/**
 * Unified registry of event sources offered in the Numa Automations Builder.
 *
 * Sits one level above `lib/pipedream-trigger-apps.ts`. Where the Pipedream
 * registry knows about per-app trigger components and restraints, this one
 * knows about the *sources themselves* — including built-in / native ones
 * like Gmail that aren't backed by Pipedream at all.
 *
 * The frontend's source picker reads from THIS file, computes availability
 * per source, and renders a single unified grid. Pipedream-backed sources
 * link out to `pipedream-trigger-apps.ts` via `pipedream_app_slug` for the
 * downstream trigger picker / configurator.
 *
 * Adding a source is a registry append plus matching i18n keys. Adding a
 * Pipedream-backed source ALSO requires the entry in `pipedream-trigger-apps.ts`
 * with the trigger components and restraints.
 */

/**
 * How the source delivers events to Numa.
 *
 * - `native`     — Numa-built integration (e.g. Gmail Pub/Sub watch). Fully
 *                  private; no third-party SaaS in the path.
 * - `pipedream`  — Backed by a Pipedream Connect deployed trigger. OAuth +
 *                  webhook delivery handled by Pipedream.
 * - `both`       — Available via both delivery mechanisms. The user picker
 *                  will eventually show this as a single card with a sub-
 *                  toggle (when we ship a source where it actually applies).
 */
export type EventSourceMechanism = 'native' | 'pipedream' | 'both';

/**
 * Availability requirements for a source. ALL declared requirements must
 * hold for the card to be enabled. A failing requirement carries the i18n
 * key for its disabled-state message — the source picker uses it to render
 * a clear "this is why you can't pick this yet" hint instead of just
 * hiding the source.
 */
export type EventSourceAvailability =
  /** No prereqs — source is always available. */
  | { kind: 'always' }
  /**
   * Source requires the user to have an active Pipedream Connect grant for
   * the linked app. Implicitly also requires PIPEDREAM_INTEGRATIONS=true at
   * the workspace level — the picker checks the flag and renders a
   * different message when the flag is off vs the user just not connected.
   */
  | { kind: 'pipedream_app' }
  /**
   * Source needs a native connector to be enabled at the client level. We
   * don't have any of these gated yet (Gmail's Pub/Sub watch is set up at
   * deploy time and assumed always-on). When a real prereq lands, switch
   * the source's availability over and add a check in the picker.
   */
  | { kind: 'native_connector'; connector: string };

export type EventSource = {
  /** Stable identifier, e.g. `gmail`, `slack`. Mirrors the icon slug. */
  source_id: string;
  /** Display order — smaller renders earlier. Used for stable picker order. */
  order: number;
  source_type: EventSourceMechanism;
  /** i18n key for the human-readable name (e.g. "Slack"). */
  label_key: string;
  /**
   * i18n key for the trigger-context description (what kinds of triggers
   * this source offers — NOT what the integration can do outbound).
   */
  description_key: string;
  /**
   * Slug used to look up the icon via the existing /integrations connection
   * config. Reuses the connect/disconnect page's icon assets so we don't
   * duplicate artwork.
   */
  icon_slug: string;
  /**
   * For Pipedream-backed sources, the Pipedream app slug from
   * `pipedream-trigger-apps.ts`. The configurator joins on this to show
   * the right per-app trigger components.
   */
  pipedream_app_slug?: string;
  /**
   * All-must-hold requirements for the source to be enabled in the picker.
   * Empty / `[{kind:'always'}]` means always available.
   */
  availability: readonly EventSourceAvailability[];
};

/**
 * Curated list of sources, ordered for the picker. Native sources first
 * (we treat them as the more privacy-preserving path), Pipedream-backed
 * sources after. Adding a new source: append here + add i18n keys + (for
 * Pipedream-backed) entry in pipedream-trigger-apps.ts.
 */
export const EVENT_SOURCES: readonly EventSource[] = [
  {
    source_id: 'gmail',
    order: 0,
    source_type: 'native',
    label_key: 'eventSources.gmail.label',
    description_key: 'eventSources.gmail.description',
    icon_slug: 'gmail',
    availability: [{ kind: 'always' }],
  },
  {
    source_id: 'slack',
    order: 10,
    source_type: 'pipedream',
    label_key: 'eventSources.slack.label',
    description_key: 'eventSources.slack.description',
    icon_slug: 'slack',
    pipedream_app_slug: 'slack',
    availability: [{ kind: 'pipedream_app' }],
  },
] as const;

/**
 * Quick-lookup helper: returns the registry entry for a given source_id, or
 * `undefined` if it isn't curated.
 */
export const findEventSource = (source_id: string): EventSource | undefined =>
  EVENT_SOURCES.find((s) => s.source_id === source_id);

/**
 * All curated source IDs as a flat set — useful for cheap `is this a known
 * source?` checks in code paths that don't already have the registry.
 */
export const EVENT_SOURCE_IDS: ReadonlySet<string> = new Set(EVENT_SOURCES.map((s) => s.source_id));
