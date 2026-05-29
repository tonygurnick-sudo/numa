# SPK-004 — Partners Entity Technical Design

**Spike:** SPK-004 — SPIKE: Partners Entity — Numa Ops CRM
**Status:** Design complete; awaiting build approval
**Branch:** `spike/spk-004`

This document is the output of the SPK-004 design spike. It validates the Partners entity proposal against the existing Numa Ops codebase, locks in implementation approaches for the relationships and config layers, and provides a defensible v1 effort estimate.

---

## 1. Spike Goals Status

| Goal                                                            | Status                          | Section |
| --------------------------------------------------------------- | ------------------------------- | ------- |
| Validate data model against existing CRM table access patterns  | ✅ Validated                    | §2      |
| Confirm Partner → Customer relationship implementation approach | ✅ Confirmed (FK + reverse GSI) | §3      |
| Assess effort for custom fields reuse vs new implementation     | ✅ 8/9 types reusable as-is     | §4      |
| Produce technical design doc and effort estimate for v1 build   | ✅ This doc, ~30 dev-days       | §6, §7  |

---

## 2. Data Model Validation — `numa-{client}-ops-crm`

The CRM table is **fully extensible** for a third entity type. Zero CDKTF/schema changes required.

**Construct:** `infra/constructs/ops-construct.ts:118-152`

### Polymorphic key design

The PK/SK and GSIs are already polymorphic over entity type via string prefixes:

| Index   | Key                      | Customer          | Supplier          | Partner (proposed)  |
| ------- | ------------------------ | ----------------- | ----------------- | ------------------- |
| Base PK | `{TYPE}#{id}`            | `CUSTOMER#…`      | `SUPPLIER#…`      | `PARTNER#…`         |
| GSI1PK  | `ENTITY#{TYPE}`          | `ENTITY#CUSTOMER` | `ENTITY#SUPPLIER` | `ENTITY#PARTNER`    |
| GSI1SK  | `STAGE#{stage}#{id}`     | ✓ (kanban-ready)  | ✓                 | ✓ — works unchanged |
| GSI2PK  | `{TYPE}_OWNER#{ownerId}` | `CRM_OWNER#…`     | `SUP_OWNER#…`     | `PARTNER_OWNER#…`   |
| GSI2SK  | `{TYPE}#{id}`            | ✓                 | ✓                 | ✓                   |

### Already entity-agnostic in Lambda code

The CRM API (`lambdas/node/numa-ops-crm-api/index.ts`) already accepts entity type as a parameter for shared concerns:

- `handleActivities(entityType, entityId, …)` — line 674
- `handleDocuments(entityType, entityId, …)` — line 764

These work for Partners with no code changes.

### Hardcoded touch-points (require a Partner branch)

| File                                                | Item                                  | Change                                                              |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `lambdas/node/numa-ops-crm-api/index.ts:325-507`    | `handleCustomers`                     | Duplicate as `handlePartners` (~240 LOC, copy of `handleSuppliers`) |
| `lambdas/node/numa-ops-crm-api/index.ts:873-880`    | Route switch                          | Add `case 'partners':`                                              |
| `lambdas/node/numa-ops-crm-api/index.ts:258`        | `reconcileOpenTicketCount` type union | Broaden to `'CUSTOMER' \| 'SUPPLIER' \| 'PARTNER'`                  |
| `lambdas/node/numa-ops-config-api/index.ts:936`     | Config route switch                   | Add `case 'partner-settings':` + `handlePartnerSettings` (~50 LOC)  |
| `lambdas/node/seed-ops-config/seed-data.ts:354-461` | Seed data                             | Add `DEFAULT_PARTNER_CONFIG` mirroring `DEFAULT_SUPPLIER_CONFIG`    |
| `lib/ops-schemas.ts:477-499`                        | Schemas                               | Add `partnerSchema`, `partnerConfigSchema`                          |

**Verdict:** The PARTNER_CONFIG mirroring claim in the spike is accurate. Pattern is well-established. No architectural blockers.

---

## 3. Partner → Customer Relationship

**Decision:** FK on Customer + reverse GSI — mirrors the existing Ticket → Customer pattern.

### Why this approach

The existing Ticket↔Customer link (`lambdas/node/numa-ops-api/index.ts:1498-1544`) uses FK + denormalised reverse-index rows in GSI2. It is proven, performs well, and has no join-table overhead. No reason to invent a new pattern.

### Schema changes

```typescript
// Customer (lib/ops-schemas.ts:448-475)
partnerId?: string | null
partnerName?: string | null  // denorm for display
```

### Reverse-lookup mechanism

When a Customer is created/updated with a `partnerId`, write an additional GSI2 entry:

```
PK: CUSTOMER#{customerId}
SK: META
GSI2PK: PARTNER#{partnerId}
GSI2SK: CUSTOMER#{customerId}
```

This enables `GET /api/ops/customers?partnerId=X` and powers the **"Linked Customers"** panel on the Partner detail page. Same shape as `listTickets({ customerId })` on `CustomerDetailModal.tsx:182-234`.

### Aggregate MRR

Numa Ops has **no generic rollup framework.** The only precedent is `openTicketCount` on Customer/Supplier META (`lambdas/node/numa-ops-crm-api/index.ts:258-281`) — denormalised counter with lazy reconciliation.

Use the same pattern for Partner aggregates:

- Store `aggregateMrr` and `linkedCustomerCount` on Partner META
- Recompute on customer create/update/delete that touches `partnerId` or `mrr`
- Lazy reconcile from a live GSI2 count when Partner detail loads (handles drift)
- No scheduled jobs needed

### Partner → Ticket links

Trivial extension of the existing ticket-link index:

1. Add `partnerId` / `partnerName` to ticket schema (`lib/ops-schemas.ts:329-332`)
2. Write `IDX_PARTNER` index row alongside existing `IDX_CUSTOMER` / `IDX_SUPPLIER` (`numa-ops-api/index.ts:1520-1541`)
3. Reuse `LinkedTicketsSection` on the Partner detail modal (already parameterised by entity)

### Caveats

- Denormalised `partnerName` on Customer needs sync on Partner rename (one-shot GSI scan + batch update)
- A ticket can now link to Customer + Partner simultaneously — UX needs to clarify there is no implicit hierarchy. **Recommendation:** treat the two links as orthogonal, no parent/child relationship implied.

---

## 4. Custom Fields — Reusability Assessment

### Coverage of v1 field types

| v1 type                                                  | Status         | Implementation                                                                               |
| -------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| text, number, currency, date, select, boolean, URL, user | ✅ implemented | `DynamicField.tsx:201-369`                                                                   |
| **relationship**                                         | ❌ **missing** | Field-type enum has only single-valued `customer` / `supplier` refs (`ops-schemas.ts:19-34`) |

### Key architectural findings

- **Field definitions are globally scoped, not per-entity** (`numa-ops-config-api/index.ts:439-496`) — one field def can power Customer, Supplier, and Partner without duplication
- `DynamicField` dispatches purely on `field.fieldType`, never on entity type — Partner record forms reuse it unchanged
- **Suppliers currently have no `customFields` property** in their schema (`lib/ops-schemas.ts:477-499`) — a pre-existing gap. Worth fixing alongside Partner work (one-line schema change)

### Recommendation: defer `relationship` field type

The `relationship` type is the only gap, but it is **not needed for v1**:

- The Partner→Customer link is a first-class FK (see §3), not a generic custom-field relationship
- A `relationship` field type would only be needed if tenants wanted to define _arbitrary additional_ 1:many links via the field-definition UI — not in v1 scope

Defer to v1.1 if tenant demand emerges. Adding it later is +3–5 days.

### Effort to wire Partner into custom fields

**~2–3 days** of pure wiring:

1. Add `customFields: Record<string, unknown>` to Partner schema
2. Seed `partnerRecord: { sections: [...] }` in `PARTNER_CONFIG`
3. Create `PartnerRecordSectionBlock` (copy from `CustomerRecordSectionBlock`)
4. No `DynamicField` changes

---

## 5. Lifecycle, Milestones, Flags

| Feature                                               | Existing pattern?                                                              | Effort   | Notes                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle stages (flat per entity)                    | ✅ Yes — fully tenant-configurable                                             | 1–2 days | Mirror CRM_CONFIG.lifecycleStages in PARTNER_CONFIG                                                                                                                                                  |
| **Per-sub-type stage variants** (Channel vs Tech/GTM) | ❌ No — both existing configs are flat                                         | 2–3 days | Extend PARTNER_CONFIG with `subTypeVariants: Record<subType, { stages, defaultStageId }>`. Add `partnerSubType` field on Partner record. Mirrors `fieldOverrides` pattern (`ops-schemas.ts:251-254`) |
| Stage-based kanban grouping                           | ✅ Yes — GSI1 partitions by stage                                              | 0 days   | `CrmMirrorView` / `SupplierMirrorView` are config-driven; reuse with PartnerConfig                                                                                                                   |
| Configurable boolean flags                            | ✅ Yes                                                                         | 0 days   | Seed `partnerFlags` in PARTNER_CONFIG — frontend renders unchanged                                                                                                                                   |
| **Milestone tracker (checklist)**                     | ❌ **Greenfield** — no checklist pattern anywhere in Ops/agents/scheduled-runs | 4–5 days | New schema (`milestones: [{ id, name, completed, completedAt, completedBy }]`), CRUD endpoints, frontend component                                                                                   |
| **Milestone Score (computed)**                        | Pattern only — `openTicketCount` is the closest precedent                      | 1 day    | `score = completed / total`. Denormalised on Partner META; recompute on milestone toggle                                                                                                             |
| Document types                                        | ✅ Yes — config array, entity-agnostic component                               | 0 days   | Seed Partner doc types (Partnership Agreement, NDA, Activation Plan, etc.)                                                                                                                           |

**The milestone tracker is the only genuinely new build in the entire spec.** Everything else is config or copy-paste.

---

## 6. Frontend Effort

| Surface                                                                                                                              | Approach                                                                                                     | Days |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---- |
| `PartnerDetailModal`                                                                                                                 | Copy `SupplierDetailModal` (~750 LOC), swap fields/config                                                    | 3    |
| `PartnerMirrorView` (list + kanban)                                                                                                  | Copy `SupplierMirrorView` — filters / sorts / saved views / column picker / dnd-kit kanban all config-driven | 2    |
| `PartnerCard`                                                                                                                        | Copy `CustomerCard`, adjust styling                                                                          | 0.5  |
| `ActivitySection`, `DocumentSection`, `ContactSection`                                                                               | Already parameterised — broaden `entityType` union to include `'partner'`                                    | 0.5  |
| Routing — add `'partners'` to `OPS_TOP_VIEWS` (`OpsHeader.tsx:25-32`), `OpsTopView` union (`useOpsData.ts:52`), `OpsPage.tsx` switch | Light param                                                                                                  | 0.5  |
| `OpsService` — `getPartner` / `createPartner` / `updatePartner` / `deletePartner`                                                    | Copy Customer pattern                                                                                        | 0.5  |
| **`LinkedCustomersPanel`** (new) — table with MRR aggregate row                                                                      | Copy `LinkedTicketsSection` shape                                                                            | 1.5  |
| **`MilestoneTracker`** (new) — checklist UI + score badge                                                                            | Greenfield                                                                                                   | 2    |
| i18n keys, types, hooks wiring                                                                                                       |                                                                                                              | 1    |

**Frontend total:** ~11–12 days

---

## 7. v1 Effort Estimate

| Stream                                                                  | Days                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Backend — PARTNER_CONFIG + seed data + handler copies + config API      | 2                                                                  |
| Backend — Partner CRUD handlers, schemas, types                         | 2                                                                  |
| Backend — Partner → Customer FK + GSI2 reverse index + counter          | 2                                                                  |
| Backend — Partner → Ticket link (IDX_PARTNER + schema fields)           | 1                                                                  |
| Backend — Sub-type stage variants config + validation                   | 2                                                                  |
| Backend — Milestone CRUD + score computation                            | 3                                                                  |
| Backend — Aggregate MRR computation + reconciliation                    | 1                                                                  |
| Frontend — all surfaces above                                           | 12                                                                 |
| Custom fields wiring (relationship type deferred)                       | 2                                                                  |
| Tests — backend Vitest + frontend Vitest + a couple of Playwright flows | 3                                                                  |
| **Total**                                                               | **~30 dev-days** (≈ 6 weeks one engineer, ≈ 3 weeks two engineers) |

---

## 8. Out of Spec (worth flagging)

Items not strictly in the spike but discovered during research:

- **Supplier `customFields` gap** — Suppliers don't have `customFields` in their schema today (`lib/ops-schemas.ts:477-499`). Customer does. One-line fix; worth doing while adding Partner's `customFields`. Otherwise the parity story between the three entities is uneven.
- **Triple-duplicated CRUD handlers** — `handleCustomers` / `handleSuppliers` / `handlePartners` would be ~700 LOC of near-identical code. A 1-day refactor pass to parameterise these on entity-type metadata would pay back across all three. Decide before vs. after v1.
- **Denormalised `partnerName` on Customer** — needs a sync path on Partner rename. Either a one-shot GSI scan + batch update on save, or a Lambda trigger on Partner META updates. Small but real.
- **HQ stack as testbed** — SPK-004 is being designed against HQ (Arcanum's dogfooded instance). Suggest building Partners with HQ as the first tenant, then promoting to general availability via the `numaOps` flag.

## 9. Open Questions

To resolve before build kicks off:

1. **Customer + Partner on the same Ticket?** A ticket can already link to both Customer and Supplier; adding Partner makes it three. **Recommendation:** parallel optional links, no implicit hierarchy — confirm.
2. **Sub-type mutability** — If a Channel partner converts to Tech/GTM, do stage values migrate or reset? Recommendation: mutable with a stage-mapping UI step when `partnerSubType` changes — confirm.
3. **MRR source of truth** — The spike assumes Customer has an MRR field for aggregation. Confirm whether it is a built-in `monthlyRecurringRevenue` field or a custom currency field — this determines whether aggregation runs in the API layer or via the custom-fields layer.
4. **Activation milestone defaults** — Who supplies the "default 10 activation milestones"? Belongs in `PARTNER_CONFIG` seed data, but the actual content needs to come from partner ops / sales.
5. **Visual distinctness for Tech vs GTM partners** — Spike calls for them to be "visually distinct" on kanban. Lane header badge? Per-sub-type colour palette? Need a design call before frontend build.

---

## 10. Recommended Build Order

The spike's ordering is correct except for one swap — **do Partner → Customer FK before custom fields**, since the FK is the dominant differentiator vs Customers/Suppliers and de-risks the relationship UX early.

1. `PARTNER_CONFIG` seed + config API endpoints
2. Partner CRUD (backend + minimal detail modal)
3. List + Kanban (cheap reuse of mirror view)
4. **Partner → Customer FK + Linked Customers panel** ← moved up
5. Custom fields (already free for 8/9 types)
6. Activity feed (rebind)
7. Partner → Ticket links (IDX_PARTNER)
8. Milestone tracker (the only real new build)
9. v1.1: Email auto-logging + `relationship` field type if tenant demand emerges

---

## 11. Reference Files

| Concern                            | File                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| CRM table schema                   | `infra/constructs/ops-construct.ts:118-152`                                        |
| Customer/Supplier CRUD handlers    | `lambdas/node/numa-ops-crm-api/index.ts:325-670`                                   |
| Config API (CRM/Supplier settings) | `lambdas/node/numa-ops-config-api/index.ts:830-870`                                |
| Seed defaults                      | `lambdas/node/seed-ops-config/seed-data.ts:354-461`                                |
| Schemas (entities + configs)       | `lib/ops-schemas.ts`                                                               |
| Ticket↔Customer link pattern       | `lambdas/node/numa-ops-api/index.ts:1498-1544`                                     |
| Linked tickets panel               | `numa-frontend/src/Components/Ops/Modals/CustomerDetailModal.tsx:182-234, 802-939` |
| Custom field rendering             | `numa-frontend/src/Components/Ops/Shared/DynamicField.tsx`                         |
| Activity feed (entity-agnostic)    | `numa-frontend/src/Components/Ops/Shared/ActivitySection.tsx`                      |
| Document section (entity-agnostic) | `numa-frontend/src/Components/Ops/Shared/DocumentSection.tsx`                      |
| CRM list/kanban view               | `numa-frontend/src/Components/Ops/CrmView/CrmMirrorView.tsx`                       |
| Supplier list/kanban view          | `numa-frontend/src/Components/Ops/CrmView/SupplierMirrorView.tsx`                  |
| Ops navigation tabs                | `numa-frontend/src/Components/Ops/OpsHeader.tsx:25-32`                             |
| Ops view state                     | `numa-frontend/src/Components/Ops/useOpsData.ts:52`                                |
