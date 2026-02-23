// Blob URL cache for profile images — once downloaded, the blob URL never expires in-memory.
// This prevents re-downloads and eliminates flicker on re-renders.
export const blobCache = new Map<string, string>();
export const inflight = new Map<string, Promise<string>>();

/** Invalidate a cached blob URL so the next render re-fetches from S3. */
export function invalidateProfileBlob(bucket: string, key: string): void {
  const cacheKey = `${bucket}|${key}`;
  const existing = blobCache.get(cacheKey);
  if (existing) {
    URL.revokeObjectURL(existing);
    blobCache.delete(cacheKey);
  }
  inflight.delete(cacheKey);
}
