import { getAllClientConfigs, listClients, putClientConfig, getClientConfig } from '@arcanumai/client-config'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { Client, ClientConfig } from '@/types'
import { getConfigValue } from './configService'
import { authService } from './authService'

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
    try {
      const credentials = this.getCredentialsProvider()

      // Get current config
      const currentConfig = await getClientConfig<ClientConfig>(name, undefined, credentials)
      if (!currentConfig) {
        throw new Error(`Client ${name} not found`)
      }

      // Merge updates
      const updatedConfig = { ...currentConfig, ...configUpdates }

      // Update in DynamoDB
      await putClientConfig(name, updatedConfig, undefined, credentials)

      // Clear cache to force refresh
      this.clearCache()
    } catch (error) {
      console.error(`Failed to update client config for ${name}:`, error)
      throw new Error(`Unable to update client configuration. Please check your permissions.`)
    }
  }

  clearCache(): void {
    this.cachedClients = []
    this.lastFetchTime = 0
  }
}

export const clientService = new ClientService()
