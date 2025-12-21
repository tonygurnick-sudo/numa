import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminListUserAuthEventsCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { awsCredentialsService } from './awsCredentialsService'
import { clientService } from './clientService'
import type {
  UserRecord,
  AllUsersReportParameters,
  AllUsersReportResult,
  ToolProgress,
  ToolResultFile,
} from '@/types/tools'
import type { Client } from '@/types'

interface ClientUsersResult {
  clientName: string
  users: UserRecord[]
  error?: string
}

export class AllUsersReportService {
  /**
   * Generate all users report for one or multiple clients
   */
  static async generateReport(
    parameters: AllUsersReportParameters,
    onProgress?: (progress: ToolProgress) => void
  ): Promise<{ result: AllUsersReportResult; files: ToolResultFile[] }> {
    const { clientNames, userTypeFilter, outputFormat, includeLastLogin = false } = parameters

    try {
      onProgress?.({ current: 0, total: 100, message: 'Starting report generation...' })

      onProgress?.({ current: 5, total: 100, message: 'Loading client configurations...' })

      // Get all clients
      const allClients = await clientService.getAllClients()

      // Determine which clients to process
      let clientsToProcess: Client[]
      if (clientNames.length === 0) {
        // Empty array means "all clients"
        clientsToProcess = allClients
      } else {
        clientsToProcess = allClients.filter(c => clientNames.includes(c.name))
      }

      if (clientsToProcess.length === 0) {
        throw new Error('No clients found matching the selection')
      }

      onProgress?.({
        current: 10,
        total: 100,
        message: `Processing ${clientsToProcess.length} client(s)...`
      })

      // Process each client
      const clientResults: ClientUsersResult[] = []
      const failedClients: { clientName: string; error: string }[] = []

      for (let i = 0; i < clientsToProcess.length; i++) {
        const client = clientsToProcess[i]
        const progressBase = 10 + (i / clientsToProcess.length) * 80

        onProgress?.({
          current: progressBase,
          total: 100,
          message: `Processing ${client.name} (${i + 1}/${clientsToProcess.length})...`
        })

        try {
          const result = await this.processClient(client, includeLastLogin)
          clientResults.push(result)
        } catch (error) {
          console.error(`Failed to process client ${client.name}:`, error)
          failedClients.push({
            clientName: client.name,
            error: error instanceof Error ? error.message : String(error)
          })
          // Continue with next client
        }
      }

      onProgress?.({ current: 90, total: 100, message: 'Aggregating results...' })

      // Combine all users
      let allUsers: UserRecord[] = []
      for (const result of clientResults) {
        allUsers.push(...result.users)
      }

      // Apply user type filter
      if (userTypeFilter !== 'all') {
        allUsers = allUsers.filter(u => u.userType === userTypeFilter)
      }

      // Sort by client name, then email
      allUsers.sort((a, b) => {
        if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName)
        return a.email.localeCompare(b.email)
      })

      // Calculate stats
      const adminCount = allUsers.filter(u => u.userType === 'admin').length
      const regularCount = allUsers.filter(u => u.userType === 'user').length

      // Determine client names for metadata
      const processedClientNames = clientResults.map(r => r.clientName)

      // Create result object
      const result: AllUsersReportResult = {
        metadata: {
          clientNames: processedClientNames,
          exportDate: new Date().toISOString(),
          totalUsers: allUsers.length,
          adminUsers: adminCount,
          regularUsers: regularCount,
          clientsProcessed: clientResults.length,
          clientsFailed: failedClients.length,
        },
        users: allUsers,
        failedClients: failedClients.length > 0 ? failedClients : undefined,
      }

      onProgress?.({ current: 95, total: 100, message: 'Generating files...' })

      // Generate files
      const files: ToolResultFile[] = []
      const filePrefix = clientsToProcess.length === 1
        ? clientsToProcess[0].name
        : `all-clients-${clientsToProcess.length}`

      if (outputFormat === 'json') {
        const jsonFile = this.generateJSON(allUsers, result.metadata, filePrefix)
        if (jsonFile) files.push(jsonFile)
      } else {
        const csvFile = this.generateCSV(allUsers, filePrefix)
        if (csvFile) files.push(csvFile)
      }

      onProgress?.({ current: 100, total: 100, message: 'Report generation completed!' })

      // Add message if no data or partial failures
      let message: string | undefined
      if (allUsers.length === 0) {
        message = 'No users found for the selected clients.'
      } else if (failedClients.length > 0) {
        message = `Report generated with ${failedClients.length} client(s) failed: ${failedClients.map(f => f.clientName).join(', ')}`
      }

      return {
        result: message ? { ...result, message } : result,
        files
      }

    } catch (error) {
      throw new Error(`Failed to generate users report: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Process a single client and return its users
   */
  private static async processClient(client: Client, includeLastLogin: boolean): Promise<ClientUsersResult> {
    const clientName = client.name
    const accountId = client.config.clientAccountId
    const region = client.config.region || 'us-east-1'

    if (!accountId) {
      throw new Error('Account ID not found in configuration')
    }

    // Set up AWS clients with client account credentials
    const awsClientConfig = await awsCredentialsService.getClientConfig(accountId, region)
    const cognitoClient = new CognitoIdentityProviderClient(awsClientConfig)

    // Find the user pool for this client
    const userPoolId = await this.findUserPoolId(cognitoClient, clientName)

    // Get all users from the pool
    const users = await this.getAllUsers(cognitoClient, userPoolId, clientName, includeLastLogin)

    return {
      clientName,
      users,
    }
  }

  private static async findUserPoolId(
    cognitoClient: CognitoIdentityProviderClient,
    clientName: string
  ): Promise<string> {
    const response = await cognitoClient.send(
      new ListUserPoolsCommand({
        MaxResults: 60,
      })
    )

    const userPool = response.UserPools?.find((pool) => pool.Name === `numa-${clientName}`)
    if (!userPool || !userPool.Id) {
      throw new Error(`User pool numa-${clientName} not found`)
    }

    return userPool.Id
  }

  private static async getAllUsers(
    cognitoClient: CognitoIdentityProviderClient,
    userPoolId: string,
    clientName: string,
    includeLastLogin: boolean
  ): Promise<UserRecord[]> {
    const cognitoUsers: UserType[] = []
    let paginationToken: string | undefined

    do {
      const response = await cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Limit: 60,
          PaginationToken: paginationToken,
        })
      )

      if (response.Users) {
        for (const user of response.Users) {
          const emailAttr = user.Attributes?.find(attr => attr.Name === 'email')
          const emailValue = (emailAttr?.Value || '').toLowerCase()

          // Skip the system user; it is not a real end-user account.
          if (emailValue === 'numa-system-user@arcanum.ai') continue

          cognitoUsers.push(user)
        }
      }

      paginationToken = response.PaginationToken
    } while (paginationToken)

    if (cognitoUsers.length === 0) return []

    return this.enrichUsersWithDetails(cognitoClient, userPoolId, clientName, cognitoUsers, includeLastLogin)
  }

  private static async enrichUsersWithDetails(
    cognitoClient: CognitoIdentityProviderClient,
    userPoolId: string,
    clientName: string,
    cognitoUsers: UserType[],
    includeLastLogin: boolean
  ): Promise<UserRecord[]> {
    const concurrencyLimit = 5

    return this.runWithConcurrency(cognitoUsers, concurrencyLimit, async (user) => {
      const emailAttr = user.Attributes?.find(attr => attr.Name === 'email')
      const username = user.Username || 'unknown'

      const isAdmin = await this.isUserAdmin(cognitoClient, userPoolId, username)
      // Only fetch last login if enabled - this is an expensive API call
      const lastLoginAt = includeLastLogin
        ? await this.getLastLoginAt(cognitoClient, userPoolId, username)
        : undefined

      return {
        clientName,
        email: emailAttr?.Value || username,
        username,
        userType: isAdmin ? 'admin' : 'user',
        status: user.UserStatus || 'unknown',
        enabled: user.Enabled ?? false,
        createdAt: user.UserCreateDate?.toISOString() || 'unknown',
        lastLoginAt,
      }
    })
  }

  private static async getLastLoginAt(
    cognitoClient: CognitoIdentityProviderClient,
    userPoolId: string,
    username: string
  ): Promise<string | undefined> {
    try {
      const response = await cognitoClient.send(
        new AdminListUserAuthEventsCommand({
          UserPoolId: userPoolId,
          Username: username,
          MaxResults: 1,
        })
      )

      const latestSignIn = response.AuthEvents
        ?.filter(event => event.EventType === 'SignIn')
        ?.sort((a, b) => {
          const aTime = a.CreationDate?.getTime() ?? 0
          const bTime = b.CreationDate?.getTime() ?? 0
          return bTime - aTime
        })[0]

      return latestSignIn?.CreationDate?.toISOString()
    } catch (error) {
      console.warn(`Could not fetch last login for user ${username}:`, error)
      return undefined
    }
  }

  private static async isUserAdmin(
    cognitoClient: CognitoIdentityProviderClient,
    userPoolId: string,
    username: string
  ): Promise<boolean> {
    try {
      const response = await cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: username,
        })
      )

      // Check if user is in 'admin' group
      return response.Groups?.some(group => group.GroupName === 'admin') ?? false
    } catch (error) {
      console.warn(`Could not check groups for user ${username}:`, error)
      return false
    }
  }

  private static async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = []
    let index = 0

    const runNext = async (): Promise<void> => {
      while (true) {
        const currentIndex = index++
        if (currentIndex >= items.length) return

        results[currentIndex] = await worker(items[currentIndex])
      }
    }

    const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext())
    await Promise.all(runners)

    return results
  }

  private static generateCSV(
    users: UserRecord[],
    filePrefix: string
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)

    const headers = [
      'Client',
      'Email',
      'Username',
      'User Type',
      'Status',
      'Enabled',
      'Created At',
      'Last Login At',
    ]

    const rows = users.map(u => [
      u.clientName,
      u.email,
      u.username,
      u.userType,
      u.status,
      u.enabled ? 'Yes' : 'No',
      u.createdAt,
      u.lastLoginAt || '',
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell =>
        String(cell).includes(',') || String(cell).includes('"')
          ? `"${String(cell).replace(/"/g, '""')}"`
          : cell
      ).join(','))
    ].join('\n')

    return {
      name: `${filePrefix}-all-users-${timestamp}.csv`,
      content: csvContent,
      mimeType: 'text/csv',
      size: new Blob([csvContent]).size,
    }
  }

  private static generateJSON(
    users: UserRecord[],
    metadata: AllUsersReportResult['metadata'],
    filePrefix: string
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)

    const exportData = {
      metadata,
      users,
    }

    const jsonContent = JSON.stringify(exportData, null, 2)

    return {
      name: `${filePrefix}-all-users-${timestamp}.json`,
      content: jsonContent,
      mimeType: 'application/json',
      size: new Blob([jsonContent]).size,
    }
  }
}
