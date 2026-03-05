// Lightweight version checker: fetches /version.json (no-cache) and compares gitHash
// If a change is detected, calls onNewVersion callback (if provided) or reloads the page.
export type OnNewVersionFn = (newVersion: string) => void;

export function startVersionChecker(onNewVersion?: OnNewVersionFn, pollIntervalMs = 5 * 60 * 1000) {
  const storageKey = 'numaReleaseVersion';

  async function fetchVersion(): Promise<string | null> {
    try {
      const res = await fetch('/version.json', { cache: 'no-cache' });
      if (!res.ok) return null;
      const json = await res.json();
      return json.gitHash ?? json.version ?? null;
    } catch {
      return null;
    }
  }

  let last: string | null = localStorage.getItem(storageKey);

  async function check() {
    const v = await fetchVersion();
    if (!v) return;
    // initialize stored value if missing
    if (!last) {
      last = v;
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // best-effort; ignore storage failures
      }
      return;
    }
    if (last !== v) {
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // best-effort; ignore storage failures
      }
      last = v;
      if (onNewVersion) onNewVersion(v);
      else window.location.reload();
    }
  }

  // run an immediate check, then optionally poll
  check().catch(() => {
    // ignore transient version fetch errors
  });
  let timer: number | undefined;
  if (pollIntervalMs && pollIntervalMs > 0) {
    timer = window.setInterval(
      () =>
        check().catch(() => {
          // ignore transient version fetch errors
        }),
      pollIntervalMs
    );
  }

  return () => {
    if (timer) window.clearInterval(timer);
  };
}
