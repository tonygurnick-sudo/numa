import { ServiceQuotas, ListServiceQuotasCommand, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas'
import { awsCredentialsService } from '@/services/awsCredentialsService'
import { clientService } from '@/services/clientService'
import { FileExportService } from '@/utils/fileExport'
import type {
  QuotaReportParameters,
  QuotaReportResult,
  QuotaDescriptor,
  QuotaReportRow,
  ToolResultFile,
  ToolProgress,
  QuotaType,
  ModelFamily,
} from '@/types/tools'

const SERVICE_CODE = 'bedrock'

export class QuotaReportService {
  // Session-scoped cache for discovered quota descriptors by filter signature
  private static quotaCache: Map<string, QuotaDescriptor[]> = new Map()

  static async generateReport(
    params: QuotaReportParameters,
    onProgress?: (progress: ToolProgress) => void,
  ): Promise<{ result: QuotaReportResult; files: ToolResultFile[] }> {
    const { clientScope, clients, regions, modelFamilies, advancedFilter, types } = params

    onProgress?.({ current: 0, total: 100, message: 'Loading client configuration...' })

    const allClients = await clientService.getAllClients()
    const selectedClients = clientScope === 'all'
      ? allClients
      : allClients.filter(c => (clients || []).includes(c.name))

    if (selectedClients.length === 0) {
      const empty: QuotaReportResult = {
        metadata: {
          runAt: new Date().toISOString(),
          totalClients: allClients.length,
          processedClients: 0,
          regions,
          modelFamilies,
          advancedFilter,
          types,
        },
        quotas: [],
        rows: [],
        message: 'No clients selected',
      }
      return { result: empty, files: [] }
    }

    onProgress?.({ current: 10, total: 100, message: 'Discovering Bedrock quota definitions (client account)...' })

    // Discover quota descriptors using the first selected client and region (assumed role)
    const discoveryAccountId = selectedClients[0].config.clientAccountId
    const discoveryRegion = regions[0]
    const quotas = await this.discoverQuotasInClient({
      families: modelFamilies,
      types,
      accountId: discoveryAccountId,
      region: discoveryRegion,
      advancedFilter,
    })
    if (quotas.length === 0) {
      const empty: QuotaReportResult = {
        metadata: {
          runAt: new Date().toISOString(),
          totalClients: allClients.length,
          processedClients: 0,
          regions,
          modelFamilies,
          advancedFilter,
          types,
        },
        quotas: [],
        rows: [],
        message: `No quota definitions found for families ${modelFamilies.join('+')}${advancedFilter ? ` (filter: "${advancedFilter}")` : ''} and types ${types.join(', ')}`,
      }
      return { result: empty, files: [] }
    }

    // Prepare fetching quotas per account/region
    onProgress?.({ current: 20, total: 100, message: 'Fetching quotas across accounts and regions...' })

    const rows: QuotaReportRow[] = []
    const totalUnits = selectedClients.length * regions.length
    let completedUnits = 0

    // Limit concurrency to avoid throttling
    const concurrency = 8
    const queue: Array<() => Promise<void>> = []

    for (const client of selectedClients) {
      const accountId = client.config.clientAccountId
      const clientName = client.name
      for (const region of regions) {
        queue.push(async () => {
          const values: Record<string, number | null> = {}
          try {
            const awsConfig = await awsCredentialsService.getClientConfig(accountId, region)
            const sq = new ServiceQuotas(awsConfig)
            // Fetch each quota code
            for (const q of quotas) {
              try {
                const res = await sq.send(new GetServiceQuotaCommand({ ServiceCode: SERVICE_CODE, QuotaCode: q.QuotaCode }))
                values[q.QuotaCode] = res.Quota?.Value ?? null
              } catch {
                // Missing/denied quota; record null and continue
                values[q.QuotaCode] = null
              }
            }
          } finally {
            rows.push({
              accountName: clientName,
              accountId,
              region,
              values,
            })
            completedUnits += 1
            const pct = 20 + Math.floor((completedUnits / Math.max(totalUnits, 1)) * 70) // 20..90
            onProgress?.({ current: pct, total: 100, message: `Processed ${completedUnits}/${totalUnits}` })
          }
        })
      }
    }

    await this.runWithConcurrency(queue, concurrency)

    onProgress?.({ current: 95, total: 100, message: 'Preparing export files...' })

    // Generate CSV file (always, even if output=table+csv)
    const csvFile = FileExportService.generateQuotaReportCSV(rows, quotas, {
      regions,
      families: modelFamilies,
      types,
      advancedFilter,
    })
    const files: ToolResultFile[] = csvFile ? [csvFile] : []

    const result: QuotaReportResult = {
      metadata: {
        runAt: new Date().toISOString(),
        totalClients: allClients.length,
        processedClients: selectedClients.length,
        regions,
        modelFamilies,
        advancedFilter,
        types,
      },
      quotas,
      rows,
    }

    onProgress?.({ current: 100, total: 100, message: 'Report complete' })
    return { result, files }
  }

  private static async discoverQuotasInClient(args: {
    families: ModelFamily[]
    types: QuotaType[]
    accountId: string
    region: string
    advancedFilter?: string
  }): Promise<QuotaDescriptor[]> {
    const { families, types, accountId, region, advancedFilter } = args
    const signature = `${accountId}|${region}|${families.sort().join('+')}|${types.sort().join(',')}|${(advancedFilter||'').toLowerCase()}`
    const cached = this.quotaCache.get(signature)
    if (cached) return cached

    // Use client account (assumed ArcanumAIAccess role) to list quotas
    const clientCfg = await awsCredentialsService.getClientConfig(accountId, region)
    const sq = new ServiceQuotas(clientCfg)

    const found: QuotaDescriptor[] = []
    let NextToken: string | undefined = undefined

    do {
      const res = await sq.send(new ListServiceQuotasCommand({ ServiceCode: SERVICE_CODE, MaxResults: 100, NextToken }))
      NextToken = res.NextToken
      const items = (res.Quotas || [])
        .filter(q => q.QuotaName && /requests per minute/i.test(q.QuotaName))
        .map(q => this.classifyQuota(q.QuotaName!))
        .filter(meta => meta !== null && families.includes(meta.family))
        .filter(meta => types.includes(meta!.type))
        .filter(meta => !advancedFilter || (meta!.label.toLowerCase().includes(advancedFilter.toLowerCase()) || meta!.raw.toLowerCase().includes(advancedFilter.toLowerCase())))

      for (const meta of items as Array<{ family: ModelFamily; label: string; type: QuotaType; raw: string; code?: string }>) {
        // Get back the original quota entry to extract code
        const match = (res.Quotas || []).find(q => q.QuotaName === meta.raw)
        if (match?.QuotaCode) {
          found.push({
            QuotaCode: match.QuotaCode,
            QuotaName: meta.raw,
            Model: meta.label,
            Type: meta.type,
          })
        }
      }
    } while (NextToken)

    // Stable order: by family (Claude first), then Model, then Type (On-demand first)
    const familyRank = (model: string) => (/^Claude/i.test(model) ? 0 : 1)
    const typeRank = (t: QuotaType) => (t === 'On-demand' ? 0 : 1)
    found.sort((a, b) => {
      const fa = familyRank(a.Model)
      const fb = familyRank(b.Model)
      if (fa !== fb) return fa - fb
      if (a.Model !== b.Model) return a.Model.localeCompare(b.Model)
      return typeRank(a.Type) - typeRank(b.Type)
    })
    this.quotaCache.set(signature, found)
    return found
  }

  private static classifyQuota(name: string): { family: ModelFamily; label: string; type: QuotaType; raw: string } | null {
    const raw = name
    const type: QuotaType = /^On-demand/i.test(name) ? 'On-demand' : 'Cross-region'
    // Claude detection (Anthropic Claude ...)
    if (/Anthropic/i.test(name) || /Claude/i.test(name)) {
      // Extract from the first occurrence of 'Claude' to before 'requests per minute'
      const start = name.search(/Claude/i)
      if (start >= 0) {
        const tail = name.slice(start)
        const label = tail.split(/requests per minute/i)[0].trim().replace(/[-–—]\s*$/,'').trim()
        if (label) return { family: 'claude', label, type, raw }
      }
      // Fallback: after 'Anthropic '
      const anth = name.split(/Anthropic\s+/i)[1]
      if (anth) {
        const label = anth.split(/requests per minute/i)[0].trim()
        if (label) return { family: 'claude', label, type, raw }
      }
    }
    // Nova detection (Amazon Nova ... or Nova ...)
    if (/Nova/i.test(name)) {
      const start = name.search(/Nova/i)
      if (start >= 0) {
        const tail = name.slice(start)
        // Capture e.g., 'Nova Pro', 'Nova Lite', 'Nova Micro', 'Nova Premier', optionally with version tokens
        const label = tail.split(/requests per minute/i)[0].trim().replace(/[-–—]\s*$/,'').trim()
        if (label) return { family: 'nova', label, type, raw }
      }
    }
    return null
  }

  private static async runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
    let index = 0
    const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
      while (index < tasks.length) {
        const current = index++
        const task = tasks[current]
        try {
          await task()
        } catch {
          // Swallow per-task errors; capture per-row nulls above
        }
      }
    })
    await Promise.all(workers)
  }
}
