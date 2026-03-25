import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { withPRM } from '../utils/prmUtils';

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';

export interface CostBreakdown {
  lambda?: { durationMs: number; memoryMb?: number };
  fargate?: { vcpu: number; memoryGb: number; arch?: string; durationMs: number };
  s3?: { reads: number; writes: number };
  bedrock?: { inputTokens: number; outputTokens: number };
  transcribe?: { durationSeconds: number };
  total: number;
}

export interface TranscriptionJob {
  userSub: string;
  jobId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  fileExtension: string;
  status: JobStatus;
  clientName: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  errorMessage?: string;
  outputKey?: string;
  progress?: number;
  processingTimeMs?: number;
  costs?: CostBreakdown;
  pipelineId?: string;
}

export interface TranscriptionListResponse {
  jobs: TranscriptionJob[];
  nextToken?: string;
  count: number;
}

export interface TranscriptionSubmitResponse {
  jobId: string;
  status: 'QUEUED';
}

export interface TranscriptionFilters {
  status?: string;
  limit?: number;
  nextToken?: string;
}

export interface TranscriptionOutputPage {
  text: string;
  page_number: number;
  num_words?: number;
}

export interface TranscriptionOutput {
  pages: TranscriptionOutputPage[];
  [key: string]: unknown;
}

export interface UploadHandle {
  promise: Promise<string>;
  abort: () => void;
}

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const TranscriptionService = {
  async submit(
    fileName: string,
    fileKey: string,
    numaPost: NumaPost,
    sourceBucket?: string,
    pipelineId?: string
  ): Promise<TranscriptionSubmitResponse> {
    const response = (await numaPost('/api/transcriptions', {
      fileName,
      fileKey,
      ...(sourceBucket && { sourceBucket }),
      ...(pipelineId && { pipelineId }),
    })) as TranscriptionSubmitResponse;
    return response;
  },

  /**
   * Upload a file to S3 with progress tracking and abort support.
   * Returns an UploadHandle with a promise (resolves to fileKey) and abort function.
   */
  uploadToS3(
    file: File,
    userSub: string,
    onProgress: (progress: number) => void,
    getCredentials: () => Promise<AwsCredentialIdentity>
  ): UploadHandle {
    let xhrRef: XMLHttpRequest | null = null;
    let aborted = false;

    const promise = (async (): Promise<string> => {
      const region = sessionStorage.getItem('REGION');
      const dataBucket = sessionStorage.getItem('DATA_BUCKET');

      if (!region || !dataBucket) {
        throw new Error('Missing region or DATA_BUCKET configuration');
      }

      const fileKey = `transcriptions/uploads/${userSub}/${Date.now()}/${file.name}`;

      const credentials = await getCredentials();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s3Client = withPRM(S3Client as any, { region, credentials });

      const command = new PutObjectCommand({
        Bucket: dataBucket,
        Key: fileKey,
        ContentType: file.type || 'application/octet-stream',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

      if (aborted) throw new Error('Upload cancelled');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef = xhr;
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded * 100) / e.total));
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });

      onProgress(100);
      return fileKey;
    })();

    return {
      promise,
      abort: () => {
        aborted = true;
        if (xhrRef) xhrRef.abort();
      },
    };
  },

  /** Fetch the output.json content for a completed transcription job. */
  async getOutputContent(
    outputKey: string,
    getCredentials: () => Promise<AwsCredentialIdentity>
  ): Promise<TranscriptionOutput> {
    const region = sessionStorage.getItem('REGION');
    const dataBucket = sessionStorage.getItem('DATA_BUCKET');

    if (!region || !dataBucket) {
      throw new Error('Missing region or DATA_BUCKET configuration');
    }

    const credentials = await getCredentials();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s3Client = withPRM(S3Client as any, { region, credentials });

    const command = new GetObjectCommand({
      Bucket: dataBucket,
      Key: outputKey,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

    const response = await fetch(presignedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch output: ${response.status}`);
    }

    return (await response.json()) as TranscriptionOutput;
  },

  async list(filters: TranscriptionFilters, numaGet: NumaGet): Promise<TranscriptionListResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.nextToken) params.set('nextToken', filters.nextToken);
    const qs = params.toString();
    const url = `/api/transcriptions${qs ? `?${qs}` : ''}`;
    return (await numaGet(url)) as TranscriptionListResponse;
  },

  async get(jobId: string, numaGet: NumaGet): Promise<TranscriptionJob> {
    return (await numaGet(`/api/transcriptions/${encodeURIComponent(jobId)}`)) as TranscriptionJob;
  },

  async cancel(jobId: string, numaDelete: NumaDelete): Promise<void> {
    await numaDelete(`/api/transcriptions/${encodeURIComponent(jobId)}`);
  },

  async retry(jobId: string, numaPost: NumaPost): Promise<void> {
    await numaPost(`/api/transcriptions/${encodeURIComponent(jobId)}/retry`);
  },

  async listAll(filters: TranscriptionFilters, numaGet: NumaGet): Promise<TranscriptionListResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.nextToken) params.set('nextToken', filters.nextToken);
    const qs = params.toString();
    const url = `/api/transcriptions/admin/all${qs ? `?${qs}` : ''}`;
    return (await numaGet(url)) as TranscriptionListResponse;
  },

  // CHOSE HEAD: lookupByPath added after original rebuild commit for dedup / link-resolution.
  // To revert: remove this method and the corresponding route in infra + lambda.
  /** Look up transcription jobs by S3 file key (path). */
  async lookupByPath(fileKey: string, numaGet: NumaGet): Promise<TranscriptionListResponse> {
    const url = `/api/transcriptions/lookup/path?fileKey=${encodeURIComponent(fileKey)}`;
    return (await numaGet(url)) as TranscriptionListResponse;
  },

  async rebuild(numaPost: NumaPost): Promise<{ created: number; skipped: number; failed: number; total: number }> {
    return (await numaPost('/api/transcriptions/admin/rebuild')) as {
      created: number;
      skipped: number;
      failed: number;
      total: number;
    };
  },

  /** Convert transcription output pages to a single text string. */
  outputToText(output: TranscriptionOutput): string {
    if (!output.pages?.length) return '';
    return output.pages.map((p) => p.text).join('\n\n');
  },
};
