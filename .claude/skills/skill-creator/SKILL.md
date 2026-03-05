---
name: skill-creator
description: Create new Claude Code skills with proper structure and conventions. Use when the user asks to create a skill, add a skill, make a new skill, or set up agent capabilities.
allowed-tools: Read, Write, Bash, Glob
---

# Creating Claude Code Skills

## What is a Skill?

A skill is a modular capability that Claude automatically discovers and uses based on context. Unlike slash commands (which require manual `/command` invocation), skills are **model-invoked** — Claude decides when to use them based on the description.

## Directory Structure

Skills go in `.claude/skills/<skill-name>/` (project) or `~/.claude/skills/<skill-name>/` (personal).

**Minimum structure:**

```
skill-name/
└── SKILL.md    (required)
```

**Full structure:**

```
skill-name/
├── SKILL.md              # Main definition (required)
├── reference.md          # Detailed documentation
├── examples.md           # Code examples
└── scripts/              # Helper scripts
    └── helper.py
```

## Naming Conventions

- Lowercase letters, numbers, and hyphens only
- Maximum 64 characters
- Descriptive but concise

**Good:** `pdf-processing`, `code-reviewer`, `test-generator`
**Bad:** `PDF Processing`, `CodeReviewer`, `my_skill`

## SKILL.md Template

````yaml
---
name: skill-name
description: Brief description of what this skill does. Use when [specific triggers/keywords that should activate this skill].
allowed-tools: Read, Write, Bash, Grep, Glob  # optional - restricts available tools
---

# Skill Title

## Purpose

One paragraph explaining what this skill accomplishes.

## Instructions

Step-by-step guidance for Claude:

1. First step
2. Second step
3. Third step

## Examples

### Example 1: [Use Case]

```language
code example here
````

## Requirements

Any dependencies or prerequisites needed.

## Notes

Additional context or edge cases to handle.

````

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, hyphens, max 64 chars |
| `description` | Yes | What it does + when to use it (max 1024 chars) |
| `allowed-tools` | No | Comma-separated list of permitted tools |

## Writing Effective Descriptions

The description is critical for discovery. Include:
1. **What** the skill does
2. **When** Claude should use it (trigger words/phrases)

**Effective:**
```yaml
description: Generate unit tests for Python code using pytest. Use when the user asks to create tests, add test coverage, write unit tests, or test Python functions.
````

**Too vague (won't be discovered):**

```yaml
description: Helps with testing
```

## Tool Restrictions

Use `allowed-tools` to limit what Claude can do:

- **Read-only skill:** `allowed-tools: Read, Grep, Glob`
- **Can modify files:** `allowed-tools: Read, Write, Edit, Bash`
- **Full access:** omit the field entirely

## Steps to Create a New Skill

1. **Gather requirements** — Ask the user what the skill should do
2. **Choose a name** — lowercase, hyphens, descriptive
3. **Create directory:**
   ```bash
   mkdir -p .claude/skills/<skill-name>
   ```
4. **Write SKILL.md** — Use the template above
5. **Add supporting files** if needed (examples, scripts, references)
6. **Test the skill** — Ask questions that should trigger it
7. **Iterate** — Refine the description if Claude doesn't discover it

## Example: Creating a Code Review Skill

```bash
mkdir -p .claude/skills/code-reviewer
```

**`.claude/skills/code-reviewer/SKILL.md`:**

```yaml
---
name: code-reviewer
description: Review code for bugs, security issues, and best practices. Use when asked to review code, check a PR, audit code quality, or find issues in code.
allowed-tools: Read, Grep, Glob
---

# Code Reviewer

## Instructions

1. Read the target file(s) using the Read tool
2. Analyze for these categories:
   - Bugs and logic errors
   - Security vulnerabilities
   - Performance issues
   - Code style and readability
   - Missing error handling
3. Provide organized feedback with line references

## Review Checklist

- [ ] Input validation present
- [ ] Error handling appropriate
- [ ] No hardcoded secrets
- [ ] Edge cases handled
- [ ] Code is readable and maintainable

## Output Format

Organize findings by severity:
1. **Critical** — Must fix (security, data loss)
2. **Warning** — Should fix (bugs, performance)
3. **Suggestion** — Nice to have (style, clarity)
```

## Skills vs Slash Commands

| Aspect     | Slash Commands      | Skills                    |
| ---------- | ------------------- | ------------------------- |
| Location   | `.claude/commands/` | `.claude/skills/`         |
| Invocation | Manual (`/command`) | Automatic                 |
| Structure  | Single `.md` file   | Directory with `SKILL.md` |
| Use case   | Quick prompts       | Complex capabilities      |

**Use slash commands** for frequently-typed prompts you want explicit control over.
**Use skills** for capabilities Claude should discover and use automatically.
