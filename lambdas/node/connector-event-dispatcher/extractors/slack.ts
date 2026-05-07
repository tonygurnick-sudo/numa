/**
 * Slack payload extractor.
 *
 * Pipedream forwards Slack events to our webhook in their native shape (no
 * envelope). The fields we surface are the ones a typical automation prompt
 * is most likely to want — the message text, who sent it, where, when.
 *
 * Reference fixture: dev-notes/tasks/pipedream-triggers/results/validate_delivery.json
 */

import type { ExtractedEvent, PipedreamEventExtractor } from './types';

type SlackPayload = {
  type?: string;
  user?: string;
  user_profile?: { real_name?: string; display_name?: string };
  text?: string;
  channel?: string;
  channel_name?: string;
  team?: string;
  ts?: string;
  event_ts?: string;
  client_msg_id?: string;
  thread_ts?: string;
  permalink?: string;
};

const stringOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');

const stringOrUndef = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const slackExtractor: PipedreamEventExtractor = (payload: unknown, componentId: string): ExtractedEvent => {
  const p = (payload ?? {}) as SlackPayload;

  // Pick the strongest available dedup key. client_msg_id is a UUID minted
  // by Slack at message-send time; ts/event_ts are timestamps that are
  // unique per event but slightly more brittle.
  const dedupKey =
    stringOrUndef(p.client_msg_id) ?? stringOrUndef(p.event_ts) ?? stringOrUndef(p.ts) ?? `slack-${Date.now()}`;

  return {
    app_slug: 'slack',
    component_id: componentId,
    dedup_key: dedupKey,
    fields: {
      // The message text — the most-prompted field by far.
      text: stringOrEmpty(p.text),
      // Channel: ID always; name when resolveNames=true was set on the trigger.
      channel: stringOrEmpty(p.channel),
      channel_name: stringOrEmpty(p.channel_name),
      // Sender: ID + best-effort human name.
      user: stringOrEmpty(p.user),
      user_name: stringOrEmpty(p.user_profile?.real_name ?? p.user_profile?.display_name ?? ''),
      // Workspace identity for templates that need to disambiguate.
      team: stringOrEmpty(p.team),
      // Slack ts (and event_ts when distinct) — useful for ordering / threading.
      ts: stringOrEmpty(p.ts),
      event_ts: stringOrEmpty(p.event_ts ?? p.ts),
      // Thread context — empty string for non-replies (truthy means "this is a thread reply").
      thread_ts: stringOrEmpty(p.thread_ts),
      is_thread_reply: !!p.thread_ts,
      // Permalink when available — convenient for the agent to cite the source message.
      permalink: stringOrEmpty(p.permalink),
    },
    raw: p,
  };
};
