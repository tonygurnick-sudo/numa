# Synergy — Exact-Term Inverted Index + 4-Mode Chat Routing (plan)

> Authored 2026-06-21. Adds a 4th Synergy search mode (exact-term) + teaches chat
> to route across all four. **BUILT 2026-06-22** (slices 1-3, 5-6; slice 4
> deliberately deferred — see below). On branch `bug/synergy-deploy`. **ON by
> default wherever `synergyKbCrawl` is on** — the quality win is the point; the
> small DynamoDB write cost is captured by the crawl's credit debit. Opt a tenant
> out with `synergyTermIndex: false`. Companion to `synergy-capability-gap-analysis.md`.
>
> **Build status:** ✅ shared tokenizer lib (Snowball) ✅ worker indexing
> ✅ term-job-index GSI + `synergyTermIndex` flag (both config schemas)
> ⏭️ slice 4 delete-mirroring SKIPPED (query-time JOB# ACL makes stale TERM rows
> safe; 365d TTL bounds storage — surgical cleanup is a follow-up, not a safety
> need) ✅ `synergy-exact-term` query tool ✅ 4-mode chat routing.
> Remaining: deploy + recrawl so existing jobs get indexed (it's on by default).
>
> **Locked decisions:** (1) **Snowball (English)** stemmer for word-like tokens;
> (2) **code-vs-word split** on "contains a digit / hyphen / dot" → code-like kept
> verbatim, word-like stemmed; (3) **dedupe terms per job in memory** — write once
> per (term, job), never per file → ~$200 first crawl, not ~$10K. DynamoDB (not
> OpenSearch); no new table/lambda.

## Why

Synergy has no cross-job search. We already give chat **semantic** (vector store),
**structured** (JOB# attributes), and **in-job** (Synergy API) search. The gap:
_"which jobs contain the literal word/code/name X"_ — exhaustively. The vector store
is top-K-by-meaning, so it can't reliably return ALL jobs containing an exact token
(a drawing number, a supplier name, a standard like AS3500). An inverted index does.

## 1. How it builds (in the crawl — "for free")

Piggybacks on the worker's existing text extraction — no extra Synergy read, no
Bedrock call. After `_process_file()` extracts text, tokenize and write term rows.

**Tokenizer (shared util, byte-identical in crawler + query handler).** Pipeline,
in order:

1. Lowercase; match `\b[a-z0-9][a-z0-9_\-.]{1,49}\b`.
2. Drop ~80 stopwords + pure-numeric noise.
3. **Classify each token:**
   - **Code-like** (contains a digit, hyphen, or dot — e.g. `dwg-2401`, `as3500`)
     → keep **verbatim, never stem**. This is exact-term mode's killer feature;
     stemming would mangle part numbers / names / standards.
   - **Word-like** (plain alphabetic) → **Snowball/Porter stem** (`walls→wall`,
     `designing→design`). Cheap (ms/file), collapses morphological variants →
     ~25–35% fewer unique terms (less write + storage) **and** better recall.
4. **Dedupe per job** (one row per (term, job), not per file) — the dominant write
   saving; stemming stacks on top of it.

Two non-negotiables: (a) the **same** stemmer + stopword list run at index time AND
query time (one shared util — drift = nothing matches); (b) the stemmer/stopwords
are **immutable post-launch** — changing them means stored terms no longer match new
queries, so it requires a full re-crawl. Lock them before enabling.

**Schema — reuse the existing state table, no new table:**

```
pk: TERM#{token}#{job_id}   sk: META
term: {token}      # GSI hash (denormalized)
job_id: {job_id}   # GSI range (denormalized)
file_ids: <StringSet>   # files in this job with the token, capped ~100
ttl: epoch + 365d
```

**GSI `term-job-index`**: hash `term`, range `job_id`, `KEYS_ONLY` → "all jobs with
token X" is one `Query`.

**Recrawl / delete (mirror existing watermark + sweep):** unchanged sha → skipped
(free); changed → union file_id (last-write-wins, no guard needed); file deleted →
Query the GSI by job_id, drop the file_id, delete the row if empty; job purged →
Query by job_id, batch-delete its TERM rows. TTL backstops orphans.

**Scale:** ~30K jobs × ~5K terms ≈ **150M rows / ~75GB**, on-demand (stemming trims
this ~25–35%). Writes are one-time per crawl, spread over hours. **Cost is governed
by per-job dedup, not term count:** write once per (term, job) ≈ **~$200 first
crawl**; writing per _file_ (common terms re-written across thousands of files)
balloons to **~$10K** — so the in-memory per-job/leg term accumulation is mandatory.
Steady-state incremental crawls (changed docs only) are cents.

**Riskiest choice — partitioning.** A global `TERM#{token}` row for "steel"/"council"
= hot partition + blows the 400KB item limit. **Mitigation (keep it): shard by job
(`TERM#{token}#{job_id}`)** — no hot key, O(1)-per-job delete, small per-row
file_ids. Cap file_ids at 100 + log (a term in 100+ files of one job is low-signal).

## 2. The query tool

New command, **no new Lambda** (handler in `workspace-chat-tools`):

```
numa integrations synergy-exact-term "term1" "term2" [--or] [--limit N] -m "..."
```

Takes `{terms[], mode: AND|OR (default AND), limit=100}`. Per term: Query
`term-job-index` → AND = intersect / OR = union of job_ids → read `JOB#{id}`, keep
only where `allowed_users` contains the caller → cap. Returns
`{jobs:[{id,name,path,matched_file_count}], count, truncated}` — **exhaustive, not
top-K; IDs not documents.** ACL applied at query time (the TERM row's acl is a hint,
never authoritative). Metered on the **existing portfolio meter**; flag-gated.

## 3. Chat routing — the four modes (the point)

**Decision guide (plain English):**

- "Which jobs contain this literal word / code / name?" → **EXACT-TERM**
- "Find jobs _like_ this one / this description?" → **SEMANTIC**
- "How many / which jobs match this attribute or date?" → **STRUCTURED PORTFOLIO**
- "What's inside _this_ job?" → **IN-JOB**
- Need exhaustive **and** ranked? → **compose: prune (Exact or Structured) → rank
  (Semantic) → drill (In-Job).**

**Worked examples:**

1. "Which jobs mention supplier ACME?" → EXACT-TERM `"acme"` (all of them, cheap).
2. "Find council retaining walls like Thornfield." → STRUCTURED `--attr "Job Type=Council"`
   (47 jobs) → SEMANTIC rank → top 5. Prune-then-rank.
3. "How many commercial jobs/year since 2023?" → STRUCTURED `--group-by` (counting only).
4. "Where is drawing DWG-2401?" → EXACT-TERM `"dwg-2401"` (3 jobs) → IN-JOB to locate the file.
5. "Jobs with 'cantilever bracket' — most similar first." → EXACT-TERM prune → SEMANTIC rank.

**Prompt snippet** (replaces the two-mode block in `prompts.py` `_synergy_section`):
the four bullets above with the exact commands + a one-line "compose: prune → rank →
drill"; note "ACL enforced server-side in every mode; EXACT-TERM returns IDs, resolve
names via synergy-job; if intent is ambiguous, ask one clarifying question."

## 4. Build sequence + decisions

Slices (flag-gated, metered, **no new Lambda, no new table**):

1. Shared `tokenize_for_index` util (the correctness lynchpin).
2. Worker indexing (`_index_file_terms`, gated).
3. Infra: add the `term-job-index` GSI to the state table.
4. Delete/purge mirroring for TERM rows.
5. Query handler `synergy-exact-term` + CLI + metadata.
6. Prompt: replace the two-mode block with the four-mode guide.
7. Enable flag → recrawl rebuilds the index.

**Decisions for the lead:**

- **Inverted index vs fold-into-portfolio-scan:** reject the scan (JOB# rows hold no
  full text; substring filter is O(n), no token semantics). Index is right — but it's
  the heaviest slice; ship behind the flag and **measure write cost on one real
  tenant before enabling broadly.**
- **DynamoDB vs OpenSearch:** stay on **DynamoDB** — we only need exact token → job
  IDs, which a sharded GSI does for ~$0 incremental. Revisit OpenSearch only for
  phrase/fuzzy/scoring.
- **Tokenizer rules:** lowercase → drop stopwords/numeric → **code-like (has digit/
  hyphen/dot) verbatim, word-like Snowball-stemmed** → dedupe per job. Stemmer +
  stopwords are **immutable post-launch** (changing them needs a recrawl); leave a
  tenant-regex escape hatch as a future env var, default off. **CONFIRMED:** Snowball
  (English) stemmer; code-vs-word split on `[has digit/-/.]`; per-job in-memory dedup.

**Effort: medium.** Only slices 2–3 carry operational risk (crawl write volume) —
de-risked by the flag + a single-tenant pilot.
