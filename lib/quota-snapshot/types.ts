export type QuotaType = 'On-demand' | 'Cross-region' | 'Global cross-region';
export type ModelFamily = 'sonnet' | 'opus' | 'haiku' | 'nova';
export type QuotaMetric = 'requests-per-minute' | 'tokens-per-minute' | 'requests-per-day' | 'tokens-per-day';

export interface ClassifiedQuota {
  family: ModelFamily;
  label: string;
  type: QuotaType;
  metric: QuotaMetric;
  raw: string;
  inferenceProfile?: string;
}

export interface QuotaDescriptor {
  QuotaCode: string;
  QuotaName: string;
  Model: string;
  Type: QuotaType;
  Metric: QuotaMetric;
  InferenceProfile?: string;
  isPriority?: boolean;
}

export interface QuotaReportRow {
  accountName: string;
  stackNames?: string[];
  accountId: string;
  region: string;
  isDev: boolean;
  bedrockAccount?: string;
  values: Record<string, number | null>;
}

export interface QuotaFilter {
  families: ModelFamily[];
  types: QuotaType[];
  metrics: QuotaMetric[];
  advancedFilter?: string;
}

export const QUOTA_METRIC_SUFFIX: Record<QuotaMetric, string> = {
  'requests-per-minute': 'RPM',
  'tokens-per-minute': 'TPM',
  'requests-per-day': 'RPD',
  'tokens-per-day': 'TPD',
};

export const ALL_MODEL_FAMILIES: ModelFamily[] = ['sonnet', 'opus', 'haiku', 'nova'];
export const ALL_QUOTA_TYPES: QuotaType[] = ['On-demand', 'Cross-region', 'Global cross-region'];
export const ALL_QUOTA_METRICS: QuotaMetric[] = [
  'requests-per-minute',
  'tokens-per-minute',
  'requests-per-day',
  'tokens-per-day',
];
