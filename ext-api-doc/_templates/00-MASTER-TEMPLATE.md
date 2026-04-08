# API Integration Package -- Process Guide

> This document describes the end-to-end process for creating an API integration package.
> It maps who does what, when, and how the template files connect to each other.

---

## Roles

| Role            | Who                                  | Responsibility                                                   |
| --------------- | ------------------------------------ | ---------------------------------------------------------------- |
| **Researcher**  | Numa API Investigator agent or human | Fills out the investigation questionnaire by researching the API |
| **Claude Code** | Claude Code instance                 | Generates the output documents from the completed questionnaire  |
| **Developer**   | Numa engineer                        | Reviews, deploys, and tests the integration                      |

---

## Workflow

### Step 1: Investigation (Researcher)

**Input:** API name and any known URLs
**Output:** Completed `00-api-investigation-questionnaire.md`

1. Start from `00-api-investigation-questionnaire.template.md`
2. Copy it to `ext-api-doc/{api-slug}/00-api-investigation-questionnaire.md`
3. Fill out all 10 phases, marking confidence on every answer
4. Complete the Phase 10 readiness checklist
5. Get human review on Phase 2 (auth) and Phase 9 (integration path)

**Quality gate:** Phase 2 first successful call must be documented. Phase 10 readiness checklist must have all required items checked.

### Step 2: Generate Knowledge Pack (Claude Code)

**Input:** Completed questionnaire
**Output:** Files 01 through 01d (LLM knowledge pack)

1. Read the completed questionnaire
2. Generate each document using its template:
   - `01-llm-api-rules.md` -- under 300 lines, workspace agent prompt
   - `01a-domain-model-reference.md` -- entity catalog
   - `01b-query-patterns.md` -- read operations
   - `01c-mutation-patterns.md` -- write operations
   - `01d-event-and-error-handling.md` -- events and errors
3. Self-review: verify examples are real (from questionnaire), line count is within limit, all entities are covered

**Quality gate:** `01-llm-api-rules.md` is under 300 lines. All examples come from the questionnaire, not invented.

### Step 3: Generate Developer Reference & Build Instructions (Claude Code)

**Input:** Completed questionnaire + knowledge pack
**Output:** Files 02 and 03

1. Generate `02-api-spec-investigation.md` -- clean API reference
2. Generate `03-connector-setup.md` -- code scaffolding and checklist (only if integration path includes Data Connector)
3. Self-review: verify no placeholder values remain in generated code

**Quality gate:** No `{{placeholder}}` values remain. Code compiles conceptually (correct TypeScript/Python syntax).

### Step 4: Deploy (Developer)

**Input:** Complete package (files 00-03)
**Output:** Working integration

1. Review all generated documents
2. Implement the connector following `03-connector-setup.md`
3. Deploy integration prompt to workspace agent
4. Complete the deployment checklist
5. Test the full user journey

**Quality gate:** All checklist items in `03-connector-setup.md` are checked.

---

## Document Relationship Diagram

```
                    ┌──────────────────────────────────────┐
                    │  00-api-investigation-questionnaire   │
                    │  (filled by researcher)               │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────┴───────────────────────┐
                    │         Claude Code generates         │
                    ├──────────────────────────────────────┤
                    │                                      │
        ┌───────────┼────────────┬────────────┬───────────┤
        ▼           ▼            ▼            ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │   01    │ │   01a   │ │   01b   │ │   01c   │ │   01d   │
   │ LLM API │ │ Domain  │ │ Query   │ │Mutation │ │ Event & │
   │ Rules   │ │ Model   │ │Patterns │ │Patterns │ │ Error   │
   └────┬────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
        │           │            │            │           │
        │           └────────────┴────────────┴───────────┘
        │                        │
        │    ┌───────────────────┤
        │    ▼                   ▼
        │  ┌─────────┐    ┌─────────┐
        │  │   02    │    │   03    │
        │  │API Spec │    │Connector│
        │  │  Ref    │    │ Setup   │
        │  └─────────┘    └────┬────┘
        │                      │
        ▼                      ▼
   ┌──────────────────────────────────┐
   │     Workspace Agent Context      │
   │ (01 loaded as prompt, 01a-01d   │
   │  available as reference)         │
   └──────────────────────────────────┘
```

---

## Template Files Reference

| File                                             | Purpose                         | Filled By   | Approx Lines   |
| ------------------------------------------------ | ------------------------------- | ----------- | -------------- |
| `00-api-investigation-questionnaire.template.md` | 10-phase research questionnaire | Researcher  | ~650           |
| `01-llm-api-rules.template.md`                   | Workspace agent prompt          | Claude Code | < 300 (strict) |
| `01a-domain-model-reference.template.md`         | Entity catalog                  | Claude Code | ~100+          |
| `01b-query-patterns.template.md`                 | Read operation patterns         | Claude Code | ~100+          |
| `01c-mutation-patterns.template.md`              | Write operation patterns        | Claude Code | ~100+          |
| `01d-event-and-error-handling.template.md`       | Events and errors               | Claude Code | ~120+          |
| `02-api-spec-investigation.template.md`          | Clean API reference             | Claude Code | ~100+          |
| `03-connector-setup.template.md`                 | Connector code scaffold         | Claude Code | ~100+          |

---

## Quality Criteria

### Investigation Questionnaire (00)

- [ ] All `[REQUIRED]` sections have answers
- [ ] Every answer has a confidence marker
- [ ] Phase 2 gate: first successful call documented with real request/response
- [ ] Phase 10 readiness checklist completed
- [ ] At least 5 critical endpoints documented with full request/response
- [ ] Pagination model documented with worked example
- [ ] Integration path explicitly selected with justification

### LLM API Rules (01)

- [ ] Under 300 lines total
- [ ] Auth section is copy-paste accurate
- [ ] 3-5 working examples with real request/response from questionnaire
- [ ] CAN/CANNOT capabilities clearly listed
- [ ] Critical gotchas are specific and actionable
- [ ] Default parameters have clear rationale
- [ ] Error handling covers all common status codes

### Domain Model Reference (01a)

- [ ] All entities from questionnaire Phase 3 included
- [ ] Every entity has a complete field table
- [ ] Relationships documented with type and expression method
- [ ] State machines documented where applicable
- [ ] Business rules are specific (not generic)
- [ ] Field formats and enums cataloged

### Query Patterns (01b)

- [ ] Capabilities summary table completed
- [ ] Filter syntax documented with operator examples
- [ ] Pagination loop fully worked out
- [ ] 3+ worked examples with real data
- [ ] Gotchas documented

### Mutation Patterns (01c)

- [ ] All supported write operations documented
- [ ] Required fields listed for each create operation
- [ ] Server-side defaults documented
- [ ] Validation rules cataloged
- [ ] Dangerous operations flagged
- [ ] 3+ worked examples with real data

### Event & Error Handling (01d)

- [ ] Event-driven capabilities assessed
- [ ] Webhook setup documented (if applicable)
- [ ] Polling fallback documented
- [ ] Error format documented with real example
- [ ] Recovery playbook complete for all status codes
- [ ] Rate limit details with backoff strategy

### API Spec (02)

- [ ] All information is consistent with questionnaire
- [ ] Complete endpoint catalog
- [ ] All data models documented
- [ ] Pagination details included
- [ ] No placeholder values

### Connector Setup (03)

- [ ] Registry entry is valid TypeScript
- [ ] Provider class is valid Python
- [ ] All connector methods mapped to API endpoints
- [ ] Deployment checklist is complete
- [ ] Testing plan covers the full user journey

---

## Existing Reference Files

These completed packages can serve as examples when filling templates:

| API          | Status | Location |
| ------------ | ------ | -------- |
| _(none yet)_ |        |          |

> As packages are completed, add them here so future investigators can reference real examples.

---

_This process guide is the master reference for the API integration package system.
For the quick-start version, see `README.md`._
