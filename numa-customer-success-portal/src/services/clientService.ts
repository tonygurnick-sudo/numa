import { getAllClientConfigs, listClients, putClientConfig, getClientConfig } from '@arcanumai/client-config'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { Client, ClientConfig } from '@/types'
import { getConfigValue } from './configService'
import { authService } from './authService'
import { activityService } from './activityService'
import { clientConfigSchema } from '@/types'
import { validateClientName } from '@/utils/clientValidation'

export class ClientService {
  private cachedClients: Client[] = []
  private lastFetchTime: number = 0
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

  async getAllClients(): Promise<Client[]> {
    const now = Date.now()
    if (this.cachedClients.length > 0 && now - this.lastFetchTime < this.cacheDuration) {
      return this.cachedClients
    }

    try {
      const credentials = this.getCredentialsProvider()
      const [clientNames, clientConfigs] = await Promise.all([
        listClients({ credentials }),
        getAllClientConfigs<ClientConfig>({ credentials }),
      ])

      this.cachedClients = clientNames.map(name => {
        const config = clientConfigs[name]
        if (!config) {
          return {
            name,
            config: {
              clientAccountId: 'unknown',
              region: 'us-east-1',
              allApps: false,
              devInstance: name.includes('demo') || name.includes('dev'),
              provisionQResources: false,
              preferredKnowledgeBase: 'bedrock',
            },
            status: 'pending' as const,
            lastDeployment: undefined,
            deploymentCount: 0,
          }
        }

        return {
          name,
          config,
          status: this.determineClientStatus(name, config),
          lastDeployment: undefined, // TODO: Implement deployment history
          deploymentCount: 0, // TODO: Implement deployment counting
        }
      })

      this.lastFetchTime = now
      return this.cachedClients
    } catch (error) {
      console.error('Failed to fetch client data:', error)
      throw new Error('Unable to load client configurations. Please check your AWS credentials and permissions.')
    }
  }

  async getClient(name: string): Promise<Client | undefined> {
    const clients = await this.getAllClients()
    return clients.find(client => client.name === name)
  }

  private determineClientStatus(_name: string, _config: ClientConfig): Client['status'] {
    // All client configurations are intentional - default to healthy
    // Status should only indicate actual deployment/system issues, not configuration choices
    return 'healthy'
  }

  async updateClientConfig(name: string, configUpdates: Partial<ClientConfig>): Promise<void> {
    // Validate client name format
    const nameError = validateClientName(name)
    if (nameError) {
      throw new Error(`Invalid client name: ${nameError}`)
    }

    let currentConfig: ClientConfig | null = null

    try {
      const credentials = this.getCredentialsProvider()

      // Get current config
      currentConfig = await getClientConfig<ClientConfig>(name, undefined, credentials)
      if (!currentConfig) {
        throw new Error(`Client ${name} not found`)
      }

      const updateKeys = Object.keys(configUpdates) as (keyof ClientConfig)[]
      if (updateKeys.length === 0) return

      // Update only the specified fields in DynamoDB to avoid clobbering unrelated config keys.
      // If this fails (e.g., due to permissions), fall back to full put (previous behavior).
      let updatedConfig: ClientConfig = { ...currentConfig, ...configUpdates }
      updateKeys.forEach(key => {
        if (configUpdates[key] === undefined) delete (updatedConfig as any)[key]
      })
      try {
        const region = getConfigValue('AWS_REGION') || 'us-east-1'
        const ddb = new DynamoDBClient({ region, credentials })
        const doc = DynamoDBDocumentClient.from(ddb)

        const expressionAttributeNames: Record<string, string> = {
          '#config': 'config',
        }
        const expressionAttributeValues: Record<string, unknown> = {}
        const setExpressions: string[] = []
        const removeExpressions: string[] = []

        updateKeys.forEach((key, index) => {
          const nameKey = `#k${index}`
          expressionAttributeNames[nameKey] = String(key)

          if (configUpdates[key] === undefined) {
            removeExpressions.push(`#config.${nameKey}`)
            return
          }

          const valueKey = `:v${index}`
          expressionAttributeValues[valueKey] = configUpdates[key]
          setExpressions.push(`#config.${nameKey} = ${valueKey}`)
        })

        if (setExpressions.length === 0 && removeExpressions.length === 0) return

        const updateExpressionParts: string[] = []
        if (setExpressions.length > 0) updateExpressionParts.push(`SET ${setExpressions.join(', ')}`)
        if (removeExpressions.length > 0) updateExpressionParts.push(`REMOVE ${removeExpressions.join(', ')}`)

        const updateResponse = await doc.send(new UpdateCommand({
          TableName: 'numa-client-config',
          Key: { clientName: name },
          UpdateExpression: updateExpressionParts.join(' '),
          ExpressionAttributeNames: expressionAttributeNames,
          ...(setExpressions.length > 0 ? { ExpressionAttributeValues: expressionAttributeValues } : {}),
          ConditionExpression: 'attribute_exists(clientName)',
          ReturnValues: 'ALL_NEW',
        }))

        const afterConfig = (updateResponse.Attributes as any)?.config as ClientConfig | undefined
        if (afterConfig) updatedConfig = afterConfig
      } catch {
        await putClientConfig(name, updatedConfig, undefined, credentials)
      }

      // Clear cache to force refresh
      this.clearCache()

      // Log activity - determine what changed
      const changes: string[] = []
      Object.keys(configUpdates).forEach(key => {
        const oldValue = currentConfig![key as keyof ClientConfig]
        const newValue = configUpdates[key as keyof ClientConfig]
        if (oldValue !== newValue) {
          changes.push(`${key}: ${String(oldValue)} → ${String(newValue)}`)
        }
      })

      await activityService.logActivity({
        type: 'config',
        action: 'updated',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: currentConfig,
          after: updatedConfig,
          changes: changes
        },
        success: true
      })

    } catch (error) {
      // Log failed activity
      await activityService.logActivity({
        type: 'config',
        action: 'updated',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: currentConfig,
          changes: Object.keys(configUpdates)
        },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })

      console.error(`Failed to update client config for ${name}:`, error)
      throw new Error(`Unable to update client configuration. Please check your permissions.`)
    }
  }

  async replaceClientConfig(name: string, newConfig: ClientConfig): Promise<void> {
    // Validate client name format
    const nameError = validateClientName(name)
    if (nameError) {
      throw new Error(`Invalid client name: ${nameError}`)
    }

    let beforeConfig: ClientConfig | null = null
    try {
      const credentials = this.getCredentialsProvider()

      // Validate strictly using portal schema
      clientConfigSchema.strict().parse(newConfig)

      // Get current for activity logging
      beforeConfig = await getClientConfig<ClientConfig>(name, undefined, credentials)

      // Write full replacement
      await putClientConfig(name, newConfig, undefined, credentials)

      // Bust cache
      this.clearCache()

      // Compute changed top-level keys for summary
      const changed: string[] = []
      const keys = Array.from(new Set([...
        Object.keys(beforeConfig || {}), ...Object.keys(newConfig)
      ]))
      for (const k of keys) {
        const a = (beforeConfig as any)?.[k]
        const b = (newConfig as any)?.[k]
        if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(k)
      }

      await activityService.logActivity({
        type: 'config',
        action: 'updated',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: beforeConfig || undefined,
          after: newConfig,
          changes: changed,
        },
        success: true,
      })
    } catch (error) {
      await activityService.logActivity({
        type: 'config',
        action: 'updated',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: beforeConfig || undefined,
          after: undefined,
        },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      })
      console.error(`Failed to replace client config for ${name}:`, error)
      throw new Error('Unable to replace client configuration. Please verify JSON and permissions.')
    }
  }

  async createClientConfig(name: string, config: ClientConfig): Promise<void> {
    // Validate client name format
    const nameError = validateClientName(name)
    if (nameError) {
      throw new Error(`Invalid client name: ${nameError}`)
    }

    try {
      const credentials = this.getCredentialsProvider()
      // Validate against schema before write
      clientConfigSchema.parse(config)
      await putClientConfig(name, config, undefined, credentials)
      this.clearCache()

      // Log successful activity
      await activityService.logActivity({
        type: 'config',
        action: 'created',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          after: config,
          metadata: {
            region: config.region,
            devInstance: config.devInstance
          }
        },
        success: true
      })

    } catch (error) {
      // Log failed activity
      await activityService.logActivity({
        type: 'config',
        action: 'created',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          after: config
        },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })

      console.error(`Failed to create client config for ${name}:`, error)
      throw new Error(`Unable to create client configuration. Please check your permissions and input.`)
    }
  }

  async deleteClientConfig(name: string): Promise<void> {
    let deletedConfig: ClientConfig | null = null

    try {
      const credentials = this.getCredentialsProvider()

      // Get current config before deleting for activity log
      deletedConfig = await getClientConfig<ClientConfig>(name, undefined, credentials)

      const region = getConfigValue('AWS_REGION') || 'us-east-1'
      const ddb = new DynamoDBClient({ region, credentials })
      const doc = DynamoDBDocumentClient.from(ddb)
      await doc.send(new DeleteCommand({ TableName: 'numa-client-config', Key: { clientName: name } }))
      this.clearCache()

      // Log successful activity
      await activityService.logActivity({
        type: 'config',
        action: 'deleted',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: deletedConfig,
          metadata: deletedConfig ? {
            region: deletedConfig.region,
            devInstance: deletedConfig.devInstance
          } : undefined
        },
        success: true
      })

    } catch (error) {
      // Log failed activity
      await activityService.logActivity({
        type: 'config',
        action: 'deleted',
        resourceType: 'client-config',
        resourceId: name,
        details: {
          before: deletedConfig
        },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })

      console.error(`Failed to delete client config for ${name}:`, error)
      throw new Error(`Unable to delete client configuration. Please check your permissions.`)
    }
  }

  clearCache(): void {
    this.cachedClients = []
    this.lastFetchTime = 0
  }
}

export const clientService = new ClientService()

// Client grouping utilities
export interface GroupedClients {
  devClients: Client[]
  productionClients: Client[]
}

export function groupClientsByType(clients: Client[]): GroupedClients {
  const devClients = clients
    .filter(c => c.config.devInstance === true)
    .sort((a, b) => a.name.localeCompare(b.name))

  const productionClients = clients
    .filter(c => c.config.devInstance !== true)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { devClients, productionClients }
}
