# Synergy → Numa Chat: Metadata, Aggregates & KB Fusion — PLAN

> Status: **proposal / not started.** Plan only — no code yet. Authored 2026-06-21.
> Companion to the API investigation in `ext-api-doc/synergy/`.

## 1. Executive summary

Synergy's 12d API exposes deep read-only structure (jobs, folders, files, tasks,
contacts, attributes, change logs) but the chat agent currently sees only file
browse/search and a text-only `synergy` rollup KB. We can:

1. Give the agent a **metadata/stats CLI surface** layered on the existing
   `oauth-workspace-tools/tools/synergy_helpers.py` (no change to those functions).
2. Add a tier of **derived "conceptual" aggregates** (portfolio, activity,
   document-mix, health) computed at crawl time into the existing `job_rollup`
   sidecar / `JOB#` row.
3. **Fuse structured job attributes into the rollup KB** so breadth search
   ("coastal retaining-wall council jobs since 2023") combines semantic + structured
   filtering instead of pure text similarity.

All read-only — zero HITL.

## 2. CLI command catalog

New family: `numa integrations synergy <subcommand>` (`integrations.ts` →
`numa-cli-api` registry → `oauth-workspace-tools`, per-user PAT). All require `-m`.
No approval.

**Thin passthroughs** (single API call, normalized):

- `list-jobs [--query <name>] [--include-stats]` → `search_all_jobs` (TotalRows/Pages). _(repurpose existing)_
- `job-meta <job-id>` → `/jobs/{id}/items` + `/jobs/{id}/{attrs}` (NoOfChildren/Folders, HasTeam/HasIssues).
- `folder-summary <folder-id>` → `/folders/{id}/items` (direct counts + size, one call).
- `file-metadata <file-id>` → `/files/{id}/{attrs}` (size, version, dates, path).
- `job-schema` → `getStandardAttributes` / search attributes (the filter vocabulary).
- `types` → `/types/*` enums (entity/file/folder states).
- `recent-files [--days 7] [--limit 50]` → scoped folder listings filtered on modified date.

**Derived** (recursive walk, bounded by `SYNERGY_LIST_DEADLINE_S` + max-depth 10):

- `job-summary <job-id>` → folder/file counts, total bytes, depth.
- `job-tree <job-id> [--max-depth N]` → indented outline, counts per level.
- `job-stats <job-id>` → size histogram, file-type mix, modified date range, largest file.
- `search-jobs-by-date --from --to` → client-side date filter.
- `job-compare <a> <b>` → side-by-side deltas.

Defer (heavy, low value): `list-duplicates`, file-reference graph.

## 3. Conceptual aggregates catalog (ranked by value/effort)

Embedded into the `job_rollup` sidecar / `JOB#` row at crawl time unless noted.
"KB?" = becomes a queryable filter/context dimension.

| Aggregate                  | User question                  | Inputs                          | Compute                         | Cost  | KB?                  |
| -------------------------- | ------------------------------ | ------------------------------- | ------------------------------- | ----- | -------------------- |
| Document-type mix          | "drawings vs specs vs emails?" | folder file-ext histogram       | crawl-time (extract.py has ext) | mod   | yes                  |
| Document age distribution  | "is this content current?"     | file LastModified buckets       | crawl-time                      | mod   | yes                  |
| Job portfolio summary      | "scope/scale of this job?"     | JobModel counts                 | on-demand, single call          | mod   | yes (counts as meta) |
| Embedding-quality signal   | (internal: rank retrieval)     | extract.py SkipType             | crawl-time, free                | cheap | yes                  |
| Job→contact role summary   | "who's PM/foreman here?"       | task owners per job             | on-demand (flat, cheap)         | mod   | partial              |
| Activity rollup (hot jobs) | "what changed recently?"       | `/items` UpdatedOn              | poll 15–30min → state table     | mod   | yes (recency)        |
| Job staleness/health flags | "dormant/incomplete jobs?"     | attrs vs schema + last-modified | nightly                         | heavy | yes (tag)            |
| Cross-job entity frequency | "repeat supplier/architect?"   | tasks+contacts across jobs      | nightly side table              | heavy | partial              |
| Job lineage                | "related jobs in family?"      | ParentJobID / SubJobs           | free, state table               | cheap | meta                 |

Skip/defer: file-reference-graph, task burndown, issue density, IFC tree,
transmittal cadence — heavy, niche, low chat value.

## 4. KB hybrid (breadth search)

Stamp structured attributes into the `job_rollup` sidecar (`_rollup_sidecar()`),
flat scalar keys only: `job_type`, `client_name`, `location` (normalized to canonical
buckets), `job_status`, `start_date`/`end_date` (ISO 8601), `cost_band`. Fetched
once per job in the coordinator's existing `/jobs/search` enumeration (or best-effort
`/jobs/{id}` detail), cached in the `JOB#` row, passed to workers — no per-file refetch.
Budget ~280 bytes vs the 9.5KB cap; keep `_fit_sidecar` truncation + log loudly on
overrun (Bedrock silently drops oversized metadata → doc goes invisible).

Extend `_query_bedrock()` with an optional `structured_filters` dict (whitelisted
keys), building `andAll` clauses alongside `tenant_id`/`kb_id`/`doc_type`/`allowed_users`:
`equals` for low-cardinality (job_type, status), `range` for ISO dates, `startsWith`
for normalized location. **Cardinality rule:** low-card → Bedrock filter; high-card
(client_name, individual contact) → post-retrieval filter on cached `JOB#` rows over
top-K hits (two-pass). Add `metadata_sha` to `JOB#` so metadata-only changes trigger a
sidecar rewrite (no re-embed), reusing the ACL-refresh path. Verify `startsWith`/`range`
operator support in the target region first; fall back to Python post-filter.

## 5. Phased rollout

- **Phase 1 — Counts + schema + passthroughs (~3–4 days).** `list-jobs`, `job-meta`,
  `folder-summary`, `file-metadata`, `job-schema`, `types`, `recent-files`;
  registry/policy entries; `synergy-metadata` skill + prompt hint; agent-type flag
  (Nolia off). Deps: existing helpers only. Highest value/effort.
- **Phase 2 — Summaries + crawl-time aggregates (~5–7 days).** `job-summary`,
  `job-tree`, `job-stats`, `job-compare`, `search-jobs-by-date`. Wire crawl-time
  aggregates into sidecar/`JOB#`: document-mix, age distribution, embedding-quality,
  portfolio counts, lineage. Activity rollup via scheduled poll → state table. Deps:
  Phase 1 CLI; crawler changes; bounded recursion.
- **Phase 3 — KB hybrid + nightly aggregates + dashboards (~7–10 days).** Metadata
  stamping + `structured_filters` query layer + `metadata_sha` refresh; nightly
  health/staleness + cross-job entity frequency side tables; filter discovery in the
  agent/UI (start job_type/location/date). Deps: Phase 2 plumbing; Bedrock operator
  verification.

## 6. Risks / decisions for the lead

- **Rate limits undocumented** — enforce ≥100ms between calls, ≤depth-10, wall-clock
  deadline; never poll <2min. _Decision: acceptable, or add a token-bucket?_
- **No webhooks** — activity/staleness is poll-only, ~30min crawl lag; live filters
  won't see brand-new jobs until next crawl.
- **Bedrock filter limits** — operator support varies by region; high-cardinality
  `equals` degrades beyond ~1000 values. Mitigation: normalize location, post-filter
  client*name. \_Decision: confirm `startsWith`/`range` in us-east-1 + ap-southeast-2
  before Phase 3.*
- **Infra** — Phases 1–2 need **none** (reuse `JOB#` DynamoDB + sidecar S3). Phase 3
  nightly aggregates need **one EventBridge schedule + side tables** per client account
  — _needs a call._
- **Per-instance API variance** — mixed casing, IDString underscores, `LimitID` needs
  `_server_id` (else HTTP 500), plain-text errors. Helpers normalize; new handlers
  inherit but verify against live Swagger per instance.
- **arcanum-demo-tony has manual Lambda code drift** ahead of Terraform — confirm a
  clean baseline before deploying crawler changes there.
- **Open call:** CLI-first vs MCP-first dispatcher — recommend CLI-first (agent over
  Bash), optional MCP wrapper later.
