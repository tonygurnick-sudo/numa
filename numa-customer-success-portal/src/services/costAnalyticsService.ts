import { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } from '@aws-sdk/client-cost-explorer';
import { awsCredentialsService } from './awsCredentialsService';
import { clientService } from './clientService';
import { clientMetadataService } from './clientMetadataService';
import { FileExportService } from '@/utils/fileExport';
import type { Client, ClientMetadata } from '@/types';
import type {
  CostAnalyticsParameters,
  CostAnalyticsResult,
  CostRecord,
  CostSummaryRecord,
  ToolProgress,
  ToolResultFile,
} from '@/types/tools';

interface ClientCostResult {
  clientName: string;
  serviceBreakdown: CostRecord[];
  error?: string;
}

export class CostAnalyticsService {
  /**
   * Generate cost analytics report for one or multiple clients
   */
  static async generateReport(
    parameters: CostAnalyticsParameters,
    onProgress?: (progress: ToolProgress) => void
  ): Promise<{ result: CostAnalyticsResult; files: ToolResultFile[] }> {
    onProgress?.({ current: 0, total: 100, message: 'Starting cost analysis...' });

    const { startDate, endDate } = this.resolveTimePeriod(parameters);

    onProgress?.({ current: 5, total: 100, message: 'Loading client configurations...' });

    const [allClients, metadataMap] = await Promise.all([
      clientService.getAllClients(),
      clientMetadataService.getAllMetadata(),
    ]);

    let clientsToProcess: Client[];
    if (parameters.clientNames.length === 0) {
      clientsToProcess = allClients;
    } else {
      clientsToProcess = allClients.filter((c) => parameters.clientNames.includes(c.name));
    }

    if (clientsToProcess.length === 0) {
      throw new Error('No clients found matching the selection');
    }

    // Deduplicate by accountId — multiple stacks can share an account
    const accountMap = new Map<string, { client: Client; stackNames: string[] }>();
    for (const client of clientsToProcess) {
      const accountId = client.config.clientAccountId;
      const existing = accountMap.get(accountId);
      if (existing) {
        existing.stackNames.push(client.name);
      } else {
        accountMap.set(accountId, { client, stackNames: [client.name] });
      }
    }

    onProgress?.({
      current: 10,
      total: 100,
      message: `Processing ${accountMap.size} account(s) (${clientsToProcess.length} client(s))...`,
    });

    const allResults: ClientCostResult[] = [];
    const failedClients: { clientName: string; error: string }[] = [];
    const entries = Array.from(accountMap.entries());

    for (let i = 0; i < entries.length; i++) {
      const [accountId, { client, stackNames }] = entries[i];
      const progressBase = 10 + (i / entries.length) * 75;
      const label = stackNames.length > 1 ? stackNames.join(', ') : stackNames[0];

      onProgress?.({
        current: progressBase,
        total: 100,
        message: `Processing ${label} (${i + 1}/${entries.length})...`,
      });

      try {
        const result = await this.processAccount(
          accountId,
          client.config.region || 'us-east-1',
          stackNames,
          startDate,
          endDate,
          parameters.granularity,
          metadataMap
        );
        allResults.push(...result);
      } catch (error) {
        console.error(`Failed to process account ${accountId} (${label}):`, error);
        for (const name of stackNames) {
          failedClients.push({
            clientName: name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    onProgress?.({ current: 85, total: 100, message: 'Aggregating results...' });

    // Collect all service breakdown records
    const allServiceBreakdown: CostRecord[] = [];
    for (const result of allResults) {
      allServiceBreakdown.push(...result.serviceBreakdown);
    }

    // Build summary records per client per period
    const summary = this.buildSummary(allServiceBreakdown, parameters.includeForecast, metadataMap);

    // Try to get forecasts if requested
    if (parameters.includeForecast) {
      onProgress?.({ current: 88, total: 100, message: 'Fetching cost forecasts...' });
      await this.enrichWithForecasts(summary, accountMap, failedClients);
    }

    const totalCost = summary.reduce((sum, s) => sum + s.totalCost, 0);

    const result: CostAnalyticsResult = {
      metadata: {
        clientNames: clientsToProcess.map((c) => c.name),
        startDate,
        endDate,
        granularity: parameters.granularity,
        exportDate: new Date().toISOString(),
        clientsProcessed: allResults.length,
        clientsFailed: failedClients.length,
        totalCost,
        currency: 'USD',
      },
      summary,
      serviceBreakdown: allServiceBreakdown,
      failedClients: failedClients.length > 0 ? failedClients : undefined,
    };

    onProgress?.({ current: 92, total: 100, message: 'Generating export files...' });

    const files = this.generateExportFiles(result, parameters);

    onProgress?.({ current: 100, total: 100, message: 'Cost analysis complete!' });

    return { result, files };
  }

  private static resolveTimePeriod(parameters: CostAnalyticsParameters): {
    startDate: string;
    endDate: string;
  } {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    switch (parameters.timePeriod) {
      case 'last-1-month': {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return {
          startDate: this.formatDate(start),
          endDate: todayStr,
        };
      }
      case 'last-3-months': {
        const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return {
          startDate: this.formatDate(start),
          endDate: todayStr,
        };
      }
      case 'last-6-months': {
        const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        return {
          startDate: this.formatDate(start),
          endDate: todayStr,
        };
      }
      case 'current-year': {
        const start = new Date(now.getFullYear(), 0, 1);
        return {
          startDate: this.formatDate(start),
          endDate: todayStr,
        };
      }
      case 'custom':
        if (!parameters.customStartDate || !parameters.customEndDate) {
          throw new Error('Custom date range requires both start and end dates');
        }
        return {
          startDate: parameters.customStartDate,
          endDate: parameters.customEndDate,
        };
      default:
        throw new Error(`Unknown time period: ${parameters.timePeriod}`);
    }
  }

  private static formatDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private static async processAccount(
    accountId: string,
    _region: string,
    stackNames: string[],
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY',
    metadataMap: Map<string, ClientMetadata>
  ): Promise<ClientCostResult[]> {
    // Cost Explorer must be called from us-east-1 (global endpoint)
    const awsConfig = await awsCredentialsService.getClientConfig(accountId, 'us-east-1');
    const ceClient = new CostExplorerClient(awsConfig);

    const response = await ceClient.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: granularity,
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      })
    );

    // When multiple stacks share an account, aggregate under a combined name
    const clientName = stackNames.length > 1 ? stackNames.join(' + ') : stackNames[0];
    const metadata = metadataMap.get(stackNames[0]);
    const serviceBreakdown: CostRecord[] = [];

    for (const resultByTime of response.ResultsByTime || []) {
      const period = resultByTime.TimePeriod?.Start || '';

      for (const group of resultByTime.Groups || []) {
        const service = group.Keys?.[0] || 'Unknown';
        const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0');

        if (cost === 0) continue;

        serviceBreakdown.push({
          clientName,
          period,
          service,
          unblendedCost: Math.round(cost * 100) / 100,
          currency: group.Metrics?.UnblendedCost?.Unit || 'USD',
          ...(metadata
            ? {
                clientStatus: metadata.status,
                clientTrialStart: metadata.trialStartDate || '',
                clientTrialEnd: metadata.trialEndDate || '',
                clientNotes: metadata.notes || '',
              }
            : {}),
        });
      }
    }

    return [{ clientName, serviceBreakdown }];
  }

  private static buildSummary(
    serviceBreakdown: CostRecord[],
    _includeForecast: boolean,
    metadataMap: Map<string, ClientMetadata>
  ): CostSummaryRecord[] {
    // Group by client + period
    const grouped = new Map<string, CostRecord[]>();
    for (const record of serviceBreakdown) {
      const key = `${record.clientName}|${record.period}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(record);
      } else {
        grouped.set(key, [record]);
      }
    }

    const summaries: CostSummaryRecord[] = [];
    for (const [key, records] of grouped) {
      const [clientName, period] = key.split('|');
      const totalCost = records.reduce((sum, r) => sum + r.unblendedCost, 0);
      const metadata = metadataMap.get(clientName);

      // Top services sorted by cost descending
      const serviceMap = new Map<string, number>();
      for (const r of records) {
        serviceMap.set(r.service, (serviceMap.get(r.service) || 0) + r.unblendedCost);
      }
      const topServices = Array.from(serviceMap.entries())
        .map(([service, cost]) => ({ service, cost: Math.round(cost * 100) / 100 }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      summaries.push({
        clientName,
        period,
        totalCost: Math.round(totalCost * 100) / 100,
        currency: 'USD',
        topServices,
        ...(metadata
          ? {
              clientStatus: metadata.status,
              clientTrialStart: metadata.trialStartDate || '',
              clientTrialEnd: metadata.trialEndDate || '',
              clientNotes: metadata.notes || '',
            }
          : {}),
      });
    }

    // Sort by client name then period
    summaries.sort((a, b) => {
      const clientCompare = a.clientName.localeCompare(b.clientName);
      return clientCompare !== 0 ? clientCompare : a.period.localeCompare(b.period);
    });

    // Calculate cost change vs previous period per client
    const clientPeriods = new Map<string, CostSummaryRecord[]>();
    for (const s of summaries) {
      const existing = clientPeriods.get(s.clientName);
      if (existing) {
        existing.push(s);
      } else {
        clientPeriods.set(s.clientName, [s]);
      }
    }
    for (const periods of clientPeriods.values()) {
      for (let i = 1; i < periods.length; i++) {
        const prev = periods[i - 1];
        const curr = periods[i];
        curr.costChange = Math.round((curr.totalCost - prev.totalCost) * 100) / 100;
        curr.costChangePercent =
          prev.totalCost > 0
            ? Math.round(((curr.totalCost - prev.totalCost) / prev.totalCost) * 10000) / 100
            : undefined;
      }
    }

    return summaries;
  }

  private static async enrichWithForecasts(
    summary: CostSummaryRecord[],
    accountMap: Map<string, { client: Client; stackNames: string[] }>,
    _failedClients: { clientName: string; error: string }[]
  ): Promise<void> {
    const now = new Date();
    const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const forecastEnd = this.formatDate(nextMonthStart);

    // Only forecast if we're not on the first day of the month
    if (now.getDate() <= 1) return;

    for (const [accountId, { client, stackNames }] of accountMap) {
      try {
        const awsConfig = await awsCredentialsService.getClientConfig(accountId, 'us-east-1');
        const ceClient = new CostExplorerClient(awsConfig);

        const forecast = await ceClient.send(
          new GetCostForecastCommand({
            TimePeriod: { Start: this.formatDate(now), End: forecastEnd },
            Metric: 'UNBLENDED_COST',
            Granularity: 'MONTHLY',
          })
        );

        const forecastAmount = parseFloat(forecast.Total?.Amount || '0');
        if (forecastAmount > 0) {
          // Use combined name to match how processAccount labels shared accounts
          const combinedName = stackNames.length > 1 ? stackNames.join(' + ') : stackNames[0];
          const currentMonthSummary = summary.find(
            (s) => s.clientName === combinedName && s.period === currentMonthStart
          );
          if (currentMonthSummary) {
            currentMonthSummary.forecastedCost = Math.round(forecastAmount * 100) / 100;
          }
        }
      } catch (error) {
        // Forecast failures are non-critical — just log and continue
        console.warn(`Failed to get forecast for account ${accountId} (${client.name}):`, error);
      }
    }
  }

  private static generateExportFiles(
    result: CostAnalyticsResult,
    parameters: CostAnalyticsParameters
  ): ToolResultFile[] {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const files: ToolResultFile[] = [];
    const periodLabel = `${result.metadata.startDate}_to_${result.metadata.endDate}`;

    if (parameters.outputFormat === 'csv' || parameters.outputFormat === 'json') {
      // Summary CSV
      const summaryData = result.summary.map((s) => ({
        ...s,
        topServices: s.topServices.map((t) => `${t.service}: $${t.cost}`).join('; '),
      }));

      const summaryContent = FileExportService.arrayToCSV(
        summaryData as unknown as Record<string, unknown>[],
        [
          'clientName',
          'clientStatus',
          'period',
          'totalCost',
          'forecastedCost',
          'costChange',
          'costChangePercent',
          'currency',
          'topServices',
        ],
        [
          'Client',
          'Status',
          'Period',
          'Total Cost ($)',
          'Forecasted Cost ($)',
          'Cost Change ($)',
          'Cost Change (%)',
          'Currency',
          'Top Services',
        ]
      );

      files.push({
        name: `cost-summary-${periodLabel}-${timestamp}.csv`,
        content: summaryContent,
        mimeType: 'text/csv',
        size: new Blob([summaryContent]).size,
      });

      // Service breakdown CSV
      const breakdownContent = FileExportService.arrayToCSV(
        result.serviceBreakdown as unknown as Record<string, unknown>[],
        ['clientName', 'clientStatus', 'period', 'service', 'unblendedCost', 'currency'],
        ['Client', 'Status', 'Period', 'Service', 'Unblended Cost ($)', 'Currency']
      );

      files.push({
        name: `cost-service-breakdown-${periodLabel}-${timestamp}.csv`,
        content: breakdownContent,
        mimeType: 'text/csv',
        size: new Blob([breakdownContent]).size,
      });
    }

    if (parameters.outputFormat === 'json') {
      const jsonContent = JSON.stringify(result, null, 2);
      files.push({
        name: `cost-analytics-${periodLabel}-${timestamp}.json`,
        content: jsonContent,
        mimeType: 'application/json',
        size: new Blob([jsonContent]).size,
      });
    }

    return files;
  }
}
