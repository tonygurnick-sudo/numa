// Utilities for normalising job status and formatting durations
// NZ spelling preference: normalise

// Stale threshold: configurable via VITE_STALE_RUNNING_HOURS, default 2 hours
const STALE_RUNNING_THRESHOLD_MS = (() => {
  const hoursEnv = Number(import.meta?.env?.VITE_STALE_RUNNING_HOURS);
  const hours = Number.isFinite(hoursEnv) && hoursEnv > 0 ? hoursEnv : 2;
  return hours * 60 * 60 * 1000;
})();

const normaliseRawStatus = (input) => {
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    if (Object.prototype.hasOwnProperty.call(input, 'status')) {
      return normaliseRawStatus(input.status);
    }
    return '';
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return normaliseRawStatus(parsed);
      } catch {
        // fall through
      }
    }
    const lower = trimmed.toLowerCase();
    const synonymMap = new Map([
      ['success', 'SUCCESS'],
      ['succeeded', 'SUCCESS'],
      ['ok', 'SUCCESS'],
      ['done', 'COMPLETED'],
      ['complete', 'COMPLETED'],
      ['completed', 'COMPLETED'],
      ['failure', 'FAILED'],
      ['fail', 'FAILED'],
      ['error', 'ERROR'],
      ['running', 'RUNNING'],
      ['in-progress', 'IN-PROGRESS'],
      ['processing', 'PROCESSING'],
      ['queued', 'QUEUED'],
      ['pending', 'PENDING'],
      ['files_uploaded', 'FILES-UPLOADED'],
      ['files-uploaded', 'FILES-UPLOADED'],
    ]);
    if (synonymMap.has(lower)) return synonymMap.get(lower);
    return trimmed.toUpperCase();
  }
  return '';
};

export const getDisplayStatusUpper = (job) => {
  const raw = normaliseRawStatus(job?.status);
  const startedAt = job?.startedAt || job?.started || job?.dateTime || job?.createdAt || job?.date;
  const isRunningState = ['RUNNING', 'IN-PROGRESS', 'PROCESSING', 'PENDING', 'QUEUED'].includes(raw);

  if (isRunningState && startedAt) {
    const start = new Date(startedAt);
    if (!Number.isNaN(start.getTime())) {
      const age = Date.now() - start.getTime();
      if (age > STALE_RUNNING_THRESHOLD_MS) {
        return 'FAILED-STUCK';
      }
    }
  }

  // Fallback: based on provided duration
  if (isRunningState && typeof job?.duration === 'number' && job.duration * 1000 > STALE_RUNNING_THRESHOLD_MS) {
    return 'FAILED-STUCK';
  }

  if (!raw) return 'UNKNOWN';
  const known = new Set([
    'SUCCESS',
    'COMPLETED',
    'FAILURE',
    'FAILED',
    'ERROR',
    'PROCESSING',
    'RUNNING',
    'IN-PROGRESS',
    'QUEUED',
    'PENDING',
    'FILES_UPLOADED',
    'FILES-UPLOADED',
    'FAILED-STUCK',
  ]);
  if (!known.has(raw)) {
    console.warn('Unknown job status encountered:', raw, 'for job', job?.jobId || 'unknown');
    return 'UNKNOWN';
  }
  return raw;
};

export const formatDuration = (durationInSeconds, job) => {
  const jobStatus = getDisplayStatusUpper(job) || '';

  if (jobStatus === 'FAILED-STUCK') return '-';

  if (
    jobStatus === 'RUNNING' ||
    jobStatus === 'IN-PROGRESS' ||
    jobStatus === 'PROCESSING' ||
    jobStatus === 'PENDING' ||
    jobStatus === 'QUEUED'
  ) {
    return 'In progress';
  }

  if (durationInSeconds === null || durationInSeconds === undefined) {
    const endTs = job?.completedAt || job?.endedAt || job?.finishedAt || job?.lastUpdated || job?.dateTime;
    const startTs = job?.startedAt || job?.createdAt || job?.date || job?.started;

    if (
      jobStatus === 'FILES-UPLOADED' ||
      jobStatus === 'FAILED' ||
      jobStatus === 'ERROR' ||
      jobStatus === 'FAILURE' ||
      jobStatus === 'FAILED-STUCK'
    ) {
      return '-';
    }

    if ((jobStatus === 'SUCCESS' || jobStatus === 'COMPLETED') && startTs && endTs) {
      const start = new Date(startTs).getTime();
      const end = new Date(endTs).getTime();
      const seconds = Math.max(0, Math.round((end - start) / 1000));
      if (seconds < 60) {
        return `${seconds}s`;
      }
      if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      }
      return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    if (
      jobStatus === 'RUNNING' ||
      jobStatus === 'IN-PROGRESS' ||
      jobStatus === 'PROCESSING' ||
      jobStatus === 'PENDING' ||
      jobStatus === 'QUEUED'
    ) {
      return 'In progress';
    }

    return '-';
  }

  if (durationInSeconds < 1) return '<1s';
  if (durationInSeconds < 0) return '-';
  if (durationInSeconds < 60) return `${Math.round(durationInSeconds)}s`;
  if (durationInSeconds < 3600) {
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = Math.round(durationInSeconds % 60);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};
