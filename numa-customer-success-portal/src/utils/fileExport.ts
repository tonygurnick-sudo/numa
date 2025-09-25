import type { AppRunRecord, ChatMessageRecord, UsageSummary, ToolResultFile } from '@/types/tools'

export class FileExportService {
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
    rows: { accountName: string; accountId: string; region: string; values: Record<string, number | null> }[],
    quotas: { QuotaCode: string; Model: string; Type: string }[],
    context: { regions: string[]; families: string[]; types: string[]; advancedFilter?: string }
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    if (rows.length === 0 || quotas.length === 0) return null

    const headers = ['accountName', 'accountId', 'region', ...quotas.map(q => `${q.Model}-${q.Type}`)]
    const data = rows.map(r => {
      const cols = quotas.map(q => {
        const v = r.values[q.QuotaCode]
        return v === null || v === undefined ? '' : String(v)
      })
      return [r.accountName, r.accountId, r.region, ...cols]
    })

    const csv = [headers.join(','), ...data.map(line => line.join(','))].join('\n')

    const fam = context.families.join('+') || 'all'
    const filt = context.advancedFilter ? `-${context.advancedFilter.replace(/\s+/g,'_')}` : ''
    const filename = `quota-report-${fam}${filt}-${context.regions.join('+')}-${timestamp}.csv`
    return {
      name: filename,
      content: csv,
      mimeType: 'text/csv',
      size: new Blob([csv]).size,
    }
  }

  /**
   * Generate CSV files for usage report
   */
  static generateUsageReportCSVs(
    appRuns: AppRunRecord[],
    chatMessages: ChatMessageRecord[],
    summary: UsageSummary[],
    clientName: string,
    period: string
  ): ToolResultFile[] {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)

    const files: ToolResultFile[] = []

    // App runs CSV
    {
      const columns = ['userId', 'userEmail', 'appId', 'appName', 'month', 'jobId', 'startedAt', 'status'] as const
      const headers = ['User ID', 'User Email', 'App ID', 'App Name', 'Month', 'Job ID', 'Started At', 'Status']
      const content = appRuns.length > 0
        ? this.arrayToCSV(appRuns, columns, headers)
        : headers.join(',')

      files.push({
        name: `${clientName}-app-runs-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    // Chat messages CSV
    {
      const columns = ['userId', 'userEmail', 'month', 'conversationId', 'messageType', 'role', 'timestamp'] as const
      const headers = ['User ID', 'User Email', 'Month', 'Conversation ID', 'Message Type', 'Role', 'Timestamp']
      const content = chatMessages.length > 0
        ? this.arrayToCSV(chatMessages, columns, headers)
        : headers.join(',')

      files.push({
        name: `${clientName}-chat-messages-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    // Usage summary CSV
    {
      const headers = ['User ID', 'User Email', 'Month', 'App Runs', 'Chat Messages', 'App Runs by App', 'Chat Messages by Type']
      let content: string
      if (summary.length > 0) {
        const summaryData = summary.map(s => ({
          ...s,
          appRunsByApp: JSON.stringify(s.appRunsByApp),
          chatMessagesByType: JSON.stringify(s.chatMessagesByType),
        }))
        content = this.arrayToCSV(
          summaryData,
          ['userId', 'userEmail', 'month', 'appRuns', 'chatMessages', 'appRunsByApp', 'chatMessagesByType'],
          headers,
        )
      } else {
        content = headers.join(',')
      }

      files.push({
        name: `${clientName}-usage-summary-${period}-${timestamp}.csv`,
        content,
        mimeType: 'text/csv',
        size: new Blob([content]).size,
      })
    }

    return files
  }

  /**
   * Generate JSON file for usage report
   */
  static generateUsageReportJSON(
    appRuns: AppRunRecord[],
    chatMessages: ChatMessageRecord[],
    summary: UsageSummary[],
    clientName: string,
    period: string,
    displayName: string
  ): ToolResultFile | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)

    const exportData = {
      metadata: {
        clientName,
        period,
        displayName,
        exportDate: new Date().toISOString(),
        totalAppRuns: appRuns.length,
        totalChatMessages: chatMessages.length,
        uniqueUsers: new Set([...appRuns.map(r => r.userId), ...chatMessages.map(m => m.userId)]).size,
      },
      appRuns,
      chatMessages,
      summary,
    }

    const jsonContent = JSON.stringify(exportData, null, 2)

    return {
      name: `${clientName}-usage-report-${period}-${timestamp}.json`,
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
