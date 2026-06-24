---
name: numa-ops
description: Build and maintain Numa Ops — the work management / project ops module. Use when working with ops tickets, kanban boards, teams, customers, suppliers, CRM, backlog, sprints, work units, ticket types, fields, comments, links, audit trail, or the ops admin settings UI.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Ops

Numa Ops is a lightweight Jira/Linear-style work management module built into the Numa platform. It was designed by Ian Dougherty (COO/PM). His reference implementation "The actual Work Ops App" (under `docs/tasks/numa-ops-feature/`) is the gold standard for feature parity.

---

## Concepts

### Core Entities

- **Tickets** — The primary unit of work. Each ticket has a title, description, status, priority, assignee, due date, custom fields, tags, links to other tickets, comments, and attachments. Tickets live on kanban boards within stages.
- **Teams** — What Ian's original POC called "boards". A team owns a set of tickets, has zones (backlog + board), stages within those zones, and optional work units (sprints). The UI refers to these as "Boards" but the API uses `teamId`.
- **Zones** — A zone is either a `board` (active kanban columns) or a `backlog` (triage/planning area). Each team can have multiple zones.
- **Stages** — Columns within a zone. Each stage maps to a `statusType` (backlog, scoped, queued, active, completed, ended, deleted). Stages are the kanban columns users drag tickets between.
- **Work Units (Sprints)** — Optional time-boxed iterations within a team. Tickets can be assigned to a work unit. Statuses: planning, active, completed. Support rollover of incomplete tickets.
- **Projects** — Groupings of tickets. A ticket can belong to one project.
- **Customers** — Standalone CRM entity with lifecycle stages, contacts, activities, documents. Tickets can be linked to customers.
- **Suppliers** — Similar to customers but with supplier-specific fields (annualSpend, paymentTerms). Tickets can be linked to suppliers.
- **Comments** — Threaded comments on tickets with optional file attachments.
- **Ticket Links** — Typed relationships between tickets: `blocks`, `depends_on`, `related_to`.
- **Audit Trail** — System-generated log of all ticket changes (created, updated, moved, commented, linked, deleted, restored).

### Status Lifecycle

Tickets progress through status types, which map to zone types:

| StatusType  | Allowed Zones  | Meaning                        |
| ----------- | -------------- | ------------------------------ |
| `backlog`   | backlog        | New/untriaged work             |
| `scoped`    | backlog        | Refined and ready for planning |
| `queued`    | board, backlog | Planned but not started        |
| `active`    | board          | Currently being worked on      |
| `completed` | board          | Done                           |
| `ended`     | board          | Cancelled/won't do             |
| `deleted`   | board          | Soft-deleted (restorable)      |

### Key Differences from Ian's POC

- Ian called "teams" -> "boards". Numa calls them **teams** in the API but "Boards" in the UI.
- Customers are their own standalone tab (Ian's version had a CRM mirror concept -- we removed that).
- Suppliers are tracked similarly to customers.
- Ian's original design had a "Work Centre" hierarchy above teams. This was removed (with Ian's approval) -- companies will only ever have one work centre, so the hierarchy is flat: Ticket -> Team.
- Stages now map directly to `statusType` -- the global Status entity is deprecated.

---

## Architecture Overview

```
Frontend (OpsPage)
    |
    v
OpsProvider (OpsContext) -> useOpsData hook
    |                          |
    |                          +-- OpsService.ts (API client)
    |                                  |
    v                                  v
Components:                     API Gateway (/api/ops/*)
  - BoardView (kanban)              |
  - BacklogView (table)        +----+----+----+
  - AllTicketsView (table)     |         |         |
  - CrmMirrorView             v         v         v
  - SupplierMirrorView    ops-api   config-api  crm-api
  - OpsHomeView            (tickets,  (ticket    (customers,
  - Modals:                 teams,     types,     suppliers,
    - CreateTicketModal     zones,     statuses,  activities,
    - TicketDetailModal     stages,    fields,    documents)
    - CreateBoardWizard     comments,  staff,
    - BoardSettingsModal    links,     projects)
    - GlobalSettingsModal   metrics,
    - CustomerDetailModal   uploads,
    - SupplierDetailModal   prefs)
    - WorkUnitModals             |
                                 v
                          DynamoDB Tables:
                            {client}-ops
                            {client}-ops-config
                            {client}-ops-crm
```

### Workspace Chat Integration

The workspace agent has a `numa_ops_tool` MCP tool that exposes all ops operations from chat. The flow is:

```
User in chat -> Claude Agent SDK -> numa_ops_tool (MCP)
    -> workspace-chat-tools Lambda -> ops.py handler
        -> Direct Lambda invocation of ops-api / config-api / crm-api
```

Operations are classified as safe (auto-approved reads) or unsafe (writes require user approval).

---

## Key Components

### Frontend

| Component               | Location                                                             | Purpose                                         |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| **OpsPage**             | `numa-frontend/src/Pages/OpsPage.tsx`                                | Top-level page, wraps everything in OpsProvider |
| **OpsProvider/Context** | `numa-frontend/src/Components/Ops/OpsContext.tsx`                    | React context for all ops state                 |
| **useOpsData**          | `numa-frontend/src/Components/Ops/useOpsData.ts`                     | Main data hook (config, teams, tickets, views)  |
| **OpsService**          | `numa-frontend/src/Services/OpsService.ts`                           | API client (all CRUD operations)                |
| **OpsHeader**           | `numa-frontend/src/Components/Ops/OpsHeader.tsx`                     | Top navigation bar with view tabs               |
| **BoardView**           | `numa-frontend/src/Components/Ops/BoardView/BoardView.tsx`           | Kanban board view                               |
| **KanbanColumn**        | `numa-frontend/src/Components/Ops/BoardView/KanbanColumn.tsx`        | Single kanban column (stage)                    |
| **KanbanZone**          | `numa-frontend/src/Components/Ops/BoardView/KanbanZone.tsx`          | Zone wrapper for kanban columns                 |
| **TicketCard**          | `numa-frontend/src/Components/Ops/BoardView/TicketCard.tsx`          | Card on kanban board                            |
| **BacklogView**         | `numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx`       | Table view for backlog zones                    |
| **AllTicketsView**      | `numa-frontend/src/Components/Ops/AllTicketsView/AllTicketsView.tsx` | Cross-team ticket list with filters             |
| **CrmMirrorView**       | `numa-frontend/src/Components/Ops/CrmView/CrmMirrorView.tsx`         | Customer list/pipeline view                     |
| **SupplierMirrorView**  | `numa-frontend/src/Components/Ops/CrmView/SupplierMirrorView.tsx`    | Supplier list/pipeline view                     |
| **OpsHomeView**         | `numa-frontend/src/Components/Ops/HomeView/OpsHomeView.tsx`          | Admin dashboard with metrics and quick actions  |
| **CreateTicketModal**   | `numa-frontend/src/Components/Ops/Modals/CreateTicketModal.tsx`      | Modal form for creating tickets                 |
| **TicketDetailModal**   | `numa-frontend/src/Components/Ops/Modals/TicketDetailModal.tsx`      | Full ticket detail with comments, links, audit  |
| **CreateBoardWizard**   | `numa-frontend/src/Components/Ops/Modals/CreateBoardWizard.tsx`      | Multi-step wizard for team/board creation       |
| **BoardSettingsModal**  | `numa-frontend/src/Components/Ops/Modals/BoardSettingsModal.tsx`     | Team settings (zones, stages, fields, access)   |
| **GlobalSettingsModal** | `numa-frontend/src/Components/Ops/Modals/GlobalSettingsModal.tsx`    | Admin settings (ticket types, fields, CRM, etc) |
| **CustomerDetailModal** | `numa-frontend/src/Components/Ops/Modals/CustomerDetailModal.tsx`    | Customer detail with activities and documents   |
| **SupplierDetailModal** | `numa-frontend/src/Components/Ops/Modals/SupplierDetailModal.tsx`    | Supplier detail with activities and documents   |
| **WorkUnitModals**      | `numa-frontend/src/Components/Ops/Modals/WorkUnitModals.tsx`         | Sprint creation, editing, completion            |
| **OpsToolRenderer**     | `numa-frontend/src/toolRenderers/OpsToolRenderer.tsx`                | Renders ops tool results in workspace chat      |
| **opsHelpers**          | `numa-frontend/src/toolRenderers/opsHelpers.ts`                      | Parses ops tool MCP results for rendering       |
| **opsCache**            | `numa-frontend/src/utils/opsCache.ts`                                | Stale-while-revalidate localStorage cache       |
| **opsConstants**        | `numa-frontend/src/constants/opsConstants.ts`                        | Zone/status mappings, team presets, defaults    |

### Shared Components (Ops/Shared/)

| Component                | Purpose                                 |
| ------------------------ | --------------------------------------- |
| **PriorityIndicator**    | Priority dot/badge                      |
| **StatusBadge**          | Status type color badge                 |
| **StageBadge**           | Stage name with status color            |
| **DueDateBadge**         | Due date with overdue highlighting      |
| **StaffAvatar**          | User avatar with presigned URL fallback |
| **SprintBadge**          | Work unit/sprint indicator              |
| **DynamicField**         | Renders any field type dynamically      |
| **RichTextEditor**       | Markdown editor for descriptions        |
| **CommentSection**       | Comment list with create/edit/delete    |
| **LinkedTicketsSection** | Linked tickets with add/remove          |
| **ActivitySection**      | Activity log for customers/suppliers    |
| **ContactSection**       | Contact management for CRM entities     |
| **DocumentSection**      | Document upload/list for CRM entities   |
| **AttachmentsSection**   | File attachments for tickets            |

### Backend Lambdas

| Lambda                  | Location                                    | Purpose                                                                                                        |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **numa-ops-api**        | `lambdas/node/numa-ops-api/index.ts`        | Core ops: tickets, teams, zones, stages, work units, comments, links, metrics, uploads, user preferences       |
| **numa-ops-config-api** | `lambdas/node/numa-ops-config-api/index.ts` | Configuration: ticket types, statuses, fields, staff, projects, CRM/supplier settings, staff sync from Cognito |
| **numa-ops-crm-api**    | `lambdas/node/numa-ops-crm-api/index.ts`    | CRM entities: customers, suppliers, activities, documents                                                      |
| **seed-ops-config**     | `lambdas/node/seed-ops-config/index.ts`     | Deploy-time seeder for default config (ticket types, statuses, fields, industries, link config)                |

### Workspace Agent Integration

| File                                                                       | Purpose                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_ops.py` | MCP tool definition for chat agent               |
| `services/numa-workspace-agent/plugins/numa/skills/ops/SKILL.md`           | Agent skill documentation (operations reference) |
| `lambdas/python/workspace-chat-tools/tools/ops.py`                         | Bridge: routes ops MCP calls to ops Lambdas      |

### Infrastructure

| File                                | Purpose                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `infra/constructs/ops-construct.ts` | CDKTF construct: 3 DynamoDB tables, 3 API Lambdas, seed Lambda |
| `infra/stacks/numa-client-stack.ts` | Conditionally creates OpsConstruct when `numaOps` flag is true |

### Shared Libraries

| File                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `lib/ops-schemas.ts`   | Zod schemas for all ops entities (shared by backend)                |
| `lib/ops-constants.ts` | Zone/status mappings, team presets (shared by backend and frontend) |

---

## Database Schema

### Three DynamoDB Tables

#### 1. `{client}-ops` (Core Operations Table)

Single-table design with PK/SK pattern. 3 GSIs.

**Key Patterns:**

| Entity                   | PK                  | SK                                 | GSI1PK          | GSI1SK                             | GSI2PK                  | GSI2SK                          | GSI3PK                | GSI3SK                      |
| ------------------------ | ------------------- | ---------------------------------- | --------------- | ---------------------------------- | ----------------------- | ------------------------------- | --------------------- | --------------------------- |
| Team                     | `TEAM#{teamId}`     | `META`                             | `TEAMS`         | `ORDER#{order}`                    | --                      | --                              | --                    | --                          |
| Zone                     | `TEAM#{teamId}`     | `ZONE#{zoneId}`                    | `TEAM#{teamId}` | `ZONE#{zoneType}#{order}`          | --                      | --                              | --                    | --                          |
| Stage                    | `TEAM#{teamId}`     | `STAGE#{stageId}`                  | `TEAM#{teamId}` | `ZONE#{zoneId}#STAGE#{order}`      | --                      | --                              | --                    | --                          |
| Ticket                   | `TEAM#{teamId}`     | `TICKET#{ticketId}`                | `TEAM#{teamId}` | `STAGE#{stageId}#ORDER#{order}`    | `CUSTOMER#{customerId}` | `TICKET#{updatedAt}#{ticketId}` | `STATUS#{statusType}` | `TEAM#{teamId}#{updatedAt}` |
| Ticket (by display)      | --                  | --                                 | --              | --                                 | `DISPLAYID#{displayId}` | `TICKET#{ticketId}`             | --                    | --                          |
| Comment                  | `TICKET#{ticketId}` | `COMMENT#{timestamp}#{commentId}`  | --              | --                                 | --                      | --                              | --                    | --                          |
| Link                     | `TICKET#{ticketId}` | `LINK#{linkType}#{linkedTicketId}` | --              | --                                 | --                      | --                              | --                    | --                          |
| Audit                    | `TICKET#{ticketId}` | `AUDIT#{timestamp}#{auditId}`      | --              | --                                 | --                      | --                              | --                    | --                          |
| Work Unit                | `TEAM#{teamId}`     | `WORKUNIT#{workUnitId}`            | `TEAM#{teamId}` | `WORKUNIT#STATUS#{status}#{order}` | --                      | --                              | --                    | --                          |
| Prefix Registry          | `PREFIX`            | `{PREFIX}` (e.g. `FEAT`)           | --              | --                                 | --                      | --                              | --                    | --                          |
| Ticket Index (assignee)  | `TEAM#{teamId}`     | `TICKET#{ticketId}#IDX_ASSIGNEE`   | --              | --                                 | `ASSIGNEE#{assigneeId}` | `TICKET#{updatedAt}#{ticketId}` | --                    | --                          |
| Ticket Index (customer)  | `TEAM#{teamId}`     | `TICKET#{ticketId}#IDX_CUSTOMER`   | --              | --                                 | `CUSTOMER#{customerId}` | `TICKET#{updatedAt}#{ticketId}` | --                    | --                          |
| Ticket Index (work unit) | `TEAM#{teamId}`     | `TICKET#{ticketId}#IDX_WORKUNIT`   | --              | --                                 | `WORKUNIT#{workUnitId}` | `TICKET#{updatedAt}#{ticketId}` | --                    | --                          |
| User Preference          | `USER#{userId}`     | `PREF#{teamId}`                    | --              | --                                 | --                      | --                              | --                    | --                          |

**GSI Access Patterns:**

- **GSI1** (`GSI1PK`, `GSI1SK`): List teams by order, list tickets by stage+order, list zones/stages within a team, list work units by status
- **GSI2** (`GSI2PK`, `GSI2SK`): Look up tickets by customer, assignee, work unit, or display ID
- **GSI3** (`GSI3PK`, `GSI3SK`): List tickets by status type across/within teams

#### 2. `{client}-ops-config` (Configuration Table)

Simple PK/SK table. No GSIs. PK is always `CONFIG`.

| Entity          | PK       | SK                   |
| --------------- | -------- | -------------------- |
| Ticket Type     | `CONFIG` | `TICKET_TYPE#{id}`   |
| Status          | `CONFIG` | `STATUS#{id}`        |
| Field           | `CONFIG` | `FIELD#{id}`         |
| Staff           | `CONFIG` | `STAFF#{cognitoSub}` |
| Project         | `CONFIG` | `PROJECT#{id}`       |
| CRM Config      | `CONFIG` | `CRM_CONFIG`         |
| Supplier Config | `CONFIG` | `SUPPLIER_CONFIG`    |
| Link Config     | `CONFIG` | `LINK_CONFIG`        |
| Staff Sync Meta | `CONFIG` | `META#STAFF_SYNC`    |

#### 3. `{client}-ops-crm` (CRM Table)

PK/SK table with 2 GSIs.

| Entity   | PK                    | SK                             | GSI1PK            | GSI1SK               | GSI2PK                | GSI2SK          |
| -------- | --------------------- | ------------------------------ | ----------------- | -------------------- | --------------------- | --------------- |
| Customer | `CUSTOMER#{id}`       | `META`                         | `ENTITY#CUSTOMER` | `STAGE#{stage}#{id}` | `CRM_OWNER#{ownerId}` | `CUSTOMER#{id}` |
| Supplier | `SUPPLIER#{id}`       | `META`                         | `ENTITY#SUPPLIER` | `STAGE#{stage}#{id}` | `SUP_OWNER#{ownerId}` | `SUPPLIER#{id}` |
| Activity | `{ENTITY}#{entityId}` | `ACTIVITY#{date}#{activityId}` | --                | --                   | --                    | --              |
| Document | `{ENTITY}#{entityId}` | `DOC#{docId}`                  | --                | --                   | --                    | --              |

**GSI Access Patterns:**

- **GSI1**: List all customers/suppliers, filter by lifecycle stage
- **GSI2**: List customers/suppliers by owner

---

## API Endpoints

All endpoints are under `/api/ops/`. Authentication is via Cognito JWT (API Gateway) or direct Lambda invocation with `userContext`.

### Core Ops API (`numa-ops-api`)

| Method | Path                                                      | Purpose                              |
| ------ | --------------------------------------------------------- | ------------------------------------ |
| GET    | `/api/ops/teams`                                          | List all teams (summaries)           |
| GET    | `/api/ops/teams/{teamId}`                                 | Get team with zones + stages         |
| POST   | `/api/ops/teams`                                          | Create team (with preset zones)      |
| PUT    | `/api/ops/teams/{teamId}`                                 | Update team                          |
| DELETE | `/api/ops/teams/{teamId}`                                 | Delete team + all children           |
| PUT    | `/api/ops/teams/{teamId}/zones`                           | Bulk update zones                    |
| DELETE | `/api/ops/teams/{teamId}/zones/{zoneId}`                  | Delete a zone                        |
| PUT    | `/api/ops/teams/{teamId}/stages`                          | Bulk update stages                   |
| GET    | `/api/ops/teams/{teamId}/work-units`                      | List work units (sprints)            |
| POST   | `/api/ops/teams/{teamId}/work-units`                      | Create work unit                     |
| PUT    | `/api/ops/teams/{teamId}/work-units/{id}`                 | Update work unit (supports rollover) |
| DELETE | `/api/ops/teams/{teamId}/work-units/{id}`                 | Delete planning work unit            |
| GET    | `/api/ops/tickets`                                        | List tickets (with filters)          |
| GET    | `/api/ops/tickets/{ticketId}`                             | Get ticket + comments + links        |
| GET    | `/api/ops/tickets/by-display-id/{displayId}`              | Get ticket by display ID             |
| POST   | `/api/ops/tickets`                                        | Create ticket                        |
| PUT    | `/api/ops/tickets/{ticketId}`                             | Update ticket                        |
| DELETE | `/api/ops/tickets/{ticketId}`                             | Soft-delete ticket                   |
| POST   | `/api/ops/tickets/{ticketId}/restore`                     | Restore deleted ticket               |
| POST   | `/api/ops/tickets/bulk`                                   | Bulk update tickets                  |
| GET    | `/api/ops/tickets/{ticketId}/comments`                    | List comments                        |
| POST   | `/api/ops/tickets/{ticketId}/comments`                    | Create comment                       |
| PUT    | `/api/ops/tickets/{ticketId}/comments/{commentId}`        | Update comment                       |
| DELETE | `/api/ops/tickets/{ticketId}/comments/{commentId}`        | Delete comment                       |
| POST   | `/api/ops/tickets/{ticketId}/links`                       | Create ticket link                   |
| DELETE | `/api/ops/tickets/{ticketId}/links/{linkType}/{linkedId}` | Delete ticket link                   |
| GET    | `/api/ops/metrics`                                        | Get ticket count metrics             |
| POST   | `/api/ops/uploads/presigned-url`                          | Get presigned upload URL             |
| GET    | `/api/ops/uploads/presigned-url?s3Key=...`                | Get presigned download URL           |
| GET    | `/api/ops/user-preferences/{teamId}`                      | Get user preferences                 |
| PUT    | `/api/ops/user-preferences/{teamId}`                      | Save user preferences                |

### Config API (`numa-ops-config-api`)

| Method | Path                                | Purpose                                                                                                          |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/ops/config`                   | Bulk load ALL config (ticket types, statuses, fields, staff, projects, CRM config, supplier config, link config) |
| GET    | `/api/ops/config/ticket-types`      | List ticket types                                                                                                |
| POST   | `/api/ops/config/ticket-types`      | Create ticket type (admin)                                                                                       |
| PUT    | `/api/ops/config/ticket-types/{id}` | Update ticket type (admin)                                                                                       |
| DELETE | `/api/ops/config/ticket-types/{id}` | Delete ticket type (admin)                                                                                       |
| GET    | `/api/ops/config/statuses`          | List statuses (deprecated)                                                                                       |
| POST   | `/api/ops/config/statuses`          | Create status (admin)                                                                                            |
| PUT    | `/api/ops/config/statuses/{id}`     | Update status (admin)                                                                                            |
| GET    | `/api/ops/config/fields`            | List custom fields                                                                                               |
| POST   | `/api/ops/config/fields`            | Create custom field (admin)                                                                                      |
| PUT    | `/api/ops/config/fields/{id}`       | Update custom field (admin)                                                                                      |
| GET    | `/api/ops/config/staff`             | List staff                                                                                                       |
| POST   | `/api/ops/config/staff`             | Create staff (admin)                                                                                             |
| PUT    | `/api/ops/config/staff/{id}`        | Update staff (admin)                                                                                             |
| POST   | `/api/ops/config/staff/sync`        | Sync staff from Cognito + enrich from chat profiles                                                              |
| GET    | `/api/ops/config/projects`          | List projects                                                                                                    |
| POST   | `/api/ops/config/projects`          | Create project                                                                                                   |
| PUT    | `/api/ops/config/projects/{id}`     | Update project                                                                                                   |
| DELETE | `/api/ops/config/projects/{id}`     | Delete project (admin)                                                                                           |
| GET    | `/api/ops/config/crm-settings`      | Get CRM config                                                                                                   |
| PUT    | `/api/ops/config/crm-settings`      | Update CRM config (admin)                                                                                        |
| GET    | `/api/ops/config/supplier-settings` | Get supplier config                                                                                              |
| PUT    | `/api/ops/config/supplier-settings` | Update supplier config (admin)                                                                                   |

### CRM API (`numa-ops-crm-api`)

| Method | Path                                         | Purpose                                              |
| ------ | -------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/ops/customers`                         | List customers (with filters)                        |
| GET    | `/api/ops/customers/{id}`                    | Get customer + activities + documents + ticket count |
| POST   | `/api/ops/customers`                         | Create customer                                      |
| PUT    | `/api/ops/customers/{id}`                    | Update customer                                      |
| DELETE | `/api/ops/customers/{id}`                    | Delete customer (if no linked tickets)               |
| POST   | `/api/ops/customers/{id}/activities`         | Create activity                                      |
| PUT    | `/api/ops/customers/{id}/activities/{actId}` | Update activity                                      |
| DELETE | `/api/ops/customers/{id}/activities/{actId}` | Delete activity                                      |
| POST   | `/api/ops/customers/{id}/documents`          | Create document (with presigned upload URL)          |
| DELETE | `/api/ops/customers/{id}/documents/{docId}`  | Delete document                                      |
| GET    | `/api/ops/suppliers`                         | List suppliers (with filters)                        |
| GET    | `/api/ops/suppliers/{id}`                    | Get supplier + activities + documents + ticket count |
| POST   | `/api/ops/suppliers`                         | Create supplier                                      |
| PUT    | `/api/ops/suppliers/{id}`                    | Update supplier                                      |
| DELETE | `/api/ops/suppliers/{id}`                    | Delete supplier (if no linked tickets)               |
| POST   | `/api/ops/suppliers/{id}/activities`         | Create activity                                      |
| POST   | `/api/ops/suppliers/{id}/documents`          | Create document                                      |

---

## Feature Flag

Numa Ops is gated behind the `numaOps` flag in the client config:

- **Client config (DynamoDB):** `numaOps: true`
- **Frontend config.json:** `NUMA_OPS: true`
- **Workspace agent env:** `NUMA_OPS_ENABLED: true` (enables the MCP tool)
- **Route:** `/ops` in the nav (OpsPage)

---

## Key Data Structures

### Ticket (TypeScript)

```typescript
type Ticket = {
  id: string;
  displayId: string; // e.g. "FEAT-042"
  teamId: string;
  ticketTypeId: string;
  title: string;
  description: string;
  statusType: StatusType; // backlog | scoped | queued | active | completed | ended | deleted
  zoneId: string;
  stageId: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  reporterId?: string | null;
  reporterName?: string | null;
  priority: TicketPriority; // highest | high | medium | low | lowest
  projectId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  workUnitId?: string | null;
  effortPoints?: number | null;
  fields: Record<string, unknown>; // custom fields
  tags: string[];
  dueDate?: string | null;
  sourceType?: TicketSourceType | null; // app | chat | agent | manual
  sourceId?: string | null;
  sourceAppType?: string | null;
  commentCount: number;
  linkCount: number;
  deletedAt?: string | null; // set when soft-deleted (Trash); cleared on restore (BUG-369)
  deletedBy?: string | null;
  version: number; // optimistic locking
  order: number; // position within stage
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  scopedAt?: string | null;
  completedAt?: string | null;
  endedAt?: string | null;
};
```

### Team (TypeScript)

```typescript
type Team = {
  id: string;
  name: string;
  color: string;
  allowedTicketTypes: string[];
  fieldOverrides: Record<string, { visible: boolean; required: boolean }>;
  workUnitSeries: WorkUnitSeriesConfig;
  accessControl: { mode: 'all' | 'specific' | 'inherit'; users: string[] };
  defaultZoneId: string;
  defaultStageId?: string;
  preset?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  order: number;
};
```

### Customer (TypeScript)

```typescript
type Customer = {
  id: string;
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  territory?: string | null;
  lifecycleStage: string; // e.g. "stage-prospect"
  ownerId?: string | null;
  ownerName?: string | null;
  flags: string[];
  source?: string | null;
  contractStartDate?: string | null;
  contractTerm?: string | null;
  renewalDate?: string | null;
  contractValue?: number | null;
  products?: string[] | null;
  productNotes?: string | null;
  notes: string;
  contacts: Contact[];
  openTicketCount: number;
  lastContactDate?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
```

### OpsConfigResponse (TypeScript)

```typescript
type OpsConfigResponse = {
  ticketTypes: TicketType[]; // id, name, prefix, icon, color, defaultFields
  statuses: Status[]; // deprecated
  fields: FieldDefinition[]; // id, name, fieldType, category, options, isSystem
  staff: StaffProfile[]; // id, name, email, role, avatarUrl, isActive
  projects: Project[]; // id, name, description, color, isActive
  crmConfig: CrmConfig; // lifecycleStages, customerFlags, documentTypes, territories, industries
  supplierConfig: SupplierConfig;
  linkConfig: LinkConfig; // linkTypes: { id, name, inverse, causesBlocked }
  lastStaffSyncedAt?: string | null;
};
```

Full TypeScript types: `numa-frontend/src/types/ops.ts`
Zod schemas: `lib/ops-schemas.ts`

---

## Team Presets

When creating a board via the wizard, users pick a preset that defines the initial zones and stages:

| Preset ID     | Name                  | Zones                                         |
| ------------- | --------------------- | --------------------------------------------- |
| `standard`    | Blank Board           | Backlog + Board (basic stages)                |
| `development` | Product Development   | Backlog + Sprint (with Review stage)          |
| `support`     | Support Desk          | Tickets (kanban, no backlog)                  |
| `monthly`     | Monthly Cycles        | Pipeline + Board                              |
| `solo`        | Solo Consultant       | Work (simple kanban)                          |
| `simple`      | Basic Kanban          | Board (To Do / In Progress / Done)            |
| `mining`      | Mining / Logistics    | Logistics + Maintenance                       |
| `enterprise`  | Enterprise Portfolio  | Portfolio Backlog + Execution                 |
| `work_mgmt`   | Work Management       | Board (To Do / Doing / Blocked / Done)        |
| `supplier`    | Supplier Management   | Suppliers (pipeline stages)                   |
| `software`    | Software Engineering  | Backlog + Sprint (with Code Review)           |
| `sales`       | Sales Pipeline        | Sales Playbook (10-stage pipeline)            |
| `legal`       | Legal Case Management | Cases (Intake / Discovery / Drafting / Filed) |

Defined in: `numa-frontend/src/constants/opsConstants.ts` and `lib/ops-constants.ts`

---

## Entity Relationships

```
Team (Board)
  |-- has many --> Zones
  |       |-- has many --> Stages
  |-- has many --> Work Units (Sprints)
  |-- has many --> Tickets
          |-- has many --> Comments
          |-- has many --> Links (to other Tickets)
          |-- has many --> Audit Entries
          |-- belongs to --> Stage (within a Zone)
          |-- optionally --> Work Unit
          |-- optionally --> Project
          |-- optionally --> Customer
          |-- optionally --> Supplier

Customer
  |-- has many --> Activities
  |-- has many --> Documents
  |-- has many --> Tickets (via ticket.customerId)

Supplier
  |-- has many --> Activities
  |-- has many --> Documents
  |-- has many --> Tickets (via ticket.supplierId)
```

---

## Seed Data

The `seed-ops-config` Lambda runs at deploy time and seeds:

- **Ticket Types:** Feature (FEAT), Bug (BUG), Task (TASK), Service Request (SRQ)
- **Fields:** ~20 system fields (name, description, priority, assignee, effort points, severity, client, due date, reporter, project, tags, work unit, customer, supplier, etc.)
- **CRM Config:** Default lifecycle stages (Prospect, Qualified, Active, At Risk, Churned), flags, document types, territories, 20+ industries
- **Supplier Config:** Default stages, flags, document types
- **Link Config:** blocks/depends_on, related_to

---

## View State

The `useOpsData` hook manages view state persisted to localStorage:

| State              | localStorage Key              | Values                                                             |
| ------------------ | ----------------------------- | ------------------------------------------------------------------ |
| Active team        | `numa_ops_active_team`        | Team ID                                                            |
| Active zone        | `numa_ops_active_zone`        | Zone ID                                                            |
| Board view mode    | `numa_ops_board_view_mode`    | `allTeams` or `singleTeam`                                         |
| Top-level view     | `numa_ops_top_view`           | `home`, `board`, `allTickets`, `customers`, `suppliers`, `roadmap` |
| Selected work unit | `numa_ops_selected_work_unit` | Work unit ID                                                       |

The `opsCache` utility provides stale-while-revalidate caching: components render immediately from cache, then fresh data loads in the background.

---

## i18n

All user-facing strings use `react-i18next` with the `ops` namespace. Translation file: `numa-frontend/src/locales/en/ops.json`.

---

## Mental Model for Ops Tasks

1. **Ian's POC is the gold standard** -- when in doubt about feature parity or field structure, match his design.
2. **The structure is largely in place** -- 3 Lambdas, 3 DynamoDB tables, full CRUD, kanban UI, CRM views, admin settings. Most new work is adding missing fields, functionality gaps, and UI/UX polish.
3. **Tickets are the most complex entity** -- they have many fields, link to other entities (projects, customers, suppliers, other tickets), and appear in multiple views (kanban card, backlog row, all-tickets table, ticket detail modal, chat tool results).
4. **Teams = Boards** -- the API says "team", the UI says "board". Keep this mapping consistent.
5. **Zones contain stages** -- a zone is backlog or board type, stages are the actual columns. A stage's `statusType` must be valid for its parent zone's type.
6. **Work units are sprints** -- optional per-team, with planning/active/completed lifecycle and ticket rollover support.
7. **Config is loaded once** via `GET /api/ops/config` (bulk endpoint) -- ticket types, fields, staff, projects, CRM settings all come in one call. The frontend caches this.
8. **Staff comes from Cognito** -- the staff sync endpoint pulls users from Cognito and enriches with chat profile data (name, job title, avatar). No manual staff creation needed.
9. **The workspace agent can do everything** -- the MCP tool exposes all ops operations. Reads are auto-approved, writes need user approval.
10. **Feature flag is `numaOps`** in client config (`NUMA_OPS` in frontend config). When off, no infra is deployed and the route is hidden.
