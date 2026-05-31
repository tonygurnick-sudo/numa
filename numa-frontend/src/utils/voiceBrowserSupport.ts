/**
 * voiceBrowserSupport — which browsers can run the embedded Amazon Connect softphone.
 *
 * The CCP is embedded as a cross-origin iframe (<tenant>.numa.arcanum.ai framing
 * <instance>.my.connect.aws), so Connect's login cookies are third-party. Browsers
 * that block third-party cookies by default cannot keep the agent authenticated —
 * the softphone falls into a login loop / ACK_TIMEOUT rather than failing cleanly.
 * AWS itself only supports Chrome/Edge (and best-effort Firefox) for the agent CCP.
 *
 *   - Chromium (Chrome, Edge, Brave, Opera, …): 3p cookies allowed by default →
 *     'supported'. The only browser set AWS officially supports.
 *   - Firefox: Total Cookie Protection blocks 3p cookies by default → 'best_effort'
 *     (works only with a manual cross-site-cookie exception).
 *   - Safari + all iOS browsers (WebKit): block all 3p cookies with no exception
 *     (ITP since 2020) → 'unsupported'.
 *
 * We gate on this so unsupported browsers see a clear "use Chrome/Edge" message
 * instead of a silently-broken softphone.
 */
export type VoiceBrowserSupport = 'supported' | 'best_effort' | 'unsupported';

interface UaDataBrand {
  brand: string;
}

export function getVoiceBrowserSupport(): VoiceBrowserSupport {
  if (typeof navigator === 'undefined') return 'supported';

  // Chromium-based browsers expose userAgentData with a Chromium/Chrome/Edge
  // brand — the most reliable positive signal, and it avoids false-blocking
  // Chromium variants we don't enumerate.
  const brands = (navigator as Navigator & { userAgentData?: { brands?: UaDataBrand[] } }).userAgentData?.brands;
  if (brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))) {
    return 'supported';
  }

  const ua = navigator.userAgent || '';

  // iOS/iPadOS: every browser is WebKit under the hood → 3p cookies blocked.
  if (/iP(hone|ad|od)/.test(ua)) return 'unsupported';

  // Desktop Firefox: blocked by default, but a manual exception can make it work.
  if (/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)) return 'best_effort';

  // Desktop Safari: WebKit, advertises "Safari", is not Chromium → hard 3p block.
  const vendor = navigator.vendor || '';
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\/|Edg\/|OPR\//.test(ua) && /Apple/.test(vendor)) {
    return 'unsupported';
  }

  // Unknown/older engine (no userAgentData): don't false-block — let it try.
  return 'supported';
}
