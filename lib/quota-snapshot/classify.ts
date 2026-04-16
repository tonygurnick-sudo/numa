import type { ClassifiedQuota, ModelFamily, QuotaDescriptor, QuotaMetric, QuotaType } from './types.js';

export function isQuotaNameSupported(name: string): boolean {
  return (
    /requests per minute/i.test(name) ||
    /tokens per minute/i.test(name) ||
    /requests per day/i.test(name) ||
    /tokens per day/i.test(name)
  );
}

export function classifyQuota(name: string): ClassifiedQuota | null {
  const raw = name;
  const type: QuotaType = /^On-demand/i.test(name)
    ? 'On-demand'
    : /^Global\s+cross-region/i.test(name)
      ? 'Global cross-region'
      : 'Cross-region';

  const metric: QuotaMetric = /tokens per day/i.test(name)
    ? 'tokens-per-day'
    : /requests per day/i.test(name)
      ? 'requests-per-day'
      : /tokens per minute/i.test(name)
        ? 'tokens-per-minute'
        : 'requests-per-minute';

  const inferenceProfile = extractInferenceProfile(name);

  if (/Sonnet/i.test(name)) {
    return { family: 'sonnet', label: extractModelLabel(name, 'Sonnet'), type, metric, raw, inferenceProfile };
  }
  if (/Opus/i.test(name)) {
    return { family: 'opus', label: extractModelLabel(name, 'Opus'), type, metric, raw, inferenceProfile };
  }
  if (/Haiku/i.test(name)) {
    return { family: 'haiku', label: extractModelLabel(name, 'Haiku'), type, metric, raw, inferenceProfile };
  }
  if (/Nova/i.test(name)) {
    return { family: 'nova', label: extractModelLabel(name, 'Nova'), type, metric, raw, inferenceProfile };
  }
  return null;
}

function extractInferenceProfile(name: string): string | undefined {
  const match = name.match(/\bin\s+(US|Global|APAC|EU)\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function extractModelLabel(name: string, modelKeyword: string): string {
  const start = name.search(new RegExp(modelKeyword, 'i'));
  if (start >= 0) {
    const tail = name.slice(start);
    let label = tail
      .split(/(?:requests|tokens) per (?:minute|day)/i)[0]
      .replace(/\s+in\s+(?:US|Global|APAC|EU)\s*$/i, '')
      .trim()
      .replace(/[-–—]\s*$/, '')
      .trim();
    if (label) return normalizeModelLabel(label, modelKeyword);
  }

  const fallback = name.match(/(?:Claude|Amazon)\s+(.+?)(?:requests|tokens) per (?:minute|day)/i);
  if (fallback) {
    let label = fallback[1]
      .replace(/\s+in\s+(?:US|Global|APAC|EU)\s*$/i, '')
      .trim()
      .replace(/[-–—]\s*$/, '')
      .trim();
    return normalizeModelLabel(label, modelKeyword);
  }

  return normalizeModelLabel(modelKeyword, modelKeyword);
}

function normalizeModelLabel(label: string, modelKeyword: string): string {
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

export function isPriorityModel(label: string): boolean {
  const match = label.match(/\b(\d+)\.(\d+)\b/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 4 || (major === 4 && minor >= 5);
}

const FAMILY_RANK: Record<ModelFamily | 'other', number> = {
  sonnet: 0,
  opus: 1,
  haiku: 2,
  nova: 3,
  other: 4,
};
const METRIC_RANK: Record<QuotaMetric, number> = {
  'requests-per-minute': 0,
  'tokens-per-minute': 1,
  'requests-per-day': 2,
  'tokens-per-day': 3,
};
const TYPE_RANK: Record<QuotaType, number> = {
  'On-demand': 0,
  'Cross-region': 1,
  'Global cross-region': 2,
};

function familyFromModelLabel(label: string): ModelFamily | 'other' {
  if (/Sonnet/i.test(label)) return 'sonnet';
  if (/Opus/i.test(label)) return 'opus';
  if (/Haiku/i.test(label)) return 'haiku';
  if (/Nova/i.test(label)) return 'nova';
  return 'other';
}

export function sortQuotaDescriptors(descriptors: QuotaDescriptor[]): QuotaDescriptor[] {
  return [...descriptors].sort((a, b) => {
    const pa = a.isPriority ? 0 : 1;
    const pb = b.isPriority ? 0 : 1;
    if (pa !== pb) return pa - pb;

    const fa = FAMILY_RANK[familyFromModelLabel(a.Model)];
    const fb = FAMILY_RANK[familyFromModelLabel(b.Model)];
    if (fa !== fb) return fa - fb;

    if (a.Model !== b.Model) return a.Model.localeCompare(b.Model);

    const ma = METRIC_RANK[a.Metric];
    const mb = METRIC_RANK[b.Metric];
    if (ma !== mb) return ma - mb;

    return TYPE_RANK[a.Type] - TYPE_RANK[b.Type];
  });
}

export function descriptorFromClassified(quotaCode: string, classified: ClassifiedQuota): QuotaDescriptor {
  return {
    QuotaCode: quotaCode,
    QuotaName: classified.raw,
    Model: classified.label,
    Type: classified.type,
    Metric: classified.metric,
    InferenceProfile: classified.inferenceProfile,
    isPriority: isPriorityModel(classified.label),
  };
}
