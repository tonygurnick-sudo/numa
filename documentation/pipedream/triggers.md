# Pipedream-Backed Triggers

Reference for the trigger half of Numa Automations. Pairs with the [`numa-triggers`](../../.claude/skills/numa-triggers/SKILL.md) skill, which is the task-oriented "I want to add X" guide. This document is the deeper reference — how the pieces fit, what invariants hold, what the empirical findings tell us about Pipedream's behavior.

For the broader proxy/relay/account model see [`architecture.md`](./architecture.md). For the cron-based half of Automations see the `numa-scheduled-agents` skill.

---

## End-to-end data path

```
┌────────────┐  (1) save  ┌──────────────────┐  (2) deploy  ┌─────────────┐
│ Wizard     │───────────▶│ agent-schedules  │─────────────▶│ Pipedream   │
│ (frontend) │            │ Lambda           │              │ Connect     │
└────────────┘            └──────────────────┘              └─────────────┘
                                  │                                │
                                  │ persist dc_xxx + signing key   │
                                  ▼                                │
                          ┌──────────────────┐                     │
                          │ DynamoDB         │                     │
                          │ schedules table  │                     │
                          │ + GSI            │                     │
                          └──────────────────┘                     │
                                  ▲                                │
                                  │ (5) lookup by dc_xxx           │
                                  │                                │
                          ┌──────────────────┐  (3) external event ▼
                          │ Receiver Lambda  │◀─── (4) HMAC-signed POST ── ┌────────────┐
                          │ (verify + S3)    │                              │ External   │
                          └──────────────────┘                              │ source     │
                                  │ (6) invoke                              │ (Slack...) │
                                  ▼                                         └────────────┘
                          ┌──────────────────┐
                          │ Dispatcher       │
                          │ Lambda           │
                          │ (extract + norm) │
                          └──────────────────┘
                                  │ (7) invoke
                                  ▼
                          ┌──────────────────┐
                          │ Runner Lambda    │
                          │ (interpolate +   │
                          │  fire agent)     │
                          └──────────────────┘
                                  │
                                  ▼
                          ┌──────────────────┐
                          │ Workspace agent  │
                          │ run + S3 result  │
                          └──────────────────┘
```

| #   | Step                                | Lambda                                        | Key behaviors                                                                                                              |
| --- | ----------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | User saves automation               | `agent-schedules` (create)                    | Validates payload, writes record to DDB                                                                                    |
| 2   | Deploy trigger to Pipedream         | `agent-schedules` → relay → proxy → Pipedream | Returns `dc_xxx` + `webhook_signing_key`. Persisted on the schedule record (top-level + inside the `trigger` map).         |
| 3   | External event happens              | (Slack / Outlook / etc.)                      | The user mentions `@Numa`, an email lands, a reaction is added.                                                            |
| 4   | Pipedream POSTs HMAC-signed payload | (Pipedream's infrastructure)                  | Signs with `t={ts},v1={hex}` over `{ts}.{rawBody}`. Headers: `x-pd-signature`, `x-pd-emitter-id`, `x-pd-external-user-id`. |
| 5   | Receiver verifies + persists        | `pipedream-event-receiver`                    | Looks up schedule by `dc_xxx` via GSI, reads signing key, verifies HMAC, persists raw payload to S3, invokes dispatcher.   |
| 6   | Dispatcher normalizes payload       | `connector-event-dispatcher`                  | Per-app extractor (e.g. `extractors/slack.ts`) maps payload to canonical event fields.                                     |
| 7   | Runner interpolates + fires agent   | `agent-schedule-runner`                       | Resolves `{{ event.<dotted.path> }}` placeholders in the agent prompt. Kicks off the agent run.                            |

---

## Schedule record schema

The schedule record (Zod-validated, see `lib/scheduling-schemas.ts`) is the single source of truth for what's deployed where. For Pipedream-backed event triggers the relevant fields are:

```typescript
{
  user_id: string;             // partition key
  schedule_id: string;         // sort key (UUID)
  status: 'active' | 'paused' | 'deleted';
  trigger_type: 'event';
  deployed_trigger_id: string; // top-level for GSI lookup (dc_xxx)
  trigger: {
    source: 'pipedream';
    app_slug: string;          // e.g. 'slack'
    component_id: string;      // e.g. 'slack-new-keyword-mention'
    component_version?: string;
    configured_props: Record<string, unknown>;       // user-editable
    configured_prop_labels?: Record<string, Record<string, string>>; // labels snapshot
    deployed_trigger_id?: string;   // NESTED copy (read by lambda + receiver)
    webhook_signing_key?: string;   // ONLY here — Pipedream doesn't expose it after deploy
    include_event_context?: boolean;
  };
  // ... other fields (agent_id, prompt_text, last_run_*, etc.)
}
```

### The two copies of `deployed_trigger_id`

Yes, it's in two places. The reasons:

- **Top-level**: indexed by the `deployed-trigger-id-index` GSI for the receiver's `dc_xxx` → schedule lookup.
- **Inside `trigger`**: read by the lambda's update/delete path (along with `webhook_signing_key`). The fallback in the delete path also reads the top-level if the inside copy is missing — protects against records corrupted by the now-fixed update wipe-bug.

Going forward, both copies should always be in sync. If you find them out of sync in the wild it's a bug.

### `configured_prop_labels`

A snapshot of human-readable labels for prop values, captured at save-time from the wizard's remote-options dropdowns. Keyed `propName → value → label`. Example:

```jsonc
{
  "configured_prop_labels": {
    "conversations": {
      "C0AG75CUDRR": "codespace",
      "C09YYXM4M0J": "engineering",
    },
  },
}
```

Used by the detail page and list cards to render `Channels: codespace, engineering` instead of raw IDs. Falls back to raw values for legacy schedules that don't have it. Pruned to selected values only at save time so we don't leak the user's full channel list into DynamoDB.

---

## The two registries

Two `lib/` files; both are source of truth for different concerns.

### `lib/event-sources.ts` — top-level source registry

Lists every source the Automations builder offers (native + Pipedream-backed). Each entry: `source_id`, `source_type` (`native` | `pipedream` | `both`), label/description i18n keys, icon slug, availability requirements, `pipedream_app_slug` link. The picker reads this exclusively.

### `lib/pipedream-trigger-apps.ts` — Pipedream-app + trigger components registry

For each Pipedream app, lists which trigger components Numa exposes (curated subset of Pipedream's catalogue) and the `restraints` for each (forced/hidden props, required props, soft policy hints). The wizard, the relay's deploy allowlist, and the schema-cache refresh all read from this single source.

Adding a new Pipedream-backed source means entries in BOTH. The two-file split avoids overloading either with concerns it shouldn't carry — a native source has no Pipedream trigger components, and a Pipedream app's trigger components are independent of how its source card looks.

### Restraints — why we override Pipedream's defaults

Pipedream's per-component config is often permissive in ways that would create dangerous triggers if accepted as-is:

- `slack-new-message-in-channels` allows empty `conversations` (= every message in every channel). We require at least one channel.
- `ignoreBot: false` is the Pipedream default for some triggers — would mean Numa's own Slack outputs (when we ship them) trigger Numa.
- `resolveNames: false` leaves the model with bare IDs instead of human names.

The `restraints` field on each curated trigger entry asserts safe defaults:

```typescript
restraints: {
  required_props: ['conversations'],            // re-asserts Pipedream-side required, validated frontend + backend
  forced_props: { ignoreBot: true,              // forced in value, hidden in UI
                  ignoreThreads: false,
                  resolveNames: true },
  hidden_props: ['keyword'],                    // hidden in UI, value not forced
  min_filter_strength: 'channel_list',          // soft policy hint for UX messaging
}
```

`forced_props` are auto-hidden from the user (no point showing a control they can't change). `hidden_props` is for props that exist on Pipedream's component but don't make sense in our curated flow — e.g. on `slack-new-user-mention`, the `keyword` prop is an additional AND filter that confuses people who picked the user-mention trigger to watch a user. Hide it.

---

## The wizard configurator

`Components/PipedreamTriggers/PipedreamTriggerConfigurator.tsx` orchestrates trigger configuration once a Pipedream-backed source is picked. Flow:

1. Calls `list_triggers?app=<slug>` once per mount, builds a map of component metadata.
2. Joins against the curated trigger entries from `lib/pipedream-trigger-apps.ts` to pick which to show (curated ones only, in registry order, with Pipedream's live `configurable_props`).
3. User picks a trigger → renders `DynamicPropRenderer` with the prop list.

`DynamicPropRenderer` is the generic rendering layer:

- Per-prop label/description overrides via i18n keys (`pipedreamTriggers.triggers.<componentKey>.props.<propName>.{label,description}`) with fallback to Pipedream's metadata. Adding clearer copy is i18n-only — no code changes.
- Calls `configure_props` for remote-options props. Only refetches when an upstream prop with `reloadProps: true` changes (or the auth prop changes) — NOT on every keystroke in any sibling field.
- For `string[]` remote-options, renders our `SearchableMultiSelect` (search box + checkboxes + removable selected pills), not the native `<select multiple>`.
- Bubbles loaded options up to the configurator via `onPropOptionsLoaded` so the configurator can snapshot label-by-value into `configured_prop_labels` at save-time.
- Optional `valueImageMap` per prop for icon enrichment (used by Slack `iconEmoji` to render real workspace emoji icons).

### Pipedream's two response shapes for `configure_props`

The endpoint returns options in one of two shapes:

- `options: [{label, value}, ...]` — used by most props (channels, users).
- `stringOptions: ["fire", "thumbsup", ...]` — used when the value IS the label. Slack's `iconEmoji` is the canonical example.

`PipedreamProxyService.configureProp` normalises both into the unified `{label, value}` shape. Any consumer of the service gets the unified output.

### Custom-icon enrichment (Slack emoji case study)

Pipedream's `stringOptions` for `iconEmoji` returns ~1000 shortcodes per workspace — most are workspace customs (`party_parrot`, `glitch_crab`, etc.). To render real icons:

1. The configurator (when `appSlug === 'slack'`) calls `useSlackEmojiMap(externalUserId, slackAccountId)`.
2. The hook proxies a request to Slack's `emoji.list` API via Pipedream's `proxy_request` operation. Returns `{shortcode → image URL | "alias:..."}`.
3. Resolves alias chains.
4. Caches in sessionStorage keyed by `(externalUserId, slackAccountId)`.
5. Builds a `valueImageMap = { iconEmoji: { bowtie: 'https://...', ... } }`.
6. Passes to `DynamicPropRenderer.valueImageMap` → `SearchableMultiSelect` renders `<img>` next to matching options.

Standard Slack emoji (`fire`, `thumbsup`) aren't in `emoji.list` — Slack renders those from unicode client-side. We just show the shortcode for those, which is fine since the customs are the visually-distinctive ones anyway.

This pattern generalises: any source with icon-able remote-options can have a similar enrichment hook (Jira project avatars, GitHub repo icons, etc.). Add on demand.

---

## Lifecycle invariants

Read these before touching the agent-schedules lambda or the receiver.

### 1. Update path MUST preserve lifecycle fields

The wizard payload only carries user-editable trigger fields (`source`, `app_slug`, `component_id`, `configured_props`, `configured_prop_labels`). It does NOT include `deployed_trigger_id` or `webhook_signing_key` — those are server-set at deploy time.

When persisting an updated trigger, MERGE the lifecycle fields from the existing record onto the wizard payload BEFORE writing. The current code:

```typescript
if (validatedPayload.trigger !== undefined) {
  let nextTrigger: EventTrigger = validatedPayload.trigger;
  if (validatedPayload.trigger.source === 'pipedream' && record.trigger?.source === 'pipedream') {
    const existingPipedream = record.trigger as PipedreamTrigger;
    nextTrigger = {
      ...validatedPayload.trigger,
      ...(existingPipedream.deployed_trigger_id ? { deployed_trigger_id: existingPipedream.deployed_trigger_id } : {}),
      ...(existingPipedream.webhook_signing_key ? { webhook_signing_key: existingPipedream.webhook_signing_key } : {}),
    };
  }
  expressionValues[':trigger'] = nextTrigger;
  setParts.push('#trigger = :trigger');
}
```

If you skip this merge, every props edit silently wipes the signing key. The receiver then logs `WEBHOOK_ORPHAN_EVENT` for every subsequent delivery — and there's NO way to recover the key. Pipedream doesn't expose it after deploy. Recovery is delete + recreate the automation.

### 2. Delete path MUST clean up Pipedream-side first

```
delete_deployed_trigger via relay  (with 404-as-success)
        ↓
soft-delete the DDB record
```

Skip the Pipedream call → orphan trigger keeps firing forever, costing credits and logging WEBHOOK_ORPHAN_EVENT. The delete code reads `record.trigger.deployed_trigger_id` with a fallback to `record.deployed_trigger_id` (top-level) — necessary because some legacy records have only the top-level copy.

### 3. `timezone` is a DynamoDB reserved keyword

`timezone` is a reserved keyword (Glue/Athena heritage). UpdateExpressions referencing `timezone` directly (SET or REMOVE) hit a `ValidationException`. Always alias via `ExpressionAttributeNames['#timezone'] = 'timezone'`.

### 4. Pipedream UPDATE preserves `dc_xxx` and the signing key

Verified empirically with the probe scripts in `dev-notes/tasks/pipedream-triggers/`:

- `update-deployed-trigger` for prop changes preserves both
- Active-toggle (pause via `update-deployed-trigger` with `active: false`, then resume) preserves both
- DELETE + redeploy is the only way to get a NEW key

This is why the update path can call `updatePipedreamTriggerProps` instead of delete-and-redeploy on edit.

### 5. Pipedream does NOT retry failed webhooks

Verified empirically. Single delivery, no retries, no DLQ. The receiver's "never 5xx if avoidable" rule is real.

Implication: persist the raw payload to S3 BEFORE invoking the dispatcher (fire-and-forget). If the dispatcher fails, the event can be replayed from S3 without losing it.

### 6. GSI projection must include any new fields the receiver reads

The `deployed-trigger-id-index` GSI uses INCLUDE projection of `[user_id, schedule_id, trigger, status]` — set in `infra/constructs/core-numa-infra-construct.ts`. If you add a new field to the trigger map that the receiver needs to read, also add it to the GSI projection. Otherwise the GSI Query result won't have it (even though the base table does).

---

## CloudFront routing

The receiver lives at `/api/webhooks/pipedream-events/{secret}` (where `{secret}` is a per-deployment URL secret in addition to HMAC verification — defense in depth).

CloudFront has a dedicated behavior for `/api/webhooks/pipedream-events/*` using the `AllViewerExceptHostHeader` origin request policy (managed policy ID `b689b0a8-53d0-40ab-baf2-68738e2966ac`). This forwards ALL viewer headers except `Host` to the origin.

The default `/api/*` catch-all uses a custom policy that whitelists only `[authorization, x-analytics-api-key, x-api-key]` for cache-key normalization. If webhooks routed through that, the `x-pd-*` headers (signature, emitter-id, external-user-id) would be stripped before reaching API Gateway and the receiver would log `WEBHOOK_MISSING_HEADERS`.

The dedicated behavior is ordered BEFORE the catch-all so it wins. Don't reorder.

---

## Logging by `_name`

Filter `/numa/<client>-core` CloudWatch logs by structured `_name` field:

| `_name`                                    | Source     | When                                                                       |
| ------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| `DEPLOY_TRIGGER`                           | proxy      | Successful trigger deploy                                                  |
| `DEPLOY_TRIGGER_FAILED`                    | proxy      | Pipedream returned non-200                                                 |
| `UPDATE_TRIGGER` / `_FAILED`               | proxy      | Props update or pause/resume                                               |
| `DELETE_TRIGGER` / `_FAILED`               | proxy      | Trigger delete                                                             |
| `DELETE_TRIGGER_ALREADY_GONE`              | proxy      | Pipedream 404 — treated as success                                         |
| `WEBHOOK_MISSING_HEADERS`                  | receiver   | `x-pd-*` headers absent — usually CloudFront stripping                     |
| `WEBHOOK_HMAC_FAILED`                      | receiver   | Bad signature — check signing key drift or replay                          |
| `WEBHOOK_USER_MISMATCH`                    | receiver   | `x-pd-external-user-id` header ≠ schedule's `user_id`                      |
| `WEBHOOK_ORPHAN_EVENT`                     | receiver   | `dc_xxx` not in schedules table OR signing key wiped — needs investigation |
| `WEBHOOK_PERSISTED`                        | receiver   | Successful event ingestion → S3                                            |
| `PIPEDREAM_EVENT_DISPATCHED`               | dispatcher | Event handed to runner                                                     |
| `LIST_TRIGGERS` / `LIST_DEPLOYED_TRIGGERS` | proxy      | Frontend metadata fetches                                                  |

---

## Worked example: adding Outlook as a trigger source

End-to-end walkthrough for adding **Outlook** with the "new email" trigger.

### Files you'll touch

| #   | File                                                                      | What                                                               |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `lib/event-sources.ts`                                                    | Append registry entry (source_type: pipedream, pipedream_app_slug) |
| 2   | `lib/pipedream-trigger-apps.ts`                                           | Append app + trigger components + restraints                       |
| 3   | `lambdas/node/connector-event-dispatcher/extractors/microsoft_outlook.ts` | New file — normalises Outlook's payload                            |
| 4   | `lambdas/node/connector-event-dispatcher/extractors/index.ts`             | Register the extractor                                             |
| 5   | `numa-frontend/src/locales/en/automations.json`                           | i18n strings (eventSources + pipedreamTriggers)                    |
| 6   | `numa-frontend/src/Config/integrationsConfig.ts`                          | If the `microsoft_outlook` icon isn't registered yet               |
| 7   | `infra/config/integrations.ts`                                            | Add `microsoft_outlook` to `SUPPORTED_INTEGRATIONS` if not already |

### Step 1 — Confirm the Pipedream component

Look at https://pipedream.com/apps/microsoft_outlook and find the "New Email" trigger. Note:

- Component key (e.g. `microsoft_outlook-new-email`)
- Required props
- Which props have `remoteOptions` (would call `configure_props`)
- Which props would benefit from `forced_props` defaults
- Any auth scopes the user must grant during connect (Pipedream's app config — usually fine out of the box)

The Pipedream API explorer at https://pipedream.com/connect/apis is faster than the OpenAPI spec for this. (Internal devs with credentials can also probe via `dev-notes/research/integrations/explore_pipedream.py`, but the docs and dashboard are sufficient for new-app exploration.)

### Step 2 — Append to `lib/event-sources.ts`

```typescript
{
  source_id: 'microsoft_outlook',
  order: 20,                              // pick something between existing entries
  source_type: 'pipedream',
  label_key: 'eventSources.microsoft_outlook.label',
  description_key: 'eventSources.microsoft_outlook.description',
  icon_slug: 'microsoft_outlook',
  pipedream_app_slug: 'microsoft_outlook',
  availability: [{ kind: 'pipedream_app' }],
}
```

### Step 3 — Append to `lib/pipedream-trigger-apps.ts`

```typescript
{
  app_slug: 'microsoft_outlook',
  label_key: 'pipedreamTriggers.apps.microsoft_outlook.label',
  description_key: 'pipedreamTriggers.apps.microsoft_outlook.description',
  icon: 'microsoft_outlook',
  triggers: [
    {
      component_id: 'microsoft_outlook-new-email',
      label_key: 'pipedreamTriggers.triggers.microsoft_outlook-new-email.label',
      description_key: 'pipedreamTriggers.triggers.microsoft_outlook-new-email.description',
      recommended: true,
      restraints: {
        required_props: [/* whatever Pipedream marks required, defensively re-asserted */],
        forced_props: {
          // Whatever safe defaults make sense for this trigger.
        },
      },
    },
  ],
}
```

### Step 4 — Build the payload extractor

`lambdas/node/connector-event-dispatcher/extractors/microsoft_outlook.ts`:

```typescript
import type { PayloadExtractor } from './types';

export const microsoftOutlookExtractor: PayloadExtractor = (payload) => {
  // Inspect Pipedream's deliverable shape for this trigger by looking at a
  // sample event from the Pipedream dashboard or a probe delivery. Map the
  // raw fields to canonical event_context the runner can interpolate.
  return {
    subject: payload.subject ?? null,
    from: payload.from?.emailAddress?.address ?? null,
    body: payload.bodyPreview ?? null,
    received_at: payload.receivedDateTime ?? null,
    raw: payload,
  };
};
```

Reference: `lambdas/node/connector-event-dispatcher/extractors/slack.ts` for the canonical pattern.

Register in `extractors/index.ts`:

```typescript
import { microsoftOutlookExtractor } from './microsoft_outlook';

export const EXTRACTORS: Record<string, PayloadExtractor> = {
  slack: slackExtractor,
  microsoft_outlook: microsoftOutlookExtractor,
};
```

### Step 5 — i18n

```jsonc
{
  "eventSources": {
    "microsoft_outlook": {
      "label": "Outlook",
      "description": "Trigger on new emails or calendar invites in Outlook.",
    },
  },
  "pipedreamTriggers": {
    "apps": {
      "microsoft_outlook": {
        "label": "Outlook",
        "description": "Trigger on new emails or calendar invites in Outlook.",
      },
    },
    "triggers": {
      "microsoft_outlook-new-email": {
        "label": "When a new email is received",
        "description": "Fires when a new email lands in your Outlook inbox.",
        "props": {
          // Per-prop label/description overrides if Pipedream's are unclear.
        },
      },
    },
  },
}
```

### Step 6 — Icon (if not already registered)

`numa-frontend/src/Config/integrationsConfig.ts` should have a `microsoft_outlook` entry already (it's in our supported integrations list). If not, see the `numa-integrations` skill for "How to add a new integration" — same pattern.

### Step 7 — Supported integrations registry

`infra/config/integrations.ts` `SUPPORTED_INTEGRATIONS` array — confirm `microsoft_outlook` is there. This is the master allowlist enforced by the proxy lambda.

### Step 8 — Test

Local frontend running against a deployed dev stack:

1. Source picker — Outlook should appear, with the right icon, source-type badge "Pipedream", and connection status reflecting whether the user has connected.
2. Click Outlook → trigger picker shows "When a new email is received" with description.
3. Click that trigger → `configure_props` runs, dropdowns populate.
4. Save → check CloudWatch for `DEPLOY_TRIGGER` (success).
5. Trigger an event upstream (send yourself an email) → check `/numa/<client>-core` for `WEBHOOK_PERSISTED` then `PIPEDREAM_EVENT_DISPATCHED`.
6. Run history on the automation detail page should show the new run.

That's the full lifecycle. No infra changes required — the existing receiver + dispatcher + runner handle the new app generically.

---

## Common debugging paths

### "My trigger isn't firing"

1. **Check Pipedream side is wired**: the Pipedream dashboard at https://pipedream.com/connect (or for internal devs, the probe scripts in `dev-notes/tasks/pipedream-triggers/`) should show an active deployed trigger with the right `configured_props` and a webhook URL pointing at your client's stack.
2. **Check CloudWatch for `WEBHOOK_*` events** in `/numa/<client>-core`. If you see no events, Pipedream isn't dispatching (config issue) or CloudFront is rejecting before API Gateway.
3. **Check CloudFront behavior**: `/api/webhooks/pipedream-events/*` MUST use `AllViewerExceptHostHeader`. If `WEBHOOK_MISSING_HEADERS` appears, this is the cause.
4. **Check the schedule record's signing key**: `aws dynamodb get-item ... --projection-expression '#tr' --expression-attribute-names '{"#tr":"trigger"}'`. If `trigger.webhook_signing_key` is missing, the receiver will log `WEBHOOK_ORPHAN_EVENT` for every delivery. Recovery: delete + recreate.

### "Edits broke my trigger"

Likely the lifecycle-field preservation bug (now fixed). Check `trigger.webhook_signing_key` is still set on the schedule record. If wiped, recovery is delete + recreate the automation.

### "Delete didn't clean up Pipedream"

Check `record.trigger.deployed_trigger_id` AND the top-level `record.deployed_trigger_id`. The delete code falls back from one to the other. If both are missing, no Pipedream cleanup happens — the trigger needs manual deletion via the Pipedream API.

For Arcanum-internal recovery: an admin can call `DELETE /v1/connect/<project>/deployed-triggers/<dc_xxx>?external_user_id=<xuid>` directly. The reconciliation worker (sweep orphans nightly) is a planned mitigation; not yet implemented.

### "Channels list empty in the wizard"

Usually `configure_props` was called without an auth context. The frontend auto-injects `{ <appPropName>: { authProvisionId: 'auto' } }` for remote-options calls — if this gets dropped in a refactor, Pipedream returns 0 options because it has no OAuth grant to query against.

### "iconEmoji multi-select shows 'Loading…' forever"

Pipedream returns emoji shortcodes as `stringOptions` (not `options`). `PipedreamProxyService.configureProp` normalises both — if you bypass that service and read `response.options` directly, you'll miss `stringOptions`-shaped responses entirely.

---

## Future work (signposted)

- **Reconciliation worker** — daily sweep that lists Pipedream-side deployed triggers per user, cross-references with active schedules, deletes orphans. Mitigates any drift.
- **`source_type: 'both'` UX** — when we ship a source available in both native and Pipedream-backed flavours, decide whether the source card surfaces a sub-toggle, or two cards, or a smart default. The registry schema already supports it.
- **Bot-loop testing** — verify Numa's own Slack outputs (when we add them) are correctly classified as bot messages so `ignoreBot: true` blocks them. Empirical test once we have outbound Slack actions through the workspace agent.
- **Stale-trigger detection** — when the underlying OAuth account is revoked, surface that on the automation detail page (the `PipedreamUnhealthyBanner` does this for the wizard; the detail page does too; but the integration-status check needs to refresh on every run, not just page load).
