# Connector Backlog — Audit + Build Plan (handoff)

**Date:** 2026-06-24 · **Owner:** Tony Gurnick · **Board:** HQ Numa Ops "Dev Team" (team `81f2560d-617a-46a4-83dc-7608a6dafc37`)

Pick-up doc for the connector backlog. Covers (A) the 11 existing-connector audit + what moved, (B) the architecture, (C) the 10 new-connector build plan, and (D) the ONE thing to do first. Before any build work: **load the `numa-connectors` skill** and read `documentation/connectors/`. The bar is the **14-point checklist** in that skill.

---

## STATUS SNAPSHOT

- **Moved In Progress → Review/Testing (audited complete-robust):** TASK-105 OneDrive, TASK-106 Dropbox, TASK-109 Wrike, TASK-114 Xero, TASK-115 QuickBooks, TASK-117 HireHop, TASK-118 Workbench. ✅ done
- **Still In Progress (connector work remaining):** the 4 Group-A gaps below + the 10 Group-B cards + FEAT-229 (connector docs page) + FEAT-053 (OneDrive Pipedream).
- All 24 connector cards are assigned to Tony and sit on the Dev board.

---

## A) GROUP A — 4 connectors with REAL gaps (stay In Progress)

Each is mostly done; here's the exact remaining work. File = `numa-frontend/src/Config/connectorRegistry.ts` (or `.../Components/DataConnectors/connectorRegistry.ts` — both paths seen; confirm which the build imports).

| Card         | Connector     | Gap (exact)                                                                                                                                                                                                                                                                                                                                                                                                                                | Size    |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **TASK-108** | Podio         | Registry: add `authHeaderScheme: 'OAuth2'` (~line 337; default Bearer → Podio 401) **and** fix `tokenUrl` (~line 340) `https://podio.com/oauth/token` → `https://api.podio.com/oauth/token/v2` (verify on a live connect before changing).                                                                                                                                                                                                 | ~30 min |
| **TASK-107** | WorkflowMax   | OAuth2/Bearer (same shape as Xero, which works). Needs `apiBaseUrl` + caching config set, CI matrix entry, and confirm the generic spec-driven request path serves it (no per-connector handler needed).                                                                                                                                                                                                                                   | S       |
| **TASK-113** | Connecteam    | `connecteam-api` needs `X-API-KEY` injected via `credentialHeaderMap`; `connecteam-oauth` backend not wired.                                                                                                                                                                                                                                                                                                                               | S–M     |
| **TASK-110** | Total Synergy | **API variant is DONE.** OAuth variant needs a **custom OAuth adapter** — non-standard endpoints/params/header: token `api.totalsynergy.com/api/v2/Oauth2/GetAccessToken`, refresh `/api/v2/Oauth2/RefreshAccessToken`, params `ApplicationKey/RedirectUri/tenant`, custom access-token header (not `Authorization: Bearer`). See `ext-api-doc/totalsynergy-oauth/03-connector-setup.md` lines 25, 49-67, 85-88 ("Not done… expect 401s"). | M–L     |

These overlap the Group-B auth work below (Podio→quick; Connecteam→Phase 2; Total Synergy OAuth→Phase 3).

---

## B) ARCHITECTURE (the lever for sizing everything)

Two distinct connector backends:

1. **File-browsing** (Drive, OneDrive, Dropbox, Synergy, NetSuite, Gmail) → a **per-connector Python provider** in `lib/oauth-providers/oauth_providers/<slug>_provider.py` implementing `list_files / download_file / search_files / get_file_metadata`.
2. **API/record** (Xero, HireHop, Workbench, Cin7, …) → a **generic, config-driven path** — NO per-connector Python for standard auth. Driven by registry fields `authType`, `authHeaderScheme`, `credentialHeaderMap`, `apiBaseUrl` + the `ext-api-doc/<slug>/` pack.

So **"build an API connector" ≈ registry config + ext-api-doc pack + (only for a new auth shape) a one-time shared-handler extension.** That's why several Group-B connectors are already ~9/14 done (registry + docs + catalog present, backend is the shared path).

`ext-api-doc/<slug>/` "filled" = 8 authored vendor-specific files (`01-llm-api-rules`, `01a-domain-model-reference`, `01b-query-patterns`, `01c-mutation-patterns`, `01d-event-and-error-handling`, `02-api-spec-investigation`, `03-connector-setup`, `04-connection-and-reauth`) — NOT copies of `ext-api-doc/_templates/`.

---

## ⭐ D) DO THIS FIRST — sizes all of Phase 2

**Open question:** which auth schemes does the shared spec-driven request path support TODAY? Bearer is confirmed (`lambdas/python/data-connectors/lambda_function.py` lines 1541/1573/1604). **`authHeaderScheme`/`credentialHeaderMap` are NOT consumed in that file** → injection happens elsewhere (candidates: `numa-frontend/src/Services/DataConnectorsService.ts`, another lambda, or baked into the vault secret at connect). Per-connector helpers also exist (e.g. `synergy_helpers.py`), so the path may be mixed.

**Action:** run an Explore agent (read-only) to answer — for spec-driven API connectors:

1. WHERE the outbound vendor request is made (file:line) — one generic path or per-connector?
2. WHERE `authHeaderScheme` + `credentialHeaderMap` are consumed to build headers (grep TS services AND python lambdas: `data-connectors`, `oauth-workspace-tools`, `oauth-files-api`, `numa-cli-api`, `workspace-chat-tools`).
3. Which schemes are SUPPORTED today: Bearer / raw token / HTTP Basic / single custom header / MULTIPLE custom headers / dual-auth / custom-OAuth — each SUPPORTED or NOT, with code path.
4. Per connector verdict: CONFIG-ONLY vs needs-shared-handler-CODE for: Connecteam(X-API-KEY), BetterImpact(Basic), Cin7-Core(2 headers), Cin7-Omni(Basic), Greentree(dual), TotalSynergy-OAuth(custom).

Outcome decides whether Phase 2 is "set registry fields" or "config + a small shared-handler change."

---

## C) GROUP B — 10 new connectors (research done)

Auth/clone/effort from the research pass. "exists" = registry / ext-api-doc / NATIVE_CONNECTORS catalog / backend.

| Card         | Connector        | Exists                  | Auth                                                                               | Clone                    | Effort | Notes                                                                  |
| ------------ | ---------------- | ----------------------- | ---------------------------------------------------------------------------------- | ------------------------ | ------ | ---------------------------------------------------------------------- |
| **FEAT-209** | Rentman          | reg+doc+cat+**backend** | token                                                                              | fergus                   | **S**  | Nearly done — needs live token test only.                              |
| **FEAT-151** | GoHighLevel      | reg+doc+cat             | token                                                                              | rentman                  | M      | Inject required `Version` header; 429-only rate signal.                |
| **TKT-529**  | BetterImpact     | reg+doc+cat             | HTTP Basic                                                                         | proworkflow              | M      | Silent module-scope filtering returns empty (not error).               |
| **SPK-016**  | Cin7 (Omni+Core) | reg+doc+cat             | Omni=Basic, Core=2 custom headers (`api-auth-accountid`,`api-auth-applicationkey`) | proworkflow/betterimpact | M      | Omni/Core opposite auth-fail codes (401 vs 403).                       |
| **TKT-543**  | MYOB Greentree   | reg+doc+cat (9/14)      | dual: Basic + ApiKey header                                                        | proworkflow              | M      | Backend layer only; docs-derived, no live validation yet.              |
| **TASK-073** | isolved HCM      | none                    | OAuth2 REST                                                                        | proworkflow              | **L**  | HCM vendors gate API access — creds/sandbox risk.                      |
| **SPK-005**  | Net-Inspect 5.0  | none                    | api-key REST                                                                       | gitlab                   | M      | **BLOCKER: confirm vendor identity, base URL, auth, endpoints FIRST.** |
| **TASK-168** | MYOB IMS Payroll | none                    | OAuth2 REST                                                                        | myob-account-right       | M      | Undocumented API; payroll data sensitivity.                            |
| **TASK-167** | Autoplay         | none                    | OAuth2 (unconfirmed)                                                               | rentman                  | M      | API docs unconfirmed.                                                  |
| **TASK-178** | Motion           | none                    | OAuth2                                                                             | workflowmax              | M      | Possible custom header handling.                                       |

---

## PHASED PLAN

- **Phase 0 — DONE:** 7 complete → Review.
- **Phase 1 (~½ day, quick wins):** Podio 2-field fix; Rentman live-token test; WorkflowMax + GoHighLevel config. → ~4 more to Review.
- **Phase 2 (1–2 days, GATED on section D):** Connecteam, BetterImpact, Cin7 (Omni+Core), Greentree. One-time shared-handler extension for Basic / custom-header / dual-auth (if section D shows it's missing), then config each.
- **Phase 3 (~1 day):** Total Synergy OAuth custom adapter (document the custom-OAuth pattern).
- **Phase 4 (research-gated, sequence by which creds/docs arrive):** Net-Inspect → confirm vendor first; then isolved, MYOB IMS, Autoplay, Motion. Each needs vendor API docs + sandbox creds before build.

Per-connector recipe (every connector): registry entry → admin wizard → caching → backend (provider OR config) → catalog (`NATIVE_CONNECTORS` in `infra/config/connectors.ts` + `_NATIVE_CONNECTOR_SLUGS` in `lambdas/python/workspace-chat-tools/tools/user_profile.py`) → connect/disconnect → Files Remote/chat surface → CI matrix → `ext-api-doc/<slug>/` pack. (Full 14-point list in the skill.)

---

## MECHANICS (board moves — reused every step)

Mass Ops writes via the API get **classifier-gated when the agent runs them**, so moves go through a `! bash` script the USER runs (forged userContext against the `hq_ops-api` Lambda). **Scratchpad is session-ephemeral — rebuild the script from this recipe.**

- AWS: `AWS_PROFILE=arcanum-prod-numa-demo`, region `us-east-1`, table `hq-ops`, Lambda `hq_ops-api`.
- IDs: team `81f2560d-617a-46a4-83dc-7608a6dafc37`, zone `26af7aed-ba6b-4c75-afa1-0e800f7fe3f9`, Tony sub `a4f8e408-4091-7050-b119-6839ce085847`.
- Stages: To Do `a5e99e77-3ec1-4c1f-8406-d056d2f395a3` · In Progress `f837ddd7-bd62-406a-848f-b6679853fffe` · Review/Testing `753fb749-fbaf-44aa-bcf9-1e214953d125` · Merge Request `7c025f8a-cf04-42e4-a694-d5b8ef0b49f2` · Done `a4c9f394-b60c-4d88-aada-80395c808a18`.
- Move one ticket (bash 3.2 safe): build body
  `{currentBoardId,boardId:TEAM, stageId:<target>, zoneId:ZONE, assigneeId:SUB, assigneeName:"Tony Gurnick"}`,
  wrap as `{requestContext:{http:{method:"PUT",path:"/api/ops/tickets/<id>"}},rawPath:..., body:<bodyJSON>, userContext:{sub:SUB,email:"tony.gurnick@arcanum.ai",name:"Tony Gurnick",groups:[]}}`,
  then `aws lambda invoke --function-name hq_ops-api --payload file://ev.json --cli-binary-format raw-in-base64-out out.json`; success = `statusCode 200`.
- Add a comment: POST `/api/ops/tickets/<id>/comments` body `{content:"..."}` (boardId resolved server-side).

### Card → ticketId map

TASK-105 `e6cdbf98-769a-4ade-8286-6c3cc2c67332` · TASK-106 `b7483ea5-c432-4f21-b4c6-15326fb6bd36` · TASK-107 `8e7ae76d-15e4-4b82-933e-05e23d918d85` · TASK-108 `d883419f-7629-4640-a129-bcc7ae18eff0` · TASK-109 `cb0069a9-ec2c-4ec0-88b0-1d9be23fd54a` · TASK-110 `3bdfe929-0ea7-4fda-a00a-d2f77f261e7c` · TASK-113 `b896a5a1-b00e-46f8-a81c-8664718f8def` · TASK-114 `c3f6d4d8-5cd9-467b-8f2f-c25739286eac` · TASK-115 `8694643d-a495-4151-86db-dc2fc69a080c` · TASK-117 `2331c64c-c0a3-4af2-b48b-80b390715f85` · TASK-118 `8c9c423a-72a1-4a91-838f-8357dd4f4303`
TASK-073 `7f04fa77-c8de-41d1-8337-ed3dec43a1e1` · SPK-005 `7cbaf754-363c-4c76-ac14-467f98a65cce` · SPK-016 `40039e5e-ac9e-4bbb-bb81-0422750e4fda` · TKT-529 `807dfaa8-d2f7-445e-9f83-ce0c2c4e9066` · FEAT-151 `a768c9e5-5166-4054-80e5-a7c5ff56a395` · TASK-168 `73b692fe-61aa-43c1-8116-bbf43c1e4699` · TKT-543 `8490f7d9-23db-4fb0-be15-277596b87be4` · TASK-167 `d5456f2f-a544-4805-b092-1b1f43e4e11c` · TASK-178 `fab939ce-36c4-484e-bf2a-b134447b2043` · FEAT-209 `0f66f98b-4a01-43d5-b904-6d1415a3f0ea`

---

## KEY FILES

- Registry: `numa-frontend/src/Config/connectorRegistry.ts` (and/or `.../Components/DataConnectors/connectorRegistry.ts`)
- Wizards: `numa-frontend/src/Components/DataConnectors/`
- File-browse providers: `lib/oauth-providers/oauth_providers/<slug>_provider.py`
- API-connector backend (Bearer confirmed here): `lambdas/python/data-connectors/lambda_function.py`
- Catalog: `infra/config/connectors.ts` (`NATIVE_CONNECTORS`) + `lambdas/python/workspace-chat-tools/tools/user_profile.py` (`_NATIVE_CONNECTOR_SLUGS`)
- API docs packs: `ext-api-doc/<slug>/` (templates in `ext-api-doc/_templates/`)
- Skill: `.claude/skills/numa-connectors/SKILL.md` · Docs: `documentation/connectors/`

## RELATED PRIOR WORK (memories)

ProWorkflow connector build (dual-auth, live-verified) · Synergy KB crawler · connector file-ops restore (MCP→CLI) · two backend patterns (spec-driven ext-api-doc vs lib/oauth-providers).
