# GitHub Mirror — Claude Code Mobile Access

## What This Repo Is

This GitHub repository is a **mirror/clone** of the primary GitLab repository used by the Arcanum AI team. It exists solely so that **Claude Code on mobile** can be used for on-the-go development — the Claude Code mobile app only supports GitHub connections.

**This is NOT the team's development environment.** The real development happens on GitLab.

## Workflow

1. Work on feature branches here in GitHub using Claude Code mobile — building real features, prototyping ideas, writing production-quality code
2. When a branch is ready, **the user** (Nathan) pulls it into the GitLab repo on their laptop
3. From GitLab, the team can review, test, run the pipeline, and merge as normal

**Claude's role:** Stay on your assigned `claude/*` feature branch. Commit and push to that branch freely. **Never merge to `main` or push to `main` unless explicitly told to.** The user handles all branch migration to GitLab — that's not something Claude needs to do.

## How We Work — Plan First, Then Build

**Do not jump straight into code changes.** Follow this process:

1. **Brainstorm** — When the user brings up a feature or idea, explore it with them. Discuss approaches, trade-offs, and alternatives. Ask questions. This is a conversation, not a command prompt.
2. **Present a plan** — Before writing any code, lay out a clear plan as plain text in the conversation. Cover what files will change, the approach, and any decisions to be made.
3. **Wait for approval** — Do not start implementing until the user says to go ahead. They might want to refine the plan, change direction, or explore more options first.
4. **Implement** — Once the user gives the green light, write the code, commit, and push.

This is especially important on mobile — the user is reading on a small screen and wants to stay in control of what gets built. Brainstorming and planning are just as valuable as the code itself.

**Exception:** Trivial changes (typo fixes, small doc updates the user explicitly asked for) can skip the full plan — use your judgement.

## What We Do Here

This is where we build cool features! The full codebase is here and we have the freedom to work on anything:

- Feature development (new features, enhancements, bug fixes)
- Code exploration and research
- Reading and understanding the codebase
- Writing and editing source code (frontend, lambdas, services, libs)
- Planning and prototyping
- Refactoring and code quality improvements

## What We Do NOT Do Here

- **No merging to `main`** — unless the user explicitly says so
- **No deployments** — no `cdktf deploy`, no pipeline triggers
- **No infrastructure operations** — no AWS CLI commands, no account management
- **No package installs** — no `yarn install`, `poetry install`, etc. (dependencies aren't set up in this environment)
- **No secrets or credentials** — AWS profiles, OAuth tokens, etc. are not available here

## Branching

All work happens on feature branches (typically `claude/*` branches). Claude stays on the assigned branch and never merges to or pushes to `main` without explicit permission. The user is responsible for migrating branches over to GitLab when they're ready.

## Mobile Quirks

This repo is primarily used via **Claude Code on mobile**. Be aware of the following:

- **AskUserQuestion tool does not work on mobile.** The interactive question component doesn't render, and selections get auto-denied. **Do not use the AskUserQuestion tool.** Instead, if you need to ask the user something: pause, list your question(s) as plain text in your message, and wait for the user to reply before continuing.
- **Plan mode approval UI does not work on mobile.** The approve/reject buttons don't render. **Do not use plan mode.** Instead, for larger tasks, write out the plan as plain text in the conversation and wait for the user to confirm before proceeding.

## Relationship to CLAUDE.md

The main `CLAUDE.md` file describes the full Numa platform, architecture, and development workflows. Everything in there is accurate for understanding the codebase, but the deployment/infra/ops instructions assume a fully configured GitLab + AWS environment which we don't have here. Use `CLAUDE.md` for understanding the code, not for running operational commands.

If you want to create documents and track tasks, use the folder agent-tasks (create folder if doesn't exist) to track task plans and work.
