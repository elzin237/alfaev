# AlfaEV — ARCHITECTURE_RULES.md

Status: Canonical architecture rules v1  
Purpose: Define non-negotiable implementation rules so AlfaEV remains scalable, secure, reviewable, and maintainable from day one.

---

## 1. Core Principle

AlfaEV must be built as a modular TypeScript application with clear feature boundaries.

The goal is not enterprise overengineering. The goal is to avoid a codebase that becomes difficult to change after a few modules are added.

Implementation must favor:

- small focused files
- reusable components
- reusable domain/services
- explicit business-rule boundaries
- trusted backend authorization
- shared types
- predictable folder structure
- testable pure logic
- minimal cross-feature coupling

---

## 2. TypeScript / TSX Only

Application source uses:

- `.tsx` for React components/pages/layouts
- `.ts` for domain logic, services, types, validation, utilities, configuration, and data access

Do not introduce new `.jsx` or application `.js` files.

TypeScript must remain strict.

Do not use:

- `any`
- `as any`
- `@ts-ignore`
- `@ts-nocheck`
- broad unsafe casts to silence errors

---

## 3. No Giant Files

Do not allow pages/components/services to become monolithic.

A file should have one clear responsibility.

Examples of things that should normally be separated:

- page shell
- table
- form
- dialog
- filters
- status badge
- domain validation
- permission checks
- data access
- mutations
- business-rule calculations
- PDF generation
- barcode generation/scanning helpers

Do not split files mechanically into meaningless micro-files. Split when there is a clear responsibility or reuse boundary.

---

## 4. Feature-Oriented Structure

Prefer a feature-based structure.

Conceptual example:

```text
src/
  app/
    router/
    layouts/
    guards/

  features/
    projects/
      components/
      hooks/
      services/
      types/
      validation/

    procurement/
    suppliers/
    inventory/
    pcb/
    work-orders/
    documents/
    fixed-assets/
    calendar/
    archive/
    users/

  shared/
    components/
    hooks/
    lib/
    types/
    validation/

  backend/
    clients/
    services/
    auth/
```

Exact folders may adapt to the existing repository, but the boundaries must remain clear.

Do not create one giant global `components/` or `utils/` dumping ground.

---

## 5. UI Components Must Not Own Critical Business Logic

TSX components should primarily:

- render UI
- collect user input
- call typed hooks/services/actions
- display loading/error/success states
- coordinate local presentation state

Critical business rules must not live only inside page/component event handlers.

Examples that must live in trusted domain/backend logic:

- Serial Number / Šifra generation
- Work Order number generation
- permission enforcement
- Inventory non-negative validation
- Work Order Finish
- PCB production
- audit creation
- BOM versioning rules
- completed-record immutability
- manual stock adjustment rules

The frontend may repeat lightweight validation for UX, but the trusted backend must remain authoritative.

---

## 6. Shared Domain Types

Do not duplicate core interfaces/types across features.

Canonical shared/domain types should exist for concepts such as:

- User
- Permission
- Product
- Brand
- Supplier
- ProductSupplier
- Project
- ProjectProduct
- ProjectProductComponent
- ProjectActivityUpdate
- ProjectActivityAttachment
- ProjectActivityAlert
- ProjectActivityAlertRecipient
- ProcurementRequest
- PcbCard
- PcbBomVersion
- PcbProductionRun
- WorkOrder
- WorkOrderItem
- DocumentationRecord
- FixedAsset
- InventoryMovement
- CalendarEntry
- AuditLog

Feature-specific UI-only types may remain local.

Do not create a single enormous `types.ts` file containing the entire application.

Prefer bounded type modules grouped by domain.

---

## 7. Reusable UI

Reusable UI should be extracted when multiple modules share the same behavior.

Likely shared primitives include:

- table shell
- pagination
- search input
- filter controls
- status badge
- empty state
- confirmation dialog
- form field wrappers
- modal/dialog shell
- permission-aware action wrapper
- loading state
- error state
- page header
- barcode display/download component

Reuse should reduce duplication without forcing unrelated screens into one overly generic abstraction.

---

## 8. Validation

Input validation must be explicit and centralized.

Use typed schemas/validators for forms and trusted mutations.

Validation must exist at the correct layer:

### Frontend
For immediate UX feedback.

### Backend/database
For authoritative enforcement.

Do not rely on React form checks alone for critical rules.

---

## 9. Data Access Boundaries

React pages/components must not contain scattered direct database calls.

Use a defined data-access/service layer.

Each feature should expose clear operations, for example:

```text
projects.list()
projects.getById()
projects.create()
projects.update()
projects.listActivity()
projects.postActivity()
projects.listAlerts()
projects.markAlertRead()

inventory.getProduct()
inventory.adjustStock()
inventory.getMovements()

workOrders.createDraft()
workOrders.updateDraft()
workOrders.finish()
```

Exact implementation names may differ.

The important rule is that database details should not leak throughout TSX components.

---

## 10. Trusted Backend Mutations

Critical operations must execute through trusted server/database boundaries.

At minimum:

- create Product with unique Serial Number
- manual Inventory adjustment
- create Product from Nabavka request
- PCB production
- Work Order Finish
- Project Product/component planning mutations
- Project Activity post/alert fanout and per-recipient mark-read/dismissal
- Documentation record and private PDF mutations
- Fixed Asset mutations
- Work Order number allocation
- permission changes
- Admin status changes
- account deactivation
- audit record creation for protected operations

These operations must validate:

- authenticated actor
- authorization
- current record state
- business rules
- inventory availability where relevant

---

## 11. Atomic Transactions

Critical multi-record workflows must be atomic.

### PCB production
Creation is one atomic idempotent Draft-Work-Order transaction with no Inventory or production-run write. Later Work Order Finish is a second atomic transaction in which either all occur:

- input stock deductions
- production record
- finished-goods stock increase
- Inventory movements
- Audit record
- Work Order/PDF finalization

or none occur.

### Work Order Finish
Either all required state transitions succeed coherently, or the Work Order must not
appear successfully Finished. This boundary includes physical Inventory deductions,
InventoryMovement rows, Work Order finalization, actual Project-consumption linkage,
automatic Project completion when this is the final unfinished Work Order, release of
unused commitment, and required audit history.

### Manual Inventory adjustment
Balance change, movement record, and audit record belong to one trusted transaction.

### Project Activity post / alert send
The database transaction must atomically create the Activity, optional alert event,
snapshotted recipients, and narrow AuditLog events. Zero eligible recipients for alert
intent fails the whole transaction. One client-generated request UUID is the
authoritative idempotency key and is permanently bound to the original Activity author:
that author's identical retry returns the same Activity, that author's conflicting
reuse fails with `PAC01`, and every other actor is denied with generic `42501` before
payload comparison. Exact historical replay creates no new fanout, audit, attachment,
or other mutation and does not reapply writable-Project validation.

Private image upload cannot share the PostgreSQL transaction. After the Activity post
transaction succeeds, use a trusted Edge boundary that validates bytes/decoded image,
chooses a random path, uploads with service-role authority, invokes the author-bound
idempotent attachment operation, removes definite orphans best-effort, and reconciles
indeterminate outcomes without deleting a possibly committed referenced object. A
failed image step may leave the committed text Activity available for retry.
The V1 upload boundary binds the verified Edge actor to the immutable Activity author
and original request UUID. Private reads resolve the exact database reference through a
server-only helper and return only a five-minute signed URL plus list-safe metadata.

Never allow partial Inventory state.

---

## 12. Permission Architecture

Authorization is backend-enforced.

Rules:

- Admin always has full access.
- Non-admin access comes from explicit per-user permissions.
- frontend hiding/disabled controls are UX only
- direct unauthorized backend/database attempts must fail
- Users module is Admin-only
- Dokumentacija and Osnovna sredstva are Admin-only
- permission management is Admin-only
- Calendar modification is Admin-only
- manual Inventory adjustment is Admin-only

Project alert recipient selection is distinct from alert posting authorization. Every
active Admin is included automatically in each new recipient snapshot. A non-admin
recipient requires an explicit stored `projects.alerts.receive` assignment plus
current active state and effective `dashboard.view` and `projects.view` access. An
alert sender is included whenever that sender satisfies the same Admin or non-admin
eligibility rules as every other recipient.

Permission checks should be reusable and centralized rather than duplicated manually throughout components.

---

## 13. Audit Architecture

Audit logging is a cross-cutting system concern.

Do not require each random TSX component to manually construct audit records.

Trusted business operations should create the required audit event centrally.

Audit records are immutable.

Audit must capture meaningful business changes without logging useless UI interaction noise.

This includes Documentation/PDF changes, Fixed Asset changes, Project planning
changes, Work Order Finish, and automatic final-Work-Order Project completion.

Project Activity is not AuditLog. Store the human title/description/image in the
Project Activity domain. Audit only narrow `project_activity.created` and optional
`project_activity.alert_sent` system events without copying full free text or image
content. Per-recipient mark-read and dismissal create no audit noise.

Project Issue resolution is a separate immutable child record, never an update to the
original Activity. Its trusted transaction locks the request UUID, target Activity,
Project, active resolver, then eligible recipient profiles; it inserts exactly one
resolution, one typed notification event, recipient snapshot, and narrow
`project_activity.issue_resolved` audit. The automatic fanout is independent of manual
alert send/receive permissions and may validly contain zero recipients. Existing
five-argument posting/read contracts remain compatible. Resolution evidence uses a
separate immutable attachment record and `resolution-final/...` namespace in the
existing private Activity-image bucket. Trusted prepare/attach/reconcile helpers bind
the original resolver and resolution request UUID; the browser receives only narrow
metadata and a separately authorized 300-second signed URL, never a Storage path.

---

## 13A. Project Activity / Alert Read Architecture

Activity and alert reads use trusted bounded projections, never direct unbounded table
access. Activity pages use `(created_at, id)` keysets and notification pages use
`(created_at, recipient_row_id)` keysets, newest first, default 20, allowed 1–50.
Deep links use a narrow authorized by-ID Activity read when the target is outside
loaded pages. Keep that profile/Project/Activity-scoped target query separate from the
infinite timeline cache: render an older target as a labelled sibling of the
chronological list, deduplicate it when a normal page contains the same ID, and never
rewrite pages or cursors to simulate ordering. Strict hash parsing occurs before the
target query; malformed and unrelated hashes make no target request.

Deep-link presentation is keyed by profile, Project, Activity, and React Router
navigation entry. After the exact row mounts, use explicit bounded-container geometry
rather than unqualified `scrollIntoView`, focus the target with `preventScroll`, and
apply only a temporary non-layout-shifting highlight. The operation is one-shot per
navigation entry; background timeline/image updates and ordinary pagination must not
retrigger it. Timers are cleaned up and reduced-motion preferences disable smooth
positioning. H4 retains real-browser geometry and history acceptance.

The Dashboard Alerts control belongs to the Dashboard content-heading feature, not
the global Topbar. Explicit profile-scoped refetches remain authoritative. The
Realtime database foundation may emit only event `invalidate` on the private
`project-alert-notifications:<profile-uuid>` topic after a recipient inbox or unread-count
change. The database supplies `{}` to `realtime.send`; Supabase appends exactly one
opaque transport `id` UUID. The frontend ignores that payload, which contains no
business identity or content. Topic SELECT authorization requires the active owner and
effective Dashboard/Project access; browsers receive no INSERT policy and no direct
recipient-table access. The signal carries no row, business identifier, count, or content and
exists only to refetch the trusted inbox/count RPCs. Task 001C2 owns the frontend
subscription lifecycle: one AppLayout-level channel captures the current profile,
coalesces in-flight invalidations with at most one trailing reconciliation, reconciles
after every successful subscribe/reconnect, and tears down plus purges protected cache
on identity/access loss. Polling remains prohibited.

Recipient read and dismissal timestamps are independent, one-way state transitions on
the retained recipient row. Direct browser table updates remain forbidden. The trusted
dismissal mutation must lock in `UserProfile -> recipient row` order, recheck current
active Dashboard/Project access and ownership after blocking, use server time, and make
identical retries idempotent. Admin access never bypasses ownership. Client cache
reconciliation is profile-scoped and occurs only after confirmed backend success.

---

## 14. Inventory Architecture

Inventory must never be modeled only as a mutable quantity.

Use:

- current balance
- immutable Inventory Movement ledger

All stock changes must pass through trusted Inventory logic.

No feature should directly set Inventory quantity.

Projects, PCB, Work Orders, and future features must interact with Inventory through defined operations.

ProjectProductComponent requirements are planning commitments, not physical stock
reservations. They never directly change InventoryBalance or create InventoryMovement.
The read model computes outstanding commitment independently for each Project/Product
pair, subtracting only qualifying physical consumption attributed to that same pair,
then sums the per-Project results by Product. Consumption from one Project never offsets
another Project's commitment. Derived availability compares physical stock with that
summed outstanding commitment and may be negative to expose shortages.

---

## 15. Historical Integrity

Do not silently rewrite historical business records.

Examples:

- Finished Work Orders are immutable.
- Used PCB BOM versions are immutable.
- Serial Numbers are never reused.
- Work Order numbers are never reused.
- Audit records are immutable.
- Inventory movements are immutable.
- historical users are deactivated rather than deleted.
- referenced Products/Suppliers/Brands are archived rather than hard-deleted.

Corrections should create explicit new correction/reversal records where needed.

---

## 16. Derived Data

Do not persist duplicate data unless required for history/performance.

Prefer derived queries/read models for:

- Project material totals
- outstanding Project commitments and available-after-commitments
- Nabavka sidebar badge count
- Calendar birthday entries
- Dashboard aggregates
- remaining Nabavka quantity

If a value is persisted for historical correctness, document why.

---

## 17. Naming and Readability

Use domain language consistently.

Preferred code terms:

- `Project`
- `ProjectProduct`
- `ProjectProductComponent`
- `ProcurementRequest`
- `Supplier`
- `Product`
- `InventoryMovement`
- `PcbCard`
- `PcbBomVersion`
- `PcbProductionRun`
- `WorkOrder`
- `DocumentationRecord`
- `FixedAsset`
- `CalendarEntry`
- `AuditLog`

UI may use localized labels such as:

- Nabavka
- Dobavljači
- Skladište
- Radni Nalozi
- Dokumentacija
- Osnovna sredstva

Avoid multiple code names for the same domain concept.

---

## 18. Dependency Direction

Higher-level UI depends on domain/service abstractions.

Domain/business logic must not depend on React UI.

Conceptually:

```text
TSX UI
  ↓
hooks / use-cases
  ↓
domain/services
  ↓
trusted backend/data-access
  ↓
database
```

Do not create circular feature dependencies.

Shared code must be genuinely shared, not merely moved to `shared/` to bypass boundaries.

---

## 19. Error Handling

Critical operations must return typed, intentional errors.

Examples:

- insufficient inventory
- unauthorized action
- record already Finished
- archived product
- duplicate/invalid state transition
- missing Project
- invalid BOM
- invalid Work Order state

Do not expose raw database errors directly to users.

UI should translate known domain errors into clear user-facing messages.

---

## 20. Scalability Without Premature Complexity

Do not pre-build unused ERP capabilities.

Do not add:

- microservices
- event buses
- CQRS
- complex plugin systems
- generic workflow engines
- unnecessary repository abstraction layers

unless the real product later requires them.

The architecture should scale by keeping boundaries clean, not by introducing enterprise patterns prematurely.

---

## 21. Code Review Expectations

Every Codex task should preserve:

- strict TypeScript
- small reviewable changes
- existing feature boundaries
- shared types
- centralized business rules
- backend-enforced permissions
- audit requirements
- transaction safety

Codex must not:

- silently redesign architecture
- create large all-purpose files
- duplicate existing domain logic
- bypass services for convenience
- move trusted rules into frontend-only logic
- weaken TypeScript/security to finish faster

---

## 22. File Size Guidance

There is no rigid line-count limit, but large files are a warning signal.

As a rule of thumb:

- page components should stay focused on page composition
- forms/tables/dialogs should be extracted when independently complex
- domain services should represent one domain/use-case area
- shared modules should not become giant catch-all files

If a file grows because it contains multiple responsibilities, split it before continuing to add features.

---

## 23. Architecture Definition of Done

AlfaEV architecture is considered healthy when:

- no critical business rule exists only in TSX
- no stock mutation bypasses trusted Inventory logic
- permissions cannot be bypassed through direct backend calls
- shared domain types are not duplicated
- features have clear ownership/boundaries
- historical records remain trustworthy
- critical workflows are atomic
- audit generation is centralized
- new modules can be added without rewriting existing modules
- no giant files become de facto application controllers
- the codebase remains understandable to a new engineer/Codex session from the canonical docs
Inventory source provenance is a database transaction boundary. Application code never chooses outbound lots. Trusted mutations lock Products/balances in canonical order, lock source lots by `(received_at, id)`, update aggregate balance and lot remainder, and append immutable allocations atomically. PDF generation may occur outside PostgreSQL only when a database-issued allocation fingerprint is revalidated under those same locks before Finish commits.
