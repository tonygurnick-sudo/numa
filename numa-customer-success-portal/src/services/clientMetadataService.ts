import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { getConfigValue } from './configService'
import { authService } from './authService'
import type { ClientMetadata } from '@/types'

export class ClientMetadataService {
  private cache: Map<string, ClientMetadata> = new Map()
  private lastFetchTime = 0
  private readonly cacheDuration = 5 * 60 * 1000 // 5 minutes

  private getCredentialsProvider() {
    if (!this.isInBrowser() || !this.hasCognitoConfig()) return undefined

    const region = getConfigValue('AWS_REGION') || 'us-east-1'
    const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!
    const userPoolId = getConfigValue('USER_POOL_ID')!

    return async () => {
      const ensured = await authService.ensureValidSession(60 * 1000)
      const session = ensured || authService.getCurrentSession()
      if (!session) throw new Error('Not authenticated')
      const idToken = session.idToken
      const base = fromCognitoIdentityPool({
        identityPoolId,
        logins: {
          [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
        },
        clientConfig: { region },
      })
      return base()
    }
  }

  private isInBrowser(): boolean {
    return typeof window !== 'undefined'
  }

  private hasCognitoConfig(): boolean {
    return !!(getConfigValue('IDENTITY_POOL_ID') && getConfigValue('USER_POOL_ID'))
  }

  private getTableName(): string | null {
    return getConfigValue('CLIENT_METADATA_TABLE')
  }

  async getAllMetadata(): Promise<Map<string, ClientMetadata>> {
    const now = Date.now()
    if (this.cache.size > 0 && now - this.lastFetchTime < this.cacheDuration) {
      return this.cache
    }

    const tableName = this.getTableName()
    if (!tableName) return new Map()

    try {
      const credentials = this.getCredentialsProvider()
      if (!credentials) return new Map()

      const region = getConfigValue('AWS_REGION') || 'us-east-1'
      const ddb = new DynamoDBClient({ region, credentials })
      const doc = DynamoDBDocumentClient.from(ddb)

      const result = new Map<string, ClientMetadata>()
      let exclusiveStartKey: Record<string, unknown> | undefined

      do {
        const response = await doc.send(new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: exclusiveStartKey,
        }))

        for (const item of response.Items || []) {
          const metadata = item as ClientMetadata
          if (metadata.clientName) {
            result.set(metadata.clientName, metadata)
          }
        }

        exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined
      } while (exclusiveStartKey)

      this.cache = result
      this.lastFetchTime = now
      return result
    } catch (error) {
      console.error('Failed to fetch client metadata:', error)
      return new Map()
    }
  }

  async getMetadata(clientName: string): Promise<ClientMetadata | undefined> {
    const all = await this.getAllMetadata()
    return all.get(clientName)
  }

  async saveMetadata(metadata: ClientMetadata): Promise<void> {
    const tableName = this.getTableName()
    if (!tableName) throw new Error('Client metadata table not configured')

    const credentials = this.getCredentialsProvider()
    if (!credentials) throw new Error('Not authenticated')

    const session = authService.getCurrentSession()
    const item = {
      ...metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: session?.user?.email || 'unknown',
    }

    const region = getConfigValue('AWS_REGION') || 'us-east-1'
    const ddb = new DynamoDBClient({ region, credentials })
    const doc = DynamoDBDocumentClient.from(ddb)

    await doc.send(new PutCommand({
      TableName: tableName,
      Item: item,
    }))

    this.clearCache()
  }

  async deleteMetadata(clientName: string): Promise<void> {
    const tableName = this.getTableName()
    if (!tableName) throw new Error('Client metadata table not configured')

    const credentials = this.getCredentialsProvider()
    if (!credentials) throw new Error('Not authenticated')

    const region = getConfigValue('AWS_REGION') || 'us-east-1'
    const ddb = new DynamoDBClient({ region, credentials })
    const doc = DynamoDBDocumentClient.from(ddb)

    await doc.send(new DeleteCommand({
      TableName: tableName,
      Key: { clientName },
    }))

    this.clearCache()
  }

  clearCache(): void {
    this.cache.clear()
    this.lastFetchTime = 0
  }
}

export const clientMetadataService = new ClientMetadataService()
