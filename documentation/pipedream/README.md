# Pipedream in Numa

Numa uses [Pipedream Connect](https://pipedream.com/connect) for two distinct features:

1. **Integrations (actions, MCP tools)** — outbound calls to SaaS APIs from the workspace agent and apps. "Send a Slack message", "create a Jira issue", "search Gmail", etc. 35+ apps supported.
2. **Triggers (deployed components)** — inbound events from SaaS apps that fire Numa agents. "When `@Numa` is mentioned in Slack", "when a new email arrives in Outlook", etc. Slack today, more on the way.

Both features share the same Pipedream Connect project, the same OAuth grants, and the same cross-account proxy/relay infrastructure described in [`architecture.md`](./architecture.md). The two surfaces differ in WHERE Pipedream calls live in our system:

| Feature      | Where Pipedream is called from | Direction        | HITL approval        |
| ------------ | ------------------------------ | ---------------- | -------------------- |
| Integrations | Workspace agent + admin UI     | Numa → Pipedream | Yes (write actions)  |
| Triggers     | Pipedream → Numa via webhook   | Pipedream → Numa | No (event ingestion) |

## What's in this folder

| File                                     | Read when…                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](./architecture.md)   | You're new to how Pipedream sits inside Numa. Covers the proxy/relay model, account binding, security boundaries, OAuth flow, and the two-secret model. Read first.                   |
| [`triggers.md`](./triggers.md)           | You're adding a new trigger source, debugging a webhook delivery, or modifying the trigger lifecycle (deploy/update/delete). Includes a worked example for adding Outlook end-to-end. |
| [`api-reference.md`](./api-reference.md) | You need to know exactly which Pipedream Connect endpoints we use, the request/response shape, our wrapper layers, or surprising response shapes (e.g. `stringOptions` vs `options`). |

## Where the source of truth lives

| For…                                       | Look at…                                                        |
| ------------------------------------------ | --------------------------------------------------------------- |
| Which apps Numa supports overall           | `infra/config/integrations.ts` (`SUPPORTED_INTEGRATIONS` array) |
| Which sources show up in Automations       | `lib/event-sources.ts`                                          |
| Which Pipedream apps have curated triggers | `lib/pipedream-trigger-apps.ts`                                 |
| The proxy lambda code                      | `lambdas/python/pipedream-proxy/`                               |
| The relay lambda code                      | `lambdas/python/pipedream-relay/`                               |
| Frontend service for Pipedream calls       | `numa-frontend/src/Services/PipedreamProxyService.ts`           |
| Per-integration agent prompts              | `services/numa-workspace-agent/integration-prompts/`            |

## Related skills + docs

- Skill: [`numa-integrations`](../../.claude/skills/numa-integrations/SKILL.md) — task-oriented "I want to add an integration" guide. The deeper feature reference is [`./architecture.md`](./architecture.md) here.
- Skill: [`numa-triggers`](../../.claude/skills/numa-triggers/SKILL.md) — task-oriented "I want to add a trigger" guide. The deeper feature reference is [`./triggers.md`](./triggers.md) here.
- Connect API reference (vendor): https://pipedream.com/docs/connect — the official OpenAPI spec for the Pipedream side of the boundary. We host a curated subset of the Connect API endpoints we use in [`api-reference.md`](./api-reference.md).
