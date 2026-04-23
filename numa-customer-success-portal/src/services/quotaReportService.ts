import { ServiceQuotas } from '@aws-sdk/client-service-quotas';
import { discoverBedrockQuotas, fetchQuotaValues } from '@numa/quota-snapshot';
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
  ModelFamily,
} from '@/types/tools';

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
          totalClients:
            clientScope === 'arcanum-internal' ? ARCANUM_INTERNAL_ACCOUNTS.length : Object.keys(accountGroups).length,
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
          let values: Record<string, number | null> = {};
          try {
            const awsConfig = await awsCredentialsService.getClientConfig(group.accountId, region);
            const sq = new ServiceQuotas(awsConfig);
            values = await fetchQuotaValues(sq, quotas);
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
    types: QuotaReportParameters['types'];
    metrics: QuotaReportParameters['quotaMetrics'];
    accountId: string;
    region: string;
    advancedFilter?: string;
  }): Promise<QuotaDescriptor[]> {
    const { families, types, metrics, accountId, region, advancedFilter } = args;
    const signature = `${accountId}|${region}|${[...families].sort().join('+')}|${[...types].sort().join(',')}|${[...metrics].sort().join(',')}|${(advancedFilter || '').toLowerCase()}`;
    const cached = this.quotaCache.get(signature);
    if (cached) return cached;

    const clientCfg = await awsCredentialsService.getClientConfig(accountId, region);
    const sq = new ServiceQuotas(clientCfg);
    const found = await discoverBedrockQuotas(sq, { families, types, metrics, advancedFilter });
    this.quotaCache.set(signature, found);
    return found;
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
      metrics: ['requests-per-minute', 'tokens-per-minute', 'requests-per-day', 'tokens-per-day'],
      accountId,
      region,
    });

    if (quotas.length === 0) {
      onProgress?.({ current: 100, total: 100, message: 'No quotas found' });
      return { quotas: [], values: {} };
    }

    onProgress?.({ current: 30, total: 100, message: 'Fetching quota values...' });

    const awsConfig = await awsCredentialsService.getClientConfig(accountId, region);
    const sq = new ServiceQuotas(awsConfig);
    const values = await fetchQuotaValues(sq, quotas);
    onProgress?.({ current: 100, total: 100, message: `Fetched ${quotas.length}/${quotas.length} quotas` });

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
