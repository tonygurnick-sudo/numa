# numa-kb-manager

Knowledge Base management API — handles `/api/kb*` requests behind CloudFront.

Split out of `numa-chat-agent` so that the chat lambda's heavy startup (Claude Agent SDK, MCP, Bedrock model warm-up) doesn't add latency or cost to simple KB CRUD operations.

## Endpoints

| Method | Path                           | Purpose                                 |
| ------ | ------------------------------ | --------------------------------------- |
| POST   | `/api/kb`                      | Create KB                               |
| GET    | `/api/kb`                      | List KBs visible to the current user    |
| GET    | `/api/kb/{kb_id}`              | Get KB details                          |
| PATCH  | `/api/kb/{kb_id}`              | Update KB name / viewers / editors      |
| DELETE | `/api/kb/{kb_id}`              | Soft-delete (archive) KB                |
| GET    | `/api/kb/{kb_id}/files`        | List S3 files in the KB prefix          |
| POST   | `/api/kb/{kb_id}/files/delete` | Server-side delete files from KB prefix |
| GET    | `/api/kb/{kb_id}/state`        | Sync status + indexed/failed documents  |

## Deployment

Standard zip Lambda with FastAPI handled by Mangum. Invoked via Lambda Function URL routed from CloudFront on the `/api/kb` and `/api/kb/*` patterns.

Build: `cd lambdas && bash package-python-lambda.sh python/numa-kb-manager`.

When adding this Lambda (or similar split-outs) to a fresh branch, make sure to:

- add the directory to the Python lambda list in `.gitlab-ci.yml` so CI packages it
- instantiate `NumaKbManager` in `infra/stacks/numa-client-stack.ts` and pass its `functionUrl` into `NumaFrontendInfra`
- register the `/api/kb` and `/api/kb/*` cache behaviours in `infra/constructs/numa-frontend-infra-construct.ts` **before** the `/api/*` catch-all
