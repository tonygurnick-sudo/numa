---
api_name: Flowingly
api_slug: flowingly
base_url: https://publicapi.flowingly.net
route_prefix: /public (literal path segment — part of every path, NOT a version)
path_version_segment: none (no /v1/; "unversioned" — never put /v1/ in a path → would 404)
base_url_warning: connector brief said api.flowingly.io — UNCONFIRMED, likely wrong (marketing site). Use publicapi.flowingly.net [UNKNOWN]
call_surface: HTTP via `numa integrations request` (action-oriented Direct-API connector). NOT a file-browser — does NOT support list-files/search-files/download-file. NOT MCP.
auth: Bearer {accessToken} (backend exchanges stored username+password at POST /public/authorise; re-authorises on 401)
field_casing: INCONSISTENT per endpoint — authorise response=camelCase; startflow REQUEST=PascalCase; startflow RESPONSE + step-field bodies=camelCase. Preserve exactly per endpoint.
id_format: flowIdentifier=FLOW-<number> (FLOW-9042) · field identifier=field<digits> (field4938201746) · stepIdentifier=step display NAME (e.g. "Step 1", "New Customer (Debtor) Form"), URL-encoded in path
rate_limit: none documented [UNKNOWN] — throttle conservatively; exponential backoff on 429/5xx
confidence: EVERY fact is [DOCUMENTED] (Flowingly Help Center, 2026-05-29) or [INFERRED]/[UNKNOWN] — NOT live-tested, NO [CONFIRMED] facts. Non-default markers are inline; treat unexpected behaviour as a doc gap, not an agent bug. Auth placement, token lifetime, error HTTP codes, full endpoint catalogue need live verification.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Flowingly — API Rules

## Paths (read first)

- Pass FULL paths including the literal `/public` segment: `/public/authorise`, `/public/startflow`, `/public/flow/{flowId}/step/{stepId}`. The host is `https://publicapi.flowingly.net`.
- `/public` is a real path segment, NOT a version. There is NO `/v1/` anywhere — adding it → 404.
- `stepIdentifier` is the step's display NAME and must be URL-encoded in the path (spaces→`%20`, parens→`%28`/`%29`). E.g. `New%20Customer%20(Debtor)%20Form`.
- Use `api.flowingly.io` ONLY if discovery confirms it; default to `publicapi.flowingly.net`.

## Surface (entire documented API = 4 endpoints)

| #   | Method | Path                                                | Purpose                                      | Auth | Idempotent |
| --- | ------ | --------------------------------------------------- | -------------------------------------------- | ---- | ---------- |
| 1   | POST   | /public/authorise                                   | username+password → bearer token             | No   | Yes        |
| 2   | POST   | /public/startflow                                   | start a flow instance from a published model | Yes  | **No**     |
| 3   | GET    | /public/flow/{flowIdentifier}/step/{stepIdentifier} | read a step's fields + values                | Yes  | Yes        |
| 4   | POST   | /public/flow/{flowIdentifier}/step/{stepIdentifier} | update a step's field values (bulk array)    | Yes  | Yes        |

`startflow` is documented as both `/public/startflow` and `/public/startFlow` — server is almost certainly case-insensitive; use lowercase. [verify on live]

## Auth

Backend exchanges stored credentials at `POST /public/authorise` and sends `Authorization: Bearer {accessToken}` on calls 2–4. Authorising user MUST be a Flowingly **Business Administrator** or calls are rejected.

- `/authorise`: credentials in the **QUERY STRING** with `Content-Type: application/x-www-form-urlencoded` (body may also work — unverified). Token check happens before payload validation.
- Response: `{accessToken, refreshToken:null, idToken:"", tokenType:"Bearer", expiresIn:0}`. `expiresIn` real value/unit UNKNOWN. `refreshToken` is null → no refresh; on 401 **re-run /authorise and retry once** (safe for GET/update; NOT for startflow). [INFERRED]

## CAN

1. Start a flow instance from a published flow MODEL name (`POST /public/startflow`) — assign actors, CC, assignee, initiator.
2. Read a known step's fields (definitions + current values): `GET /public/flow/{flowId}/step/{stepId}`.
3. Update step field values in bulk (array of field objects) for a known flow+step: `POST /public/flow/{flowId}/step/{stepId}`.

## CANNOT

List/search/browse flows, models, steps, actors, or teams — **no list endpoints exist** (must already hold the model name + flowIdentifier). Advance/approve/complete/reassign/cancel a flow or step (in-app only). Upload/download files; `FileUpload`/`Signature`/`Instruction` fields are not API-writable. Configure/list/delete webhooks or edit flow models (modeller web UI only). Poll for "what changed" (no list/changed-since endpoint — use the Webhook step). Bulk-start flows (one instance per call).

## Gotchas

1. **Casing flips per endpoint.** startflow REQUEST = PascalCase (`Name`, `Subject`, `ActorsToStartFlowFor`, `CCActors`, `AssignedActor`, `FlowInitiator`). authorise response + startflow response + step-field bodies = camelCase. Mixing fails validation.
2. **`Name` = flow MODEL name (published template), NOT the instance subject.** `Subject` = this instance's title. Model must exist + be published. No API to discover model names → get it from the user.
3. **Credentials go in the query string of `/authorise`** despite the form-urlencoded Content-Type. URL-encode the password.
4. **GET a step before you POST it.** Field `identifier`s (`field<digits>`) are model-assigned and required in the write body — read them, set `value`, POST the same array shape back. Preserve `name`/`type`/`order`/`identifier` exactly.
5. **`AssignedActor` is conditionally required** — only when the flow's first step needs an approver selected; else optional/omit.
6. **Errors may arrive as HTTP 200 with `success:false`.** Always inspect `success`/`errorCode`/`errorMessage` in the body, not just HTTP status. (Whether failures are 200 or 4xx is UNKNOWN; `errorCode` catalogue undocumented.)
7. **`startflow` is NOT idempotent** — each call starts a new flow + notifies/assigns people. Never blind-retry; on ambiguous failure confirm with the user before re-calling. [INFERRED]
8. **Per-`type` `value` encoding differs** (see Field types). CheckBox is the string `"true"`/`"false"`, not a boolean. SelectList/RadioButtonList values are option OBJECTS with `isSelected:true`.

## Field types → `value` encoding (for update)

| type            | UI                   | value encoding                                               | Notes                                            |
| --------------- | -------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Text            | short text           | `"..."` (string)                                             |                                                  |
| TextArea        | long text            | `"..."` (string)                                             |                                                  |
| SelectList      | dropdown (single)    | `{"key":"2","value":"Option 2","isSelected":true}`           | object; isSelected must be true                  |
| RadioButtonList | option list (single) | `{"key":"1","value":"Option 1","isSelected":true}`           | object; isSelected must be true                  |
| MultiSelectList | multi-select         | array of option objects, each `isSelected` true/false        | `false` un-sets a value                          |
| CheckBox        | checkbox             | `"true"` / `"false"`                                         | **string, not boolean**                          |
| Email           | email                | string, valid email                                          |                                                  |
| Date            | date                 | `"dd/MM/yyyy"` (e.g. `"19/07/1990"`)                         | only Custom Value validation runs                |
| Datetime        | date+time            | `"dd/MM/yyyy hh:mm:ss tt"` (e.g. `"02/07/2021 02:05:00 PM"`) | only Custom Value validation runs                |
| Currency        | currency             | number `5000.50`                                             | max len 15; currency code auto-set if configured |
| Number          | number               | number `35`                                                  | max len 15                                       |

Not API-writable: `Instruction`, `FileUpload`, `Signature`. GET returns the first **10,000** options for list-type fields.

## Defaults (override only if the user specifies)

`FlowInitiator` = the authenticated user. `ActorsToStartFlowFor` = no default (must ask — no safe default). `AssignedActor` = omit (set only when first step needs an approver). `CCActors` = omit.

## Errors

Application envelope (startflow; likely shared by update): `{"success":false,"errorCode":"SOME_CODE","errorMessage":"Human readable reason","dataModel":null}`. HTTP status on failure UNKNOWN — check BOTH status AND `success`. Don't branch on specific `errorCode`s (catalogue undocumented); surface `errorMessage`.
Recovery (all INFERRED): 200 → if `success:false` surface `errorMessage`, do not retry blindly · 400 fix payload (casing, required fields, value type) · 401 re-run `/authorise` then retry once (no refresh token) · 403 confirm account is Business Administrator · 404 verify `flowIdentifier` + URL-encoded step name · 429 backoff (no `retry-after`), exponential ≤60s · 5xx exponential backoff + jitter (≤3). NEVER auto-retry `startflow`.

## Examples

1. Get a token (`POST /public/authorise?username=admin@acme.com&password=********`, `Content-Type: application/x-www-form-urlencoded`)
   → `{"accessToken":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":null,"idToken":"","tokenType":"Bearer","expiresIn":0}`

2. Start a flow (`POST /public/startflow`, `Authorization: Bearer {accessToken}`, PascalCase body)
   `{"Name":"New Customer Onboarding","Subject":"Acme Ltd onboarding","ActorsToStartFlowFor":[{"UserEmail":"jo@acme.com"}],"CCActors":[{"Team":"Finance"}],"AssignedActor":"manager@acme.com","FlowInitiator":"system@acme.com"}`
   → `{"success":true,"errorCode":null,"errorMessage":null,"dataModel":[{"flowIdentifier":"FLOW-9042","stepIdentifier":"Step 1"}]}`
   Actor = `{"UserEmail":"jo@acme.com"}` (individual) OR `{"Team":"Finance"}` (team) — supply one per actor.

3. Read a step's fields (discover identifiers): `GET /public/flow/FLOW-9042/step/New%20Customer%20(Debtor)%20Form`
   → `[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"","options":null},{"name":"Account Type","type":"RadioButtonList","order":3,"identifier":"field4938201748","value":"","options":["Standard","Premium"]}]`
   Response is a raw array (wrapper vs envelope UNKNOWN). `options` populated for list-type fields, else `null`.

4. Update step field values (`POST /public/flow/FLOW-9042/step/New%20Customer%20(Debtor)%20Form`, camelCase array body — write back the GET array with `value` set)
   `[{"name":"Customer Name","type":"Text","order":1,"identifier":"field4938201746","value":"Acme Ltd","options":null},{"name":"Email","type":"Email","order":2,"identifier":"field4938201747","value":"jo@acme.com","options":null}]`
   → `{"success":true,"errorCode":null,"errorMessage":null}` (response shape INFERRED — may instead echo the field array or return bare 200; re-GET to confirm). Partial-failure behaviour unknown — treat as all-or-nothing.
