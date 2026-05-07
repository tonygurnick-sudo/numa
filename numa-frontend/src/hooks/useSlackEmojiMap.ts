/**
 * Fetches the user's Slack workspace emoji list once per session and returns
 * a value→image-URL map. Used by the trigger configurator to render real
 * workspace emoji icons (party_parrot, glitch_crab, custom branding, etc.)
 * in the `iconEmoji` multi-select on `slack-new-reaction-added`.
 *
 * Data flow:
 *   1. Look up the user's connected Slack account ID (apn_xxx)
 *   2. Call Slack's `emoji.list` via Pipedream's Connect Proxy with that
 *      account's OAuth grant (requires `emoji:read` scope, which Pipedream's
 *      default Slack app has)
 *   3. Resolve aliases (`alias:squirrel` → squirrel's URL)
 *   4. Cache the result in sessionStorage keyed by external user ID so the
 *      configurator doesn't refetch every time the user reopens it
 *
 * Standard Slack emoji (`fire`, `thumbsup`) are NOT in `emoji.list` — that
 * endpoint only returns customs and aliases. Standard ones fall through and
 * the renderer just shows the shortname. Customs are the visually distinctive
 * ones anyway, so this is the right tradeoff.
 */

import { useEffect, useState } from 'react';

import { useAuth } from '../Providers/AuthProvider';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';

const SESSION_CACHE_PREFIX = 'numa.slackEmojiMap.';

type SlackEmojiListResponse = {
  ok: boolean;
  emoji?: Record<string, string>;
  error?: string;
};

type State = {
  /** value → image URL (resolved through aliases). null while loading. */
  emojiMap: Map<string, string> | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolves Slack's `alias:<name>` chain — a custom emoji can alias another
 * custom emoji which can alias another, etc. Caps at depth 5 to avoid
 * runaway recursion if a workspace somehow has a cycle.
 */
const resolveAliases = (raw: Record<string, string>): Map<string, string> => {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const resolve = (name: string, depth: number): string | null => {
    if (depth > 5 || seen.has(name)) return null;
    const value = raw[name];
    if (!value) return null;
    if (value.startsWith('alias:')) {
      seen.add(name);
      const target = value.slice('alias:'.length);
      const resolved = resolve(target, depth + 1);
      seen.delete(name);
      return resolved;
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    // Non-URL, non-alias values (some old workspaces have hex codepoints
    // here for standard emoji). Skip — we don't render those as images.
    return null;
  };
  for (const [name, value] of Object.entries(raw)) {
    seen.clear();
    seen.add(name);
    if (value.startsWith('http://') || value.startsWith('https://')) {
      out.set(name, value);
    } else if (value.startsWith('alias:')) {
      const url = resolve(name, 0);
      if (url) out.set(name, url);
    }
  }
  return out;
};

/**
 * @param slackAccountId  apn_xxx for the user's Slack connection. Pass
 *                        `null` to skip fetching (e.g. when the source app
 *                        isn't Slack — keeps the hook unconditionally
 *                        callable from a generic configurator).
 */
export const useSlackEmojiMap = (externalUserId: string, slackAccountId: string | null): State => {
  const { lambdaClient } = useAuth();
  const [state, setState] = useState<State>({ emojiMap: null, loading: false, error: null });

  useEffect(() => {
    if (!slackAccountId) {
      setState({ emojiMap: null, loading: false, error: null });
      return;
    }

    const cacheKey = `${SESSION_CACHE_PREFIX}${externalUserId}.${slackAccountId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, string>;
        setState({ emojiMap: new Map(Object.entries(parsed)), loading: false, error: null });
        return;
      }
    } catch {
      // sessionStorage might be unavailable in some embed contexts; fall through.
    }

    let cancelled = false;
    setState({ emojiMap: null, loading: true, error: null });

    PipedreamProxyService.proxyRequest<SlackEmojiListResponse>(lambdaClient, externalUserId, {
      accountId: slackAccountId,
      method: 'GET',
      upstreamUrl: 'https://slack.com/api/emoji.list',
    })
      .then((resp) => {
        if (cancelled) return;
        if (!resp.ok || !resp.emoji) {
          setState({
            emojiMap: new Map(),
            loading: false,
            error: resp.error ?? 'emoji.list returned ok=false',
          });
          return;
        }
        const resolved = resolveAliases(resp.emoji);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(Object.fromEntries(resolved)));
        } catch {
          // best-effort cache only
        }
        setState({ emojiMap: resolved, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Don't blow up the whole configurator if emoji enrichment fails —
        // the multi-select still works, just without icons.
        setState({
          emojiMap: new Map(),
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [externalUserId, slackAccountId, lambdaClient]);

  return state;
};
