# Synergy Chat — Capability Gap Analysis (breadth / depth / cross-job)

> Authored 2026-06-21. Goals driving this: **breadth** search (find any set of jobs
> by criteria), **depth** search (deep-dive one job), **cross-job** data analysis &
> comparison. Companion to `synergy-metadata-cli-plan.md`. Grounded in the current
> code + the 12d API spec (`ext-api-doc/synergy/`).

## What shipped (branch `bug/synergy-deploy`, MR !1534)

- **Breadth:** `numa files query --folder synergy --similar-jobs` (semantic over per-job
  rollup records) + structured filters `--created-after/--created-before/--parent-job/--exclude-templates`.
- **Depth:** `list-files`, `search-files` (job-scoped content+name), `synergy-job`,
  `synergy-folder`, `synergy-stats` (bounded recursive walk), `synergy-tree`, `file-info`, `download-file`.
- **Cross-job:** `--similar-jobs` + the agent manually fanning out `synergy-stats` and composing.

## "Make it better" — quick wins (done in this pass)

- **Prompt now teaches the metadata commands + the breadth→depth pattern** (`prompts.py`).
  The agent previously didn't know `synergy-stats/tree/job/folder/schema` existed in the
  prompt (only the skill), so it brute-forced per-folder `list-files` (a real run did ~8).
  Pure prompt — zero deploy risk.
- **Honest sampling disclosure** in `synergy-stats` — adds `sample_coverage_pct` and a
  note so the type/size mix isn't read as exact when coverage is low.

## Gap analysis

### BREADTH — find any set of jobs by criteria

- **Have:** semantic similarity + 3 structured filters (`created_date`, `parent_job_id`, `is_template`).
- **Missing:**
  - **Tenant attribute filtering** (Job Type / Status / Client / Region / PM). API **yes** —
    `GET /Attributes/getStandardJobSearchAttributes` + `RetrieveAttributes` on `/jobs/search`;
    just not stamped. _Biggest unlock (value high / effort large)._
  - **Exhaustive enumeration** — Bedrock Retrieve is top-K by similarity; there's no
    "list/count ALL jobs where status=active" mode. `/jobs/search` paginates, but the
    answer should come from a structured index, not the KB.
- **Unlock:** stamp `Attributes[]` into the JOB# row + rollup sidecar. Low-cardinality
  (Type/Status/Region) → scalar sidecar + Bedrock metadata clause; high-cardinality
  (Client/PM) → JOB# row + Python post-filter (dodges Bedrock's ~1000-value `equals` ceiling).

### DEPTH — deep-dive one job

- **Have:** full file enumeration, bounded recursive walk, exact `TotalRows`, job/folder/file metadata, schema.
- **Missing (ranked by value÷effort, all small, all in `synergy_helpers.py`):**
  1. **Tasks** — `GET /tasks/getTaskList/{job_id}` + `POST /tasks/search` (API **yes**). Who owns what, due dates.
  2. **Contacts / PM mapping** — `GET /Contacts/{id}/true/true` via `task.item_owner` (API **yes**).
  3. **File version history** — `GET /files/{id}/history/...` (API **yes**).
  4. **Folder-scoped + date/ext file filters** (API **partial** — post-filter).
  5. **Issues / Forums** — `GET /jobs/{id}/getForums` (forums **yes**; issues/clash partial — Swagger check).
- **Unlock:** **Tasks + Contacts** (small, both supported) turn depth from "files only" into
  "files + people + responsibility." Then compose a one-shot `synergy-summarise` (meta +
  stats + tasks + contacts in parallel).

### CROSS-JOB — analysis & comparison

- **Have:** per-job rollups (doc-type mix as a signal); JOB# rows with scalar lifecycle metadata.
- **Missing:** portfolio aggregates / faceted counts ("council vs residential by region");
  entity frequency / co-occurrence (repeat supplier across N jobs); staleness/health flags;
  native compare.
- **API support:** aggregates **partial** (data exists, compose locally — no `/compare`/aggregate
  endpoint); entity frequency **partial** (nightly fan-out → side table); staleness/health **yes** (state-table only).
- **Unlock:** **JOB# DynamoDB + GSIs as the structured query layer.** Exhaustive counts /
  faceting / CSV export / portfolio dashboards should NOT go through Bedrock — they need GSIs
  on `created_date` / `client` / `job_type` / `status`. Depends on the same attribute-stamping write.

### Cross-cutting — the backbone decision

**The semantic KB is the wrong tool for exhaustive structured + portfolio queries.** Bedrock
Retrieve is top-K-by-similarity and caps `equals` cardinality; it answers "jobs _like_ X," not
"_all_ jobs where Status=Active AND Region=NY" or "count by type." The clean architecture is
**two complementary read layers off one crawl write:**

- **KB (semantic):** "find jobs similar to…", "documents mentioning…". Keep as-is.
- **JOB# DynamoDB + GSIs (structured/exhaustive):** counts, faceting, export, dashboards,
  staleness. Deterministic, no embeddings, no latency.

Both fed by stamping tenant attributes once at crawl time — **one write, two read paths**, not a rebuild.

## Recommended sequence

1. **Prompt/skill edit** — done (kills the manual fan-out today, zero deploy risk).
2. **Tasks + Contacts depth tools** (`synergy_helpers.py`, small, API=yes) → biggest depth gain;
   then composed `synergy-summarise`.
3. **Stamp tenant `Attributes[]`** into JOB# row + rollup sidecar (the shared write) + cheap
   rollup metrics/freshness → unlocks breadth (semantic+structured fusion) and the structured layer.
   _(This is the deferred P3-2.)_
4. **JOB# GSIs + faceted-query Lambda** (counts / export / portfolio) reading the stamped attributes
   → the cross-job + exhaustive-breadth payoff.

## Scale changes things (8TB raw / ~200GB text / tens of thousands of jobs)

cuttriss is the shape to design for: ~8TB raw → ~200GB _text_ → on the order of
**millions of extracted docs** and **tens of thousands of jobs**. This doesn't
overturn the plan — it makes parts of it **mandatory** and adds one cost decision.

- **Structured layer is no longer optional — it's required.** "Count/list ALL jobs
  where Status=Active AND Region=Wgtn" over ~10k–100k jobs CANNOT come from Bedrock
  (top-K, cardinality caps). It must be DynamoDB `JOB#` + GSIs. Scale converts the
  "dual backbone" from a nice-to-have into the only correct design.
- **Cross-job aggregates must be precomputed, not fanned-out.** The agent manually
  calling `synergy-stats` per job is fine for 2 jobs, impossible for 50k. Portfolio
  counts / entity frequency / staleness → nightly batch into aggregate rows, read
  instantly. On-demand fan-out only for a handful of explicitly chosen jobs.
- **Embedding strategy becomes a real cost decision (~$1k one-time + ~millions of
  vectors + re-embed on change).** Three options:
  1. **Full-text KB** (embed all ~200GB) — cross-job _semantic_ content search over
     every document. Most capable, most expensive; relies on the incremental
     watermark/sha gating (already built) to keep steady-state cost down.
  2. **Rollup-centric KB** (embed only the ~tens-of-thousands of per-job rollups,
     ~that many vectors) + **live job-scoped `/files/search`** for document content +
     structured layer for everything else. ~100× cheaper to embed; loses cross-job
     _semantic_ document search (you still get cross-job _similarity_ via rollups and
     in-job content search live).
  3. **Tiered** — always embed rollups; embed full text only for recent/active jobs
     (or on first deep-dive), aging others out. Best cost/value if cross-job document
     semantic search is only needed on a live subset.
- **The crawler's existing design is validated by scale** — SQS FIFO, per-job
  watermark + sha gating, partial-continuation, per-type size caps (PDF 10MB etc.),
  credit metering. The initial 8TB crawl is the heavy one-time cost; steady-state is
  incremental. Keep all of it; it's why this is feasible at all.
- **Credit metering (already built) matters more** at this scale — the embed spend is
  real money; the admin should see and bound it.

Net: scale **strengthens** the dual-backbone recommendation and **adds the
embedding-strategy choice** (full-text vs rollup-centric vs tiered) as the cost lever.

## The one decision for the lead

**Commit to the dual-backbone model** — KB for semantic, JOB# DynamoDB + GSIs for
structured/exhaustive/portfolio, fed by a single attribute-stamping write at crawl time. The
alternative (forcing exhaustive/aggregate queries through Bedrock) keeps returning top-K samples
for "list/count ALL" questions and silently misleads on portfolio/compliance asks. Decide GSI key
design (`created_date`, `client_name`, `job_type`, `status`) and the low-card vs high-card attribute
split together — that one decision fixes both the DynamoDB schema and the Bedrock metadata budget.
