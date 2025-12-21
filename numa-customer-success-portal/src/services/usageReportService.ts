import { DynamoDBClient, ListTablesCommand, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { awsCredentialsService } from './awsCredentialsService'
import type { AWSClientConfig } from './awsCredentialsService'
import { clientService } from './clientService'
import { DateUtils } from '@/utils/dateUtils'
import { FileExportService } from '@/utils/fileExport'
import type {
  AppRunRecord,
  ChatMessageRecord,
  AgentRecord,
  AgentUsageRecord,
  IntegrationRecord,
  IntegrationChatUsageRecord,
  AgentIntegrationUsageRecord,
  KnowledgeBaseRecord,
  UsageSummary,
  UsageReportType,
  UsageReportParameters,
  UsageReportResult,
  ToolProgress,
  ToolResultFile,
} from '@/types/tools'
import type { Client } from '@/types'

const ALL_USAGE_REPORT_TYPES: UsageReportType[] = [
  'summary',
  'app-runs',
  'chat-messages',
  'agents',
  'agent-usage',
  'integrations',
  'integration-chat-usage',
  'agent-integration-usage',
  'knowledge-bases',
]

interface ClientResult {
  clientName: string
  appRuns: AppRunRecord[]
  chatMessages: ChatMessageRecord[]
  agents: AgentRecord[]
  agentUsage: AgentUsageRecord[]
  integrations: IntegrationRecord[]
  integrationChatUsage: IntegrationChatUsageRecord[]
  agentIntegrationUsage: AgentIntegrationUsageRecord[]
  knowledgeBases: KnowledgeBaseRecord[]
  error?: string
}

export class UsageReportService {
  /**
   * Generate usage report for one or multiple clients
   */
  static async generateReport(
    parameters: UsageReportParameters,
    onProgress?: (progress: ToolProgress) => void
  ): Promise<{ result: UsageReportResult; files: ToolResultFile[] }> {
    const {
      clientNames,
      timePeriod,
      customStartDate,
      customEndDate,
      timeGranularity = 'month',
      outputFormat,
      reports
    } = parameters
    const selectedReports = reports && reports.length > 0 ? reports : ALL_USAGE_REPORT_TYPES

    try {
      onProgress?.({ current: 0, total: 100, message: 'Starting report generation...' })

      const dateRange = DateUtils.parseTimePeriod(timePeriod, {
        startDate: customStartDate,
        endDate: customEndDate,
      })

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
      const clientResults: ClientResult[] = []
      const failedClients: { clientName: string; error: string }[] = []

      for (let i = 0; i < clientsToProcess.length; i++) {
        const client = clientsToProcess[i]
        const progressBase = 10 + (i / clientsToProcess.length) * 75

        onProgress?.({
          current: progressBase,
          total: 100,
          message: `Processing ${client.name} (${i + 1}/${clientsToProcess.length})...`
        })

        try {
          const result = await this.processClient(
            client,
            dateRange.startDate,
            dateRange.endDate,
            selectedReports,
            timeGranularity
          )
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

      onProgress?.({ current: 85, total: 100, message: 'Aggregating results...' })

      // Combine all results
      const allAppRuns: AppRunRecord[] = []
      const allChatMessages: ChatMessageRecord[] = []
      const allAgents: AgentRecord[] = []
      const allAgentUsage: AgentUsageRecord[] = []
      const allIntegrations: IntegrationRecord[] = []
      const allIntegrationChatUsage: IntegrationChatUsageRecord[] = []
      const allAgentIntegrationUsage: AgentIntegrationUsageRecord[] = []
      const allKnowledgeBases: KnowledgeBaseRecord[] = []

      for (const result of clientResults) {
        allAppRuns.push(...result.appRuns)
        allChatMessages.push(...result.chatMessages)
        allAgents.push(...result.agents)
        allAgentUsage.push(...result.agentUsage)
        allIntegrations.push(...result.integrations)
        allIntegrationChatUsage.push(...result.integrationChatUsage)
        allAgentIntegrationUsage.push(...result.agentIntegrationUsage)
        allKnowledgeBases.push(...result.knowledgeBases)
      }

      onProgress?.({ current: 90, total: 100, message: 'Generating summary and files...' })

      // Aggregate data
      const summary = selectedReports.includes('summary')
        ? this.aggregateUsageData(allAppRuns, allChatMessages)
        : []

      // Determine client names for metadata
      const processedClientNames = clientResults.map(r => r.clientName)

      // Create result object
      const uniqueUsageUsers = selectedReports.some(r => ['app-runs', 'chat-messages', 'summary'].includes(r))
        ? new Set([...allAppRuns.map(r => r.userId), ...allChatMessages.map(m => m.userId)]).size
        : undefined
      const totalAgentConversations = selectedReports.includes('agent-usage')
        ? allAgentUsage.reduce((sum, record) => sum + record.conversationCount, 0)
        : undefined
      const totalIntegrationChats = selectedReports.includes('integration-chat-usage')
        ? allIntegrationChatUsage.length
        : undefined
      const totalAgentIntegrationRuns = selectedReports.includes('agent-integration-usage')
        ? allAgentIntegrationUsage.length
        : undefined
      const totalKnowledgeBases = selectedReports.includes('knowledge-bases')
        ? allKnowledgeBases.length
        : undefined
      const totalKnowledgeBaseFiles = selectedReports.includes('knowledge-bases')
        ? allKnowledgeBases.reduce((sum, record) => sum + (record.fileCount || 0), 0)
        : undefined

      const result: UsageReportResult = {
        metadata: {
          clientNames: processedClientNames,
          period: dateRange.period,
          displayName: dateRange.displayName,
          timeGranularity,
          exportDate: new Date().toISOString(),
          clientsProcessed: clientResults.length,
          clientsFailed: failedClients.length,
          selectedReports,
          totalAppRuns: selectedReports.some(r => ['app-runs', 'summary'].includes(r)) ? allAppRuns.length : undefined,
          totalChatMessages: selectedReports.some(r => ['chat-messages', 'summary'].includes(r)) ? allChatMessages.length : undefined,
          uniqueUsers: uniqueUsageUsers,
          totalAgents: selectedReports.includes('agents') ? allAgents.length : undefined,
          totalAgentUsage: selectedReports.includes('agent-usage') ? allAgentUsage.length : undefined,
          uniqueAgentUsers: selectedReports.includes('agent-usage')
            ? new Set(allAgentUsage.map(r => r.userId)).size
            : undefined,
          agentConversationCount: totalAgentConversations,
          totalIntegrations: selectedReports.includes('integrations') ? allIntegrations.length : undefined,
          totalIntegrationChats,
          totalAgentIntegrationRuns,
          totalKnowledgeBases,
          totalKnowledgeBaseFiles,
        },
        appRuns: selectedReports.includes('app-runs') ? allAppRuns : undefined,
        chatMessages: selectedReports.includes('chat-messages') ? allChatMessages : undefined,
        summary: selectedReports.includes('summary') ? summary : undefined,
        agents: selectedReports.includes('agents') ? allAgents : undefined,
        agentUsage: selectedReports.includes('agent-usage') ? allAgentUsage : undefined,
        integrations: selectedReports.includes('integrations') ? allIntegrations : undefined,
        integrationChatUsage: selectedReports.includes('integration-chat-usage') ? allIntegrationChatUsage : undefined,
        agentIntegrationUsage: selectedReports.includes('agent-integration-usage') ? allAgentIntegrationUsage : undefined,
        knowledgeBases: selectedReports.includes('knowledge-bases') ? allKnowledgeBases : undefined,
        failedClients: failedClients.length > 0 ? failedClients : undefined,
      }

      // Generate files
      let files: ToolResultFile[] = []
      const filePrefix = clientsToProcess.length === 1
        ? clientsToProcess[0].name
        : `all-clients-${clientsToProcess.length}`

      if (outputFormat === 'json') {
        const jsonFile = FileExportService.generateUsageReportJSON(
          {
            appRuns: allAppRuns,
            chatMessages: allChatMessages,
            summary,
            agents: allAgents,
            agentUsage: allAgentUsage,
            integrations: allIntegrations,
            integrationChatUsage: allIntegrationChatUsage,
            agentIntegrationUsage: allAgentIntegrationUsage,
            knowledgeBases: allKnowledgeBases,
          },
          selectedReports,
          filePrefix,
          dateRange.period,
          dateRange.displayName
        )
        if (jsonFile) files.push(jsonFile)
      } else {
        files = FileExportService.generateUsageReportCSVs(
          {
            appRuns: allAppRuns,
            chatMessages: allChatMessages,
            summary,
            agents: allAgents,
            agentUsage: allAgentUsage,
            integrations: allIntegrations,
            integrationChatUsage: allIntegrationChatUsage,
            agentIntegrationUsage: allAgentIntegrationUsage,
            knowledgeBases: allKnowledgeBases,
          },
          selectedReports,
          filePrefix,
          dateRange.period
        )
      }

      onProgress?.({ current: 100, total: 100, message: 'Report generation completed!' })

      // Add message if no data or partial failures
      let message: string | undefined
      const totalSelectedRecords = [
        selectedReports.includes('app-runs') ? allAppRuns.length : 0,
        selectedReports.includes('chat-messages') ? allChatMessages.length : 0,
        selectedReports.includes('summary') ? summary.length : 0,
        selectedReports.includes('agents') ? allAgents.length : 0,
        selectedReports.includes('agent-usage') ? allAgentUsage.length : 0,
        selectedReports.includes('integrations') ? allIntegrations.length : 0,
        selectedReports.includes('integration-chat-usage') ? allIntegrationChatUsage.length : 0,
        selectedReports.includes('agent-integration-usage') ? allAgentIntegrationUsage.length : 0,
        selectedReports.includes('knowledge-bases') ? allKnowledgeBases.length : 0,
      ].reduce((sum, value) => sum + value, 0)

      if (totalSelectedRecords === 0) {
        message = `No data found for the selected reports in ${dateRange.displayName}. Files include headers only.`
      } else if (failedClients.length > 0) {
        message = `Report generated with ${failedClients.length} client(s) failed: ${failedClients.map(f => f.clientName).join(', ')}`
      }

      return {
        result: message ? { ...result, message } : result,
        files
      }

    } catch (error) {
      throw new Error(`Failed to generate usage report: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Process a single client and return its data
   */
  private static async processClient(
    client: Client,
    startDate: Date,
    endDate: Date,
    selectedReports: UsageReportType[],
    timeGranularity: 'month' | 'day'
  ): Promise<ClientResult> {
    const clientName = client.name
    const accountId = client.config.clientAccountId
    const region = client.config.region || 'us-east-1'

    if (!accountId) {
      throw new Error(`Account ID not found in configuration`)
    }

    // Set up AWS clients with client account credentials
    const awsClientConfig = await awsCredentialsService.getClientConfig(accountId, region)
    const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig))

    const needsAppRuns = selectedReports.some(r => ['app-runs', 'summary'].includes(r))
    const needsChatMessages = selectedReports.some(r => ['chat-messages', 'summary', 'agent-usage'].includes(r))
    const needsAgents = selectedReports.includes('agents')
    const needsAgentUsage = selectedReports.includes('agent-usage')
    const needsIntegrations = selectedReports.includes('integrations')
    const needsIntegrationUsage = selectedReports.includes('integration-chat-usage') || selectedReports.includes('agent-integration-usage')
    const needsKnowledgeBases = selectedReports.includes('knowledge-bases')

    // Get all jobs tables if needed
    const jobsTableNames = needsAppRuns
      ? await this.getJobsTableNames(dynamoClient, clientName)
      : []

    // Chat history table name
    const chatTableName = `numa-${clientName}-chat-history`

    // Fetch data in parallel based on selection
    const [appRuns, chatMessages, agents, knowledgeBases] = await Promise.all([
      needsAppRuns
      ? this.getAllAppRuns(dynamoClient, jobsTableNames, clientName, startDate, endDate, timeGranularity)
      : Promise.resolve<AppRunRecord[]>([]),
      needsChatMessages || needsIntegrationUsage
        ? this.getAllChatMessages(dynamoClient, chatTableName, clientName, startDate, endDate, needsIntegrationUsage, timeGranularity)
        : Promise.resolve<ChatMessageRecord[]>([]),
      needsAgents
        ? this.getAgentRecords(dynamoClient, clientName)
        : Promise.resolve<AgentRecord[]>([]),
      needsKnowledgeBases
        ? this.getKnowledgeBaseRecords(client, awsClientConfig, dynamoClient)
        : Promise.resolve<KnowledgeBaseRecord[]>([]),
    ])

    const agentUsage = needsAgentUsage
      ? this.extractAgentUsageFromMessages(chatMessages, clientName)
      : []
    const { integrationChatUsage, agentIntegrationUsage } = needsIntegrationUsage
      ? this.extractIntegrationUsageFromMessages(chatMessages, clientName)
      : { integrationChatUsage: [], agentIntegrationUsage: [] }
    const userChatMessages = this.filterUserTextMessages(chatMessages)
    const integrations = needsIntegrations
      ? await this.getIntegrationRecords(dynamoClient, clientName)
      : []

    // Get unique user IDs and look up their emails
    const allUserIds = [...new Set([
      ...appRuns.map(r => r.userId),
      ...userChatMessages.map(m => m.userId),
      ...agents.map(a => a.createdBy),
      ...agentUsage.map(a => a.userId),
      ...integrationChatUsage.map(i => i.userId),
      ...agentIntegrationUsage.map(i => i.userId),
    ].filter(Boolean))]

    let enrichedAppRuns = appRuns
    let enrichedChatMessages = userChatMessages
    let enrichedAgents = agents
    let enrichedAgentUsage = agentUsage
    let enrichedIntegrationChatUsage = integrationChatUsage
    let enrichedAgentIntegrationUsage = agentIntegrationUsage

    if (allUserIds.length > 0) {
      try {
        const userPoolId = await this.findUserPoolId(awsClientConfig, clientName)
        const userEmails = await this.getUserEmails(awsClientConfig, userPoolId, allUserIds)
        const enrichedData = this.enrichDataWithEmails(appRuns, userChatMessages, agents, agentUsage, userEmails)
        enrichedAppRuns = enrichedData.appRuns
        enrichedChatMessages = enrichedData.chatMessages
        enrichedAgents = enrichedData.agents
        enrichedAgentUsage = enrichedData.agentUsage
        enrichedIntegrationChatUsage = integrationChatUsage.map(item => ({
          ...item,
          userEmail: userEmails[item.userId] || `${item.userId}@unknown`,
        }))
        enrichedAgentIntegrationUsage = agentIntegrationUsage.map(item => ({
          ...item,
          userEmail: userEmails[item.userId] || `${item.userId}@unknown`,
        }))
      } catch (error) {
        console.warn(`Could not enrich data with emails for ${clientName}:`, error)
        // Continue with user IDs only
      }
    }

    return {
      clientName,
      appRuns: enrichedAppRuns,
      chatMessages: enrichedChatMessages,
      agents: enrichedAgents,
      agentUsage: enrichedAgentUsage,
      integrations,
      integrationChatUsage: enrichedIntegrationChatUsage,
      agentIntegrationUsage: enrichedAgentIntegrationUsage,
      knowledgeBases,
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

    let tableNames: string[] = []
    let lastEvaluatedTableName: string | undefined = undefined

    do {
      const result = await client.send(new ListTablesCommand({
        ExclusiveStartTableName: lastEvaluatedTableName,
      }))

      if (result.TableNames) {
        tableNames = tableNames.concat(result.TableNames)
      }

      lastEvaluatedTableName = result.LastEvaluatedTableName
    } while (lastEvaluatedTableName)

    return tableNames.filter(
      (tableName) => tableName.startsWith(`${clientName}-`) && tableName.endsWith('-recent-jobs')
    )
  }

  private static async getAllAppRuns(
    dynamoClient: DynamoDBDocumentClient,
    jobsTableNames: string[],
    clientName: string,
    startDate: Date,
    endDate: Date,
    timeGranularity: 'month' | 'day'
  ): Promise<AppRunRecord[]> {
    const allRuns: AppRunRecord[] = []

    for (const tableName of jobsTableNames) {
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
                clientName,
                userId: item.userId || 'unknown',
                appId,
                appName: item.appName || appId,
                month: DateUtils.getPeriodKey(startedAt, timeGranularity),
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

    return allRuns
  }

  private static async getAllChatMessages(
    dynamoClient: DynamoDBDocumentClient,
    chatTableName: string,
    clientName: string,
    startDate: Date,
    endDate: Date,
    includeToolName = false,
    timeGranularity: 'month' | 'day'
  ): Promise<ChatMessageRecord[]> {
    const allMessages: ChatMessageRecord[] = []

    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined
    do {
      const command = new ScanCommand({
        TableName: chatTableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })

      try {
        const result = await dynamoClient.send(command)

        if (result.Items) {
          for (const item of result.Items) {
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
                clientName,
                userId: item.user_id || 'unknown',
                month: DateUtils.getPeriodKey(messageDate, timeGranularity),
                conversationId: item.conversation_id || 'unknown',
                messageType: item.message_type || 'unknown',
                role: item.role || 'unknown',
                timestamp: nzDate,
                toolName: includeToolName ? item.tool_name || item.toolName || item.tool : undefined,
                toolType: includeToolName ? item.tool_type || item.toolType : undefined,
                agentId: item.agentId,
                agentTitle: item.agentTitle,
                agentType: item.agentType,
                agentVersion: item.agentVersion,
                agentVisibility: item.agentVisibility || item.visibility,
                isAgentConversation: item.isAgentConversation === true || item.isAgentConversation === 'true',
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

    return allMessages
  }

  private static async getAgentRecords(
    dynamoClient: DynamoDBDocumentClient,
    clientName: string
  ): Promise<AgentRecord[]> {
    const tableNames = await this.getAgentTableNames(dynamoClient, clientName)
    const agents: AgentRecord[] = []

    for (const tableName of tableNames) {
      let lastEvaluatedKey: Record<string, unknown> | undefined = undefined

      do {
        try {
          const result = await dynamoClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey,
          }))

          if (result.Items) {
            for (const item of result.Items) {
              const agentId = item.agent_id || item.agentId || item.id
              if (!agentId) continue

              const createdBy = item.created_by_user_id || item.user_id || item.createdBy
              const agentName = item.title || item.agentTitle || 'Unknown Agent'
              const visibility = item.visibility || item.agentVisibility || 'unknown'
              const agentType = item.agent_type || item.agentType
              const createdAt = this.normalizeDateString(item.created_at || item.createdAt || item.timestamp)
              const scope: 'workspace' | 'user' = tableName.endsWith('user-agents') ? 'user' : 'workspace'

              agents.push({
                clientName,
                agentId: String(agentId),
                agentName: String(agentName),
                visibility: String(visibility),
                agentType: agentType ? String(agentType) : undefined,
                createdBy: createdBy ? String(createdBy) : 'unknown',
                createdAt,
                scope,
              })
            }
          }

          lastEvaluatedKey = result.LastEvaluatedKey
        } catch (error) {
          console.warn(`Could not scan agents table ${tableName}:`, error)
          break
        }
      } while (lastEvaluatedKey)
    }

    return agents
  }

  private static async getAgentTableNames(
    dynamoClient: DynamoDBDocumentClient,
    clientName: string
  ): Promise<string[]> {
    const client = new DynamoDBClient({
      region: dynamoClient.config.region,
      credentials: dynamoClient.config.credentials,
    })

    let tableNames: string[] = []
    let lastEvaluatedTableName: string | undefined = undefined

    do {
      const result = await client.send(new ListTablesCommand({
        ExclusiveStartTableName: lastEvaluatedTableName,
      }))

      if (result.TableNames) {
        tableNames = tableNames.concat(result.TableNames)
      }

      lastEvaluatedTableName = result.LastEvaluatedTableName
    } while (lastEvaluatedTableName)

    // Match both `{client}-agents` and `numa-{client}-agents` (and user variants)
    const matchesClient = (tableName: string) => {
      const lower = tableName.toLowerCase()
      const nameLower = clientName.toLowerCase()
      return lower.includes(`${nameLower}-agents`) || lower.includes(`${nameLower}-user-agents`)
    }

    return tableNames.filter(tableName => matchesClient(tableName))
  }

  private static async getIntegrationRecords(
    dynamoClient: DynamoDBDocumentClient,
    clientName: string
  ): Promise<IntegrationRecord[]> {
    const tableNames = await this.getIntegrationTableNames(dynamoClient, clientName)
    const integrations: IntegrationRecord[] = []

    for (const tableName of tableNames) {
      let lastEvaluatedKey: Record<string, unknown> | undefined = undefined
      do {
        try {
          const result = await dynamoClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey,
          }))

          if (result.Items) {
            for (const item of result.Items) {
              const integration = item.integration || item.id || item.name
              if (!integration) continue

              integrations.push({
                clientName,
                integration: String(integration),
                status: String(item.status || 'unknown'),
                denyTools: Array.isArray(item.denyTools) ? item.denyTools as string[] : undefined,
                updatedAt: this.normalizeDateString(item.updatedAt || item.updated_at),
                updatedBy: item.updatedBy ? String(item.updatedBy) : undefined,
                raw: item as Record<string, unknown>,
              })
            }
          }

          lastEvaluatedKey = result.LastEvaluatedKey
        } catch (error) {
          console.warn(`Could not scan integrations table ${tableName}:`, error)
          break
        }
      } while (lastEvaluatedKey)
    }

    return integrations
  }

  private static async getIntegrationTableNames(
    dynamoClient: DynamoDBDocumentClient,
    clientName: string
  ): Promise<string[]> {
    const client = new DynamoDBClient({
      region: dynamoClient.config.region,
      credentials: dynamoClient.config.credentials,
    })

    let tableNames: string[] = []
    let lastEvaluatedTableName: string | undefined = undefined

    do {
      const result = await client.send(new ListTablesCommand({
        ExclusiveStartTableName: lastEvaluatedTableName,
      }))

      if (result.TableNames) {
        tableNames = tableNames.concat(result.TableNames)
      }

      lastEvaluatedTableName = result.LastEvaluatedTableName
    } while (lastEvaluatedTableName)

    // Match `{client}-integration-settings` or `{client}-global-integration-settings` patterns
    const matchesClient = (tableName: string) => {
      const lower = tableName.toLowerCase()
      const nameLower = clientName.toLowerCase()
      return lower.includes(`${nameLower}-integration-settings`) || lower.includes(`${nameLower}-global-integration-settings`)
    }

    return tableNames.filter(tableName => matchesClient(tableName))
  }

  private static async getKnowledgeBaseRecords(
    client: Client,
    awsClientConfig: AWSClientConfig,
    dynamoClient: DynamoDBDocumentClient
  ): Promise<KnowledgeBaseRecord[]> {
    const s3 = new S3Client(awsClientConfig)
    const bucket = `numa-${client.name}-data`

    const kbType: KnowledgeBaseRecord['kbType'] =
      client.config.preferredKnowledgeBase === 'q' || client.config.provisionQResources
        ? 'q-business'
        : client.config.preferredKnowledgeBase === 'bedrock'
          ? 'bedrock'
          : 'unknown'

    const records: KnowledgeBaseRecord[] = []

    try {
      const tableRecords = await this.getKnowledgeBasesFromTable(client.name, dynamoClient)
      if (tableRecords.length > 0) {
        for (const kb of tableRecords) {
          const prefix = kb.prefix || kb.s3_prefix || kb.s3Prefix || 'documents/'
          const fileCount = await this.countObjectsInPrefix(s3, bucket, prefix)
          const scope: KnowledgeBaseRecord['scope'] =
            kb.isDefault || kb.isPublic ? 'company' : 'user'

          records.push({
            clientName: client.name,
            kbType,
            name: kb.name || kb.kb_name || kb.kbId || 'knowledge-base',
            kbId: kb.kbId,
            bucket,
            prefix,
            fileCount,
            scope,
            createdBy: kb.createdBy,
            isDefault: kb.isDefault,
            isShared: kb.isShared,
            isPublic: kb.isPublic,
            notes: kb.status,
          })
        }

        return records
      }

      const kbPrefixes = await this.getKnowledgeBasePrefixes(s3, bucket)

      if (kbPrefixes.length > 0) {
        for (const prefix of kbPrefixes) {
          const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
          const documentsPrefix = `${normalizedPrefix}documents/`

          let fileCount = await this.countObjectsInPrefix(s3, bucket, documentsPrefix)
          let usedPrefix = documentsPrefix

          if (fileCount === 0) {
            fileCount = await this.countObjectsInPrefix(s3, bucket, normalizedPrefix)
            usedPrefix = normalizedPrefix
          }

          const name = normalizedPrefix
            .replace(/^knowledge-bases\//, '')
            .replace(/\/$/, '') || 'knowledge-base'

          records.push({
            clientName: client.name,
            kbType,
            name,
            bucket,
            prefix: usedPrefix,
            fileCount,
            scope: 'company',
            notes: fileCount === 0 ? 'No documents found' : undefined,
          })
        }

        return records
      }

      // Fallback: treat documents/ prefix as single KB
      const defaultPrefix = 'documents/'
      const fileCount = await this.countObjectsInPrefix(s3, bucket, defaultPrefix)

      records.push({
        clientName: client.name,
        kbType,
        name: 'default',
        bucket,
        prefix: defaultPrefix,
        fileCount,
        scope: 'company',
        notes: fileCount === 0 ? 'No documents found' : undefined,
      })
    } catch (error) {
      console.warn(`Could not retrieve knowledge base data for ${client.name}:`, error)
      const message = error instanceof Error ? error.message : String(error)
      records.push({
        clientName: client.name,
        kbType,
        name: 'unavailable',
        bucket,
        prefix: 'documents/',
        fileCount: 0,
        scope: 'company',
        notes: message,
      })
    }

    return records
  }

  private static async getKnowledgeBasePrefixes(
    s3: S3Client,
    bucket: string
  ): Promise<string[]> {
    try {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'knowledge-bases/',
        Delimiter: '/',
      }))

      return (result.CommonPrefixes || [])
        .map(prefix => prefix.Prefix)
        .filter((prefix): prefix is string => !!prefix)
    } catch (error) {
      console.warn(`Could not list knowledge base prefixes for bucket ${bucket}:`, error)
      return []
    }
  }

  private static async countObjectsInPrefix(
    s3: S3Client,
    bucket: string,
    prefix?: string
  ): Promise<number> {
    let continuationToken: string | undefined
    let count = 0

    do {
      const response = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }))

      count += response.Contents?.filter(obj => {
        const key = obj.Key
        if (!key) return false
        if (key.endsWith('/')) return false
        if (key.endsWith('.metadata.json')) return false
        const leaf = key.split('/').pop()
        return leaf !== 'metadata.json'
      }).length ?? 0
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return count
  }

  private static async getKnowledgeBasesFromTable(
    clientName: string,
    dynamoClient: DynamoDBDocumentClient
  ): Promise<Array<{
    kbId?: string
    name?: string
    kb_name?: string
    prefix?: string
    s3_prefix?: string
    s3Prefix?: string
    isDefault?: boolean
    isShared?: boolean
    isPublic?: boolean
    createdBy?: string
    status?: string
  }>> {
    const tableName = `numa-${clientName}-knowledge-bases`
    const pk = `TENANT#${clientName}`
    try {
      const response = await dynamoClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': 'KB#',
        },
      }))

      const items = response.Items || []
      return items.map(item => ({
        kbId: item.kb_id || item.kbId,
        name: item.kb_name || item.name,
        kb_name: item.kb_name,
        prefix: item.prefix || item.s3_prefix || item.s3Prefix,
        s3_prefix: item.s3_prefix,
        s3Prefix: item.s3Prefix,
        isDefault: item.is_default ?? item.isDefault,
        isShared: item.is_shared ?? item.isShared,
        isPublic: item.is_public ?? item.isPublic,
        createdBy: item.created_by || item.createdBy,
        status: item.status,
      }))
    } catch (error) {
      console.warn(`Could not query knowledge base table for ${clientName}:`, error)
      return []
    }
  }

  private static extractAgentUsageFromMessages(
    chatMessages: ChatMessageRecord[],
    clientName: string
  ): AgentUsageRecord[] {
    const usageMap = new Map<string, { record: AgentUsageRecord; conversations: Set<string> }>()

    for (const message of chatMessages) {
      if (message.messageType !== 'meta') continue
      if (!message.isAgentConversation) continue
      if (!message.agentId) continue

      const key = `${message.agentId}-${message.userId}-${message.month}`
      const conversationId = message.conversationId || 'unknown'

      if (!usageMap.has(key)) {
        usageMap.set(key, {
          record: {
            clientName,
            agentId: message.agentId,
            agentName: message.agentTitle || 'Unknown Agent',
            userId: message.userId,
            userEmail: message.userEmail,
            month: message.month,
            conversationCount: 0,
            visibility: message.agentVisibility,
            agentType: message.agentType,
          },
          conversations: new Set<string>(),
        })
      }

      const entry = usageMap.get(key)!
      if (!entry.conversations.has(conversationId)) {
        entry.conversations.add(conversationId)
        entry.record.conversationCount += 1
      }
    }

    return Array.from(usageMap.values())
      .map(({ record }) => record)
      .sort((a, b) => {
        if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName)
        if (a.agentName !== b.agentName) return a.agentName.localeCompare(b.agentName)
        if (a.userId !== b.userId) return a.userId.localeCompare(b.userId)
        return a.month.localeCompare(b.month)
      })
  }

  private static extractIntegrationUsageFromMessages(
    chatMessages: ChatMessageRecord[],
    clientName: string
  ): { integrationChatUsage: IntegrationChatUsageRecord[]; agentIntegrationUsage: AgentIntegrationUsageRecord[] } {
    const integrationChat: IntegrationChatUsageRecord[] = []
    const agentIntegration: AgentIntegrationUsageRecord[] = []

    // Track agent context per conversation using meta messages
    const agentContextByConversation = new Map<string, {
      agentId?: string
      agentName?: string
      agentType?: string
      agentVisibility?: string
    }>()

    for (const message of chatMessages) {
      if (message.messageType === 'meta' && message.isAgentConversation) {
        agentContextByConversation.set(message.conversationId, {
          agentId: message.agentId,
          agentName: message.agentTitle,
          agentType: message.agentType,
          agentVisibility: message.agentVisibility,
        })
      }
    }

    for (const message of chatMessages) {
      if (message.messageType !== 'tool_call') continue
      const toolName = message.toolName || ''
      const integration = toolName.includes('_') ? toolName.split('_')[0] : ''
      if (!integration) continue

      integrationChat.push({
        clientName,
        integration,
        userId: message.userId,
        userEmail: message.userEmail,
        conversationId: message.conversationId,
        month: message.month,
        toolName,
      })

      const agentContext = agentContextByConversation.get(message.conversationId)
      const agentId = message.agentId || agentContext?.agentId
      const agentName = message.agentTitle || agentContext?.agentName
      const agentType = message.agentType || agentContext?.agentType
      const agentVisibility = message.agentVisibility || agentContext?.agentVisibility

      if (message.isAgentConversation || agentContext) {
        agentIntegration.push({
          clientName,
          integration,
          userId: message.userId,
          userEmail: message.userEmail,
          agentId,
          agentName,
          agentType,
          conversationId: message.conversationId,
          month: message.month,
          toolName,
          agentVisibility,
        })
      }
    }

    return { integrationChatUsage: integrationChat, agentIntegrationUsage: agentIntegration }
  }

  static filterUserTextMessages(chatMessages: ChatMessageRecord[]): ChatMessageRecord[] {
    return chatMessages.filter(
      (message) => message.role === 'user' && message.messageType === 'text'
    )
  }

  private static normalizeDateString(value: unknown): string | undefined {
    if (!value) return undefined

    const date = typeof value === 'number'
      ? new Date(value)
      : new Date(String(value))

    return isNaN(date.getTime()) ? undefined : date.toISOString()
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
    agents: AgentRecord[],
    agentUsage: AgentUsageRecord[],
    userEmails: Record<string, string>
  ): {
    appRuns: AppRunRecord[]
    chatMessages: ChatMessageRecord[]
    agents: AgentRecord[]
    agentUsage: AgentUsageRecord[]
  } {
    const enrichedAppRuns = appRuns.map((run) => ({
      ...run,
      userEmail: userEmails[run.userId] || `${run.userId}@unknown`,
    }))

    const enrichedChatMessages = chatMessages.map((message) => ({
      ...message,
      userEmail: userEmails[message.userId] || `${message.userId}@unknown`,
    }))

    const enrichedAgents = agents.map((agent) => ({
      ...agent,
      createdByEmail: userEmails[agent.createdBy] || `${agent.createdBy}@unknown`,
    }))

    const enrichedAgentUsage = agentUsage.map((usage) => ({
      ...usage,
      userEmail: userEmails[usage.userId] || `${usage.userId}@unknown`,
    }))

    return {
      appRuns: enrichedAppRuns,
      chatMessages: enrichedChatMessages,
      agents: enrichedAgents,
      agentUsage: enrichedAgentUsage,
    }
  }

  private static aggregateUsageData(
    appRuns: AppRunRecord[],
    chatMessages: ChatMessageRecord[]
  ): UsageSummary[] {
    const summaryMap = new Map<string, UsageSummary>()

    // Process app runs - include clientName in key for multi-client
    for (const run of appRuns) {
      const key = `${run.clientName}-${run.userId}-${run.month}`

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          clientName: run.clientName,
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
      const key = `${message.clientName}-${message.userId}-${message.month}`

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          clientName: message.clientName,
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
      if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName)
      if (a.month !== b.month) return a.month.localeCompare(b.month)
      return a.userId.localeCompare(b.userId)
    })
  }
}
