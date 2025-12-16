# Claude Code Skills

## What Are Skills?

Skills are **on-demand documentation** that Claude automatically discovers and uses when relevant. Unlike slash commands (which you type manually like `/lint-and-tests`), skills are **model-invoked** — Claude reads your request and decides when to use them.

## How Discovery Works

1. **At startup**, Claude scans `.claude/skills/*/SKILL.md` and extracts just the `name` and `description` (~100 tokens per skill)
2. This metadata is injected into Claude's system prompt as an index
3. **When you ask a question**, Claude matches your request against skill descriptions
4. **If relevant**, Claude loads the full skill content on-demand
5. Supporting files (detailed guides) are only read when needed

```
You: "How do I create a new Numa app?"
     ↓
Claude: Matches against numa-apps skill description
     ↓
Claude: Loads SKILL.md → sees references to apps-creating.md
     ↓
Claude: Reads apps-creating.md for detailed instructions
     ↓
Claude: Provides accurate, up-to-date guidance
```

## Where Skills Live

```
.claude/skills/
├── skill-creator/          # Meta-skill for creating new skills
│   └── SKILL.md
├── numa-apps/              # Numa app development skill
│   ├── SKILL.md
│   ├── apps-creating.md
│   ├── apps-backend-orchestration.md
│   └── apps-frontend-integration.md
└── numa-agents/            # Numa agents skill
    ├── SKILL.md
    ├── agents-overview.md
    ├── agents-frontend.md
    ├── agents-backend.md
    └── agents-database.md
```

## How to Use Them

**You don't invoke skills manually.** Just ask naturally:

| Your Question | Skill Activated |
|---------------|-----------------|
| "How do I create a new Numa app?" | `numa-apps` |
| "What's the job status polling pattern?" | `numa-apps` |
| "How do I create an agent?" | `numa-agents` |
| "What's the agent database schema?" | `numa-agents` |
| "Create a skill for X" | `skill-creator` |

## Available Skills

### 1. `skill-creator`

Helps Claude create new skills with proper conventions.

**Activated by:** "create a skill", "add a skill", "make a new skill"

### 2. `numa-apps`

Comprehensive guide to Numa app development.

**Activated by:** "create an app", "Step Function", "jobs", "manifest", "BaseNumaApp", "app construct"

**Contains:**
- `apps-creating.md` — Step-by-step guide to creating new apps (traditional & Claude Code apps)
- `apps-backend-orchestration.md` — Step Functions, jobs system, S3/DynamoDB storage, status polling
- `apps-frontend-integration.md` — React components, services, state management

### 3. `numa-agents`

Complete guide to Numa agents (AI chat wrappers with custom prompts and tools).

**Activated by:** "create an agent", "agent builder", "AgentCreateModal", "agent API", "agent database", "agent tools config", "agent visibility"

**Contains:**
- `agents-overview.md` — How agents work as chat wrappers (not separate AI models)
- `agents-frontend.md` — Agent builder form, UI components, services, types
- `agents-backend.md` — CRUD APIs, chat integration, intent verification, security
- `agents-database.md` — DynamoDB schema (3 tables), S3 storage patterns, access patterns

## Benefits

- **Always up-to-date**: Skills live in the repo, updated with the code
- **Team-shared**: Committed to git, everyone gets them on pull
- **Context-efficient**: Only loads what's needed
- **Accurate**: Verified against actual codebase, not hallucinated

## Adding More Skills

To create a new skill, just ask Claude: *"Create a skill for [topic]"* and it will use the `skill-creator` skill to scaffold it properly.

### Manual Creation

1. Create directory: `.claude/skills/my-skill/`
2. Create `SKILL.md` with YAML frontmatter:

```yaml
---
name: my-skill
description: Brief description. Use when [trigger keywords].
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# My Skill

Instructions and quick reference here...
```

3. Add supporting files as needed (e.g., `detailed-guide.md`)
4. Commit to git

### Naming Conventions

- Lowercase letters, numbers, and hyphens only
- Maximum 64 characters
- Descriptive but concise

**Good:** `numa-apps`, `numa-agents`, `code-reviewer`, `lambda-creator`
**Bad:** `Numa Apps`, `CodeReviewer`, `my_skill`
