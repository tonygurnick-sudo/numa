/**
 * Wrap a promise with a defensive timeout.
 *
 * Rejects with a labelled Error if the promise doesn't settle within `ms`.
 * The underlying operation is NOT cancelled — Promise.race just stops
 * awaiting it — so callers must tolerate the abandoned promise settling
 * later (e.g. its state updates landing after the caller has moved on).
 *
 * Used to keep the conversation-load path from hanging the loading spinner
 * indefinitely when an AWS SDK call or fetch stalls (BUG-140).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
