/**
 * Pull a useful error message out of an axios/HTTP error.
 * Falls back to err.message / String(err) when no server payload is present,
 * so it's safe to use as a drop-in replacement for `String(err)`.
 *
 * Backend errorResponse shape is `{ error: string }`; this also handles raw
 * string payloads and standard Error instances.
 */
export const extractApiError = (err: unknown): string => {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (typeof data === 'string' && data.trim()) return data.trim();
    if (data && typeof data === 'object') {
      const errMsg = (data as { error?: unknown; message?: unknown }).error;
      if (typeof errMsg === 'string' && errMsg.trim()) return errMsg.trim();
      const msg = (data as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return String(err);
};
