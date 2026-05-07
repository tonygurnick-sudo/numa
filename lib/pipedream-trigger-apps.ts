/**
 * Curated registry of Pipedream-backed event triggers exposed in the Numa
 * Automations Builder.
 *
 * This file is the **single source of truth** for:
 *
 *   1. The frontend trigger picker (which apps + which trigger components are
 *      offered, ordering, recommended badges, copy keys for i18n).
 *   2. The relay's deploy-trigger allowlist — only `(app_slug, component_id)`
 *      combinations declared here can be deployed against Pipedream.
 *   3. The schema-cache refresh worker — only metadata for curated components
 *      is fetched and cached.
 *
 * Adding a new app or trigger component is intentionally cheap — no other code
 * needs to change beyond:
 *   - this file (registry entry + restraints)
 *   - per-app payload extractor in `lambdas/node/connector-event-dispatcher/extractors/<slug>.ts`
 *   - i18n strings in `numa-frontend/src/locales/en/automations.json`
 *
 * The `app_slug` MUST already be in `SUPPORTED_INTEGRATIONS` (see
 * infra/config/integrations.ts). We don't import that union type here to
 * keep `lib/` free of upward dependencies on `infra/` — the constraint is
 * enforced at deploy/test time and at runtime via lookup.
 */

/**
 * Restraints we enforce on top of Pipedream's own required-prop validation.
 *
 * Numa-side restraints exist because Pipedream's per-component config is often
 * permissive in ways that would create high-volume / poorly-scoped triggers
 * (e.g. `slack-new-message-in-channels` with an empty `conversations` list
 * means "every message in every channel"). We re-assert sensible defaults
 * here, validated in the relay before deploy AND in the frontend before save.
 */
export type TriggerRestraints = {
  /**
   * Names of props the user must populate. A subset of these may overlap with
   * Pipedream's own `required` flag; redundancy is intentional. Empty arrays
   * and zero-length strings are treated as not populated.
   */
  required_props: readonly string[];

  /**
   * Props whose values are forcibly set by Numa (overriding any user value).
   * Used to lock in safe defaults — e.g. `ignoreBot: true` on every Slack
   * trigger to prevent Numa from triggering itself in a loop. Forced props
   * are automatically hidden from the user UI.
   */
  forced_props: Readonly<Record<string, unknown>>;

  /**
   * Names of props to hide from the user UI without forcing a value. Use this
   * for props that exist on the Pipedream component but don't make sense in
   * the curated Numa flow (e.g. `keyword` on the user-mention trigger — it's
   * an additional AND filter that confuses people who picked the user-mention
   * trigger to watch a specific user).
   */
  hidden_props?: readonly string[];

  /**
   * Soft policy hint — at least one of these prop sets must be non-empty.
   * Frontend uses this to render meaningful "you need to specify a keyword
   * OR pick a channel" messaging. Backend validation falls back to the
   * `required_props` list above; this is for UX clarity.
   */
  min_filter_strength?: 'keyword' | 'channel_list' | 'either_keyword_or_channel';
};

export type PipedreamTriggerComponent = {
  /** Pipedream component key, e.g. `slack-new-keyword-mention` */
  component_id: string;
  /** i18n key for the human-readable trigger name */
  label_key: string;
  /** i18n key for a one-liner description shown in the picker */
  description_key: string;
  /**
   * If true, this trigger is featured prominently (badge + first in list).
   * Use sparingly — at most one per app.
   */
  recommended?: boolean;
  /** Numa-side configuration restraints layered on top of Pipedream's own. */
  restraints: TriggerRestraints;
};

export type PipedreamTriggerApp = {
  app_slug: string;
  /** i18n key for the human-readable app name (e.g. "Slack"). */
  label_key: string;
  /** i18n key for a one-liner shown in the app picker grid. */
  description_key: string;
  /**
   * Lucide / Bootstrap icon name OR slug used by the existing
   * `integrationsConfig.ts` icon resolver. Reuses the connect/disconnect
   * page's icon assets — no new artwork required.
   */
  icon: string;
  triggers: readonly PipedreamTriggerComponent[];
};

/**
 * Slack is the only app exposed in the MVP. Adding more apps (Jira, Notion,
 * Outlook, Asana, Google Calendar, GitHub) is purely additive — no schema
 * changes, no infra changes, just append to this array + write a payload
 * extractor + add i18n strings.
 */
export const PIPEDREAM_TRIGGER_APPS: readonly PipedreamTriggerApp[] = [
  {
    app_slug: 'slack',
    label_key: 'pipedreamTriggers.apps.slack.label',
    description_key: 'pipedreamTriggers.apps.slack.description',
    icon: 'slack',
    triggers: [
      {
        component_id: 'slack-new-keyword-mention',
        label_key: 'pipedreamTriggers.triggers.slack-new-keyword-mention.label',
        description_key: 'pipedreamTriggers.triggers.slack-new-keyword-mention.description',
        recommended: true,
        restraints: {
          // Pipedream marks `keyword` required; we re-assert defensively.
          required_props: ['keyword'],
          // Hard rule: never let users disable bot-ignore. Without this,
          // Numa's own Slack outputs (when we ship them) would trigger Numa.
          forced_props: { ignoreBot: true },
          min_filter_strength: 'keyword',
        },
      },
      {
        component_id: 'slack-new-user-mention',
        label_key: 'pipedreamTriggers.triggers.slack-new-user-mention.label',
        description_key: 'pipedreamTriggers.triggers.slack-new-user-mention.description',
        restraints: {
          // `user` is the user being @-mentioned. Pipedream marks it required.
          required_props: ['user'],
          forced_props: { ignoreBot: true },
          // `keyword` on this trigger acts as an AND filter on top of the
          // mention — confusing UX (people pick "@-mention" to watch a user,
          // not to compose a keyword filter). If the user wants both, they
          // should use the keyword trigger instead.
          hidden_props: ['keyword'],
        },
      },
      {
        component_id: 'slack-new-message-in-channels',
        label_key: 'pipedreamTriggers.triggers.slack-new-message-in-channels.label',
        description_key: 'pipedreamTriggers.triggers.slack-new-message-in-channels.description',
        restraints: {
          // Pipedream allows an empty `conversations` (= all channels). We
          // require at least one channel — fires-on-everything is too risky.
          required_props: ['conversations'],
          // `resolveNames: true` enriches the payload with human-readable
          // names alongside the IDs (Slack returns both, not a replacement).
          // Models do better with names; we always want this on. Hidden so
          // users don't have to think about it.
          forced_props: { ignoreBot: true, ignoreThreads: false, resolveNames: true },
          min_filter_strength: 'channel_list',
        },
      },
      {
        component_id: 'slack-new-reaction-added',
        label_key: 'pipedreamTriggers.triggers.slack-new-reaction-added.label',
        description_key: 'pipedreamTriggers.triggers.slack-new-reaction-added.description',
        restraints: {
          required_props: ['conversations'],
          // includeUserData forces Slack to include the reacting user's
          // profile in the payload (name, email, etc.) — without it, the
          // model only gets a bare user ID. Same pattern as resolveNames
          // on slack-new-message-in-channels: always-on, never user-toggled.
          forced_props: { ignoreBot: true, includeUserData: true },
          min_filter_strength: 'channel_list',
        },
      },
    ],
  },
] as const;

/**
 * Quick-lookup helper: returns the registry entry for a given (app, component)
 * pair, or `undefined` if not curated. Both relay and frontend use this to
 * gate deploy attempts.
 */
export const findPipedreamTriggerComponent = (
  app_slug: string,
  component_id: string
): { app: PipedreamTriggerApp; trigger: PipedreamTriggerComponent } | undefined => {
  const app = PIPEDREAM_TRIGGER_APPS.find((a) => a.app_slug === app_slug);
  if (!app) return undefined;
  const trigger = app.triggers.find((t) => t.component_id === component_id);
  if (!trigger) return undefined;
  return { app, trigger };
};

/**
 * All curated app slugs as a flat set — useful for IAM allowlist generation.
 */
export const PIPEDREAM_TRIGGER_APP_SLUGS: readonly string[] = PIPEDREAM_TRIGGER_APPS.map((a) => a.app_slug);
