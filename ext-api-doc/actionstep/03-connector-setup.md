---
api_name: 'Actionstep'
connector_id: 'actionstep'
auth_type: 'oauth2'
tier: 'standard'
category: 'legal'
integration_path: 'direct-api (spec-driven, chat-only)'
---

# Actionstep — Connector & Integration Setup

> Build instructions for the Actionstep connector. **Integration path: Direct API, chat-only,
> spec-driven** — same shape as NetSuite / simPRO / Zoho CRM. The workspace agent reads the
> `ext-api-doc/actionstep/` specs (this folder) and calls the API through the connector request
> path. **No `lib/oauth-providers/` provider class is required** (it is not a Files-Remote /
> file-browsing connector).
>
> Prerequisites: read `00-api-investigation-questionnaire.md` and activate the `numa-connectors`
> skill.

---

## Integration Type

**Selected path:** Direct API (spec-driven, chat-only)

| Component                       | Required? | Status                                       |
| ------------------------------- | --------- | -------------------------------------------- |
| Connector Registry entry        | Yes       | ✅ Done — `connectorRegistry.ts`             |
| OAuth scope picker entry        | Yes       | ✅ Done — `wizards/oauthScopeDefinitions.ts` |
| Native-connector catalog entry  | Yes       | ✅ Done — `infra/config/connectors.ts`       |
| `ext-api-doc/actionstep/` specs | Yes       | ✅ Done — this folder                        |
| Admin OAuth wizard              | Yes       | ✅ Generated from registry (no bespoke code) |
| User integration (Connect)      | Yes       | ✅ Generated from registry (no bespoke code) |
| `lib/oauth-providers/` provider | No        | ❌ Not needed (chat-only, not file-browsing) |
| Dynamic `api_endpoint` capture  | Optional  | ⏳ Enhancement (see below)                   |
| OAuth app credentials           | Yes       | ⛔ External — request from Actionstep        |

---

## 1. Connector Registry Entry (DONE)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

The entry is already committed. For reference, its shape:

```typescript
{
  id: 'actionstep',
  displayName: 'Actionstep',
  icon: 'bi-briefcase',
  description: 'Legal practice management — matters, contacts, time recording, billing, and documents',
  category: 'Legal',
  authType: 'oauth2',
  surfaces: ['chat'],
  cachingPolicy: CACHING_PRESETS.projectManagement,
  oauth: {
    authUrl: 'https://go.actionstep.com/api/oauth/authorize',
    tokenUrl: 'https://api.actionstep.com/api/oauth/token',
    scopes: 'actions participants timerecords',
  },
  credentialFields: [
    {
      key: 'api_endpoint',
      label: 'Actionstep API endpoint',
      type: 'url',
      placeholder: 'https://ap-southeast-2.actionstep.com',
      required: true,
      helpText: 'The region-specific REST base URL returned as api_endpoint in your Actionstep token response. All users in this workspace share one region.',
    },
  ],
  oauthSetupSteps: [ /* request creds from Actionstep; paste region endpoint */ ],
}
```

Scope checkboxes come from `oauthScopeDefinitions.ts:actionstep` (matters/contacts/time default-on;
file notes, tasks, billing, documents, and `all` opt-in). Scopes are **space-separated**.

---

## 2. Backend Provider Class — NOT REQUIRED

Actionstep is chat-only and spec-driven. There is **no** `lib/oauth-providers/actionstep_provider.py`
and no `handleListProviders`/`getProviderConfig` Files-Remote wiring. The workspace agent issues
authenticated requests through the standard connector request path using the OAuth token Numa
already stores, guided by the `01*` rules in this folder.

(If a future requirement adds Files-Remote document browsing via `actiondocuments`, then — and
only then — add a provider class and set `surfaces: ['files','chat']`.)

---

## 3. The `api_endpoint` (region base URL)

Actionstep returns a region-specific `api_endpoint` in the **token response**. Today the admin
records it in the `api_endpoint` credential field (workspace-wide, like Synergy's instance URL),
so the agent knows the base host without backend changes.

**Optional enhancement (cleaner):** have the OAuth token-exchange handler persist `api_endpoint`
(and `orgkey`) from the token response into the connection record automatically, and make the
credential field a fallback/override. Scope this as a backend task on the relay/OAuth path; it is
not required for first testing.

---

## 4. Workspace Agent Specs (DONE)

The `01*` files in this folder are the agent knowledge pack:

- `01-llm-api-rules.md` (main rules, < 300 lines)
- `01a-domain-model-reference.md`, `01b-query-patterns.md`, `01c-mutation-patterns.md`, `01d-event-and-error-handling.md`

They sync to the per-client `{client}-ext-api-doc` S3 bucket on deploy and are read by the agent
at runtime. The folder name (`actionstep`) matches the registry id, satisfying the
`tools/check-connector-docs.mjs` parity check.

---

## 5. Deployment Checklist

### Code (done in this branch)

- [x] Registry entry added (`connectorRegistry.ts`)
- [x] Scope picker entry added (`oauthScopeDefinitions.ts`)
- [x] Native-connector catalog entry added (`infra/config/connectors.ts`)
- [x] `ext-api-doc/actionstep/` specs committed
- [x] Parity check passes (`node tools/check-connector-docs.mjs`)
- [x] Frontend lint + typecheck clean

### External / deploy (developer)

- [ ] Obtain Actionstep OAuth Client ID + Secret (request from Actionstep; register redirect URI)
- [ ] Deploy a dev/HQ stack (frontend rebuild + `ext-api-doc` sync + `NATIVE_CONNECTORS`)
- [ ] **Phase 2 smoke test** against a sandbox (see `04-connection-and-reauth.md`)
- [ ] Confirm the 🔬 items: filter/sort syntax, write field schemas, webhook payload, rate limits

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** open the Actionstep OAuth wizard, enter Client ID/Secret, pick scopes, set
   the region `api_endpoint`, save.
2. **User connect:** click Connect → authorize on `go.actionstep.com` → token exchange.
3. **Smoke test (Phase 2 gate):** ask the agent to "list my Actionstep matters" → expect a
   `GET /api/rest/actions` returning a resource-keyed list.
4. **Read:** "show matter 123 and its contacts" → single record + `linked` participants.
5. **Write:** "log 30 minutes on matter 123 for drafting advice" → `POST /api/rest/timeentries`
   (confirm field schema first).
6. **Events (optional):** subscribe a RestHook and trigger it; capture the payload to fill the
   🔬 gap in `01d`.
7. **Disconnect:** user disconnect removes the user secret only.

### Edge cases

- [ ] 401 → token refresh (8h access / 21-day rotating refresh)
- [ ] 429 rate limit → backoff
- [ ] Pagination beyond one page (`nextPage`)
- [ ] Wrong region `api_endpoint` → 404s (verify the field)

---

## Sources

- Auth: https://docs.actionstep.com/authentication/
- Scopes: https://docs.actionstep.com/api-scopes/
- RestHooks: https://docs.actionstep.com/webhooks/
- Responses/errors: https://docs.actionstep.com/api-responses/ , /error-codes/
- Limits: https://docs.actionstep.com/api-limits/

_Generated from the investigation questionnaire. Pair with the `numa-connectors` skill._
