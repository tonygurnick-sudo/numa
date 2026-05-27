# API Integration Packages

A structured process for researching external APIs and generating everything needed to integrate them into Numa: workspace agent prompts, developer references, and connector build instructions.

---

## Process at a Glance

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   1. RESEARCH    │────>│   2. GENERATE   │────>│   3. BUILD      │
│                 │     │                 │     │                 │
│ API Investigator│     │  Claude Code    │     │  Developer      │
│ agent or human  │     │                 │     │                 │
│                 │     │                 │     │                 │
│ Fills out the   │     │ Generates 7     │     │ Implements the  │
│ questionnaire   │     │ output files    │     │ connector and   │
│ (10 phases)     │     │ from completed  │     │ deploys the     │
│                 │     │ questionnaire   │     │ integration     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Total output per API:** Up to 8 files (1 questionnaire + 7 generated documents).

---

## Roles

| Role            | Who                                                       | What They Do                                                                     |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Researcher**  | Numa API Investigator agent (preferred) or human engineer | Researches the API, fills out the investigation questionnaire, validates auth    |
| **Claude Code** | Claude Code instance                                      | Reads the completed questionnaire, generates all output documents from templates |
| **Developer**   | Numa engineer                                             | Reviews generated output, implements connector code, deploys, tests end-to-end   |

---

## How to Start a New Investigation

### Option A: Using the Numa API Investigator Agent (Recommended)

1. Open a Numa chat with the API Investigator agent
2. Tell it: "Investigate the {API Name} API. Here are the docs: {url}"
3. The agent will research the API and fill the questionnaire interactively
4. Review the completed questionnaire when the agent presents it
5. Answer any human review questions the agent asks
6. The agent generates all output files

### Option B: Manual Research

1. Copy the questionnaire template:

   ```bash
   mkdir -p ext-api-doc/{api-slug}
   cp ext-api-doc/_templates/00-api-investigation-questionnaire.template.md \
      ext-api-doc/{api-slug}/00-api-investigation-questionnaire.md
   ```

2. Fill out the questionnaire by researching the API:
   - Start with Phase 1 (find documentation)
   - Phase 2 is a hard gate: you MUST make a successful API call before proceeding
   - Complete all 10 phases
   - Mark confidence on every answer: `[CONFIRMED]`, `[DOCUMENTED]`, `[INFERRED]`, `[UNKNOWN]`

3. Give the completed questionnaire to Claude Code:

   ```
   "Read ext-api-doc/{api-slug}/00-api-investigation-questionnaire.md and generate
   all output files using the templates in ext-api-doc/_templates/"
   ```

4. Review the generated output and hand off to a developer.

---

## What Each Document Is For

### Investigation Phase

| File                                      | What It Is                                                                                                                                   | Who Reads It                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **00-api-investigation-questionnaire.md** | The complete research record. 10 phases covering everything from auth to webhooks to integration path. Every answer has a confidence marker. | Claude Code (to generate output), Developer (for context) |

### Generated Output: LLM Knowledge Pack (01 series)

These files are loaded into the workspace agent's context when the integration is active.

| File                                | What It Is                                                                                      | Who Reads It                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| **01-llm-api-rules.md**             | The main prompt. Under 300 lines. Auth, capabilities, gotchas, worked examples, error handling. | Workspace agent (at runtime)          |
| **01a-domain-model-reference.md**   | Entity catalog with fields, relationships, state machines, business rules.                      | Workspace agent (as needed reference) |
| **01b-query-patterns.md**           | All read operations: filtering, searching, sorting, pagination with worked examples.            | Workspace agent (as needed reference) |
| **01c-mutation-patterns.md**        | All write operations: create, update, delete, state transitions with validation rules.          | Workspace agent (as needed reference) |
| **01d-event-and-error-handling.md** | Webhooks, events, polling fallback, error format, recovery playbook.                            | Workspace agent (as needed reference) |

### Generated Output: Developer Reference

| File                             | What It Is                                                                                                  | Who Reads It                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **02-api-spec-investigation.md** | Clean API reference. Endpoints, models, auth, pagination, limits. Everything a developer needs in one page. | Developer (during implementation) |

### Generated Output: Build Instructions

| File                            | What It Is                                                                                                                                                      | Who Reads It                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **03-connector-setup.md**       | Code scaffolding (TypeScript registry entry, Python provider class), deployment checklist, testing plan. Only generated for Data Connector integration paths.   | Developer (during implementation) |
| **04-connection-and-reauth.md** | Step-by-step connection setup (OAuth app creation or PAT generation), token refresh/rotation, reauthorization triggers. Detailed enough to automate via script. | Developer + automation scripts    |

---

## Output File Structure

When complete, each API package lives in its own directory:

```
ext-api-doc/
  _templates/               <-- You are here
    00-api-investigation-questionnaire.template.md
    01-llm-api-rules.template.md
    01a-domain-model-reference.template.md
    01b-query-patterns.template.md
    01c-mutation-patterns.template.md
    01d-event-and-error-handling.template.md
    02-api-spec-investigation.template.md
    03-connector-setup.template.md
    00-MASTER-TEMPLATE.md
    README.md
    agent-prompt-api-investigator.md
  {api-slug}/               <-- One directory per API
    00-api-investigation-questionnaire.md
    01-llm-api-rules.md
    01a-domain-model-reference.md
    01b-query-patterns.md
    01c-mutation-patterns.md
    01d-event-and-error-handling.md
    02-api-spec-investigation.md
    03-connector-setup.md    (only for Data Connector paths)
```

---

## Completed Packages

| API        | Slug         | Status                                                     | Integration Path                    | Date       |
| ---------- | ------------ | ---------------------------------------------------------- | ----------------------------------- | ---------- |
| Actionstep | `actionstep` | Docs complete; doc-based (Phase 2 live smoke test pending) | Direct API (spec-driven, chat-only) | 2026-05-27 |

> Update this table as packages are completed.

---

## Templates Reference

| Template                                         | Purpose                                           | Lines |
| ------------------------------------------------ | ------------------------------------------------- | ----- |
| `00-api-investigation-questionnaire.template.md` | 10-phase structured questionnaire                 | ~650  |
| `01-llm-api-rules.template.md`                   | Workspace agent prompt (strict < 300 line limit)  | ~50   |
| `01a-domain-model-reference.template.md`         | Entity catalog and business rules                 | ~100  |
| `01b-query-patterns.template.md`                 | Read operation patterns                           | ~100  |
| `01c-mutation-patterns.template.md`              | Write operation patterns                          | ~100  |
| `01d-event-and-error-handling.template.md`       | Events, webhooks, errors                          | ~120  |
| `02-api-spec-investigation.template.md`          | Clean developer API reference                     | ~100  |
| `03-connector-setup.template.md`                 | Connector code scaffold and checklist             | ~100  |
| `04-connection-and-reauth.template.md`           | Connection setup, token mgmt, reauth triggers     | ~180  |
| `00-MASTER-TEMPLATE.md`                          | Process guide (this workflow, quality criteria)   | ~180  |
| `agent-prompt-api-investigator.md`               | Numa agent system prompt for the API Investigator | ~150  |

---

## How This Connects to the Integration Development Process

This package system is the **research and planning phase** that feeds into actual implementation.

```
API Integration Package (this system)
        │
        ├── Produces: workspace agent prompts (01 series)
        │     └── Deployed to: workspace agent skills/plugins
        │
        ├── Produces: developer reference (02)
        │     └── Used during: connector implementation
        │
        └── Produces: build instructions (03)
              └── Followed by: developer using numa-connectors skill

Connector Implementation (numa-connectors skill)
        │
        ├── Registry entry (from 03)
        ├── Backend provider (from 03)
        ├── Admin wizard
        ├── Auth flows
        ├── Files Remote integration
        └── CI/CD setup
```

The `03-connector-setup.md` file bridges this system and the `numa-connectors` skill. It provides the code scaffolding; the skill provides the implementation framework.

---

## Troubleshooting

### "The questionnaire is too long / overwhelming"

The questionnaire is intentionally thorough. Focus on `[REQUIRED]` sections first. Many `[NICE-TO-HAVE]` sections can be skipped for initial integration and filled later.

### "The API docs are terrible / nonexistent"

Use Appendix A in the questionnaire (Discovery Playbook for Undocumented APIs). Key techniques:

- Check for hidden OpenAPI/Swagger endpoints
- Inspect browser network traffic on the vendor's web app
- Clone and examine official SDKs
- Intentionally trigger errors to learn about the API

### "I am not sure which integration path to choose"

See Phase 9 of the questionnaire. The decision tree:

- Does the API have browsable file/document content? -> **Data Connector (Files)**
- Does the API have browsable structured content (contacts, projects, etc.)? -> **Data Connector**
- Is the API purely action-oriented (send email, create ticket)? -> **Direct API Only**
- Does it have both browsable content AND actions? -> **Hybrid**

### "Claude Code generated placeholder values in the output"

The questionnaire was probably incomplete. Check the Phase 10 readiness checklist. Every `{{placeholder}}` in the output corresponds to a missing answer in the questionnaire.

### "The 01-llm-api-rules.md is over 300 lines"

This is a strict limit. The main prompt must be concise enough to fit in workspace agent context alongside other tools and conversation. Move detailed reference material to the companion files (01a-01d) and reference them from 01.

---

_For the detailed process guide with quality criteria, see `00-MASTER-TEMPLATE.md`._
_For the agent system prompt, see `agent-prompt-api-investigator.md`._
