import { DynamoDBClient, ListTablesCommand, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { awsCredentialsService } from './awsCredentialsService'
import { clientService } from './clientService'
import { DateUtils } from '@/utils/dateUtils'
import { FileExportService } from '@/utils/fileExport'
import type {
  AppRunRecord,
  ChatMessageRecord,
  UsageSummary,
  UsageReportParameters,
  UsageReportResult,
  ToolProgress,
  ToolResultFile,
} from '@/types/tools'

export class UsageReportService {
  /**
   * Generate usage report for a client
   */
  static async generateReport(
    parameters: UsageReportParameters,
    onProgress?: (progress: ToolProgress) => void
  ): Promise<{ result: UsageReportResult; files: ToolResultFile[] }> {
    const { clientName, timePeriod, outputFormat } = parameters

    try {
      onProgress?.({ current: 0, total: 100, message: 'Starting report generation...' })

      const dateRange = DateUtils.parseTimePeriod(timePeriod)

      onProgress?.({ current: 5, total: 100, message: 'Loading client configuration...' })

      // Get client configuration
      const clients = await clientService.getAllClients()
      const client = clients.find(c => c.name === clientName)
      if (!client) {
        throw new Error(`Client ${clientName} not found`)
      }

      const accountId = client.config.clientAccountId
      const region = client.config.region || 'us-east-1'

      if (!accountId) {
        throw new Error(`Account ID for ${clientName} not found in configuration`)
      }

      onProgress?.({ current: 10, total: 100, message: 'Establishing AWS connection...' })

      // Set up AWS clients with client account credentials
      const awsClientConfig = await awsCredentialsService.getClientConfig(accountId, region)
      const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig))

      onProgress?.({ current: 20, total: 100, message: 'Discovering data tables...' })

      // Get all jobs tables
      const jobsTableNames = await this.getJobsTableNames(dynamoClient, clientName)

      onProgress?.({ current: 30, total: 100, message: 'Fetching usage data...' })

      // Chat history table name
      const chatTableName = `numa-${clientName}-chat-history`

      // Fetch data in parallel
      const [appRuns, chatMessages] = await Promise.all([
        this.getAllAppRuns(dynamoClient, jobsTableNames, dateRange.startDate, dateRange.endDate, (progress) => {
          onProgress?.({ current: 30 + progress * 0.25, total: 100, message: 'Fetching app runs...' })
        }),
        this.getAllChatMessages(dynamoClient, chatTableName, dateRange.startDate, dateRange.endDate, (progress) => {
          onProgress?.({ current: 55 + progress * 0.25, total: 100, message: 'Fetching chat messages...' })
        }),
      ])

      onProgress?.({ current: 80, total: 100, message: 'Enriching data with user information...' })

      // Get unique user IDs and look up their emails
      const allUserIds = [...new Set([...appRuns.map(r => r.userId), ...chatMessages.map(m => m.userId)])]

      let enrichedAppRuns = appRuns
      let enrichedChatMessages = chatMessages

      if (allUserIds.length > 0) {
        try {
          const userPoolId = await this.findUserPoolId(awsClientConfig, clientName)
          const userEmails = await this.getUserEmails(awsClientConfig, userPoolId, allUserIds)
          const enrichedData = this.enrichDataWithEmails(appRuns, chatMessages, userEmails)
          enrichedAppRuns = enrichedData.appRuns
          enrichedChatMessages = enrichedData.chatMessages
        } catch (error) {
          console.warn('Could not enrich data with emails:', error)
          // Continue with user IDs only
        }
      }

      onProgress?.({ current: 90, total: 100, message: 'Generating summary and files...' })

      // Aggregate data
      const summary = this.aggregateUsageData(enrichedAppRuns, enrichedChatMessages)

      // Create result object
      const result: UsageReportResult = {
        metadata: {
          clientName,
          period: dateRange.period,
          displayName: dateRange.displayName,
          exportDate: new Date().toISOString(),
          totalAppRuns: enrichedAppRuns.length,
          totalChatMessages: enrichedChatMessages.length,
          uniqueUsers: new Set([...enrichedAppRuns.map(r => r.userId), ...enrichedChatMessages.map(m => m.userId)]).size,
        },
        appRuns: enrichedAppRuns,
        chatMessages: enrichedChatMessages,
        summary,
      }

      // Generate files
      let files: ToolResultFile[] = []

      if (outputFormat === 'json') {
        const jsonFile = FileExportService.generateUsageReportJSON(
          enrichedAppRuns,
          enrichedChatMessages,
          summary,
          clientName,
          dateRange.period,
          dateRange.displayName
        )
        if (jsonFile) files.push(jsonFile)
      } else {
        files = FileExportService.generateUsageReportCSVs(
          enrichedAppRuns,
          enrichedChatMessages,
          summary,
          clientName,
          dateRange.period
        )
      }

      onProgress?.({ current: 100, total: 100, message: 'Report generation completed!' })

      // If no data at all, include a helpful message but still return files (headers only)
      const enhancedResult = (enrichedAppRuns.length === 0 && enrichedChatMessages.length === 0)
        ? {
            ...result,
            message: `No usage data found for ${clientName} in ${dateRange.displayName}. Files include headers only.`,
          }
        : result

      return { result: enhancedResult, files }

    } catch (error) {
      throw new Error(`Failed to generate usage report: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private static async getJobsTableNames(
    dynamoClient: DynamoDBDocumentClient,
    clientName: string
  ): Promise<string[]> {
    // List all tables and filter for jobs tables
    const client = new DynamoDBClient({
      region: dynamoClient.config.region,
      credentials: dynamoClient.config.credentials,
    })

    const result = await client.send(new ListTablesCommand({}))

    const jobsTables = result.TableNames?.filter(
      (tableName) => tableName.startsWith(`${clientName}-`) && tableName.endsWith('-recent-jobs')
    ) || []

    return jobsTables
  }

  private static async getAllAppRuns(
    dynamoClient: DynamoDBDocumentClient,
    jobsTableNames: string[],
    startDate: Date,
    endDate: Date,
    onProgress?: (progress: number) => void
  ): Promise<AppRunRecord[]> {
    const allRuns: AppRunRecord[] = []
    const totalTables = jobsTableNames.length

    for (let i = 0; i < totalTables; i++) {
      const tableName = jobsTableNames[i]
      onProgress?.(i / totalTables)

      let lastEvaluatedKey: Record<string, unknown> | undefined = undefined
      do {
        const command = new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastEvaluatedKey,
        })

        const result = await dynamoClient.send(command)

        if (result.Items) {
          for (const item of result.Items) {
            const startedAt = new Date(item.startedAt || item.dateTime)

            if (DateUtils.isDateInRange(startedAt, startDate, endDate)) {
              // Extract app ID from table name
              const appId = tableName.replace(/^.*?-(.+)-recent-jobs$/, '$1')

              allRuns.push({
                userId: item.userId || 'unknown',
                appId,
                appName: item.appName || appId,
                month: startedAt.toISOString().substring(0, 7), // YYYY-MM format
                jobId: item.jobId,
                startedAt: item.startedAt || item.dateTime,
                status: item.status || 'unknown',
              })
            }
          }
        }

        lastEvaluatedKey = result.LastEvaluatedKey
      } while (lastEvaluatedKey)
    }

    onProgress?.(1)
    return allRuns
  }

  private static async getAllChatMessages(
    dynamoClient: DynamoDBDocumentClient,
    chatTableName: string,
    startDate: Date,
    endDate: Date,
    onProgress?: (progress: number) => void
  ): Promise<ChatMessageRecord[]> {
    const allMessages: ChatMessageRecord[] = []
    let processedItems = 0
    let totalItems = 0

    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined
    do {
      const command = new ScanCommand({
        TableName: chatTableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })

      try {
        const result = await dynamoClient.send(command)

        if (result.Items) {
          totalItems += result.Items.length

          for (const item of result.Items) {
            processedItems++
            if (processedItems % 100 === 0) {
              onProgress?.(Math.min(processedItems / Math.max(totalItems, processedItems), 0.9))
            }

            const messageDate = new Date(item.timestamp)

            if (DateUtils.isDateInRange(messageDate, startDate, endDate)) {
              // Convert timestamp to NZ date format DD/MM/YYYY (same as CLI tool)
              const nzDate = new Date(item.timestamp).toLocaleDateString('en-NZ', {
                timeZone: 'Pacific/Auckland',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })

              allMessages.push({
                userId: item.user_id || 'unknown',
                month: messageDate.toISOString().substring(0, 7), // YYYY-MM format
                conversationId: item.conversation_id || 'unknown',
                messageType: item.message_type || 'unknown',
                role: item.role || 'unknown',
                timestamp: nzDate,
              })
            }
          }
        }

        lastEvaluatedKey = result.LastEvaluatedKey
      } catch (error) {
        // Chat table might not exist for some clients
        console.warn(`Could not access chat table ${chatTableName}:`, error)
        break
      }
    } while (lastEvaluatedKey)

    onProgress?.(1)
    return allMessages
  }

  private static async findUserPoolId(
    awsClientConfig: DynamoDBClientConfig,
    clientName: string
  ): Promise<string> {
    const cognito = new CognitoIdentityProviderClient(awsClientConfig)

    const response = await cognito.send(
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

  private static async getUserEmails(
    awsClientConfig: DynamoDBClientConfig,
    userPoolId: string,
    userIds: string[]
  ): Promise<Record<string, string>> {
    const cognito = new CognitoIdentityProviderClient(awsClientConfig)
    const userEmails: Record<string, string> = {}

    for (const userId of userIds) {
      try {
        const response = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: userId,
          })
        )

        const emailAttr = response.UserAttributes?.find((attr) => attr.Name === 'email')
        userEmails[userId] = emailAttr?.Value || `${userId}@unknown`
      } catch (error) {
        console.warn(`Could not find email for user ${userId}:`, error)
        userEmails[userId] = `${userId}@unknown`
      }
    }

    return userEmails
  }

  private static enrichDataWithEmails(
    appRuns: AppRunRecord[],
    chatMessages: ChatMessageRecord[],
    userEmails: Record<string, string>
  ): { appRuns: AppRunRecord[]; chatMessages: ChatMessageRecord[] } {
    const enrichedAppRuns = appRuns.map((run) => ({
      ...run,
      userEmail: userEmails[run.userId] || `${run.userId}@unknown`,
    }))

    const enrichedChatMessages = chatMessages.map((message) => ({
      ...message,
      userEmail: userEmails[message.userId] || `${message.userId}@unknown`,
    }))

    return { appRuns: enrichedAppRuns, chatMessages: enrichedChatMessages }
  }

  private static aggregateUsageData(
    appRuns: AppRunRecord[],
    chatMessages: ChatMessageRecord[]
  ): UsageSummary[] {
    const summaryMap = new Map<string, UsageSummary>()

    // Process app runs
    for (const run of appRuns) {
      const key = `${run.userId}-${run.month}`

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          userId: run.userId,
          userEmail: run.userEmail,
          month: run.month,
          appRuns: 0,
          chatMessages: 0,
          appRunsByApp: {},
          chatMessagesByType: {},
        })
      }

      const summary = summaryMap.get(key)!
      summary.appRuns++
      summary.appRunsByApp[run.appName] = (summary.appRunsByApp[run.appName] || 0) + 1
    }

    // Process chat messages
    for (const message of chatMessages) {
      const key = `${message.userId}-${message.month}`

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          userId: message.userId,
          userEmail: message.userEmail,
          month: message.month,
          appRuns: 0,
          chatMessages: 0,
          appRunsByApp: {},
          chatMessagesByType: {},
        })
      }

      const summary = summaryMap.get(key)!
      summary.chatMessages++
      summary.chatMessagesByType[message.messageType] = (summary.chatMessagesByType[message.messageType] || 0) + 1
    }

    return Array.from(summaryMap.values()).sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month)
      return a.userId.localeCompare(b.userId)
    })
  }
}
