/**
 * Extract a human-readable error message from a thrown error, preferring
 * the lambda's structured `{ error: '...' }` body over axios's generic
 * "Request failed with status code XXX".
 *
 * Lambdas in this project respond with `{ error: message }` (see
 * `respond()` in the various handlers). When the request fails, that
 * payload sits at `error.response.data.error`. Without unwrapping it,
 * UI alerts show the useless "Request failed with status code 409"
 * instead of the actual remediation hint we worked to put in the body.
 */
/** Axios's generic "Request failed with status code N" fallback — the exact
 *  string this helper exists to suppress. Drop through to `fallback` when we
 *  see it so UI alerts show our caller's hint instead. */
const AXIOS_GENERIC_RE = /^Request failed with status code \d+$/i;

const cleanString = (s: string | undefined): string | undefined => {
  if (typeof s !== 'string') return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  if (AXIOS_GENERIC_RE.test(trimmed)) return undefined;
  return trimmed;
};

export const extractApiError = (err: unknown, fallback = 'Request failed'): string => {
  if (err && typeof err === 'object') {
    const e = err as {
      response?: { data?: unknown };
      message?: string;
    };
    const data = e.response?.data;
    if (data && typeof data === 'object') {
      const body = data as { error?: unknown; message?: unknown };
      const bodyError = typeof body.error === 'string' ? cleanString(body.error) : undefined;
      if (bodyError) return bodyError;
      const bodyMessage = typeof body.message === 'string' ? cleanString(body.message) : undefined;
      if (bodyMessage) return bodyMessage;
    }
    if (typeof data === 'string') {
      const cleaned = cleanString(data);
      if (cleaned) return cleaned;
    }
    const msg = cleanString(e.message);
    if (msg) return msg;
  }
  return fallback;
};
