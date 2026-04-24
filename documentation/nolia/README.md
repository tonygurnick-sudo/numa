# Nolia Documentation

Technical documentation for the Nolia AI-powered procurement compliance platform.

## Documents

| File                                                           | Description                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [overview.md](overview.md)                                     | High-level overview — what Nolia is, how it fits into Numa, architecture summary                                               |
| [v2-app-architecture.md](v2-app-architecture.md)               | Detailed technical architecture of the Nolia V2 app — API call chain, AgentCore orchestration, workspace pattern, S3 data flow |
| [ter-cer-assessment.md](ter-cer-assessment.md)                 | TER/CER document validation — the 5-phase compliance pipeline, KB pairing, prompts, outputs                                    |
| [automatic-rules-generation.md](automatic-rules-generation.md) | Automatic rules generation — how KBs get their compliance rules files                                                          |
| [project-notes.md](project-notes.md)                           | Project context, current scope, known issues, deployment notes, contacts                                                       |

## Related Resources

- **Nolia context doc:** [NOLIA.md](NOLIA.md) (full project context — single source of truth)
- **Developer skill:** `.claude/skills/nolia-developer-guide/` (activate for full dev context)
- **Local testing skill:** `.claude/skills/workspace-agent-local-test/`
- **Nolia backend code:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`
- **Nolia frontends (separate repos):** `arcanum/nolia/nolia-app/` (bank / MDB procurement — MoH Indonesia) and `arcanum/nolia/nolia-funding-app/` (funding application assessment — Ngāi Tahu). See each repo's `CLAUDE.md` for the full product doc, plus `arcanum/nolia/CLAUDE.md` for the umbrella context across both.
