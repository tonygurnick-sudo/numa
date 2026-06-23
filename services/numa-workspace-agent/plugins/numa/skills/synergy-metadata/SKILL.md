---
name: synergy-metadata
description: Read Synergy 12d structure, counts, and the job attribute schema — use instead of listing everything, and to answer "how many / what fields / how big" questions.
---

# Synergy metadata & stats

Synergy 12d holds rich structure beyond file contents. These read-only commands
surface it cheaply (single API calls, the user's own permissions). Prefer them
over enumerating everything — a full `list-files synergy` on a large instance is
slow and gets truncated.

## Commands

- `numa integrations synergy-job <job-id> -m "..."` — one job's child counts
  (sub-jobs / folders / 12d projects / forums) **and** its attributes (type,
  status, dates, custom fields). Use for "what's in this job / how big / what
  type is it".
- `numa integrations synergy-folder <folder-id> -m "..."` — a folder's subfolder
  and file **counts** (+ first-page size) in one call. Use for "how many files
  in here" without listing them.
- `numa integrations synergy-schema [--mode job|file|contact|types|categories|find|choices] [--entity job|file|contact] [--name <attr>] [--type-name <enum>] [--extension <ext>] -m "..."`
  — the filter/report **vocabulary**. The zero-arg default is the job attribute
  set (standard + searchable fields). Use this first when the user asks to filter
  or report on a field, so you know what's available and its valid values. The
  extra modes make structured filtering self-describing:
  - `--mode types` — decode the numeric enums (`attributeTypes`,
    `attributeMatchOperations`, `entityTypes`, `fileTypes`, `folderTypes`,
    `folderStates`, `noteTargetTypes`). Use to read what an attribute's numeric
    `type` means, or the valid match operations for a filter. `--type-name <enum>`
    resolves any named enum.
  - `--mode choices --name "<attr>"` — the valid **enum picklist** for an
    attribute (the values you may filter by). Use before filtering on an
    enum/dropdown field so you pass a value that exists.
  - `--mode find --name "<attr>" [--entity job|file|contact]` — confirm one
    attribute exists and read its exact type before filtering.
  - `--mode file` / `--mode contact` — the searchable + system attributes for
    files / contacts (the file/contact filter vocabulary). `--extension dwg`
    scopes file attributes to an extension.
  - `--mode categories` — the category taxonomy you can filter/group by.
- `numa integrations synergy-stats <job-id> -m "..."` — **aggregate stats** for a
  job from a bounded recursive walk: total folders/files, file-type mix, size
  buckets, largest file, depth. Use for "what's this job made of / how big / what
  kinds of files". (Counts are exact; the type/size mix is a sample — it says so.)
- `numa integrations synergy-tree <job-id> [--max-depth N] -m "..."` — the job's
  **folder outline** (path + file count per folder). Use to understand structure
  or point the user at the right folder.
- `numa integrations synergy-exact-term "<word>" ["<word2>"] [--or] [--limit N] -m "..."`
  — find every job that contains these **exact** words/codes (supplier name,
  drawing number, a standard like AS3500), ACL-enforced + exhaustive. Use for
  "which jobs mention X" or locating a code — NOT `--similar-jobs` (that's
  meaning-based, top-K). Requires the crawl/index feature.
- `numa integrations synergy-portfolio [--attr "Job Type=Council"] [--created-after <ISO>] [--exclude-templates] [--group-by "Status"] [--limit N] -m "..."`
  — **exhaustive** count/list of ALL crawled jobs by attribute (ACL-enforced).
  Use for "how many jobs are …", "list all jobs where …", and portfolio
  breakdowns (`--group-by` returns facet counts). This is the COMPLETE answer —
  unlike `files search --folder synergy --similar-jobs`, which is top-K by similarity. Requires the
  Synergy crawl/index feature (returns a clear message if it's off).

## Live reads — tasks, people, issues, workflow, history, recent changes

These commands hit 12d **live with the user's own PAT** (not the crawl index), so
they reflect the current state and respect 12d's per-user permissions. They need
**no** crawl/index feature. Status fields (workflow, issue, task, contact) are
**read-only** — you can report them, you cannot change them.

- `numa integrations synergy-tasks [<job-id>] [--task-id <id>] [--task-type-id <id>] [--mode list|detail|vocab] [--assignee-id <id>] [--include-closed] [--limit N] -m "..."`
  — a job's **tasks**: who owns each, its state, due dates, open/closed. Use for
  "what's outstanding on this job", "what's assigned to X", "what's due". Defaults
  to open tasks; `--include-closed` adds done ones. Accepts a `job:`/`folder:` id
  or bare id. Two extra modes (inferred from the id you pass, no `--mode` needed):
  - `--task-id <id>` → **detail** mode: one task with its children (subtasks) and
    history. Use for "show task 4821 / what's the full story on this task".
  - `--task-type-id <id>` → **vocab** mode: the **state vocabulary** for a task
    type — its valid states (`getTaskStates`) and initial states
    (`getInitialTaskStates`), plus the task-type list (`getTaskTypes`). Use to
    decode what a task's `state`/`state_name` means or to learn the lifecycle a
    task type can be in. (States are read-only — you can report a task's state,
    you cannot change it.)
- `numa integrations synergy-contacts [--mode job|search|get|directory|global-lists] [--job-id <id>] [--contact-id <id>] [--query <text>] [--first-name <n>] [--last-name <n>] [--email <e>] [--users-only] [--page N] [--page-size N] -m "..."`
  — **people**: contacts on a job (`--job-id`), a directory search (`--query` or
  structured name/email), or one contact's detail (`--contact-id`). Use for "who's
  on this job", "find <person>'s email", "who's the foreman". Note: the **PM /
  foreman** is often also a job **attribute** — `synergy-job` (or `synergy-portfolio`)
  may answer "who is the PM" without a contact lookup. Two extra modes (pass
  `--mode` explicitly — they take no id):
  - `--mode directory` — the **full address book**, paged (`--page`/`--page-size`,
    bounded walk). Use for "list everyone in Synergy" when you want the whole
    directory rather than a targeted search. Prefer `--query`/name search when you
    know who you're after — `directory` can be large and is paged.
  - `--mode global-lists` — the instance's **global contact lists** (shared
    distribution / address lists, not job-scoped). Use for "what global contact
    lists exist".
- `numa integrations synergy-issues [--job-id <id>] [--issue-id <id>] [--page N] [--page-size N] [--include-changes] -m "..."`
  — a job's **issues / RFIs** (`--job-id`) or one issue's detail + comments
  (`--issue-id`). Use for "what issues are open", "show RFI 1234". Status/type are
  read-only labels. `--include-changes` adds the change log (best-effort).
- `numa integrations synergy-workflow [--mode definitions|definition|instance|transition_log|diagram] [--workflow-id <id>] [--entity-id <id>] [--entity-type job|issue|task] [--instance-id <id>] [--current-state-id <id>] [--return-all] -m "..."`
  — **workflow status (READ ONLY)**: list workflow definitions, one definition,
  the **live instance state** for a job/issue/task (`--entity-id` + `--entity-type`),
  its transition log, or the stage diagram image. Use for "what stage is this in",
  "what's the approval status". You cannot advance a workflow — transitions are
  writes and out of scope.
- `numa integrations synergy-file-history <file-id> [--page N] [--page-size N] -m "..."`
  — a single file's **version history** (version, who changed it, when, change
  type). Pass a FILE id, not a `job:`/`folder:` id. Use for "who last changed this
  drawing", "what versions exist".
- `numa integrations file-info synergy <file-id> [--mode info|permission|access|by-name|version] [--name <file-name>] [--folder-id <id>] [--version N] -m "..."`
  — a single file's **metadata + access**. Default `--mode info` is the file's
  metadata (name, size, type, version, checksum, dates, `ActiveCheckout`). Extra
  modes:
  - `--mode permission` — the **caller's permission** on the file (what _you_ can
    do with it). Use for "can I edit/download this file".
  - `--mode access` — the **users and groups** with access to the file (merged).
    Use for "who can see this drawing", "who has access".
  - `--mode by-name --name "<file-name>" --folder-id <id>` — look a file up **by
    name within a folder** instead of by id. Use when the user names a file but you
    only know the folder. Both `--name` and `--folder-id` are required.
  - `--mode version --version N` — the metadata of a **specific version** of the
    file. Use for "details of version 3 of this file".
    Pass a FILE id, not a `job:`/`folder:` id. For org-wide "who has this file
    locked", read `ActiveCheckout` from the default `info` mode (see `synergy-users`).
- `numa integrations synergy-recent [--job-id <id>] [--folder-id <id>] [--days N] [--since <ISO-UTC>] [--limit N] -m "..."`
  — **what changed recently** in a job or folder (one of `--job-id`/`--folder-id`
  required; folder wins). Use for "what's changed this week", "any new files since
  Monday". `--since` overrides `--days` (default 7). This is **polling**, not
  push — there are no webhooks, so re-run when the user asks again rather than
  tight-looping.
- `numa integrations synergy-forums [--mode list|forum|categories|category|topics|topic|posts] [--job-id <id>] [--forum-id <id>] [--category-id <id>] [--topic-id <id>] [--page N] [--page-size N] [--include-permission] -m "..."`
  — a job's **forums / discussions**, drilled forum → categories → topics →
  posts. Use for "what's being discussed on this job", "read the thread about X".
  The mode is **inferred from the deepest id you pass** (topic-id → posts,
  category-id → topics, forum-id → categories, job-id → list), so you rarely need
  `--mode`. Accepts a `job:`/`folder:` id for `--job-id`.
- `numa integrations synergy-projects [--mode find|list|get|folders|file-info|associations|notes|permission|history|changed-elements|latest-change|preview] [--project-id <id>] [--job-id <id>] [--folder-id <id>] [--name <n>] [--version N] [--page N] [--page-size N] -m "..."`
  — the embedded **12d Model projects** (the `Sub12dProjects`/`TDJobs` nested
  inside a Synergy job/folder): find/list them, get one's metadata, browse its
  sub-folders, read a file inside it, its associations/notes/permission, walk its
  change history / changed elements, or fetch its preview image. **Job vs 12d
  project:** a Synergy **job** is the org unit users usually mean by "project" —
  for those use `synergy-list` / `synergy-search` / `synergy-job`. A **12d
  project** (this tool) is the 12d Model _software_ project embedded inside a
  job/folder. They are different entities with different ids — never pass a job id
  where a `--project-id` is wanted, or vice-versa. Mode is inferred: `--project-id`
  → get, `--job-id`/`--folder-id` → list, `--name` → find.
- `numa integrations synergy-transmittals [--mode types|sets|set|issue|discover|attributes] [--job-id <id>] [--type-id <id>] [--set-id <id>] [--issue-id <id>] [--version N] -m "..."`
  — **issued files / transmittals** on a job: the two-level drill is file-set
  **types** → **sets** (versioned bundles) → **issues** (publish/transmittal
  events) → published files + recipients. Use `--mode discover --job-id <id>` to
  list a job's transmittals in one call, then `--mode issue --issue-id <id>` for
  one publish event's files and recipients. **Naming caveat:** an issued-files
  "issue" is a _transmittal publish event_, NOT an issue-tracking RFI (that's
  `synergy-issues`) — don't pass an RFI id here or an issue_id there. Binary
  transmittal/zip downloads are excluded; this tool reports whether one is
  available so you can fetch it separately.
- `numa integrations synergy-companies [--mode list|get|jobs|staff|schema] [--company-id <id>] [--limit N] -m "..."`
  — **companies / organisations**: list all (`list`), one company + attributes
  (`get`), a company's jobs (`jobs`), its staff/contacts (`staff`), or the
  company-attribute vocabulary (`schema`). Use for "what jobs does ACME have",
  "who works at ACME". Pairs with `synergy-contacts` (each contact carries a
  `companies[]` back-reference). Some instances expose no list-all endpoint — if
  `list` returns empty, fetch a company by id, via its jobs, or via a contact
  record. Mode is inferred from `--company-id`.
- `numa integrations synergy-webforms [--mode enabled|definitions|fills] [--job-id <id>] [--task-id <id>] [--task-type-id <id>] [--file-id <id>] [--definition-id <id>] [--fill-id <id>] [--output-files] [--search] [--user-id <id>] [--page N] [--page-size N] [--limit N] -m "..."`
  — **webforms**: `enabled` checks the feature is on for the instance;
  `definitions` lists form **definitions** (the field/question structure) by
  job/task/task-type or one by id; `fills` lists form **fills** (submissions +
  their captured answers) by job/file/task, a server-side `--search`, or one by
  `--fill-id`. Use for "what forms were submitted on this job", "show submission
  1234". `--fill-id … --output-files` lists a submission's generated files — then
  pull the bytes with `download-file`. Mode is inferred (a `--fill-id`/`--file-id`
  → fills, a `--definition-id` → definitions, a `--job-id` alone → fills).
- `numa integrations synergy-job-extras --section team|roles|reports|report|report_inputs|clashes|clash_items|clash_report|dashboard|job-roles|categories|job-file-attributes [--job-id <id>] [--entity-id <id>] [--entity-type <enc>] [--report-type <t>] [--report-id <guid>] [--folder-id <id>] [--clash-id <id>] [--report-format csv|pdf] [--users-only] [--limit N] -m "..."`
  — heavier job/entity/folder reads grouped behind a required `--section`: the job
  **team** (members + roles) and `roles` (the role-id → name reference); server
  **reports** (`reports` = catalog or entity-scoped list, `report` = one report's
  definition, `report_inputs` = what `generateReport` would require); and **clash
  detection** (`clashes` = clash sets for a folder's federated model,
  `clash_items` = items within one clash, `clash_report` = the binary report,
  staged as a download). Use for "who's on this job's team", "what reports are
  available", "show the clashes in this model". All writes (generate report,
  start/delete clash, update team) are excluded. Job-header reads (all need
  `--job-id`):
  - `--section dashboard` — the job's **dashboard header** (the summary panel a
    user sees when they open the job). Use for "give me the job overview / header".
  - `--section job-roles` [`--users-only`] — the job's **role assignments** (who
    holds which role _on this specific job_; `--users-only` restricts to users).
    Distinct from `--section roles`, which is the instance-wide role-id → name
    reference. Use for "who is the <role> on this job".
  - `--section categories` — the job's **categories** (the category taxonomy
    applied to this job). Use for "what categories is this job tagged with".
  - `--section job-file-attributes` — the **file attributes** defined on this job
    (the per-job file-attribute schema). Use for "what file attributes can this
    job's files carry".
- `numa integrations synergy-notes [--section notes|associations] --target-id <id> [--target-type <enc>] [--scope job|file|folder|project] [--note-id <id>] [--include-message] [--expected-type <enc>] [--count-only] -m "..."`
  — **notes & associations** on any entity (a job/file/folder/12d-project):
  "what's attached to / linked from this?". `--section notes` (default) returns
  note headers + bodies; `--section associations` returns linked entities. Pass
  `--scope job|file|folder|project` to use the convenience path so you don't need
  the numeric entity-type enum. `--count-only` returns just the count cheaply;
  `--note-id` fetches one note's full message. Use for "any notes on this
  drawing", "what's linked to this job".
- `numa integrations synergy-status -m "..."`
  — **connection-health / PAT-validity probe**: a single read that rolls up
  instance reachability (`/health`), the API version, the server id, and whether
  the user's stored PAT is still valid (plus days remaining) into one `healthy`
  verdict. Use this when another Synergy command failed with an auth/credential
  error (to tell "instance down" from "PAT expired"), or to answer "is my Synergy
  connection working". Takes no other params — it always probes the current
  connection.
- `numa integrations synergy-users [--mode lookup|checkouts|module] [--user-id <id>] [--job-id <id>] [--module <name>] -m "..."`
  — **users**: `lookup` resolves a user id (surfaced by a task owner / issue
  assignee / checkout holder) into a name/email; `checkouts` lists the **caller's
  own** active file/folder checkouts within a job (PAT-scoped — it is NOT an
  org-wide "who across the company has this locked" view); `module` checks whether
  the caller has access to a named license module. For who-holds-a-specific-file
  org-wide, read `ActiveCheckout` via `synergy-file-info` instead. Mode is
  inferred from the id you pass.
- `numa integrations synergy-resolve [--mode link|path|weblink] [--link <synergy-or-web-link>] [--path <12d-path>] [--entity-id <id>] [--entity-type <enc>] -m "..."`
  — **resolve a pasted 12d link or path to an entity (+ a clickable URL)**. When a
  user pastes a `synergy://…` link, a Synergy web URL, or a 12d path and asks
  "what is this / open this / which job is this", turn it into a concrete entity
  reference so you can then read it with the right tool. Modes (inferred from what
  you pass):
  - `--mode link --link "<synergy:// or https web link>"` — parse the link into an
    entity reference (id + type), then best-effort produce its web URL.
  - `--mode path --path "<12d path>"` — find the entity at a given 12d path
    (e.g. a job/folder path) and return its id + type.
  - `--mode weblink --entity-id <id> --entity-type <enc>` — build the **clickable
    web URL** for an entity you already have the id + type for. Use to hand the
    user a link they can open in 12d.
    Once resolved, follow up with the entity-specific tool (`synergy-job`,
    `synergy-folder`, `synergy-file-info`, …) using the returned id. These are
    read-only link/path lookups — they resolve, they don't change anything. Some
    instances' link/path response shapes are undocumented, so it degrades with a
    clear note if a field can't be parsed.

## When to use vs file browse

- "How many jobs / files …" → you usually don't need to list them. Counts come
  from `synergy-folder` (per folder) or the `total_count` already returned by
  `list-files` / `search-files`.
- "What fields can I filter on / what's the job type / status" → `synergy-schema`
  then `synergy-job`.
- "Show me the actual files" → `numa integrations list-files synergy --folder-id job:<id>`.
- Big instance, unfiltered list timed out → narrow with a name query
  (`search-files synergy "<term>"`), don't re-list.

## Examples

Bash: numa integrations synergy-job 22153 -m "Checking the Kakaho job's structure"
Bash: numa integrations synergy-folder folder:1234 --json -m "Counting files in this folder" | jq '.file_count'
Bash: numa integrations synergy-schema --json -m "Finding which job fields the user can filter on"
Bash: numa integrations synergy-tasks job:22153 -m "Listing open tasks on the Kakaho job"
Bash: numa integrations synergy-contacts --query "Smith" -m "Looking up Smith in the contact directory"
Bash: numa integrations synergy-issues --job-id 22153 -m "Listing open issues on this job"
Bash: numa integrations synergy-workflow --mode instance --entity-id 22153 --entity-type job -m "Checking this job's workflow stage"
Bash: numa integrations synergy-file-history 998877 -m "Who last changed this drawing"
Bash: numa integrations synergy-recent --job-id 22153 --days 7 -m "What's changed on this job this week"
Bash: numa integrations synergy-schema --mode choices --name "Job Type" -m "Listing the valid Job Type values to filter on"
Bash: numa integrations synergy-schema --mode types --json -m "Decoding the attribute type and folder-state enums" | jq '.folder_states'
Bash: numa integrations synergy-forums --job-id 22153 -m "Listing the discussion forums on the Kakaho job"
Bash: numa integrations synergy-forums --topic-id 5012 -m "Reading the design-query thread"
Bash: numa integrations synergy-projects --job-id 22153 -m "Listing the 12d Model projects embedded in this job"
Bash: numa integrations synergy-transmittals --mode discover --job-id 22153 -m "Listing this job's transmittals / issued files"
Bash: numa integrations synergy-companies --mode jobs --company-id 50_1 -m "Listing jobs for this company"
Bash: numa integrations synergy-webforms --mode fills --job-id 22153 -m "What forms were submitted on this job"
Bash: numa integrations synergy-job-extras --section team --job-id 22153 -m "Who's on this job's team"
Bash: numa integrations synergy-notes --target-id 22153 --scope job -m "Any notes attached to this job"
Bash: numa integrations synergy-status -m "Checking whether the Synergy connection and PAT are healthy"
Bash: numa integrations synergy-users --mode lookup --user-id 8_1 -m "Resolving this user id to a name and email"
Bash: numa integrations synergy-tasks --task-id 4821 -m "Reading task 4821's detail, children and history"
Bash: numa integrations synergy-tasks --task-type-id 3_1 -m "Listing the valid states for this task type"
Bash: numa integrations synergy-contacts --mode directory --page 1 --page-size 50 -m "Paging the full Synergy address book"
Bash: numa integrations file-info synergy 998877 --mode access -m "Who has access to this drawing"
Bash: numa integrations file-info synergy --mode by-name --name "site-plan.dwg" --folder-id folder:1234 -m "Finding this file by name in the folder"
Bash: numa integrations synergy-job-extras --section dashboard --job-id 22153 -m "Reading the Kakaho job's dashboard header"
Bash: numa integrations synergy-job-extras --section job-roles --job-id 22153 -m "Who holds which role on this job"
Bash: numa integrations synergy-resolve --link "synergy://.../job/22153" -m "Resolving this pasted 12d link to a job"
Bash: numa integrations synergy-resolve --mode weblink --entity-id 22153 --entity-type 1 -m "Building a clickable 12d URL for this job"
