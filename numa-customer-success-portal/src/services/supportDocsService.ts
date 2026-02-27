import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { awsCredentialsService } from '@/services/awsCredentialsService'
import { getConfigValue } from '@/services/configService'
import { withPRM } from '@/utils/prmUtils'

export interface MasterSupportDoc {
  key: string
  size: number
  lastModified?: string
  uploadedBy?: string
}

export interface DeployProgress {
  current: number
  total: number
  message: string
}

const NUMA_SUPPORT_KB_ID = 'numa-support'
const NUMA_SUPPORT_PREFIX = `documents/${NUMA_SUPPORT_KB_ID}/`
const MAX_DELETE_BATCH = 1000

function getSupportDocsBucket(): string {
  const bucket = getConfigValue('SUPPORT_DOCS_BUCKET')
  if (!bucket) {
    throw new Error('SUPPORT_DOCS_BUCKET is not configured in portal config')
  }
  return bucket
}

function toMasterDocs(items: _Object[] | undefined): MasterSupportDoc[] {
  return (items || [])
    .filter((item) => !!item.Key && !item.Key.endsWith('/') && !item.Key.endsWith('.metadata.json'))
    .map((item) => ({
      key: item.Key as string,
      size: item.Size || 0,
      lastModified: item.LastModified?.toISOString(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

async function listAllS3Keys(client: S3Client, bucket: string, prefix = ''): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    for (const item of response.Contents || []) {
      if (item.Key) {
        keys.push(item.Key)
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)

  return keys
}

async function chunkedDelete(client: S3Client, bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return
  }
  for (let index = 0; index < keys.length; index += MAX_DELETE_BATCH) {
    const chunk = keys.slice(index, index + MAX_DELETE_BATCH)
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((key) => ({ Key: key })),
        Quiet: true,
      },
    }))
  }
}

async function downloadMasterDoc(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ bytes: Uint8Array; contentType?: string }> {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }))
  const body = response.Body
  if (!body) {
    throw new Error(`Master document has no body: ${key}`)
  }
  const bytes = await body.transformToByteArray()
  return { bytes, contentType: response.ContentType }
}

export class SupportDocsService {
  async listMasterDocs(): Promise<MasterSupportDoc[]> {
    const bucket = getSupportDocsBucket()
    const deployerConfig = await awsCredentialsService.getDeployerClientConfig()
    const s3 = withPRM(S3Client, deployerConfig)
    const response = await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
    const docs = toMasterDocs(response.Contents)

    // Fetch uploaded_by metadata for each doc via HeadObject.
    // Done in parallel for speed; failures are non-fatal.
    await Promise.all(docs.map(async (doc) => {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: doc.key }))
        doc.uploadedBy = head.Metadata?.['uploaded_by']
      } catch {
        // Non-fatal — just won't show uploader for this file
      }
    }))

    return docs
  }

  async uploadMasterDoc(file: File, uploadedBy?: string): Promise<void> {
    const bucket = getSupportDocsBucket()
    const deployerConfig = await awsCredentialsService.getDeployerClientConfig()
    const s3 = withPRM(S3Client, deployerConfig)
    // Read the File into a Uint8Array first — passing a raw File object as Body
    // fails in the browser SDK (getReader is not a function). Uint8Array works.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const metadata: Record<string, string> = {}
    if (uploadedBy) {
      metadata['uploaded_by'] = uploadedBy
    }
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: file.name,
      Body: bytes,
      ContentType: file.type || 'application/octet-stream',
      Metadata: metadata,
    }))
  }

  async deleteMasterDoc(key: string): Promise<void> {
    const bucket = getSupportDocsBucket()
    const deployerConfig = await awsCredentialsService.getDeployerClientConfig()
    const s3 = withPRM(S3Client, deployerConfig)
    await s3.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }))
  }

  async ensureKBRecord(clientName: string, accountId: string, region: string): Promise<boolean> {
    const clientConfig = await awsCredentialsService.getClientConfig(accountId, region)
    const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, clientConfig))
    const tableName = `numa-${clientName}-knowledge-bases`
    const pk = `TENANT#${clientName}`
    const sk = `KB#${NUMA_SUPPORT_KB_ID}`

    const existing = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
    }))
    if (existing.Item) {
      return false
    }

    const now = new Date().toISOString()
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: pk,
        SK: sk,
        kb_id: NUMA_SUPPORT_KB_ID,
        kb_name: 'Numa Support',
        s3_prefix: NUMA_SUPPORT_PREFIX,
        is_default: false,
        viewers: new Set(['*']), // marshals to DynamoDB String Set (SS)
        editors: [],
        created_by: 'system',
        created_at: now,
        updated_at: now,
        status: 'ACTIVE',
        document_count: 0,
      },
    }))

    return true
  }

  async deployToClient(
    clientName: string,
    accountId: string,
    region: string,
    masterDocs: MasterSupportDoc[],
    onProgress?: (progress: DeployProgress) => void,
  ): Promise<{ uploadedCount: number; cleanedCount: number; kbCreated: boolean }> {
    const supportDocsBucket = getSupportDocsBucket()
    const deployerConfig = await awsCredentialsService.getDeployerClientConfig()
    const clientConfig = await awsCredentialsService.getClientConfig(accountId, region)
    const deployerS3 = withPRM(S3Client, deployerConfig)
    const clientS3 = withPRM(S3Client, clientConfig)
    const targetBucket = `numa-${clientName}-data`
    const desiredKeys = new Set<string>()
    const uploadTotal = masterDocs.length
    let uploaded = 0

    for (const doc of masterDocs) {
      const source = await downloadMasterDoc(deployerS3, supportDocsBucket, doc.key)
      const targetKey = `${NUMA_SUPPORT_PREFIX}${doc.key}`
      const metadataKey = `${targetKey}.metadata.json`
      const uploadedAt = new Date().toISOString()

      await clientS3.send(new PutObjectCommand({
        Bucket: targetBucket,
        Key: targetKey,
        Body: source.bytes,
        ContentType: source.contentType || 'application/octet-stream',
        Metadata: {
          kb_id: NUMA_SUPPORT_KB_ID,
          tenant_id: clientName,
          uploaded_at: uploadedAt,
          source: 'support-docs-manager',
        },
      }))
      desiredKeys.add(targetKey)

      const sidecar = {
        metadataAttributes: {
          kb_id: NUMA_SUPPORT_KB_ID,
          tenant_id: clientName,
          uploaded_at: uploadedAt,
          source: 'support-docs-manager',
        },
      }

      await clientS3.send(new PutObjectCommand({
        Bucket: targetBucket,
        Key: metadataKey,
        Body: JSON.stringify(sidecar),
        ContentType: 'application/json',
      }))
      desiredKeys.add(metadataKey)

      uploaded += 1
      onProgress?.({ current: uploaded, total: uploadTotal, message: `Uploaded ${doc.key}` })
    }

    const existingKeys = await listAllS3Keys(clientS3, targetBucket, NUMA_SUPPORT_PREFIX)
    const orphanKeys = existingKeys.filter((key) => !desiredKeys.has(key))
    await chunkedDelete(clientS3, targetBucket, orphanKeys)

    const kbCreated = await this.ensureKBRecord(clientName, accountId, region)

    return {
      uploadedCount: uploaded,
      cleanedCount: orphanKeys.length,
      kbCreated,
    }
  }
}

export const supportDocsService = new SupportDocsService()
