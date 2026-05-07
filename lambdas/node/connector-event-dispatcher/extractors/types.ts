/**
 * Per-app payload extractor contract.
 *
 * The dispatcher routes Pipedream-delivered events through these extractors to
 * turn the raw SaaS payload (e.g. a Slack message JSON) into a canonical
 * `event.*` shape that the agent-schedule-runner can interpolate into the
 * automation prompt.
 *
 * One extractor per Pipedream-supported app. They live next to each other
 * here so adding a new app is a single small addition rather than a sprawl
 * across the dispatcher's main file.
 */

export type ExtractedEvent = {
  /** App slug echoed back, e.g. "slack". Useful for downstream logging. */
  app_slug: string;

  /** Pipedream component_id that produced this event, e.g. "slack-new-keyword-mention". */
  component_id: string;

  /**
   * A stable, source-side identifier suitable for receiver-side dedup against
   * Pipedream's at-most-once-but-no-retries delivery semantics. For Slack we
   * use `client_msg_id` (UUID) when present, falling back to `event_ts`.
   */
  dedup_key: string;

  /**
   * Canonical fields the runner can substitute into prompt templates as
   * `{{ event.<field> }}`. Shape varies per app but kept flat for ergonomics.
   * Each extractor decides which fields to surface — see slack.ts for an
   * example.
   */
  fields: Record<string, unknown>;

  /**
   * The raw Pipedream-delivered payload, kept on the side for power users
   * who want to interpolate `{{ event.raw.<deeply.nested.thing> }}`.
   */
  raw: unknown;
};

export type PipedreamEventExtractor = (payload: unknown, componentId: string) => ExtractedEvent;
