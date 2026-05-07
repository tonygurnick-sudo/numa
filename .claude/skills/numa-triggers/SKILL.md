---
name: numa-triggers
description: Numa Automations — event triggers (native and Pipedream-backed) that fire agents in response to external events (Slack messages, Gmail emails, Outlook calendar invites, etc.). Use when adding a new trigger source, debugging webhook deliveries, working on the source/trigger picker UX, modifying trigger lifecycle (deploy/update/delete), or wiring HMAC-signed webhook receivers.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Triggers

Triggers are the "when something happens, fire this agent" half of the Automations builder (the other half is cron-based schedules — see `numa-scheduled-agents`).

A user wires up: **source → trigger → agent → instructions**. Two delivery mechanisms exist:

- **Native** — Numa-built integration. Today: Gmail (Workspace Pub/Sub watch). Fully private, no third-party in the path.
- **Pipedream-backed** — uses Pipedream Connect deployed triggers. Today: Slack (4 trigger components). OAuth + webhook delivery handled by Pipedream's infrastructure; we own the wizard, the receiver, the schedule lifecycle.

Both flow into the **same downstream pipeline**: webhook arrives → receiver verifies → dispatcher normalises → runner invokes the agent → results land in S3 + the run history.

For everything Pipedream-specific (auth, account model, proxy/relay), see `documentation/pipedream/`. This skill focuses on triggers as a feature.

---

## When to use this skill

Activate it before doing any of:

- Adding a new trigger source (native or Pipedream-backed)
- Adding new trigger components for an existing Pipedream app
- Modifying the source picker / trigger configurator UX in the Automations builder
- Debugging "my trigger isn't firing"
- Working on the receiver (`pipedream-event-receiver`), dispatcher (`connector-event-dispatcher`), or runner (`agent-schedule-runner`) lambdas
- Touching `agent-schedules` lambda CRUD (deploy/update/delete trigger lifecycle)

---

## Mental model

```
┌──────────────┐    ┌────────────────┐    ┌──────────────┐    ┌─────────┐
│ External     │ →  │ Webhook        │ →  │ Receiver     │ →  │ Run     │
│ source       │    │ delivery       │    │ + dispatcher │    │ agent   │
│ (Slack,      │    │ (HMAC signed)  │    │ + runner     │    │         │
│  Gmail, ...) │    │                │    │              │    │         │
└──────────────┘    └────────────────┘    └──────────────┘    └─────────┘
        ▲                                       │
        │  (1) deploy at save-time               │  (4) trace.jsonl + S3 result
        │                                       ▼
┌──────────────┐                         ┌──────────────┐
│ Schedule     │                         │ Run history  │
│ DDB record   │                         │ on detail    │
│ + dc_xxx +   │                         │ page         │
│ signing key  │                         └──────────────┘
└──────────────┘
        ▲
        │  (0) wizard saves the schedule
┌──────────────┐
│ Automations  │
│ builder      │
│ (frontend)   │
└──────────────┘
```

Key invariant: **the schedule record is the source of truth for "what's deployed where"**. The deployed_trigger_id (`dc_xxx`) and `webhook_signing_key` live both at the top level (for GSI lookup) and inside the trigger map (read by the lambda + receiver). Updates must preserve both.

---

## Feature flags

Three frontend flags compose to gate the Automations surface:

| Flag                     | Off behaviour                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SCHEDULING`             | Whole `/automations` route disappears. Master switch.                                                                                                                                                  |
| `EVENT_TRIGGERS`         | Wizard step 1 still loads, but the "When something happens" tile is disabled with a contact-admin hint. Only cron schedules creatable. Existing event automations keep firing.                         |
| `PIPEDREAM_INTEGRATIONS` | Pipedream-backed source cards (Slack, etc.) appear hard-disabled inside the trigger source picker with the "Pipedream integrations are disabled" reason text. Native sources (Gmail) still selectable. |

Composition for staged rollout: enable `SCHEDULING` first (cron only), then `EVENT_TRIGGERS` (adds native triggers like Gmail), then `PIPEDREAM_INTEGRATIONS` (unlocks Slack and other Pipedream-backed sources). Each step adds capability without affecting earlier ones.

Gating is frontend-only today. The agent-schedules lambda accepts any well-formed payload regardless of flag state — fine because the wizard is the only creation surface. Revisit if/when we expose schedule creation via public API.

---

## The trigger source registry

`lib/event-sources.ts` is the **single source of truth** for which sources show up in the Automations builder. Each entry has:

| Field                | Purpose                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `source_id`          | Stable identifier (e.g. `gmail`, `slack`).                                                       |
| `source_type`        | `native` \| `pipedream` \| `both`.                                                               |
| `label_key`          | i18n key for the human-readable name.                                                            |
| `description_key`    | i18n key — describes the kinds of triggers offered (not outbound actions).                       |
| `icon_slug`          | Looked up via `getConnectionConfig()` so we don't duplicate artwork.                             |
| `pipedream_app_slug` | Present when `source_type` includes `pipedream`. Joins to the Pipedream registry.                |
| `availability`       | All-must-hold list of requirements. Failing requirements render the card disabled with a reason. |

Pipedream-backed sources also need a matching entry in `lib/pipedream-trigger-apps.ts` listing the per-app trigger components and restraints (forced/hidden props).

The picker (`Components/Automations/WorkflowStepEventTrigger.tsx`) reads this registry, fetches integration status once for any Pipedream-backed sources, computes per-card state, and renders unified `EventSourceCard`s. Adding a source = registry append + i18n keys + (Pipedream-backed) trigger components + (native) the inline config builder. No picker code changes.

### Availability checks

| Kind                                      | When                                                                | Disabled-state behaviour                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ kind: 'always' }`                      | Always available.                                                   | n/a                                                                                                                                                |
| `{ kind: 'pipedream_app' }`               | Needs the linked Pipedream app connected for the user.              | If `PIPEDREAM_INTEGRATIONS=false` → hard-disabled with reason. If user just hasn't connected → soft-disabled with "Connect on Integrations →" CTA. |
| `{ kind: 'native_connector', connector }` | Reserved for future use when a native connector needs admin gating. | Hard-disabled with reason once we wire a real check.                                                                                               |

---

## Pipedream-backed triggers

The full data path for a Pipedream-backed event:

1. **Wizard save (`agent-schedules` create endpoint)** — calls `deployPipedreamTrigger()` via the relay. Pipedream returns a `dc_xxx` (deployed trigger ID) and a `webhook_signing_key`. Both get persisted on the schedule record.
2. **External event happens** (e.g. user mentions `@Numa` in Slack) → Slack pushes to Pipedream → Pipedream POSTs to our receiver URL with HMAC-SHA256 signature in `x-pd-signature` header (Stripe-style: `t={timestamp},v1={hex}` against `{ts}.{rawBody}`).
3. **`pipedream-event-receiver` lambda** — looks up the schedule by `dc_xxx` via the `deployed-trigger-id-index` GSI, reads `webhook_signing_key` from the schedule's trigger map, verifies HMAC. On success: writes the raw payload to S3 under `connector-events/<external_user_id>/<dc>/<event_id>.json` and invokes the dispatcher.
4. **`connector-event-dispatcher` lambda** — reads the S3 payload, runs the per-app extractor (e.g. `extractors/slack.ts` normalises Slack payloads to canonical `{text, user, channel, ts, ...}`), invokes the runner.
5. **`agent-schedule-runner` lambda** — interpolates `{{ event.<dotted.path> }}` placeholders in the agent's prompt, kicks off the agent run.

Each component lives in `lambdas/node/`. Each step's success and failure modes are logged with a structured `_name` field (`WEBHOOK_PERSISTED`, `WEBHOOK_HMAC_FAILED`, `WEBHOOK_ORPHAN_EVENT`, `PIPEDREAM_EVENT_DISPATCHED`, etc.) for CloudWatch filtering.

### Lifecycle invariants — read this before touching the lambda

| Invariant                                                                                       | Why                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Updates MUST preserve `trigger.deployed_trigger_id` and `trigger.webhook_signing_key`.          | The wizard payload only carries user-editable fields. If you `SET trigger = :wizardPayload` directly you'll wipe the signing key, the receiver will start logging `WEBHOOK_ORPHAN_EVENT` for every delivery, and there's NO way to recover the key — Pipedream doesn't expose it after deploy. Recovery is delete + recreate the automation. |
| Deletes MUST call `delete_deployed_trigger` via the relay BEFORE soft-deleting the DDB record.  | Otherwise Pipedream keeps firing webhooks at our receiver forever, costing credits and logging orphans. The delete code reads `trigger.deployed_trigger_id` with a fallback to the top-level `deployed_trigger_id` attribute (some legacy records have only the top-level copy). 404 from Pipedream is treated as success.                   |
| `timezone` is a DynamoDB reserved keyword.                                                      | UpdateExpressions referencing `timezone` directly (SET or REMOVE) hit a `ValidationException`. Always alias via `ExpressionAttributeNames['#timezone'] = 'timezone'`.                                                                                                                                                                        |
| Pipedream UPDATE preserves `dc_xxx` and the signing key (verified empirically).                 | We can call `update-deployed-trigger` for prop changes without re-deploying. Active-toggle (pause/resume) likewise preserves both.                                                                                                                                                                                                           |
| Pipedream does NOT retry failed webhooks (verified empirically).                                | The receiver's "never 5xx if avoidable" rule is real. If a transient error means we 5xx back to Pipedream, the event is gone forever. Persist the raw payload to S3 BEFORE invoking the dispatcher; if the dispatcher fails, the event can be replayed.                                                                                      |
| The receiver's GSI lookup uses INCLUDE projection of `[user_id, schedule_id, trigger, status]`. | If you add a new field that the receiver needs to read, also add it to the GSI projection in `core-numa-infra-construct.ts`. Otherwise the GSI item won't have it.                                                                                                                                                                           |

### Per-trigger restraints (`forced_props` and `hidden_props`)

Pipedream's per-component config is often permissive in ways that would create high-volume / poorly-scoped triggers (e.g. `slack-new-message-in-channels` with empty `conversations` = "every message in every channel"). We re-assert sensible defaults via `restraints` on each curated trigger entry:

- `required_props`: user must populate these (validated frontend + backend before deploy).
- `forced_props`: Numa-controlled values that override any user input. Auto-hidden from the UI. Use for safe defaults like `ignoreBot: true` (prevents Numa from triggering itself in a loop) and `resolveNames: true` / `includeUserData: true` (model wants names, not bare IDs).
- `hidden_props`: hide from UI without forcing a value. Use for props that exist on the Pipedream component but don't make sense in the curated Numa flow (e.g. `keyword` on the user-mention trigger — confusing AND filter).

### Per-prop label/description overrides

The renderer first checks `pipedreamTriggers.triggers.<componentKey>.props.<propName>.{label,description}` in i18n and falls back to Pipedream's own metadata. **Adding clearer copy is i18n-only — no code changes**. Use this aggressively; Pipedream's prop descriptions are written for developers, not end users.

### Pipedream's two response shapes for `configure_props`

The endpoint returns options in one of two shapes:

- `options: [{label, value}, ...]` — used by most props (channels, users).
- `stringOptions: ["fire", "thumbsup", ...]` — used when value IS the label (Slack `iconEmoji`).

`PipedreamProxyService.configureProp` normalises both into the unified `{label, value}` shape. Don't re-implement this in calling code.

### Custom-icon enrichment (Slack emoji)

For Pipedream-backed sources where labels alone aren't enough (Slack workspace customs like `party_parrot`, `glitch_crab`, etc.), the configurator can side-fetch metadata via `proxy_request`:

- `useSlackEmojiMap` hook calls Slack's `emoji.list` once per session via Pipedream's Connect Proxy
- Resolves `alias:` chains
- Caches in sessionStorage
- Returns a value→image-URL map passed to `DynamicPropRenderer.valueImageMap`
- `SearchableMultiSelect` renders `<img>` next to matching options (and inside selected pills)

This pattern generalises: any source that has icon-able remote-options can have a similar enrichment hook (e.g. Jira project avatars). Add it on demand, not speculatively.

---

## Native triggers

Native triggers don't deploy anywhere external — they listen to events that Numa's own infrastructure already receives. Today this is just Gmail (Workspace push subscription). Adding a native trigger is fundamentally different from adding a Pipedream-backed one:

1. The event source must already be flowing into a Numa receiver. For Gmail this is the Pub/Sub watch set up at deploy time.
2. The frontend has an inline config builder (e.g. `EmailFilterBuilder` for Gmail) — not driven by a generic prop renderer because the data shape is fully known and the UX is bespoke.
3. The trigger is persisted as a `GmailEventTrigger` (or future shape) in the schedule record's `trigger` field via the Zod discriminated union in `lib/scheduling-schemas.ts`.
4. The dispatcher's per-source extractor handles the Numa-native payload shape.

Native sources are higher-effort to build but offer privacy + cost benefits (no per-event Pipedream credit, no third-party in the auth path). We'll add native flavours of high-traffic sources as the product matures.

---

## How to add a new Pipedream-backed trigger

Worked example: adding **Outlook** as a source with the "new email" trigger.

### 1. Confirm the Pipedream component exists

Pipedream's catalogue lives at `https://api.pipedream.com/v1/connect/<project>/triggers?app=<slug>`. The component metadata returns the configurable props (with their types, options, descriptions). Use the existing probe pattern in `dev-notes/research/integrations/pipedream-docs/connect-api/list-triggers.md` to understand the request shape — but for adding a new app, the API explorer at `https://pipedream.com/apps/<slug>` is faster.

Look up:

- Component `key` (e.g. `microsoft_outlook-new-email`)
- The full `configurable_props` list — note which are required, which have `remoteOptions`, which have `reloadProps`
- Whether any props need restraints (defaults too permissive, dangerous on/off toggles, etc.)

### 2. Append to `lib/event-sources.ts`

```ts
{
  source_id: 'microsoft_outlook',
  order: 20,                             // pick something between existing entries
  source_type: 'pipedream',
  label_key: 'eventSources.microsoft_outlook.label',
  description_key: 'eventSources.microsoft_outlook.description',
  icon_slug: 'microsoft_outlook',        // must already exist in Config/integrationsConfig
  pipedream_app_slug: 'microsoft_outlook',
  availability: [{ kind: 'pipedream_app' }],
}
```

If the icon isn't in `Config/integrationsConfig.ts` yet, add it (see `numa-integrations` skill for "How to add a new integration").

### 3. Append to `lib/pipedream-trigger-apps.ts`

```ts
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
        required_props: [/* whatever Pipedream marks required */],
        forced_props: { /* safe defaults */ },
      },
    },
  ],
}
```

### 4. Add the per-app payload extractor

`lambdas/node/connector-event-dispatcher/extractors/microsoft_outlook.ts` — normalises Outlook's webhook payload into canonical event fields the runner can interpolate (`{{ event.subject }}`, `{{ event.from }}`, `{{ event.body }}`, etc.). Register it in `extractors/index.ts`. Look at `extractors/slack.ts` as the reference.

### 5. i18n strings

Add to `numa-frontend/src/locales/en/automations.json`:

```jsonc
{
  "eventSources": {
    "microsoft_outlook": {
      "label": "Outlook",
      "description": "Trigger on new emails, with optional filters on sender, subject, body, or attachments.",
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
          // Optional per-prop label/description overrides
        },
      },
    },
  },
}
```

### 6. Test

- Frontend: source picker shows the new source, configurator loads the trigger components, `configure_props` populates remote dropdowns
- Backend: deploy + delete via the agent-schedules CRUD work end-to-end (the relay's allowlist already covers the new app since it reads from the registry)
- End-to-end: trigger fires the agent with the right interpolated event context

That's it — five files (registry × 2, extractor, i18n, optionally icon). No infra changes. No new tests required (the existing trigger-receiver / dispatcher / runner tests cover the generic path).

---

## How to add a new native trigger

Higher-effort. Sketch:

1. Confirm the event source flows into Numa via existing infrastructure (or build it).
2. Add a new variant to the `EventTriggerSchema` discriminated union in `lib/scheduling-schemas.ts`.
3. Build the config UI component (like `EmailFilterBuilder` for Gmail) — bespoke per source.
4. Wire the new variant in `WorkflowStepEventTrigger`'s router (`source.source_id === '<new>' ? <NewBuilder /> : ...`).
5. Add the source to `lib/event-sources.ts` with `source_type: 'native'`.
6. Add the dispatcher extractor for the source's payload shape.
7. Persist + lifecycle in `agent-schedules` lambda — typically simpler than Pipedream-backed since there's no external deploy.

When Numa eventually offers the same source in BOTH flavours (e.g. native Slack alongside Pipedream Slack), the registry can mark it `source_type: 'both'` — picker UX (toggle on the card vs sub-picker) will be designed when the case actually lands.

---

## Debugging triggers

Filter `/numa/<client>-core` CloudWatch logs by structured `_name` field:

| `_name`                       | Source     | When                                                                       |
| ----------------------------- | ---------- | -------------------------------------------------------------------------- |
| `DEPLOY_TRIGGER`              | proxy      | Successful trigger deploy                                                  |
| `DEPLOY_TRIGGER_FAILED`       | proxy      | Pipedream returned non-200                                                 |
| `UPDATE_TRIGGER` / `_FAILED`  | proxy      | Props update or pause/resume                                               |
| `DELETE_TRIGGER` / `_FAILED`  | proxy      | Trigger delete                                                             |
| `DELETE_TRIGGER_ALREADY_GONE` | proxy      | Pipedream 404 — treated as success                                         |
| `WEBHOOK_HMAC_FAILED`         | receiver   | Bad signature — check signing key drift or replay                          |
| `WEBHOOK_USER_MISMATCH`       | receiver   | `x-pd-external-user-id` header ≠ schedule's user_id                        |
| `WEBHOOK_ORPHAN_EVENT`        | receiver   | `dc_xxx` not in schedules table OR signing key wiped — needs investigation |
| `WEBHOOK_PERSISTED`           | receiver   | Successful event ingestion → S3                                            |
| `PIPEDREAM_EVENT_DISPATCHED`  | dispatcher | Event handed to runner                                                     |

Common debug paths:

- **"My trigger isn't firing"** — first check the Pipedream side is wired: an admin can run `python3 dev-notes/tasks/pipedream-triggers/check_my_deployed_triggers.py` (Arcanum-internal credentials only) or hit the Pipedream dashboard. If Pipedream isn't dispatching, it's a config issue. If Pipedream IS dispatching but the receiver doesn't log `WEBHOOK_PERSISTED`, check CloudFront origin-request policy: `/api/webhooks/pipedream-events/*` MUST use `AllViewerExceptHostHeader`, otherwise CloudFront strips the `x-pd-*` headers before they reach API Gateway.
- **"Edits broke my trigger"** — likely the lifecycle-field preservation bug (fixed) — check `trigger.webhook_signing_key` is still set on the schedule record. If wiped, recovery is delete + recreate the automation.
- **"Delete didn't clean up Pipedream"** — check `record.trigger.deployed_trigger_id` AND the top-level `record.deployed_trigger_id`. If both are missing, Pipedream side won't be cleaned up (no ID to call delete with). The reconciliation-worker pattern (sweep orphan `dc_xxx` from Pipedream nightly) is a planned mitigation for any such drift; not yet implemented.

---

## What NOT to do

- **Don't store secrets in the trigger map.** `webhook_signing_key` is the only secret-shaped field — it's already there because the receiver needs it for HMAC verification. Don't add others. Use Secrets Manager for anything else.
- **Don't route webhooks through CloudFront's `/api/*` catch-all.** Always use the dedicated `/api/webhooks/pipedream-events/*` behavior with `AllViewerExceptHostHeader`. The catch-all has a strict allowlist that strips required `x-pd-*` headers.
- **Don't skip the per-trigger `restraints`.** Pipedream's defaults are often too permissive (e.g. listening to every channel). Always assert the safe defaults.
- **Don't 5xx from the receiver if you can avoid it.** Pipedream doesn't retry. Persist to S3 first, invoke dispatcher fire-and-forget if you can; if you must fail, log it loudly and reconcile separately.
- **Don't hardcode trigger metadata in components.** It belongs in `lib/event-sources.ts` and `lib/pipedream-trigger-apps.ts` so the wizard, relay, and schema-cache refresh all read the same source of truth.

---

## Related skills

- `numa-integrations` — Pipedream Connect integrations (the broader system: actions, MCP, admin policies). Triggers reuse the same proxy/relay infrastructure; this skill is the lower layer.
- `numa-scheduled-agents` — cron-based schedules (the other half of Automations).
- `numa-connectors` — data connectors (SharePoint, Google Drive, etc.). Triggers are NOT connectors; the systems are independent.
- `extending-numa-chat` — adding new tools to the workspace agent. If a trigger needs a new tool to act on the event, that's where it lives.
