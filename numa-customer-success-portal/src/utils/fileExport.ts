import type {
  AgentRecord,
  AgentUsageRecord,
  AppRunRecord,
  ChatMessageRecord,
  IntegrationRecord,
  IntegrationChatUsageRecord,
  AgentIntegrationUsageRecord,
  KnowledgeBaseRecord,
  ToolResultFile,
  UsageReportType,
  UsageSummary,
  QuotaReportRow,
  QuotaDescriptor,
  QuotaMetric,
} from '@/types/tools'

export class FileExportService {
  /**
   * Escape a CSV field value - wraps in quotes if it contains comma, quote, or newline
   */
  private static escapeCSVField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  /**
   * Convert data to CSV format
   */
  static arrayToCSV<T extends Record<string, unknown>>(
    data: T[],
    columns: (keyof T)[],
    headers?: string[]
  ): string {
    if (data.length === 0) return ''

    const headerRow = headers || columns.map(col => String(col))
    const csvRows = [headerRow.join(',')]

    for (const row of data) {
      const values = columns.map(col => {
        const value = row[col]

        // Handle different data types
        if (value === null || value === undefined) return ''
        if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`
        }

        return String(value)
      })
      csvRows.push(values.join(','))
    }

    return csvRows.join('\n')
  }

  /**
   * Generate CSV file for quota report
   */
  static generateQuotaReportCSV(
    rows: QuotaReportRow[],
    quotas: QuotaDescriptor[],
    context: { families: string[]; metrics: QuotaMetric[]; types: string[]; advancedFilter?: string }
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    if (rows.length === 0 || quotas.length === 0) return null

    // Build headers with new columns and metric suffix for quota columns
    // Include inference profile (US/Global/APAC) when present to distinguish regional quotas
    const metricSuffix = (m: QuotaMetric) => m === 'requests-per-minute' ? 'RPM' : 'TPM'
    const buildQuotaHeader = (q: QuotaDescriptor): string => {
      const parts = [q.Model, q.Type]
      if (q.InferenceProfile) {
        parts.push(q.InferenceProfile)
      }
      parts.push(metricSuffix(q.Metric))
      const header = parts.join('-')
      return q.isPriority ? `* ${header}` : header
    }
    const headers = [
      'accountName',
      'stackNames',
      'accountId',
      'region',
      'isDev',
      'bedrockAccount',
      ...quotas.map(buildQuotaHeader)
    ]

    const data = rows.map(r => {
      const quotaCols = quotas.map(q => {
        const v = r.values[q.QuotaCode]
        return v === null || v === undefined ? '' : String(v)
      })
      return [
        this.escapeCSVField(r.accountName),
        this.escapeCSVField(r.stackNames?.join('; ') || ''),
        r.accountId,
        r.region,
        r.isDev ? 'Yes' : 'No',
        r.bedrockAccount || '',
        ...quotaCols
      ]
    })

    const csv = [headers.join(','), ...data.map(line => line.join(','))].join('\n')

    const fam = context.families.join('+') || 'all'
    const filt = context.advancedFilter ? `-${context.advancedFilter.replace(/\s+/g,'_')}` : ''
    const filename = `quota-report-${fam}${filt}-${timestamp}.csv`
    return {
      name: filename,
      content: csv,
      mimeType: 'text/csv',
      size: new Blob([csv]).size,
    }
  }

  /**
   * Generate CSV files for usage report (supports multi-client)
   */
  static generateUsageReportCSVs(
    data: {
      appRuns: AppRunRecord[]
      chatMessages: ChatMessageRecord[]
      summary: UsageSummary[]
      agents: AgentRecord[]
      agentUsage: AgentUsageRecord[]
      scheduledAgentUsage: AgentUsageRecord[]
      integrations: IntegrationRecord[]
      integrationChatUsage: IntegrationChatUsageRecord[]
      agentIntegrationUsage: AgentIntegrationUsageRecord[]
      knowledgeBases: KnowledgeBaseRecord[]
    },
    selectedReports: UsageReportType[],
    filePrefix: string,
    period: string
  ): ToolResultFile[] {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const {
      appRuns,
      chatMessages,
      summary,
      agents,
      agentUsage,
      scheduledAgentUsage,
      integrations,
      integrationChatUsage,
      agentIntegrationUsage,
      knowledgeBases,
    } = data

    const files: ToolResultFile[] = []

    if (selectedReports.includes('app-runs')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'userId', 'userEmail', 'appId', 'appName', 'month', 'jobId', 'startedAt', 'status'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'User ID', 'User Email', 'App ID', 'App Name', 'Date', 'Job ID', 'Started At', 'Status']
      const content = appRuns.length > 0
        ? this.arrayToCSV(appRuns, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-app-runs-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('chat-messages')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'userId', 'userEmail', 'month', 'conversationId', 'messageType', 'role', 'timestamp'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'User ID', 'User Email', 'Date', 'Conversation ID', 'Message Type', 'Role', 'Timestamp']
      const content = chatMessages.length > 0
        ? this.arrayToCSV(chatMessages, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-chat-messages-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('summary')) {
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'User ID', 'User Email', 'Date', 'App Runs', 'Chat Messages', 'App Runs by App', 'Chat Messages by Type']
      let content: string
      if (summary.length > 0) {
        const summaryData = summary.map(s => ({
          ...s,
          appRunsByApp: JSON.stringify(s.appRunsByApp),
          chatMessagesByType: JSON.stringify(s.chatMessagesByType),
        }))
        content = this.arrayToCSV(
          summaryData,
          ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'userId', 'userEmail', 'month', 'appRuns', 'chatMessages', 'appRunsByApp', 'chatMessagesByType'],
          headers,
        )
      } else {
        content = headers.join(',')
      }

      files.push({
        name: `${filePrefix}-usage-summary-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('agents')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'agentId', 'agentName', 'visibility', 'agentType', 'createdBy', 'createdByEmail', 'createdAt', 'scope'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Agent ID', 'Agent Name', 'Visibility', 'Agent Type', 'Created By (ID)', 'Created By (Email)', 'Created At', 'Scope']
      const content = agents.length > 0
        ? this.arrayToCSV(agents, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-agents-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('agent-usage')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'agentId', 'agentName', 'userId', 'userEmail', 'month', 'conversationCount', 'visibility', 'agentType'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Agent ID', 'Agent Name', 'User ID', 'User Email', 'Date', 'Conversations', 'Visibility', 'Agent Type']
      const content = agentUsage.length > 0
        ? this.arrayToCSV(agentUsage, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-agent-usage-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('scheduled-agent-usage')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'agentId', 'agentName', 'userId', 'userEmail', 'month', 'conversationCount', 'visibility', 'agentType'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Agent ID', 'Agent Name', 'User ID', 'User Email', 'Date', 'Conversations', 'Visibility', 'Agent Type']
      const content = scheduledAgentUsage.length > 0
        ? this.arrayToCSV(scheduledAgentUsage, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-scheduled-agent-usage-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('integrations')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'integration', 'status', 'denyTools', 'updatedAt', 'updatedBy'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Integration', 'Status', 'Deny Tools', 'Updated At', 'Updated By']
      const flattened = integrations.map(i => ({
        ...i,
        denyTools: i.denyTools?.join('; ') || '',
      }))
      const content = integrations.length > 0
        ? this.arrayToCSV(flattened, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-integrations-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('integration-chat-usage')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'integration', 'userId', 'userEmail', 'conversationId', 'month', 'toolName'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Integration', 'User ID', 'User Email', 'Conversation ID', 'Date', 'Tool Name']
      const content = integrationChatUsage.length > 0
        ? this.arrayToCSV(integrationChatUsage, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-integration-chat-usage-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('agent-integration-usage')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'integration', 'userId', 'userEmail', 'agentId', 'agentName', 'conversationId', 'month', 'toolName'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'Integration', 'User ID', 'User Email', 'Agent ID', 'Agent Name', 'Conversation ID', 'Date', 'Tool Name']
      const content = agentIntegrationUsage.length > 0
        ? this.arrayToCSV(agentIntegrationUsage, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-agent-integration-usage-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    if (selectedReports.includes('knowledge-bases')) {
      const columns = ['clientName', 'clientStatus', 'clientTrialStart', 'clientTrialEnd', 'clientNotes', 'kbType', 'scope', 'name', 'kbId', 'bucket', 'prefix', 'fileCount', 'createdBy', 'isDefault', 'isShared', 'isPublic', 'notes'] as const
      const headers = ['Client', 'Client Status', 'Trial Start', 'Trial End', 'Client Notes', 'KB Type', 'Scope', 'Name', 'KB ID', 'Bucket', 'Prefix', 'File Count', 'Created By', 'Is Default', 'Is Shared', 'Is Public', 'Notes']
      const content = knowledgeBases.length > 0
        ? this.arrayToCSV(knowledgeBases, columns, headers)
        : headers.join(',')

      files.push({
        name: `${filePrefix}-knowledge-bases-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    return files
  }

  /**
   * Generate JSON file for usage report (supports multi-client)
   */
  static generateUsageReportJSON(
    data: {
      appRuns: AppRunRecord[]
      chatMessages: ChatMessageRecord[]
      summary: UsageSummary[]
      agents: AgentRecord[]
      agentUsage: AgentUsageRecord[]
      scheduledAgentUsage: AgentUsageRecord[]
      integrations: IntegrationRecord[]
      integrationChatUsage: IntegrationChatUsageRecord[]
      agentIntegrationUsage: AgentIntegrationUsageRecord[]
      knowledgeBases: KnowledgeBaseRecord[]
    },
    selectedReports: UsageReportType[],
    filePrefix: string,
    period: string,
    displayName: string
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const {
      appRuns,
      chatMessages,
      summary,
      agents,
      agentUsage,
      scheduledAgentUsage,
      integrations,
      integrationChatUsage,
      agentIntegrationUsage,
      knowledgeBases,
    } = data

    // Get unique client names based on selected reports
    const clientNames = new Set<string>()
    if (selectedReports.includes('app-runs')) {
      appRuns.forEach(r => clientNames.add(r.clientName))
    }
    if (selectedReports.includes('chat-messages') || selectedReports.includes('summary') || selectedReports.includes('agent-usage')) {
      chatMessages.forEach(m => clientNames.add(m.clientName))
    }
    if (selectedReports.includes('agents')) {
      agents.forEach(a => clientNames.add(a.clientName))
    }
    if (selectedReports.includes('integrations')) {
      integrations.forEach(a => clientNames.add(a.clientName))
    }
    if (selectedReports.includes('integration-chat-usage')) {
      integrationChatUsage.forEach(a => clientNames.add(a.clientName))
    }
    if (selectedReports.includes('agent-integration-usage')) {
      agentIntegrationUsage.forEach(a => clientNames.add(a.clientName))
    }
    if (selectedReports.includes('knowledge-bases')) {
      knowledgeBases.forEach(a => clientNames.add(a.clientName))
    }
    if (selectedReports.includes('scheduled-agent-usage')) {
      scheduledAgentUsage.forEach(a => clientNames.add(a.clientName))
    }

    const uniqueUsers = selectedReports.some(r => ['app-runs', 'chat-messages', 'summary'].includes(r))
      ? new Set([...appRuns.map(r => r.userId), ...chatMessages.map(m => m.userId)]).size
      : undefined
    const uniqueAgentUsers = selectedReports.includes('agent-usage')
      ? new Set(agentUsage.map(a => a.userId)).size
      : undefined
    const agentConversationCount = selectedReports.includes('agent-usage')
      ? agentUsage.reduce((sum, record) => sum + record.conversationCount, 0)
      : undefined

    const metadata = {
      clientNames: Array.from(clientNames),
      period,
      displayName,
      exportDate: new Date().toISOString(),
      selectedReports,
      totalAppRuns: selectedReports.some(r => ['app-runs', 'summary'].includes(r)) ? appRuns.length : undefined,
      totalChatMessages: selectedReports.some(r => ['chat-messages', 'summary'].includes(r)) ? chatMessages.length : undefined,
      uniqueUsers,
      totalAgents: selectedReports.includes('agents') ? agents.length : undefined,
      totalAgentUsage: selectedReports.includes('agent-usage') ? agentUsage.length : undefined,
      uniqueAgentUsers,
      agentConversationCount,
      scheduledAgentConversationCount: selectedReports.includes('scheduled-agent-usage')
        ? scheduledAgentUsage.reduce((sum, record) => sum + record.conversationCount, 0)
        : undefined,
      totalIntegrations: selectedReports.includes('integrations') ? integrations.length : undefined,
      totalIntegrationChats: selectedReports.includes('integration-chat-usage') ? integrationChatUsage.length : undefined,
      totalAgentIntegrationRuns: selectedReports.includes('agent-integration-usage') ? agentIntegrationUsage.length : undefined,
      totalKnowledgeBases: selectedReports.includes('knowledge-bases') ? knowledgeBases.length : undefined,
      totalKnowledgeBaseFiles: selectedReports.includes('knowledge-bases')
        ? knowledgeBases.reduce((sum, kb) => sum + (kb.fileCount || 0), 0)
        : undefined,
    }

    const exportData: Record<string, unknown> = {
      metadata,
    }

    if (selectedReports.includes('app-runs')) {
      exportData.appRuns = appRuns
    }
    if (selectedReports.includes('chat-messages')) {
      exportData.chatMessages = chatMessages
    }
    if (selectedReports.includes('summary')) {
      exportData.summary = summary
    }
    if (selectedReports.includes('agents')) {
      exportData.agents = agents
    }
    if (selectedReports.includes('agent-usage')) {
      exportData.agentUsage = agentUsage
    }
    if (selectedReports.includes('scheduled-agent-usage')) {
      exportData.scheduledAgentUsage = scheduledAgentUsage
    }
    if (selectedReports.includes('integrations')) {
      exportData.integrations = integrations
    }
    if (selectedReports.includes('integration-chat-usage')) {
      exportData.integrationChatUsage = integrationChatUsage
    }
    if (selectedReports.includes('agent-integration-usage')) {
      exportData.agentIntegrationUsage = agentIntegrationUsage
    }
    if (selectedReports.includes('knowledge-bases')) {
      exportData.knowledgeBases = knowledgeBases
    }

    const jsonContent = JSON.stringify(exportData, null, 2)

    return {
      name: `${filePrefix}-usage-report-${period}-${timestamp}.json`,
      content: jsonContent,
      mimeType: 'application/json',
      size: new Blob([jsonContent]).size,
    }
  }

  /**
   * Download a file in the browser
   */
  static downloadFile(file: ToolResultFile): void {
    const blob = typeof file.content === 'string'
      ? new Blob([file.content], { type: file.mimeType })
      : file.content as Blob

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.style.display = 'none'

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // Clean up the URL object
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  /**
   * Download multiple files
   */
  static downloadFiles(files: ToolResultFile[]): void {
    files.forEach((file, index) => {
      // Stagger downloads slightly to avoid browser limitations
      setTimeout(() => this.downloadFile(file), index * 100)
    })
  }

  /**
   * Format file size for display
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }
}
