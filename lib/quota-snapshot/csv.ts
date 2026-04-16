import { QUOTA_METRIC_SUFFIX, type QuotaDescriptor, type QuotaReportRow } from './types.js';

function escapeField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildQuotaHeader(quota: QuotaDescriptor): string {
  const parts: string[] = [quota.Model, quota.Type];
  if (quota.InferenceProfile) parts.push(quota.InferenceProfile);
  parts.push(QUOTA_METRIC_SUFFIX[quota.Metric]);
  const header = parts.join('-');
  return quota.isPriority ? `* ${header}` : header;
}

export interface BuildCsvOptions {
  /** If provided, emitted as a `snapshotDate` column on every row (YYYY-MM-DD). */
  snapshotDate?: string;
}

export function buildQuotaReportCsv(
  rows: QuotaReportRow[],
  quotas: QuotaDescriptor[],
  options: BuildCsvOptions = {}
): string {
  const headers: string[] = [];
  if (options.snapshotDate !== undefined) headers.push('snapshotDate');
  headers.push('accountName', 'stackNames', 'accountId', 'region', 'isDev', 'bedrockAccount');
  headers.push(...quotas.map(buildQuotaHeader));

  const lines = [headers.join(',')];

  for (const row of rows) {
    const values: string[] = [];
    if (options.snapshotDate !== undefined) values.push(options.snapshotDate);
    values.push(
      escapeField(row.accountName),
      escapeField(row.stackNames?.join('; ') ?? ''),
      row.accountId,
      row.region,
      row.isDev ? 'Yes' : 'No',
      row.bedrockAccount ?? ''
    );
    for (const q of quotas) {
      const v = row.values[q.QuotaCode];
      values.push(v === null || v === undefined ? '' : String(v));
    }
    lines.push(values.join(','));
  }

  return lines.join('\n');
}
