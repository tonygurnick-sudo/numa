import { ServiceQuotas, ListServiceQuotasCommand, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import { clientService } from '@/services/clientService';
import { FileExportService } from '@/utils/fileExport';
import type { Client } from '@/types';
import type {
  QuotaReportParameters,
  QuotaReportResult,
  QuotaDescriptor,
  QuotaReportRow,
  ToolResultFile,
  ToolProgress,
  QuotaType,
  QuotaMetric,
  ModelFamily,
} from '@/types/tools';

const SERVICE_CODE = 'bedrock';
const ALL_REGIONS = ['us-east-1', 'ap-southeast-2', 'ap-southeast-3'];

// Arcanum internal AWS accounts for direct quota querying
const ARCANUM_INTERNAL_ACCOUNTS = [
  // { name: 'arcanum-dev', accountId: '458119850496' },
  // { name: 'arcanum-dev-images', accountId: '975186400848' },
  { name: 'arcanum-dev-numa-pipedream-proxy', accountId: '063563181233' },
  { name: 'arcanum-dev-q-client', accountId: '872515258482' },
  { name: 'arcanum-dev-q-deployer', accountId: '324037291751' },
  { name: 'arcanum-prod', accountId: '262893720581' },
  { name: 'arcanum-prod-images', accountId: '826326270637' },
  { name: 'arcanum-prod-numa-demo', accountId: '619071323471' },
  { name: 'arcanum-prod-numa-pipedream-proxy', accountId: '965745962688' },
  { name: 'arcanum-prod-q-deployer', accountId: '207567759910' },
  { name: 'arcanum-staging', accountId: '978450690680' },
  { name: 'Q Demo Account', accountId: '905418183804' },
];

interface ClassifiedQuota {
  family: ModelFamily;
  label: string;
  type: QuotaType;
  metric: QuotaMetric;
  raw: string;
  inferenceProfile?: string; // e.g., 'US', 'Global', 'APAC'
}

interface AccountGroup {
  accountId: string;
  clients: Client[];
  isDev: boolean;
  regions: string[];
  bedrockAccount?: string;
}

export class QuotaReportService {
  // Session-scoped cache for discovered quota descriptors by filter signature
  private static quotaCache: Map<string, QuotaDescriptor[]> = new Map();

  static async generateReport(
    params: QuotaReportParameters,
    onProgress?: (progress: ToolProgress) => void
  ): Promise<{ result: QuotaReportResult; files: ToolResultFile[] }> {
    const { clientScope, clients, regionMode, modelFamilies, quotaMetrics, advancedFilter, types } = params;

    onProgress?.({ current: 0, total: 100, message: 'Loading client configuration...' });

    let accountGroups: Record<string, AccountGroup>;

    if (clientScope === 'arcanum-internal') {
      // Build account groups directly from Arcanum internal accounts
      accountGroups = {};
      for (const account of ARCANUM_INTERNAL_ACCOUNTS) {
        accountGroups[account.accountId] = {
          accountId: account.accountId,
          clients: [], // No associated clients for internal accounts
          isDev: account.name.includes('-dev') || account.name.includes('staging') || account.name.includes('Demo'),
          regions: ALL_REGIONS, // Always check both regions for internal accounts
        };
        // Store account name in a way we can retrieve it later
        (accountGroups[account.accountId] as AccountGroup & { accountName?: string }).accountName = account.name;
      }
    } else {
      const allClients = await clientService.getAllClients();
      const selectedClients =
        clientScope === 'all' ? allClients : allClients.filter((c) => (clients || []).includes(c.name));

      if (selectedClients.length === 0) {
        const empty: QuotaReportResult = {
          metadata: {
            runAt: new Date().toISOString(),
            totalClients: 0,
            processedAccounts: 0,
            modelFamilies,
            quotaMetrics,
            advancedFilter,
            types,
          },
          quotas: [],
          rows: [],
          message: 'No clients selected',
        };
        return { result: empty, files: [] };
      }

      // Group clients by AWS account ID for dev consolidation
      accountGroups = this.groupByAccountId(selectedClients, regionMode);
    }

    onProgress?.({ current: 10, total: 100, message: 'Discovering Bedrock quota definitions...' });

    // Use the first account/region to discover quota definitions
    const firstGroup = Object.values(accountGroups)[0];
    const discoveryRegion = firstGroup.regions[0];
    const quotas = await this.discoverQuotasInClient({
      families: modelFamilies,
      types,
      metrics: quotaMetrics,
      accountId: firstGroup.accountId,
      region: discoveryRegion,
      advancedFilter,
    });

    if (quotas.length === 0) {
      const empty: QuotaReportResult = {
        metadata: {
          runAt: new Date().toISOString(),
          totalClients: allClients.length,
          processedAccounts: 0,
          modelFamilies,
          quotaMetrics,
          advancedFilter,
          types,
        },
        quotas: [],
        rows: [],
        message: `No quota definitions found for families ${modelFamilies.join('+')}${advancedFilter ? ` (filter: "${advancedFilter}")` : ''}, metrics ${quotaMetrics.join(', ')}, types ${types.join(', ')}`,
      };
      return { result: empty, files: [] };
    }

    onProgress?.({ current: 20, total: 100, message: 'Fetching quotas across accounts and regions...' });

    const rows: QuotaReportRow[] = [];
    const groupEntries = Object.values(accountGroups);
    const totalUnits = groupEntries.reduce((sum, g) => sum + g.regions.length, 0);
    let completedUnits = 0;

    // Limit concurrency to avoid throttling
    const concurrency = 8;
    const queue: Array<() => Promise<void>> = [];

    for (const group of groupEntries) {
      for (const region of group.regions) {
        queue.push(async () => {
          const values: Record<string, number | null> = {};
          try {
            const awsConfig = await awsCredentialsService.getClientConfig(group.accountId, region);
            const sq = new ServiceQuotas(awsConfig);

            // Fetch each quota code
            for (const q of quotas) {
              try {
                const res = await sq.send(
                  new GetServiceQuotaCommand({ ServiceCode: SERVICE_CODE, QuotaCode: q.QuotaCode })
                );
                values[q.QuotaCode] = res.Quota?.Value ?? null;
              } catch {
                // Missing/denied quota; record null and continue
                values[q.QuotaCode] = null;
              }
            }
          } finally {
            // Determine display name for this row
            // For Arcanum internal accounts, use stored accountName; for clients, derive from client list
            const groupWithName = group as AccountGroup & { accountName?: string };
            let accountName: string;
            if (groupWithName.accountName) {
              // Arcanum internal account
              accountName = groupWithName.accountName;
            } else if (group.clients.length > 0) {
              // Client-based account
              accountName = group.isDev ? group.clients.map((c) => c.name).join(', ') : group.clients[0].name;
            } else {
              accountName = group.accountId;
            }

            rows.push({
              accountName,
              stackNames: group.clients.length > 0 && group.isDev ? group.clients.map((c) => c.name) : undefined,
              accountId: group.accountId,
              region,
              isDev: group.isDev,
              bedrockAccount: group.bedrockAccount,
              values,
            });
            completedUnits += 1;
            const pct = 20 + Math.floor((completedUnits / Math.max(totalUnits, 1)) * 70);
            onProgress?.({ current: pct, total: 100, message: `Processed ${completedUnits}/${totalUnits}` });
          }
        });
      }
    }

    await this.runWithConcurrency(queue, concurrency);

    // Sort rows: dev accounts first, then by accountName, then by region
    rows.sort((a, b) => {
      if (a.isDev !== b.isDev) return a.isDev ? -1 : 1;
      if (a.accountName !== b.accountName) return a.accountName.localeCompare(b.accountName);
      return a.region.localeCompare(b.region);
    });

    onProgress?.({ current: 95, total: 100, message: 'Preparing export files...' });

    // Generate CSV file
    const csvFile = FileExportService.generateQuotaReportCSV(rows, quotas, {
      families: modelFamilies,
      metrics: quotaMetrics,
      types,
      advancedFilter,
    });
    const files: ToolResultFile[] = csvFile ? [csvFile] : [];

    const result: QuotaReportResult = {
      metadata: {
        runAt: new Date().toISOString(),
        totalClients: clientScope === 'arcanum-internal' ? ARCANUM_INTERNAL_ACCOUNTS.length : groupEntries.length,
        processedAccounts: groupEntries.length,
        modelFamilies,
        quotaMetrics,
        advancedFilter,
        types,
      },
      quotas,
      rows,
    };

    onProgress?.({ current: 100, total: 100, message: 'Report complete' });
    return { result, files };
  }

  /**
   * Group clients by AWS account ID for dev consolidation.
   * Dev accounts (multiple stacks on same account) get both regions.
   * Prod accounts use their configured region (or all regions if regionMode is 'all-regions').
   */
  private static groupByAccountId(
    clients: Client[],
    regionMode: 'client-region' | 'all-regions'
  ): Record<string, AccountGroup> {
    const groups: Record<string, AccountGroup> = {};

    for (const client of clients) {
      const accountId = client.config.clientAccountId;
      const isDev = client.config.devInstance === true;

      if (!groups[accountId]) {
        groups[accountId] = {
          accountId,
          clients: [],
          isDev,
          regions: [],
          bedrockAccount: client.config.bedrockAccount,
        };
      }

      groups[accountId].clients.push(client);

      // If any client in the group is dev, mark the group as dev
      if (isDev) {
        groups[accountId].isDev = true;
      }

      // Collect bedrockAccount from any client that has it
      if (client.config.bedrockAccount && !groups[accountId].bedrockAccount) {
        groups[accountId].bedrockAccount = client.config.bedrockAccount;
      }
    }

    // Determine regions for each group
    for (const group of Object.values(groups)) {
      if (group.isDev) {
        // Dev accounts always check both regions
        group.regions = ALL_REGIONS;
      } else if (regionMode === 'all-regions') {
        // User requested all regions
        group.regions = ALL_REGIONS;
      } else {
        // Use client's configured region
        const clientRegion = group.clients[0].config.region || 'us-east-1';
        group.regions = [clientRegion];
      }
    }

    return groups;
  }

  private static async discoverQuotasInClient(args: {
    families: ModelFamily[];
    types: QuotaType[];
    metrics: QuotaMetric[];
    accountId: string;
    region: string;
    advancedFilter?: string;
  }): Promise<QuotaDescriptor[]> {
    const { families, types, metrics, accountId, region, advancedFilter } = args;
    const signature = `${accountId}|${region}|${families.sort().join('+')}|${types.sort().join(',')}|${metrics.sort().join(',')}|${(advancedFilter || '').toLowerCase()}`;
    const cached = this.quotaCache.get(signature);
    if (cached) return cached;

    // Use client account (assumed ArcanumAIAccess role) to list quotas
    const clientCfg = await awsCredentialsService.getClientConfig(accountId, region);
    const sq = new ServiceQuotas(clientCfg);

    const found: QuotaDescriptor[] = [];
    let NextToken: string | undefined = undefined;

    do {
      const res = await sq.send(
        new ListServiceQuotasCommand({ ServiceCode: SERVICE_CODE, MaxResults: 100, NextToken })
      );
      NextToken = res.NextToken;

      const items = (res.Quotas || [])
        .filter(
          (q) => q.QuotaName && (/requests per minute/i.test(q.QuotaName) || /tokens per minute/i.test(q.QuotaName))
        )
        .map((q) => ({ quota: q, classified: this.classifyQuota(q.QuotaName!) }))
        .filter(({ classified }) => classified !== null)
        .filter(({ classified }) => families.includes(classified!.family))
        .filter(({ classified }) => types.includes(classified!.type))
        .filter(({ classified }) => metrics.includes(classified!.metric))
        .filter(
          ({ classified }) =>
            !advancedFilter ||
            classified!.label.toLowerCase().includes(advancedFilter.toLowerCase()) ||
            classified!.raw.toLowerCase().includes(advancedFilter.toLowerCase())
        );

      for (const { quota, classified } of items) {
        if (quota.QuotaCode && classified) {
          found.push({
            QuotaCode: quota.QuotaCode,
            QuotaName: classified.raw,
            Model: classified.label,
            Type: classified.type,
            Metric: classified.metric,
            InferenceProfile: classified.inferenceProfile,
            isPriority: this.isPriorityModel(classified.label),
          });
        }
      }
    } while (NextToken);

    // Stable order: by family (Sonnet first), then Model, then Metric (RPM first), then Type (On-demand first)
    const familyRank = (model: string): number => {
      if (/Sonnet/i.test(model)) return 0;
      if (/Opus/i.test(model)) return 1;
      if (/Haiku/i.test(model)) return 2;
      return 3; // Nova and others
    };
    const metricRank = (m: QuotaMetric): number => (m === 'requests-per-minute' ? 0 : 1);
    const typeRank = (t: QuotaType): number => (t === 'On-demand' ? 0 : t === 'Cross-region' ? 1 : 2);

    found.sort((a, b) => {
      // Priority models (4.5/4.6+) first
      const pa = a.isPriority ? 0 : 1;
      const pb = b.isPriority ? 0 : 1;
      if (pa !== pb) return pa - pb;

      const fa = familyRank(a.Model);
      const fb = familyRank(b.Model);
      if (fa !== fb) return fa - fb;
      if (a.Model !== b.Model) return a.Model.localeCompare(b.Model);
      const ma = metricRank(a.Metric);
      const mb = metricRank(b.Metric);
      if (ma !== mb) return ma - mb;
      return typeRank(a.Type) - typeRank(b.Type);
    });

    this.quotaCache.set(signature, found);
    return found;
  }

  /**
   * Classify a quota name into family, label, type, metric, and inference profile.
   */
  private static classifyQuota(name: string): ClassifiedQuota | null {
    const raw = name;
    const type: QuotaType = /^On-demand/i.test(name)
      ? 'On-demand'
      : /^Global\s+cross-region/i.test(name)
        ? 'Global cross-region'
        : 'Cross-region';
    const metric: QuotaMetric = /tokens per minute/i.test(name) ? 'tokens-per-minute' : 'requests-per-minute';
    const inferenceProfile = this.extractInferenceProfile(name);

    // Sonnet detection
    if (/Sonnet/i.test(name)) {
      const label = this.extractModelLabel(name, 'Sonnet');
      return { family: 'sonnet', label, type, metric, raw, inferenceProfile };
    }

    // Opus detection
    if (/Opus/i.test(name)) {
      const label = this.extractModelLabel(name, 'Opus');
      return { family: 'opus', label, type, metric, raw, inferenceProfile };
    }

    // Haiku detection
    if (/Haiku/i.test(name)) {
      const label = this.extractModelLabel(name, 'Haiku');
      return { family: 'haiku', label, type, metric, raw, inferenceProfile };
    }

    // Nova detection
    if (/Nova/i.test(name)) {
      const label = this.extractModelLabel(name, 'Nova');
      return { family: 'nova', label, type, metric, raw, inferenceProfile };
    }

    return null;
  }

  /**
   * Extract inference profile region from quota name (e.g., 'US', 'Global', 'APAC').
   */
  private static extractInferenceProfile(name: string): string | undefined {
    // Match patterns like "in US", "in Global", "in APAC", "in EU"
    const profileMatch = name.match(/\bin\s+(US|Global|APAC|EU)\b/i);
    if (profileMatch) {
      return profileMatch[1].toUpperCase();
    }
    return undefined;
  }

  /**
   * Extract a clean model label from a quota name.
   * Makes model versions explicit (e.g., bare "Sonnet" → "Sonnet 3.5").
   */
  private static extractModelLabel(name: string, modelKeyword: string): string {
    const start = name.search(new RegExp(modelKeyword, 'i'));
    if (start >= 0) {
      const tail = name.slice(start);
      // Extract up to "requests per minute" or "tokens per minute", excluding inference profile info
      let label = tail
        .split(/(?:requests|tokens) per minute/i)[0]
        .replace(/\s+in\s+(?:US|Global|APAC|EU)\s*$/i, '') // Remove trailing inference profile
        .trim()
        .replace(/[-–—]\s*$/, '')
        .trim();

      if (label) {
        // Make bare model names more explicit
        label = this.normalizeModelLabel(label, modelKeyword);
        return label;
      }
    }

    // Fallback: after 'Claude ' or 'Amazon '
    const fallbackMatch = name.match(/(?:Claude|Amazon)\s+(.+?)(?:requests|tokens) per minute/i);
    if (fallbackMatch) {
      let label = fallbackMatch[1]
        .replace(/\s+in\s+(?:US|Global|APAC|EU)\s*$/i, '')
        .trim()
        .replace(/[-–—]\s*$/, '')
        .trim();
      label = this.normalizeModelLabel(label, modelKeyword);
      return label;
    }

    return this.normalizeModelLabel(modelKeyword, modelKeyword);
  }

  /**
   * Normalize model labels to be more explicit about versions.
   * - Bare "Sonnet" → "Sonnet 3.5" (the original Claude 3.5 Sonnet)
   * - Bare "Haiku" → "Haiku 3" (the original Claude 3 Haiku)
   * - Bare "Opus" → "Opus 3" (Claude 3 Opus)
   */
  private static normalizeModelLabel(label: string, modelKeyword: string): string {
    // If the label is just the bare model name without version, add default version
    const barePattern = new RegExp(`^${modelKeyword}$`, 'i');
    if (barePattern.test(label.trim())) {
      switch (modelKeyword.toLowerCase()) {
        case 'sonnet':
          return 'Sonnet 3.5';
        case 'haiku':
          return 'Haiku 3';
        case 'opus':
          return 'Opus 3';
        default:
          return label;
      }
    }
    return label;
  }

  /**
   * Check if a model label represents a priority (latest generation) model.
   * Models with version 4.5 or higher are considered priority.
   */
  private static isPriorityModel(label: string): boolean {
    const versionMatch = label.match(/\b(\d+)\.(\d+)\b/);
    if (!versionMatch) return false;
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    return major > 4 || (major === 4 && minor >= 5);
  }

  /**
   * Quick quota check for a single account/region. Discovers quotas and fetches
   * their values. Lighter-weight than generateReport() — no multi-account grouping,
   * no CSV export, no client-service lookups.
   */
  static async checkSingleAccountQuotas(args: {
    accountId: string;
    region: string;
    families?: ModelFamily[];
    onProgress?: (progress: ToolProgress) => void;
  }): Promise<{
    quotas: QuotaDescriptor[];
    values: Record<string, number | null>;
  }> {
    const { accountId, region, families = ['sonnet', 'opus', 'haiku'], onProgress } = args;

    onProgress?.({ current: 0, total: 100, message: 'Discovering quota definitions...' });

    const quotas = await this.discoverQuotasInClient({
      families,
      types: ['On-demand', 'Cross-region'],
      metrics: ['requests-per-minute', 'tokens-per-minute'],
      accountId,
      region,
    });

    if (quotas.length === 0) {
      onProgress?.({ current: 100, total: 100, message: 'No quotas found' });
      return { quotas: [], values: {} };
    }

    onProgress?.({ current: 30, total: 100, message: 'Fetching quota values...' });

    const values: Record<string, number | null> = {};
    const awsConfig = await awsCredentialsService.getClientConfig(accountId, region);
    const sq = new ServiceQuotas(awsConfig);

    for (let i = 0; i < quotas.length; i++) {
      const q = quotas[i];
      try {
        const res = await sq.send(new GetServiceQuotaCommand({ ServiceCode: SERVICE_CODE, QuotaCode: q.QuotaCode }));
        values[q.QuotaCode] = res.Quota?.Value ?? null;
      } catch {
        values[q.QuotaCode] = null;
      }
      onProgress?.({
        current: 30 + Math.floor(((i + 1) / quotas.length) * 70),
        total: 100,
        message: `Fetched ${i + 1}/${quotas.length} quotas`,
      });
    }

    return { quotas, values };
  }

  private static async runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
    let index = 0;
    const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
      while (index < tasks.length) {
        const current = index++;
        const task = tasks[current];
        try {
          await task();
        } catch {
          // Swallow per-task errors; capture per-row nulls above
        }
      }
    });
    await Promise.all(workers);
  }
}
