# kb-core

Shared knowledge-base management primitives for Numa.

Provides `KnowledgeBaseManager`, the DynamoDB-backed KB + membership model. Single-table design with `PK = TENANT#{client}`, KB items at `SK = KB#{id}` and membership records at `SK = KBMEM#{kb}#USER#{user}` (plus `GSI1` for user-to-KB lookups).

## Consumers

- **`numa-kb-manager`** — the full KB CRUD API (`/api/kb*`). Uses create/update/delete/memberships.
- **`numa-chat-agent`** — read-only at runtime. Calls `list_user_kbs` to compute the set of KBs a user may enable per chat turn. IAM restricts the chat agent to `dynamodb:Query, GetItem` on the KB table, so write paths are not reachable from there even though the class is shared.

## Usage

```python
from kb_core import KnowledgeBaseManager

manager = KnowledgeBaseManager()  # picks up CLIENT_NAME from env
accessible = manager.list_user_kbs(user_sub)
```

Add to a Poetry project via a path dependency:

```toml
[tool.poetry.dependencies]
kb-core = { path = "../../../lib/kb-core", develop = true }
```
