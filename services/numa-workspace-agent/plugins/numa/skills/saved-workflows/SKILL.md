---
name: saved-workflows
description: Author, run, repair, and retire saved workflows — reusable scripts in /workdir/chat-workflows/ (and /workdir/agent-workflows/ for agents) that persist across a user's conversations and run with zero LLM tokens. Load when saving a repeatable job as a workflow, deciding whether something should be scripted at all, parameterising a script, fixing a stale workflow, or wiring a workflow into a scheduled agent.
---

# Saved Workflows

A saved workflow is an ordinary executable script (Python by default, Bash works
too) that you write once and re-run forever. It lives in a persistent directory,
syncs to the user's S3, and is surfaced back to you — by name + description — in
every future conversation. Running one costs **zero LLM tokens**: it's just code.

This is how Numa compounds. The first time you work out a recurring job, you do it
the slow way. If it's the same job every time, you save the mechanical spine as a
workflow so the next run is `run script → verify output → handle the exceptions`.
Over many runs the cost falls and the reliability rises.

**Workflows are not a replacement for thinking.** They capture the parts that are
identical every run. The judgment stays with you, live, every time. Read §1
before you save anything.

---

## 1. When to script — and when NOT to

Scripting is **encouraged, never compulsory.** On many requests the right answer
is to save nothing. The test is simple:

> Would you do this step **identically** next time, given different inputs?
> If yes → it's mechanics, script it. If it needs reading, weighing, or deciding
> → it's judgment, keep doing it live.

**Script the mechanics:**

- Fixed data pulls (the same `numa` queries / integration calls every run)
- File and format transformations (parse this shape → produce that shape)
- Rendering with fixed parameters (the same chart, the same report layout)
- Delivery to a fixed destination (save here, email there, post to that channel)

**Never script the judgment:**

- Choosing what matters in a digest, or which anomalies to escalate
- Writing prose, summaries, recommendations, or anything a person reads for meaning
- Interpreting ambiguous or unusual input
- Anything where "it depends" is the honest answer

**You still own the outcome.** A workflow is an accelerator, not a contract. Every
time you run one: read its output, sanity-check it, and deviate without hesitation
when the inputs look unusual, the script errors, or the task has drifted. Never
trade correctness for speed or a lower credit cost.

### Save triggers — act on these, don't wait to be asked

- **Second time:** the request resembles something you've done for this user before
  (or nearly matches an existing workflow) → save or update one as you finish, and
  say so in a line.
- **Maintenance loop:** they ask you to refresh/update something you built before (a
  dashboard, report, doc) → script the refresh path.
- **Real effort:** you just wrote ~40+ lines of working code for a plausibly
  recurring task → offer to save it.
- **Calendar smell:** the ask names a period ("weekly", "month-end", "quarterly")
  → save it now **and** suggest scheduling it as an agent so it runs unattended.

---

## 2. Format

Every workflow starts with a `#`-comment frontmatter block. `#` is a comment in
both Python and Bash, so the file stays directly runnable while Numa reads its
metadata _without_ executing it. **The filename is the workflow's identifier**;
the header carries the human metadata. A write without a valid header is rejected.

```python
#!/usr/bin/env python3
# --- numa-workflow ---
# title: Weekly Finance Summary
# description: Pull this week's transactions and render a summary.
#   Use when the user asks for their weekly finance update.
# created: 2026-06-12
# updated: 2026-06-12
# required_integrations: gmail        # optional, comma-separated slugs; omit if none
# --- end ---
"""Longer human notes can live here."""
import json, subprocess

def numa(*args):
    """Run a numa CLI command from Python and parse its JSON output."""
    p = subprocess.run(["numa", *args, "--json"], capture_output=True, text=True)
    p.check_returncode()
    return json.loads(p.stdout or "{}")

hits = numa("files", "search", "transactions this week", "--all", "-m", "weekly finance")
# ...process in Python, then e.g. `numa render` the result...
```

| Field                   | Required | Notes                                                                                                                                                    |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                 | yes      | ≥3 chars, human-readable                                                                                                                                 |
| `description`           | yes      | ≥10 chars — **what it does + when to use it**. This is your future self's retrieval key; make it sharp. Folds across indented `#   ` continuation lines. |
| `created`               | yes      | `YYYY-MM-DD`, set once                                                                                                                                   |
| `updated`               | yes      | `YYYY-MM-DD`, bump on every change                                                                                                                       |
| `required_integrations` | no       | comma-separated slugs (e.g. `gmail, slack`) the workflow needs — lets you pre-check availability before running                                          |

**Bash variant:** same fence, `#`-comments, shebang `#!/usr/bin/env bash`; call
`numa ... --json` and parse with `jq`.

You can call **any** `numa` command from a workflow this way (it's on `PATH`).

---

## 3. Parameterise — don't hardcode

A workflow runs again next week with _different_ inputs. Bake in nothing from
this run:

- **Dates/ranges:** compute them at runtime (`datetime.now()`, "this week",
  "last month"), never the literal dates of today's run.
- **IDs / selectors:** take them as `argv` with sane defaults, or resolve them by
  intent at run time ("the user's finance folder"), not a hardcoded ID only this
  user can see.
- **Secrets:** never. Integration credentials are injected at runtime _outside_
  the workspace — just call the integration via `numa` and they're applied for
  you. A literal-looking secret triggers a warning; remove it.

Portable workflows are also a prerequisite for the future ability to publish and
share them, so parameterising is a quality bar, not a nicety.

---

## 4. Verify-after-run and self-repair

A workflow's output gets the **same quality bar** as work you do by hand.

- **Fail loudly.** Check return codes (`p.check_returncode()`), raise on empty or
  malformed data, no bare `except`. A silent failure that ships wrong output is
  far worse than a crash you can see.
- **Verify the output** before you use it — does it look right for _these_ inputs?
- **Self-repair.** When a workflow breaks or drifts, fix it in place and bump
  `updated` — the fix compounds too. If it's beyond saving or no longer needed,
  delete it. Don't leave a broken script in the library.

---

## 5. Reuse what other skills already ship

Before hand-rolling document/spreadsheet/deck/render code in a workflow, check
whether a skill already provides it — `docx-handling`, `pptx-handling`,
`spreadsheet-handling`, `pdf-handling`, `render`, `visual-design`, etc. ship
their own helper scripts under `/app/plugins/numa/skills/<skill>/`. Importing or
shelling out to those is shorter, more reliable, and stays current as we improve
them. Treat them as the standard library; your workflow is the glue.

---

## 6. Maintenance

- **Update vs new:** if a workflow on the same job exists, improve it rather than
  adding a near-duplicate. Prefer one good workflow over three overlapping ones.
- **Cap:** only the most recent ~20 per library surface in the prompt — quality
  over quantity. A sharp `description` is what makes a workflow findable; keep it
  current when behaviour changes.
- **Retire:** delete workflows that have gone stale or stopped being used. A
  library you trust is worth more than a big one you don't.

---

## 7. Scheduled & agent runs

When you run as a **scheduled agent**, the same rules apply, plus:

- **Where to save:** if `/workdir/agent-workflows/` exists, save the schedule's
  scripts there (it's this agent's own library, shared across this user's runs of
  the agent). Otherwise save under `/workdir/chat-workflows/<schedule-slug>/`.
- **Report it:** record any workflow you create or update in the `optimised`
  array of `status.json` — one string per item (e.g.
  `"optimised": ["agent-workflows/fetch-data.py (created — pulls weekly deals)"]`).
  Leave it `[]` when nothing qualified.
- **Converge:** a mature scheduled run is mostly script execution + a little live
  judgment (exception handling, the summary). That's the goal — cheaper and more
  reliable every run — but never at the cost of correctness.
- **Remember, too:** durable facts (integration gotchas, recurring exceptions,
  owner preferences) belong in a memory (`numa memory add … --scope agent:<id>`),
  not a script. Scripts capture _steps_; memories capture _context_.
