import type { BrandingTheme } from '../Providers/BrandingContext';
import i18n from '../i18n';

export type BrandingVersionSummary = {
  versionId: string;
  label?: string;
  updatedAt?: string;
  updatedBy?: string;
  primaryColor?: string;
  logoNav?: string | null;
};

export type BrandingConfigResponse = {
  enabled?: boolean;
  branding?: BrandingTheme & {
    componentGroups?: Record<string, boolean>;
    assets?: {
      logoNav?: string | null;
      logoLoginRight?: string | null;
      favicon?: string | null;
    };
  };
  updatedAt?: string;
  updatedBy?: string;
  versionId?: string;
  history?: BrandingVersionSummary[];
};

export type BrandingHistoryResponse = {
  history?: BrandingVersionSummary[];
};

export type BrandingSavePayload = {
  enabled: boolean;
  branding: BrandingTheme & {
    componentGroups?: Record<string, boolean>;
    assets?: {
      logoNav?: string | null;
      logoLoginRight?: string | null;
      favicon?: string | null;
    };
  };
  createVersion?: boolean;
  label?: string;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

const getBaseUrl = () => sessionStorage.getItem('API_ENDPOINT') || '/api';
const getClientId = () => sessionStorage.getItem('CLIENT_NAME') || 'numa';

type PresignResponse = {
  uploadUrl?: string;
  url?: string;
  putUrl?: string;
  presignedUrl?: string;
  assetUrl?: string;
  asset_url?: string;
  publicUrl?: string;
  public_url?: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
};

export const sanitizeFileName = (name: string): string => {
  return name.trim().replace(/\s+/g, '-');
};

const normalizePresignResponse = (raw: unknown): PresignResponse => {
  if (!raw) {
    return {};
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as PresignResponse;
      } catch (error) {
        console.error('Branding presign response JSON parse failed', error);
        return {};
      }
    }

    if (trimmed.startsWith('<')) {
      console.error(
        'Branding presign response returned HTML payload. Check API base URL or auth.',
        trimmed.slice(0, 200)
      );
      throw new Error(i18n.t('errors:branding.presignHtml'));
    }

    return {};
  }

  if (typeof raw === 'object') {
    return raw as PresignResponse;
  }

  return {};
};

export const BrandingAdminService = {
  async fetchConfig(numaGet: NumaGet): Promise<BrandingConfigResponse> {
    const clientId = getClientId();
    const result = (await numaGet(`${getBaseUrl()}/branding/${clientId}`)) as BrandingConfigResponse;
    return result || {};
  },
  async fetchHistory(numaGet: NumaGet): Promise<BrandingHistoryResponse> {
    const clientId = getClientId();
    const result = (await numaGet(`${getBaseUrl()}/branding/${clientId}/versions`)) as BrandingHistoryResponse;
    return result || {};
  },
  async saveConfig(numaPut: NumaPut, payload: BrandingSavePayload): Promise<void> {
    const clientId = getClientId();
    await numaPut(`${getBaseUrl()}/branding/${clientId}`, payload);
  },
  async requestAssetUpload(numaPost: NumaPost, assetType: string, file: File): Promise<PresignResponse> {
    const clientId = getClientId();
    const sanitizedFileName = sanitizeFileName(file.name || `${assetType}-asset`);
    const rawResponse = await numaPost(`${getBaseUrl()}/branding/${clientId}/assets`, {
      assetType,
      contentType: file.type,
      fileName: sanitizedFileName,
    });

    const response = normalizePresignResponse(rawResponse);

    const normalizedUploadUrl = response.uploadUrl ?? response.url ?? response.putUrl ?? response.presignedUrl ?? null;

    let normalizedAssetUrl =
      response.assetUrl ?? response.asset_url ?? response.publicUrl ?? response.public_url ?? undefined;

    if (!normalizedAssetUrl) {
      const fields = response.fields ?? {};
      const rawKey = (fields.key ?? fields.Key)?.toString();
      const rawBucket = (fields.bucket ?? fields.Bucket)?.toString();

      if (rawKey) {
        const normalizedKey = rawKey.replace(/^\/+/, '');

        if (rawBucket) {
          normalizedAssetUrl = `s3://${rawBucket}/${normalizedKey}`;
        } else if (normalizedUploadUrl) {
          const baseUrl = normalizedUploadUrl.split('?')[0];

          try {
            const parsed = new URL(baseUrl);
            const hostParts = parsed.hostname.split('.');
            const s3Index = hostParts.findIndex((part) => part === 's3');

            if (s3Index > 0) {
              const bucketName = hostParts.slice(0, s3Index).join('.');
              normalizedAssetUrl = `s3://${bucketName}/${normalizedKey}`;
            } else if (
              parsed.hostname === 's3.amazonaws.com' ||
              parsed.hostname.startsWith('s3-') ||
              parsed.hostname.startsWith('s3.')
            ) {
              const firstSegment = parsed.pathname.replace(/^\/+/, '').split('/')[0];
              if (firstSegment) {
                normalizedAssetUrl = `s3://${firstSegment}/${normalizedKey}`;
              }
            }
          } catch {
            const trimmedBase = baseUrl.replace(/\/+$/, '');
            normalizedAssetUrl = `${trimmedBase}/${normalizedKey}`;
          }

          if (!normalizedAssetUrl) {
            const trimmedBase = baseUrl.replace(/\/+$/, '');
            normalizedAssetUrl = `${trimmedBase}/${normalizedKey}`;
          }
        }
      }
    }

    if (!normalizedAssetUrl && normalizedUploadUrl) {
      normalizedAssetUrl = normalizedUploadUrl.split('?')[0];
    }

    return {
      ...response,
      uploadUrl: normalizedUploadUrl ?? undefined,
      assetUrl: normalizedAssetUrl,
    };
  },
  async revertVersion(numaPost: NumaPost, versionId: string): Promise<BrandingConfigResponse> {
    const clientId = getClientId();
    const result = (await numaPost(
      `${getBaseUrl()}/branding/${clientId}/versions/${versionId}/revert`
    )) as BrandingConfigResponse;
    return result || {};
  },
  async fetchVersion(numaGet: NumaGet, versionId: string): Promise<BrandingConfigResponse> {
    const clientId = getClientId();
    const result = (await numaGet(
      `${getBaseUrl()}/branding/${clientId}/versions/${versionId}`
    )) as BrandingConfigResponse;
    return result || {};
  },
};
