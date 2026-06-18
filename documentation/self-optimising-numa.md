# Self-Optimising Numa

**Status:** in build (FEAT-243) · **Owner:** Nathan

Numa should get cheaper and more reliable the more a user uses it. The mechanism
is **compounding**: Numa notices recurring, deterministic work and captures it as
a saved workflow (runnable code, zero LLM tokens), and notices durable facts about
the user and captures them as memories. Each run then starts from more capability
and more context than the last. Over time a user ends up with their own customised
Numa — one that costs fewer credits and makes fewer mistakes on the jobs they
actually repeat.

This is a **platform pattern**, not a one-off feature. Any surface that runs an
agent — scheduled runs, agent types, app runners — should carry reflect-and-
compound prompting. This doc is the reference for how it works and how to extend
it.

---

## Two layers that compound

| Layer               | Captures                                                           | Where it lives                                                                 | Token cost to reuse    |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------- |
| **Saved workflows** | _mechanics_ — data pulls, transforms, rendering, delivery          | `/workdir/chat-workflows/` (user) · `/workdir/agent-workflows/` (per-agent)    | ~zero (it's just code) |
| **Memories**        | _context_ — integration gotchas, preferences, recurring exceptions | `userProfile.memories`, scoped `general` / `integration:<slug>` / `agent:<id>` | cheap (a prompt line)  |

Workflows make the steps free; memories stop you re-learning the same things.
Both are surfaced back into every future conversation automatically.

## Two directions of optimisation

1. **New recurring work** — automate a job the first time it looks repeatable.
2. **Maintenance loops** — when a user keeps asking you to refresh/update something
   you already made (a dashboard, a report), script the refresh path.

## The one rule that keeps it safe: script mechanics, never judgment

Scripting is **encouraged, never compulsory.** The test: _would you do this step
identically next time, given different inputs?_ If yes → mechanics, script it. If
it needs reading, weighing, interpreting, or writing prose → judgment, keep doing
it live. A workflow is an accelerator, not a contract: the agent verifies its
output every run and deviates freely when inputs look unusual. We are **not**
turning agents into robots that can't think — the convergence target is a run
that's mostly script execution plus a little live judgment, never all-script.

---

## How it works today

### Scheduled agents (the biggest prize)

`lambdas/node/agent-schedule-runner/index.ts` builds a per-run preamble
(`buildScheduledRunPreamble(agentId, costFeedback)`) that, after the status
report, asks two **mandatory-to-consider, optional-to-act** questions:

- **SCRIPT** — was anything deterministic? If so, save/update a workflow (to
  `/workdir/agent-workflows/` when it exists, else a `chat-workflows/<slug>/`
  subfolder). Never script judgment.
- **REMEMBER** — did this run teach something durable? If so,
  `numa memory add … --scope agent:<id>` (confirm-first waived — no user present;
  bar = "would the next run be slower or wrong without it?"). The agent's own
  memories are already injected into its context, so save→use is a closed loop.

The agent records what it saved in an optional `optimised: []` field of
`status.json`. The runner parses it (`readWorkspaceStatus`) and emits a
`[SELF_OPTIMISE]` structured log pairing `optimised[]` with the prior runs' cost
stats.

**Cost feedback.** When the client has the credits view on (`SHOW_CREDITS`), the
preamble carries a live line — "recent runs of this schedule averaged N credits"
— read from the credit ledger (`fetchScheduleCostFeedback`, a BatchGet over the
schedule's rolling `recent_run_conversation_ids`). Metering runs for every client;
the **figure** is gated on `SHOW_CREDITS` so we never surface credit numbers to a
client whose admin keeps credits hidden. The script/remember prompting itself is
unconditional.

### Chat (active, not passive)

`prompts.py:_build_saved_workflows_context()` lists the user's (and, for agent
chats, the agent's) workflows and injects active **save triggers**: second-time,
maintenance-loop, real-effort (~40+ lines), calendar-smell. The proactive
**memory** triggers live in the Agents & Memories prompt section + the `memories`
skill: corrections, repeated context, integration gotchas — with scope guidance
(`agent:<id>` for agent-specific facts, `general` for user-wide).

### Agent-scoped workflow library (FEAT-243, flag-gated)

Per-user-per-agent: `/workdir/agent-workflows/` ↔ S3
`numa-chat/workspace/{user_sub}/agents/{agent_id}/chat-workflows/`. Active only
when `AGENT_WORKFLOWS_ENABLED` (client config) **and** the conversation has an
`agentId`. The active agent scope is captured once per request
(`workspace.set_active_agent_id`, read via `get_agent_workflows_scope`) and the S3
sync layer + prompt builder pick it up — no `agent_id` threading through sync
signatures. Cross-user sharing is deliberately **not** here: that arrives via the
publish/promotion flow (see Part 2), not a shared writable prefix.

### What's reused, not rebuilt

Saved workflows, the write-guard (`hooks/workflow_guard.py`), the prompt
injection, and agent-scoped memories all already existed. FEAT-243 adds the
reflection contract, the active triggers, the `saved-workflows` skill, cost
feedback, and the agent-scoped library on top.

---

## Key files

| Concern                                                                      | File                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled reflect/remember preamble, `optimised[]`, cost feedback, telemetry | `lambdas/node/agent-schedule-runner/index.ts`                                                                                                               |
| Runner env/IAM, `SHOW_CREDITS`, `AGENT_WORKFLOWS_ENABLED` flag               | `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts`, `infra/constructs/workspace-chat-agent-construct.ts`, `infra/stacks/numa-client-stack.ts` |
| Chat triggers + agent-workflow table                                         | `services/numa-workspace-agent/numa_workspace_agent/prompts.py`                                                                                             |
| Workflow libraries (list/format/validate)                                    | `…/numa_workspace_agent/saved_workflows.py`                                                                                                                 |
| Agent scope + dirs                                                           | `…/numa_workspace_agent/workspace.py`                                                                                                                       |
| S3 sync routing                                                              | `…/numa_workspace_agent/s3_workspace.py`                                                                                                                    |
| Write guard (both libraries)                                                 | `…/numa_workspace_agent/hooks/workflow_guard.py`                                                                                                            |
| Authoring guidance                                                           | `…/plugins/numa/skills/saved-workflows/SKILL.md`, `…/skills/memories/SKILL.md`                                                                              |

---

## Backup plan: the reflection classifier (Approach 2)

Approach 1 above is pure prompting. If HQ testing shows scripting-friendly
schedules producing no `optimised[]` entries within a few runs, build **Approach
2**: a post-run cheap-model classifier (Nova Lite / Haiku-class via the existing
`assistant.py` pattern) that, for scheduled runs only, sees the run tail + current
workflows + current memories and returns `{should_act, reasoning}`; on _yes_ it
injects one bounded "consider this — ignore if not useful" turn. The agent keeps
its veto. This is **specced, not built** — design lives in
`dev-notes/tasks/self-optimising-numa/spec.md`. (Implemented as our own post-loop
step, not an SDK Stop hook: the SDK currently registers only PreToolUse /
PostToolUse / PreCompact.)

---

## Part 2 — don't forget (workflows as mini-apps)

Chat self-optimisation will eventually suggest **credit-free surfaces**, not just
scripts: publish a workflow → schedule/trigger it (Automation) or host it with a
UI (App), with presentation modes (run / view / fill) and a bounded `numa ai`
node for a pinch of judgment. The saved-workflow frontmatter is the seed of that
manifest, so keep it **manifest-compatible** — future fields are
`capability_scope`, `presentation_mode`, `inputs`, `version`. Cross-user sharing
arrives through publish/promotion (reviewed), never a shared writable prefix. Full
vision: `dev-notes/research/scripts-workflows-etc/workflows-as-mini-apps-vision.md`.

Related future work (tracked in `dev-notes/tasks/self-optimising-numa/spec.md`):
ordering surfaced workflows by last-executed; a nightly mining agent that reads a
user's conversation history to propose deterministic workflows and surface them on
a dashboard.
