# AlfaEV — BUSINESS_RULES.md

Status: Canonical business rules v1  
Purpose: Define business invariants that implementation must preserve.

Warehouse rollout status: migrations 136–142 are deployed to alfaev-dev (142/142);
DEV `finish-work-order` v6 is ACTIVE. The warehouse frontend is implemented locally,
and read-only browser acceptance is complete. Controlled Stage 2 mutation acceptance
is pending and non-Admin browser acceptance is incomplete. No frontend production
deployment or warehouse production database rollout has occurred; production remains
at its previously verified migration state. Finished Goods Project reservation and
fulfillment backend code is local in undeployed migrations 143–145; application
activation and reservation frontend remain pending.

---

## Task 001J warehouse listing contract

- Raw Materials retains existing Product visibility, including historical Calculator stock.
- Finished Goods lists only Calculator outputs linked by `pcb_cards.output_product_id`,
  including active/archived outputs and zero stock. Ordinary Products are excluded.
- Customs lists positive Customs balances or committed Customs movement history.
  Structural zero rows are hidden; depletion retains visibility; rollback creates none.
- Listing membership does not restrict trusted detail, adjustments, transfers or
  Work Order allocation. Existing ordinary-Product transfers into Finished Goods
  remain allowed but do not make those Products Calculator outputs.
- Calculator output stock means Finished Goods quantity. BOM input/picker stock stays
  Raw; historical stock is not reclassified.

## 1. General Principles

1. Meaningful business changes must be attributable to an authenticated user.
2. Important mutations must create immutable audit history.
3. Historical records must not be silently rewritten.
4. Inventory must never become negative.
5. Backend/database logic is authoritative for permissions and critical mutations.
6. UI hiding alone is never sufficient authorization.
7. Records with business history should be preserved rather than hard-deleted.

---

## 2. Dashboard Rules

Dashboard inherits module permissions.

- Admin sees the full Dashboard.
- Non-admin users may only see widgets/data backed by modules they are authorized to view.
- Explicitly company-wide information may be shown to all authenticated users.
- Calendar information may be treated as company-wide because Calendar viewing is available to all authenticated users.
- Dashboard must not expose unauthorized module data indirectly.

---

## 3. Project Rules

### Core fields and dates

- Project Name is required, trimmed before persistence, nonblank, and not unique.
- Customer is required, trimmed before persistence, nonblank, and not unique.
- Start Date and Delivery Date are required calendar dates.
- Delivery Date must be on or after Start Date.

### Statuses

Allowed database status values are exactly:

- `planned`
- `in_progress`
- `on_hold`
- `completed`
- `cancelled`

The default status is `planned`.

Do not impose a rigid general Project status-transition graph beyond the explicitly locked lifecycle rules.

### Lifecycle metadata

- `completed_at` is populated only while the current status is `completed`.
- `cancelled_at` is populated only while the current status is `cancelled`.
- Every other status requires both `completed_at` and `cancelled_at` to be `NULL`.
- Lifecycle timestamps are assigned by trusted backend operations and are never client inputs.
- An Admin-only `completed` to `in_progress` reopen clears the current `completed_at`; immutable AuditLog history preserves the completion and reopen events.

### Normal Project editing

- Normal Project editing requires an active Admin or `projects.edit`.
- Normal editable fields are Name, Customer, Start Date, Delivery Date, and normal status where allowed.
- The normal edit operation handles only `planned`, `in_progress`, and `on_hold`; it cannot set `completed` or `cancelled`.
- Project completion is produced only by the trusted final-Work-Order Finish flow, which sets `completed_at` server-side and keeps `cancelled_at` `NULL`.
- Normal edit/status mutation cannot move a Project out of `completed`. The only reopen is the explicit Admin-only `completed` to `in_progress` operation, which clears the current `completed_at` and is audited.
- These explicit lifecycle rules do not establish a broader rigid status-transition graph.

### Cancelled Projects

`cancelled` is the Project removal/archive lifecycle state and is reached only through an explicit trusted cancellation operation.

- Project cancellation/archive requires an active Admin or `projects.archive`; `projects.edit` alone does not authorize it.
- Only `planned`, `in_progress`, or `on_hold` Projects may be cancelled.
- Cancellation sets `cancelled_at` server-side and leaves `completed_at` `NULL`.
- Completed Projects cannot be cancelled directly.
- Cancelled Projects remain historically readable.
- Cancelled Projects are immutable, cannot change status, and cannot be normally edited.
- Projects are not hard-deleted through normal application workflows.
- Project does not use separate `is_active`, `archived_at`, or archived-by fields.
- Cancelled Projects cannot be restored/reactivated in the current scope.

### Mutation audit behavior

- Every meaningful Project edit, normal status change, or cancellation creates exactly one immutable AuditLog entry in the same atomic operation as the mutation.
- A normalized no-op normal edit/status submission creates no update and no audit entry.
- Denied or failed mutations leave both Project state and AuditLog unchanged.

### Project Products and planned material

- A Project may contain multiple Project Products, each representing a Project-specific grouping or deliverable rather than an Inventory Product.
- Project Product Name is required, trimmed, nonblank, not globally unique, and receives no Product Serial Number.
- A Project Product may contain multiple component requirements referencing stock-tracked AlfaEV Products.
- Required Quantity is the planned total whole-number requirement for that Project Product and must be greater than zero.
- The same Product cannot be duplicated within one Project Product.
- A newly selected or changed requirement Product must exist and be active. Later Product archival preserves historical references.
- Eligible requirement Products may include components and finished PCB goods; do not restrict the planning model to `component` only.
- Completed and Cancelled Projects cannot receive normal Project Product or component-requirement changes.
- Reads require an active Admin or `projects.view`; mutations require an active Admin or `projects.edit` and trusted backend enforcement.

### Material usage and outstanding commitment

Project material usage is derived automatically from completed linked operations.

Contributors:
- Finished Work Orders linked to the Project
- PCB production linked to the Project

Draft Work Orders do not count.

Material totals must remain traceable to the originating operations.

Planned requirements do not change physical Inventory. Commitment must be calculated
per Project and Product before aggregation. For every open Project P and Product X:

`planned_requirement(P, X) = sum of ProjectProductComponent.required_quantity for X within P`

`actual_project_consumption(P, X) = qualifying physical consumption of X attributable to P`

`outstanding_commitment(P, X) = max(planned_requirement(P, X) - actual_project_consumption(P, X), 0)`

Then:

`committed_to_projects(X) = sum of outstanding_commitment(P, X) across Projects currently in planned/in_progress/on_hold`

`eligible_physical_stock(X) = Raw Materials quantity + Customs Warehouse quantity`

`available_after_commitments(X) = eligible_physical_stock(X) - committed_to_projects(X)`

Finished Goods stock is excluded from Project availability and shared shortage in V1,
even though warehouse-aware Work Order Finish may consume a finished Product directly.

Consumption from one Project must never reduce another Project's commitment. Completed
and Cancelled Projects contribute zero. Reopening a Completed Project to `in_progress`
makes its own still-outstanding requirement contribute again, with only its own prior
physical consumption subtracted.

Qualifying consumption includes finished Work Order Inventory deductions linked to
the same Project and Product and Project-linked PCB production input deductions where
applicable. Inventory additions/output movements, unrelated manual adjustments, and
consumption belonging to another Project do not qualify. Raw PCB inputs and later
finished-PCB consumption must not be double-counted.

Availability is not clamped to zero; negative values indicate a shortage. Neither
commitments nor their release create InventoryMovement rows or directly change stock.

Project requirements are planning/reference data only. A generic Draft Work Order may
record any active eligible Inventory Product, whether or not that Product appears in
the selected Project requirements, and its quantity may exceed the Project's remaining
planned requirement. Selecting a Project supplies traceability and the trusted Customer
snapshot; it does not make Project requirements a materials whitelist, a quantity cap,
an Inventory reservation, or a stock mutation.

Persisted Draft WorkOrderItems remain the proposed actual material record for that Work
Order. They do not reduce Project requirements or physical Inventory. On successful
Finish, the exact persisted quantities are checked against authoritative physical
Inventory, deducted through immutable InventoryMovement history, and then qualify as
actual Project consumption where linked. Project commitment/read models remain derived
from planned requirements and qualifying completed physical consumption.

### Completed Projects

When the final unfinished Work Order is successfully Finished, the trusted Finish
operation automatically changes the Project to Completed in the same transaction.

When status becomes Completed:

- normal business fields become read-only
- historical material usage remains preserved
- Project remains preserved rather than being hard-deleted

Admin may explicitly reopen a Completed Project by changing it back to In Progress.

Reopening must create an audit event.

### Project Activity and alerts

Project Activity is immutable human-authored collaboration content, separate from the
immutable trusted system/business-event AuditLog. Each update belongs to one Project
and stores its retained author, a created timestamp, a unique client request UUID, a
required title, a required description, and at most one optional immutable image.
Each update is permanently classified as a General update or Issue; historical rows
are General updates.

The title is trimmed plain text, nonblank, and 1–120 characters. The description is
trimmed plain text, nonblank, and 1–5000 characters; internal newlines are preserved.
Frontend validation mirrors these rules, while the trusted backend is authoritative.
V1 Activity is append-only: there is no edit, delete, Admin delete, attachment replace
or remove, or alert resend. Corrections are posted as a new update.

An active Admin or active user with `projects.view` may read Activity, including a
deep-linked item. An active Admin or active user with `projects.edit` may post only
while the Project is `planned`, `in_progress`, or `on_hold`. Completed and Cancelled
Projects reject new posts but retain readable historical Activity.

`Post update` creates only Activity. `Post & send alert` creates the same Activity,
one alert event, and a recipient snapshot without duplicating Activity content into
notification rows. It requires both Activity-post authority and Admin or
`projects.alerts.send`. If there are no eligible recipients, the entire request fails
rather than silently posting Activity alone.

Every active Admin is an eligible recipient automatically. An eligible non-admin
recipient must be active, hold an explicit `projects.alerts.receive` assignment, and
have current effective `dashboard.view` and `projects.view` access. An alert sender is
included in the recipient snapshot whenever that sender satisfies the same Admin or
non-admin eligibility rules as every other recipient. The send-time recipient set is frozen:
later grants do not add historical recipients and later removal does not delete stored
recipient rows. Current active state plus current Dashboard and Project access still
controls visibility, so historical alerts never bypass current Project authorization.

Each recipient starts unread. Clicking a notification marks only that recipient row
read and then opens `/projects/<projectId>#activity-<activityId>`. Opening the panel or
Project by another path does not mark it read. V1 has no Mark all as read action.

A recipient may permanently dismiss one of its own Dashboard notifications. Dismissal
removes it from only that recipient's active inbox and unread count across sessions,
while retaining the recipient row and leaving `read_at` unchanged. Other recipients and
the underlying Activity, alert event, image, and AuditLog history are unaffected. V1
requires confirmation and has no undo or dismissed-notification archive.

An Issue has at most one immutable resolution. An active Admin or active employee with
`projects.edit` may resolve an existing Issue with a required trimmed description even
when the Project is Completed or Cancelled. Resolution never changes Project status or
the original Activity/image. Same-resolver exact retries are idempotent; cross-resolver
request reuse is denied and changed payload or a second resolution is rejected.

Successful resolution atomically creates one automatic `issue_resolved` notification
and snapshots every active Admin plus every active non-Admin with effective
`dashboard.view` and `projects.view`. Alert send/receive permissions are not required,
the resolver is included when eligible, and zero recipients is allowed. Existing
manual Activity alerts keep their current send/receive rules. One optional resolution
image may be attached afterward only by the original active resolver who still has
Admin or `projects.edit`; Completed/Cancelled Project state does not block this
evidence-only step. The attachment is immutable and an upload retry never recreates
the resolution, notification, or audit.

Activity and notifications are newest-first bounded reads with default limit 20,
allowed limits 1–50, and keyset cursors `(created_at, id)` and
`(created_at, recipient_row_id)` respectively. Neither uses OFFSET or unbounded reads.
If a deep-linked Activity is outside loaded pages, an authorized narrow by-ID read
loads it as a separate `Linked activity` without changing chronological page ordering
or cursors. If the target later appears in a loaded page, only its normal timeline row
is shown. Opening or resolving a deep link does not mark, dismiss, or otherwise mutate
any notification recipient row. Task H3 owns scrolling, highlighting, and focus.

The optional image is private JPEG, PNG, or WebP, maximum 5 MiB, with no SVG or animated
format. Trusted handling validates actual content, chooses the object path, permits only
authorized signed reads, and treats the attachment as immutable. Alt text is optional;
the UI may fall back to the Activity title.

In V1, the Activity author may attach the image only with the Activity's original
request UUID, while the Activity remains attachment-free and the Project remains
writable. Admin does not bypass the author requirement. An identical image retry may
reconcile the immutable attachment after the Project closes. Authorized image reads use
a private signed URL that expires after five minutes.

One request UUID covers a submission and is permanently bound to the original Activity
author. An identical retry by that author for the same Project, normalized content,
and alert intent returns the same Activity; conflicting reuse by that author fails.
Another actor, including an Admin, is denied without learning whether its payload
matches (`42501`); the original author's conflicting reuse remains `PAC01`. An exact
historical replay does not append AuditLog, fan out recipients again, modify an
attachment, or require a completed/cancelled Project to become writable. The database
transaction atomically creates the Activity, optional
alert/recipient rows, and narrow AuditLog events. After that transaction succeeds, the
separate trusted image workflow may upload and attach the optional immutable image by
using the same author-bound request UUID; an image failure may therefore leave the
successfully committed text Activity available for retry.

Project-alert Realtime uses only a private content-free cache invalidation: event
`invalidate` and one `project-alert-notifications:<profile-uuid>` topic per authorized
active recipient. The database supplies `{}`; Supabase delivers exactly one generated
transport field, `{ "id": "<transport-uuid>" }`. It is not any business identity, and
the frontend ignores the payload completely. The signal never carries notification
content, business identifiers, or counts; trusted inbox/count RPC reads remain authoritative. Task 001C1 establishes
the database signal and owner-only topic authorization. Task 001C2 adds one persistent
authorized per-profile application subscription that ignores the payload and triggers
only trusted inbox/count refetches, including reconciliation after reconnect. Existing
bounded refetches on Dashboard load, panel open, window focus, successful send,
mark-read, dismissal, and explicit retry remain valid. Polling is not allowed.

---

## 4. Nabavka / Procurement Rules

### Existing vs brand-new component requests

If the requested component already exists:

- Nabavka references the existing Product/Component
- the selected Product must exist and be active when the later trusted request-creation operation executes
- Serial Number / Šifra comes from that Product/Component
- the Product's current Name is copied, with surrounding whitespace trimmed before persistence, into `requested_name` as the request-time snapshot
- Quantity is entered for the request; Supplier is not requested at creation and starts unassigned
- later Product renames or archival do not rewrite the snapshot or remove the historical Product reference

If the requested component does not yet exist:

- the Nabavka request may exist temporarily without an AlfaEV Serial Number / Šifra
- `product_id` may start as `NULL`
- worker enters the required request-time Name snapshot and Quantity; surrounding Name whitespace is trimmed before persistence and blank Names are invalid
- the request must be distinguishable as not yet linked to a Product/Component

Procurement Request creation does not require Supplier; `supplier_id = NULL` means Supplier was not selected at request time. Existing historical requests with a Supplier remain valid, and later Supplier archival never removes or rewrites those references.

Only Admin may create the actual Product/Component from that request.

When Admin uses `Create component from request`:

- the request must still be Active or Partly Delivered and unlinked; Resolved or already-linked requests are rejected
- Product Name is prefilled from the request-time `requested_name` snapshot, but Admin may edit it before creation; the final Name and required free-text Category are trimmed and nonblank
- optional Brand must still exist and be active
- when the request has a Supplier, that Supplier is fixed for this workflow and must still exist and be active; an archived Supplier leaves history readable but blocks Product creation from that request
- create exactly one active Product/Component with `product_kind = 'component'`
- generate the next unique 7-digit Serial Number / Šifra through trusted backend/database logic
- when the request has a Supplier, require that Supplier to have its normalized nonblank master Catalog Number and create one active ProductSupplier eligibility relationship without Catalog/Description input
- when the request has no Supplier, create the Product without a ProductSupplier relationship
- link the Product/Component back to the original Nabavka request without changing its historical requested-name snapshot, Supplier, quantities, status, resolution metadata, or creation metadata
- preserve immutable audit history for Product creation, any ProductSupplier creation, and the Procurement-to-Product link

Workers never manually assign Serial Number / Šifra values.

The workflow is one concurrency-safe transaction. Competing Admin attempts cannot create two Products for the same request, and any required audit failure rolls back all domain mutations. Sequence gaps after a failed attempt are acceptable and never reused. Product initialization creates three zero InventoryBalance rows, one per warehouse, but creates no InventoryMovement and does not add delivered Procurement quantity to stock; physical stock is entered separately through the authorized Inventory workflow.

### Statuses

Allowed statuses:

- Active
- Partly Delivered
- Resolved

Every new request starts as Active with Delivered Quantity `0` and no resolution metadata. Clients cannot choose another initial status.

### Partly Delivered

Store/display:

- Requested Quantity
- Delivered So Far
- Remaining Quantity

Remaining Quantity = Requested Quantity - Delivered So Far.

Requested Quantity and Delivered Quantity are whole-number pieces. Requested Quantity must be greater than zero. Delivered Quantity defaults to zero and must remain between zero and Requested Quantity, inclusive. Remaining Quantity is derived only and is not stored.

While unresolved:

- Delivered Quantity `0` corresponds to Active
- Delivered Quantity greater than `0` corresponds to Partly Delivered
- a Partly Delivered request may temporarily have Delivered Quantity equal to Requested Quantity
- full delivery does not silently resolve the request

Task 080 owns trusted delivery updates and synchronization between Active and Partly Delivered. The trusted operation accepts the request ID and desired Delivered Quantity, then derives the unresolved status atomically: zero is Active and any positive value, including full delivery, is Partly Delivered. The client does not independently choose either status.

Task 080 requires an active Admin or `procurement.change_status`; `procurement.edit` alone does not authorize Delivered Quantity or Active/Partly Delivered lifecycle changes, and `procurement.view` is not required inside the trusted mutation. Task 080 never changes Requested Quantity.

A meaningful delivery update creates exactly one immutable AuditLog entry atomically. A no-op Delivered Quantity submission changes no update metadata and creates no audit entry. Task 080 cannot modify, resolve, reopen, delete, or reactivate a Resolved request.

This information is informational only.

### Resolved

Resolved is an explicit terminal business state owned by Task 082 and authorized by an active Admin or `procurement.resolve`. `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not authorize resolution, and the trusted Resolve mutation does not require `procurement.view`. Resolution may start from Active or Partly Delivered and does not require full delivery, so Delivered Quantity may be any value from zero through Requested Quantity.

The trusted Resolve operation sets status and resolution/update metadata from server time and the active caller. It does not change Requested Quantity, Delivered Quantity, Product, requested-name snapshot, Supplier, or creation metadata. Remaining Quantity stays derived only.

Resolved requests remain readable historical records, are excluded from the Sidebar badge, and are never hard-deleted. They cannot be normally modified, receive delivery updates, be resolved a second time, reopen, or reactivate. An already-Resolved request is rejected rather than treated as a successful no-op.

`resolved_at` and `resolved_by_user_id` are both populated exactly while the request is Resolved and are both `NULL` for Active and Partly Delivered requests.

Every successful resolution creates exactly one immutable AuditLog entry atomically with the lifecycle change. Denied or invalid attempts create neither a mutation nor an audit event. Resolution never changes Inventory.

### Inventory relationship

Nabavka status changes do not automatically change Inventory.

Inventory receipts are entered manually by Admin/CEO through Inventory.

### Sidebar badge

Badge count = number of requests where status is:

- Active
- Partly Delivered

Resolved requests are excluded.

The badge counts rows/requests, not piece quantities.

---

## 5. Inventory Identity Rules

### Brands

- AlfaEV supports reusable Brand records for products/components.
- Brand name is required and must be trimmed before persistence.
- Empty or blank Brand names are invalid.
- Brand names are case-insensitively unique; values such as `Bosch`, `bosch`, and `BOSCH` represent the same Brand identity.
- AlfaEV does not hard-delete Brand records through normal application workflows, whether or not they are currently referenced.
- Archive/deactivate is the only normal Brand removal workflow, and historical references remain intact.
- Archived Brands are immutable through normal Brand editing.
- Archived Brands remain readable where historical Product data requires them but cannot be selected for newly created Products.
- Brand reactivation/unarchive is not supported in the current scope.
- Meaningful Brand create/edit/archive changes create immutable AuditLog history.
- No-op Brand edits do not create audit noise.

### Suppliers

- Supplier name is required and must be trimmed before persistence.
- Empty or blank Supplier names are invalid.
- Supplier names are case-insensitively unique; values such as `Bosch`, `bosch`, and `BOSCH` represent the same Supplier identity.
- Country and contact details do not define Supplier identity.
- Catalog Number belongs to Supplier, is required/trimmed/nonblank for every active Supplier, preserves casing, is not globally unique, and is never Product identity.
- Supplier Description is optional, trimmed, stored as `NULL` when blank, and preserves nonblank casing/content.
- Country is required, trimmed before persistence, and must not be empty or blank.
- Contact Person and Phone are optional, trimmed when provided, and stored as `NULL` when blank.
- Phone values do not require aggressive formatting at the database boundary.
- Email is optional, trimmed and lowercased when provided, stored as `NULL` when blank, and subject to basic email validation.
- Supplier email is not unique.
- AlfaEV does not hard-delete Suppliers through normal application workflows.
- Archive/deactivate is the normal Supplier removal workflow, and historical references remain intact.
- Archived Suppliers remain readable wherever historical records require them and are immutable through normal Supplier editing.
- Archived Suppliers cannot be selected for new ProductSupplier links or new procurement selections.
- Supplier reactivation/unarchive is not supported in the current scope.
- Meaningful Supplier create/edit/archive changes create immutable AuditLog history.
- Normalized no-op Supplier edits do not create audit noise.

### Products

- Product Name is required, trimmed before persistence, and must not be empty or blank. Product names are not unique.
- Product Category is required, trimmed before persistence, and must not be empty or blank. Categories are not unique and remain free text in the current scope.
- Product identity is the unique Serial Number / Šifra, not Name, Category, Brand, or Catalog Number.
- Brand is optional. Historical Products may continue to reference archived Brands, but new Products and Product Brand changes may select only active Brands.
- The only Product kinds are `component` and `pcb_finished_good`.
- Product kind is immutable after creation.
- Normal Inventory Add Product creates a `component`; `pcb_finished_good` is reserved for later trusted PCB workflows and is not a normal user-selectable Product kind.
- Product archive/deactivate is a trusted backend lifecycle mutation authorized only for an active Admin or a user with `inventory.products.edit`; `inventory.products.create` does not authorize archive, `inventory.view` remains read-only, and no separate `inventory.products.archive` permission is added.
- AlfaEV does not hard-delete Products through normal application workflows.
- Archived Products remain readable for historical records and are immutable through normal Product editing.
- Product reactivation/unarchive is not supported in the current scope.

### Excel Component bulk import

- Inventory supports creating Components from `.xlsx` only. The initial template contains only Name, Category, and optional Brand; Supplier and Catalog Number are not imported.
- Each valid spreadsheet row requests one new `component`. Name and free-text Category are required, trimmed, and nonblank. Blank Brand means no Brand; a provided Brand must resolve to an existing active Brand. Import never creates Brands implicitly.
- Name, Category, and Brand are not Product identity. Visually duplicate rows are not silently deduplicated; each valid row receives its own server-allocated permanent 7-digit Serial Number. Excel never supplies Serial Number or Product kind, and `pcb_finished_good` remains reserved for trusted PCB workflows.
- Import sets no initial stock. Each created Product receives three zero InventoryBalance rows, one per warehouse, with no InventoryMovement; physical stock entry is a separate Inventory operation.
- A confirmed import is all-or-nothing: the trusted backend revalidates every row and Brand before writes, then creates all Products and one immutable batch-level Product-creation audit containing created Product IDs and count in one transaction. Failed or denied import persists no Product, balance, or success audit. Rolled-back Serial allocations may leave gaps and are never reused.

### Serial Number / Šifra

- required text and globally unique, including archived Products
- current ordinary Product/import creation generates exactly 7 digits, starts at
  `0000001`, and sequentially increments
- approved Finished Product Calculator creation accepts a manual exact 3-digit value
  through its trusted creation boundary
- exactly 3 or 7 digits; leading zeroes are preserved
- never reused
- used as barcode value

The ordinary-Product sequence and the shared uniqueness constraint must prevent
duplicates under concurrent creation.

### Catalog Number

- separate from Serial Number
- supplier-related
- belongs to Supplier, never Product or ProductSupplier
- required, normalized, and nonblank for every active Supplier; archived legacy Suppliers may remain readable with a historical missing value
- Supplier `description` is optional, trimmed, stores blank as `NULL`, and preserves nonblank casing/content; it is distinct from Product name, Work Order description, and Procurement requested name
- preserves entered casing
- one product/component may have multiple Suppliers
- each Product/Supplier pair has at most one active eligibility relationship
- not globally unique
- may be shared by multiple different products/components
- must not be used as primary identifier

### ProductSupplier Relationships

- ProductSupplier records only that a Supplier supplies a Product; it does not own Catalog Number or Supplier Description.
- More than one active relationship for the same `(product_id, supplier_id)` is not allowed.
- A new ProductSupplier relationship starts active and may be created only between an active Product and an active Supplier.
- If a related Product or Supplier is archived later, the existing ProductSupplier relationship remains historically valid and is not deleted or cascaded away.
- ProductSupplier relationships are never hard-deleted through normal application workflows; archive/deactivate is the removal path.
- Archived ProductSupplier relationships remain historically readable and are immutable.
- ProductSupplier reactivation/unarchive is not supported in the current scope.
- Meaningful ProductSupplier add/archive changes create immutable AuditLog history.
- ProductSupplier add/archive requires an active Admin, `inventory.products.edit`, or `suppliers.edit`, enforced through one shared trusted backend authority regardless of the originating detail screen.
- Trusted Product-side ProductSupplier relationship reads may expose only the related Supplier ID, Name, live Catalog Number, optional Description, and active/archive state required to display the relationship to an active Admin or a user with `inventory.view` or `suppliers.view`.
- A trusted Supplier-choice lookup for ProductSupplier management may expose only active Supplier IDs and Names to an active Admin or a user with `inventory.products.edit` or `suppliers.edit`.
- These narrow ProductSupplier reads do not provide general Supplier access or Supplier contact/details; normal Supplier reads still require an active Admin or `suppliers.view`.
- Trusted Supplier-side ProductSupplier relationship reads may expose only the related Product ID, Serial Number, Name, and active/archive state required to display the relationship to an active Admin or a user with `inventory.view` or `suppliers.view`.
- A trusted Product-choice lookup for ProductSupplier management may expose only active Product IDs, Serial Numbers, and Names to an active Admin or a user with `inventory.products.edit` or `suppliers.edit`.
- These narrow ProductSupplier reads do not provide general Product access or Product Category, Brand, lifecycle timestamps/actors, or other Product details; normal Product reads still require an active Admin or `inventory.view`.
- No separate ProductSupplier permission key is added.

### Inventory Source Provenance

- `InventoryBalance.quantity` remains the canonical aggregate physical balance.
- Every positive balance is represented by immutable inbound source lots whose remaining quantities reconcile exactly to that balance.
- Supplier receipts freeze Supplier ID/name, Supplier Catalog Number, and optional Supplier Description at receipt time.
- Pre-provenance positive stock is represented explicitly as `legacy_unknown`; no Supplier or Catalog Number is fabricated.
- PCB finished-goods output is `internal_production` and has no Supplier or Catalog Number.
- Outbound stock is allocated FIFO by receipt timestamp and source-lot UUID. One consumption may allocate across multiple lots.
- Manual Add and upward Correction require the exact active ProductSupplier relationship. Remove and downward Correction never ask for a new Supplier and consume existing lots FIFO.
- Source lots and outbound allocation history are trusted-only and immutable except that trusted consumption may decrease a lot's remaining quantity.
- After every trusted mutation, the sum of remaining source-lot quantities for a Product equals its InventoryBalance quantity.
- Work Order and PCB Finish allocate persisted material quantities at Finish time; Drafts do not reserve stock.
- Finished history and PDFs use frozen allocation facts rather than current ProductSupplier or Supplier metadata.
- PDF `KAT. BROJ` is the frozen Supplier Catalog Number for a supplier-sourced allocation and `—` for legacy or internally produced stock. `OPIS` remains Product name. Split-source consumption produces one PDF row per allocation.

---

## 6. Inventory Quantity Rules

### Low Stock V1 — locked LS-01 configuration rules

Minimum stock is advisory metadata per applicable Product/warehouse pair, not a
physical reservation or debit limit. Configured minimums are positive SQL bigint
quantities; zero/negative/fractional values are rejected. An absent setting or a
cleared null minimum means Not Configured. For configured settings: physical zero
means Out of Stock; positive physical below minimum means Low Stock; physical at
or above minimum means Healthy. Compare only the selected warehouse's physical
balance, never Project demand, FG reservations or Test holds.

Existing authoritative warehouse listing membership is required; configuring a
minimum never creates membership or balances. Archived Products retain settings
but reject set/clear operations. Configuration cannot create stock, movements,
reservations, procurement requests or notifications, or reconcile Project shortages.
LS-01 implements only local configuration; stock-health reads/UI and Dashboard
integration remain future work. No DEV deployment is implied.

Inventory quantity must never go below zero.

Inventory mutations come from:

- manual Admin adjustment
- Finished Work Order
- completed PCB production

Draft Work Orders never affect Inventory.

Incomplete/failed PCB production never affects Inventory.

Project planning commitments never affect InventoryBalance or create InventoryMovement.
Only trusted physical-consumption workflows change stock. Actual Project-linked
consumption reduces derived outstanding commitment without a second stock deduction.

### Manual adjustment

Only Admin may manually adjust Inventory.

The target Product must exist and be active when the adjustment executes. Archived Products remain historically readable and retain their InventoryBalance and InventoryMovement history, but cannot receive new manual Add, Remove, or Correction adjustments or movements.

Required fields:

- target Product
- adjustment type:
  - Add
  - Remove
  - Correction
- quantity interpreted according to the selected adjustment type
- required reason/note, trimmed before use and nonblank

Adjustment semantics:

- Add enters the positive amount to add. Quantity must be greater than zero and `delta = +quantity`.
- Remove enters the positive amount to remove. Quantity must be greater than zero, `delta = -quantity`, and resulting stock cannot be negative.
- Correction enters the desired final stock quantity, not a delta. The target must be greater than or equal to zero and `delta = target_quantity - current_quantity`.
- A Correction target of zero is valid.
- A Correction target equal to current stock is rejected as a no-op and creates no InventoryMovement or AuditLog.

Manual InventoryMovement types are exactly:

- `manual_add`
- `manual_remove`
- `manual_correction`

Record:

- previous quantity
- delta
- new quantity
- reason
- actor
- timestamp

Every meaningful manual adjustment creates exactly one InventoryMovement and exactly one immutable AuditLog event in the same atomic business operation. If any part fails, the balance, movement, and audit changes all roll back.

Work Order and PCB changes are recorded under their own source event rather than pretending to be manual adjustments.

### Inventory Movement history

Inventory Movement history is available to an active Admin or a user with `inventory.view`.

History includes movements for active and archived Products, is ordered newest first, and is read-only. Task 064 adds no movement update, deletion, or reversal action.

Where the history identifies the actor, a trusted read may expose only `actor_user_id` and the actor's Full Name in addition to the InventoryMovement fields required by the UI. It must not expose other UserProfile data or broaden general UserProfile access.

---

## 7. Barcode Rules

Barcode value is the product/component Serial Number / Šifra.

For a product/component, AlfaEV must support:

- barcode generation
- barcode viewing
- barcode image download

Physical warehouse boxes use the same barcode value.

Scanning the barcode must resolve the matching AlfaEV product by Serial Number / Šifra.

---

## 8. PCB Production Rules

### PCB card definitions

- PcbCard Name is the required human-facing Name/Code. It is trimmed before persistence, must be nonblank, and is case-insensitively unique across active and archived definitions.
- Every PcbCard has exactly one stock-tracked output Product, and one Product may be the output of at most one PcbCard.
- The output Product must be a `pcb_finished_good`; its link to the PcbCard cannot be changed after card creation.
- A new PcbCard starts active with no archive metadata. An active card has null archive timestamp and actor, while an archived card has both values populated.
- Archiving the output Product later does not invalidate or rewrite the historical PcbCard relationship.
- Task 085 creates no PcbCard archive or reactivation workflow. Where production history exists, a PcbCard must be archived rather than hard-deleted, consistent with the existing lifecycle rule.
- Creating a PcbCard through Finished Product Calculator takes its required, trimmed Name/Code and a manually supplied exact three-digit Serial Number as text. The trusted operation creates exactly one new active output Product with the same normalized Name, Category `PCB`, no Brand, and kind `pcb_finished_good`; ordinary Product/import creation still uses the seven-digit allocator.
- Normal Product setup initializes the output Product's three warehouse balances at zero. Definition creation is not production: it adds no finished-goods stock and creates no InventoryMovement. Only later production may increase finished-goods stock.
- A PcbCard definition does not inherently require a Supplier. Creation adds no Supplier, ProductSupplier relationship, or Catalog Number.
- Creation is authorized by an active Admin or `pcb.create`, without requiring `pcb.view` or Inventory Product permissions. It atomically creates the Product, three zero warehouse balances, card, and exactly one Product creation audit plus one `pcb_card.created` audit. Failure leaves none of those rows or audits.

### BOM calculation

PCB BOM inputs may be existing stock-tracked Products of kind `component` or `pcb_finished_good`. When adding or changing a BOM item, the Product must exist and be active; a PcbCard cannot directly consume its own output Product. Archiving an input Product later does not invalidate, delete, or rewrite the existing BOM item or its historical version.

For each BOM row:

Required Quantity = Quantity Per Card × Planned Production Quantity

Before production completes, AlfaEV must compare all required quantities with current Inventory.

For PCB production precheck, Available is trusted production-eligible physical stock
under the current warehouse sourcing and hard FG reservation rules, not Available
after soft Project Commitments. When Test Calculator V1 is implemented, active Test
holds are also excluded. Missing is `max(Required - Available, 0)` for each BOM input.
Ordinary Project planning does not itself reserve or mutate physical stock; all
authoritative quantities remain exact whole numbers. The normal production flow is unchanged.

### Insufficient stock

Insufficient stock does not prevent creating the specialized Draft Work Order because creation reserves and mutates nothing. It prevents Finish:

- production does not complete
- no Inventory deductions occur
- show required, available and missing quantities

### PCB production Work Order creation and Finish

The locally implemented `Produce PCB` flow creates an idempotent specialized Draft Work Order. The planned quantity is a positive exact bigint and freezes the exact PCB Card, BOM version, derived BOM material quantities, and description `PCB production — <PcbCard name>`. New calculator-initiated production has no Project selection or association. Historical Project-linked contexts and exact idempotent replays remain preserved. BOM-derived WorkOrderItems have authoritative frozen `pcb_bom` origin. They cannot be edited or removed. A separate `manual` row set may contain supplemental active eligible Products while the parent remains Draft; managing that set requires Admin or `work_orders.edit_draft`, never `pcb.produce` alone. Supplemental rows create no reservation or Inventory effect. An empty BOM is valid, multiple Draft batches for one card are valid, and creation changes no Inventory, creates no InventoryMovement/PcbProductionRun, and records normal `work_order.created` plus `pcb_production.work_order_created` history.

At Finish, the user supplies exact bigint actual-good quantity with `0 <= actual_good <= planned_quantity`. If all frozen and supplemental inputs remain eligible and sufficient:

- record the production run
- record the exact BOM version used
- deduct every persisted frozen and supplemental material quantity
- consume BOM inputs for the frozen planned quantity and supplemental inputs exactly as saved
- add only actual-good quantity to Finished Goods Warehouse Inventory
- record Inventory movements for both consumed inputs and produced output
- record actor and timestamp
- record audit event

Frozen and supplemental rows may reference the same Product because origin is part of their authoritative identity. Finish aggregates those rows by Product for deterministic physical-stock locking and sufficiency. Ordinary inputs consume Raw Materials FIFO, then Customs FIFO, then unreserved Finished Goods FIFO. Calculator-linked finished inputs use unreserved FG FIFO only, never recursive BOM consumption (local migration 148). Every consumed Product/warehouse has an input movement and exact source-lot allocations. Actual good zero still consumes all saved inputs and records completed production, but leaves output stock unchanged and creates no zero/positive output movement. Finish creates exactly one run linked to the Work Order, records normal `work_order.finished` plus `pcb_production.completed`, and never automatically completes a historical linked Project. The operation is atomic: input deductions, actual output, production record, Work Order/PDF state, and audits either all succeed or none do.

Produced PCB cards are stock-tracked finished goods.

### Historical Project links

New calculator production is General Stock with no Project association. Existing Project-linked production keeps its original traceability and remains readable and finishable; the warehouse rollout does not rewrite those links or reserve Project requirements.

For a historical Project-linked production:
- the production run is linked to that Project
- its underlying BOM component consumption may contribute to the Project's derived material usage

For General Stock production:
- production remains valid and still affects Inventory

Project reporting must not double-count the same material consumption if produced PCB finished goods are later issued through a Work Order. The final DATA_MODEL/reporting design must preserve one traceable source of consumption per physical material movement.

### BOM versioning

If a PCB definition has never been used in production:
- Admin may edit the BOM in place

If production history exists:
- any BOM change creates a new version
- old production remains linked to the old version
- new production uses the latest active version

A version used by any PcbProductionRun keeps its card identity, version number, creation timestamp/actor, and BOM items permanently immutable; it cannot be deleted. Its sole permitted lifecycle change is one-way deactivation from active to inactive when a new version supersedes it. Deactivation does not edit its contents, and an inactive used version cannot be reactivated. Production-use state is derived from run history, not stored as a separate flag.

---

## 9. Work Order Rules

### Required content

Before Finish, a Work Order must contain:

- Work Order Number
- Project
- Customer
- consumed materials table
- short description

The trusted creation flow first creates the numbered Draft. At that initial creation
point, Project, Customer snapshot, and Description may be unset. The later Draft
save/update flow selects the Project, derives Customer from that Project, and saves
the Description before Finish validation requires the complete business content.

### Work Order number generation

AlfaEV generates Work Order numbers automatically.

Human-readable format:

`RN-YYYY-NNNN`

Examples:

- `RN-2026-0001`
- `RN-2026-0002`

Rules:

- numbering sequence resets each calendar year
- the `YYYY` value and calendar-year reset boundary are determined at authoritative database allocation time in the IANA timezone `Europe/Sarajevo`
- number is assigned at Work Order creation, including Draft
- number is immutable
- number is never reused after deletion of a Draft
- trusted backend/database logic must allocate numbers safely under concurrency
- internal database UUID and human-facing Work Order number are separate identifiers

### Project/customer

User manually selects Project after the numbered Draft has been created.

Customer is auto-filled from the selected Project when the Draft is saved/updated.
Saved Drafts may remain incomplete: clearing Project also clears the Customer
snapshot, and blank Description normalizes to NULL. A new or replacement Project
must be open (`planned`, `in_progress`, or `on_hold`), while an existing selected
Project may be retained after later completion/cancellation. Saving the same Project
refreshes Customer from the trusted current Project row. A normalized no-op changes
neither update metadata nor audit history, and stale `updated_at` submissions are
rejected rather than overwriting newer Draft state.

One Project may have one or many Work Orders. No uniqueness rule may limit a Project
to one Work Order. Draft material persistence records intended material rows but does
not reserve Inventory or calculate/allocate Project commitments.

### Barcode scanning

When a product barcode is scanned while editing a Work Order:

- resolve an existing active Product by exact three- or seven-digit Serial Number /
  Šifra text, preserving leading zeroes without trimming or numeric conversion
- allow either stock-tracked Product kind: `component` or `pcb_finished_good`
- add product to materials table
- populate product data automatically
- user manually enters consumed quantity

The narrow trusted resolver is authorized only for an active Admin or
`work_orders.edit_draft` actor in the context of an existing Draft Work Order. It
returns only Product ID, Serial Number, and Name, does not grant general Product
access, and does not create a WorkOrderItem, change Inventory, or create audit
history. Later item persistence and Finish operations re-check Product eligibility.

Current Inventory shown for a resolved Draft material is the Product's physical
`InventoryBalance.quantity`, exposed through a narrow trusted Work Order read. It
does not subtract Project commitments, grant general Inventory access, reserve
stock, or create any Inventory effect. Finish later re-checks authoritative stock.

### Draft

Saving as draft:

- atomically persists the normalized header and complete desired Materials set
- allows later editing
- does not affect Inventory
- accepts positive whole `bigint` material quantities as exact decimal strings
- revalidates every newly introduced Product reference at save time
- preserves original item identity/add metadata when an existing Quantity changes
- advances the Work Order's unified `updated_at` version for any meaningful header
  or material change
- performs no mutation and creates no audit for a normalized full no-op

Persisted Draft materials are reloaded through a narrow trusted Work Order read that
may expose only Product identity, persisted Quantity, and current physical Inventory.
It does not grant general Product or Inventory access. A persisted item remains
historically readable if its Product is archived later; adding a new archived Product
is forbidden. Inventory sufficiency remains a Finish-time decision.

Deleting a Draft is an explicit trusted operation for an active Admin or
`work_orders.delete_draft` actor. It locks the Draft, rejects a stale expected
`updated_at`, deletes its WorkOrderItem rows and parent atomically, and records exactly
one `work_order.deleted` audit containing the deleted header and deterministic
Product-ID/Quantity material snapshot. The allocated Work Order Number remains
permanently consumed. Deletion changes no Inventory, Project, Product, PCB, PDF, or
Storage state. Finished Work Orders remain undeletable.

### Finish

Finishing:

- validates required data
- validates Inventory availability
- deducts consumed quantities
- records Inventory movements
- records actor and timestamp
- creates audit history
- generates PDF
- changes Work Order to Finished
- records qualifying Project/Product consumption so the derived read model reduces only that matching Project/Product commitment
- checks for other unfinished Work Orders for the same Project
- automatically completes the Project when none remain

Inventory changes happen only on Finish.

The final Work Order transaction must atomically validate and finish the Work Order,
deduct Inventory, create InventoryMovement rows, update actual Project consumption,
complete the Project when this is the last unfinished Work Order, and create required
AuditLog entries. ProjectProductComponent requirements are never deducted separately.
Completing or cancelling a Project releases remaining unused commitment without
changing physical stock.

### Finished Work Order

Finished Work Orders:

- are immutable
- cannot be edited
- cannot be reopened
- cannot be deleted

If a mistake must be corrected later:
- use a separate explicit correction/reversal process
- never silently rewrite the Finished record

### Permanent Work Order PDF

- Each Finished Work Order has at most one canonical `WorkOrderPdf` in the current
  scope, with document version exactly 1.
- PDF bytes live only in the private `work-order-pdfs` bucket; PostgreSQL stores only
  immutable metadata and the exact final object reference.
- Temporary objects use `_tmp/<work_order_id>/<object_uuid>.pdf`; permanent objects
  use `final/<work_order_id>/<object_uuid>.pdf`. Both IDs are internal UUIDs, never a
  Work Order number or user filename.
- A permanent metadata row may reference only an existing `application/pdf` final
  object in its own Work Order namespace, and only after that Work Order is Finished.
- Uploading a final candidate does not expose it. Browser read access begins only
  after an exact `WorkOrderPdf` reference exists and is limited to an active Admin or
  `work_orders.view` actor.
- `WorkOrderPdf` rows cannot be updated or deleted. There is no current replacement,
  re-versioning, or removal workflow.
- The canonical document is an A4 portrait Alfa Proteh Radni Nalog. It renders only
  trusted Work Order identity, selected Project name, Customer snapshot, Description,
  Work Order creation date, and persisted material Product Serial Number, Product Name,
  and exact Quantity. Report, authorized-person, unit, price, total, completion-date,
  signature, and stamp fields remain blank until an authoritative domain value exists.
- The trusted snapshot reuses Finish preflight authorization and validation. The PDF
  generator consumes that snapshot independently of React/browser state and creates no
  Inventory, AuditLog, Storage, or Work Order mutation by itself.

---

## 10. Documentation Rules

- Documentation is permanently Admin-only for navigation, routes, reads, and mutations.
- DocumentationRecord Name is required, trimmed, and nonblank.
- Category is exactly `uvoz`, `izvoz`, `nabavka`, or `troskovi`.
- Document Date is a required SQL date.
- Amount is a required exact non-negative decimal monetary value; floating point is forbidden and no currency field exists in current scope.
- One optional PDF may be attached. PDF bytes are stored only in private Supabase Storage, not PostgreSQL.
- Only Admin may upload, read/download, replace, or remove the PDF through trusted operations.
- Normal workflows archive rather than hard-delete Documentation records; archived records remain readable to Admin and have no current reactivation workflow.
- Meaningful create/edit/archive/PDF changes are audited.

---

## 11. Fixed Asset Rules

- Osnovna sredstva is permanently Admin-only for navigation, routes, reads, and mutations.
- Fixed Asset Name is required, trimmed, and nonblank.
- Category is exactly `oprema`, `uredjaji`, or `alati`.
- Purchase Date is a required SQL date.
- Quantity is a required whole number greater than zero.
- Fixed Assets are independent of Product, Procurement, InventoryBalance, and InventoryMovement; asset quantity never changes warehouse stock automatically.
- Normal workflows archive rather than hard-delete Fixed Assets; archived records remain readable to Admin and have no current reactivation workflow.
- Meaningful create/edit/archive changes are audited.

---

## 12. Calendar Rules

Categories:

- Birthdays
- Business Trips
- Events
- Vacations

Birthdays come from User profile Birthday.

Business Trips and Vacations are informational only.

No approval workflow is required.

All users may view Calendar.

Only Admin may modify Calendar entries.

---

## 13. User and Permission Rules

Admin has full access.

Non-admin capabilities are controlled by explicit per-user permissions.

Permission checks must be enforced by trusted backend authorization.

`Manage user permissions` is permanently Admin-only.

A non-admin user can never:

- grant permissions
- revoke permissions
- modify another user's access
- elevate their own access

Every permission change creates an audit event.

The Users module is completely Admin-only. Non-admin users must not see or access the Users page or any read-only user directory.

Inactive users cannot perform new AlfaEV actions, including when an older Supabase session or token still exists.

Deactivation preserves the Supabase Auth user, UserProfile, business history, and historical references; it does not delete the account records.

An Admin cannot deactivate their own account.

At least one active Admin must remain; deactivation of the last active Admin is forbidden.

Reactivation is an explicit Admin action and creates an immutable audit event.

Admin status and Active/Inactive account status are separate concepts; changing `is_admin` does not change `is_active`.

An inactive user may be promoted or demoted, but remains unable to use AlfaEV until explicitly reactivated through the separate account-state workflow.

An Admin cannot change their own Admin status.

At least one active Admin must remain; demotion of the last active Admin is forbidden.

Existing explicit UserPermission rows are preserved across promotion and demotion. Admin bypass applies while the user is an Admin, and the preserved permissions become effective again after demotion.

Every meaningful Admin-status promotion or demotion creates an immutable audit event.

Historical audit records continue to display the original actor after deactivation or reactivation.

---

## 14. Audit Rules

Audit records are immutable.

No user, including normal operational users, may edit/delete audit history through application workflows.

Each meaningful event should record:

- actor
- action type
- entity/module
- record identifier
- timestamp
- before/after values where relevant
- source/context where relevant

Examples:

- product created/edited/archived
- Inventory adjusted
- Work Order finished
- PCB production completed
- Project status changed
- Project Product/component requirement changed
- Project automatically completed by final Work Order Finish
- Nabavka status changed
- Supplier edited
- Calendar edited
- user activated/deactivated
- permission changed
- Documentation/PDF changed
- Fixed Asset changed
- Project Activity created (narrow `project_activity.created` event only)
- Project Activity alert sent (narrow `project_activity.alert_sent` event only)

Do not generate audit noise for pure UI interactions.

Project Activity descriptions and images are collaboration content and must not be
copied into AuditLog. Marking an Activity alert read or dismissing one recipient's
notification creates no AuditLog event.

Pure derived commitment/availability calculations create no AuditLog noise.

---

## 15. Deletion / Archive Rules

General rule:

If a record has business history or is referenced by another record, preserve it through archive/deactivate/cancel instead of hard deletion.

Hard deletion is reserved for unused records/drafts where preserving history is unnecessary.

Specific rules:

### Products/components
If used/referenced:
- archive/deactivate
- do not hard-delete

### Suppliers
AlfaEV does not hard-delete Suppliers through normal application workflows, regardless of whether they are currently referenced.

- archive/deactivate is the normal removal workflow
- preserve existing historical references
- do not provide Supplier reactivation/unarchive in the current scope

### Projects
If linked history exists:
- archive/cancel rather than hard-delete

### Documentation
- archive rather than hard-delete
- no current reactivation workflow

### Fixed Assets
- archive rather than hard-delete
- no current reactivation workflow

### PCB definitions
If production history exists:
- archive rather than hard-delete

### Work Orders
Draft:
- may be deleted

Finished:
- never delete

### Nabavka
Resolved items remain historical records.
Do not require Inventory side effects.

### Users
Users with history:
- deactivate rather than delete

### Audit records
- never edit
- never delete

### Automatic Project shortage episodes

- A Product shortage is the unclamped global deficit from the existing shared
  `available_after_commitments` calculation.
- Every open Project with positive outstanding commitment for that Product has one
  active episode; duplicate component rows still produce one Project/Product episode.
- Opening and automatic resolution send one Dashboard notification each. Quantity
  increases/decreases append history but do not notify.
- Resolution closes rather than deletes an episode; recurrence creates a new episode.
- Initial enablement records current shortages as baseline detections without inventing
  earlier history.
- Migration 142, deployed to DEV, also schedules deferred
  reconciliation for negative Project-linked `work_order` and
  `pcb_production_input` movements from any warehouse, including Finished Goods.
  Eligible physical stock remains Raw Materials plus Customs. Multiple qualifying
  movements coalesce by transaction/Product; quantity-only changes do not notify.
  This correction does not implement Finished Goods reservations.

## Task 001L — automatic FG reservation on requirement edits (local, undeployed)

Only Products with `product_kind = 'pcb_finished_good'` and an authoritative
`pcb_cards.output_product_id` link qualify. Explicit requirements across all groups
are summed per Project/Product; prior qualifying consumption, including fulfillment,
is deducted once. Group names and Calculator BOMs never create inferred demand.

Genuine additions/increases reserve the lesser of all uncovered outstanding demand
and currently unreserved FG. Partial or zero stock does not reject the requirement.
Reductions/removals release only reservation quantity above the new outstanding
demand. Unchanged saves, exact retries, manual releases, manufacturing, adjustments,
transfers, stock arrivals and reopening never opportunistically allocate stock.
Existing manual Reserve/Release/Fulfill remains available under its existing rules.

FG shortage = outstanding demand minus this Project's remaining reservation. Global
reservations are not subtracted again. This is separate from the existing shared
Raw + Customs planning shortage and its notifications; those formulas are unchanged.
Reserve/release changes no physical balance, movement, source lot or allocation.
Fulfillment deducts FG only, never the original components again. Closed Projects
reject new requirement changes; cancellation releases, completion requires resolved
reservations, and reopening never recreates reservations. Fulfillment/history is
retained when requirements are reduced, removed or later re-added.

Migration 149 and its editor integration remain local until separately reviewed,
authorized and deployed; no DEV/browser acceptance is implied here.

## Finished Goods reservations — disabled local Phase 3A foundation

Existing explicit Product requirement rows, including selected finished goods, define
stock demand. A free-text ProjectProduct grouping alone does not define an output
Product or quantity. Reservations aggregate by Project/Product, not separately by
matching group names, and cannot allocate the same outstanding demand twice.

Local migration 143 provides private reserve/release algorithms and trusted reads,
not operational hard reservations. Application/service roles cannot execute mutations,
even for Admin callers. No existing Project receives an automatic reservation.
Internal allocation is bounded independently by unreserved FG physical stock and
same-Project/Product outstanding demand. New allocation rejects archived Products;
release retains history and may release an archived Product. Reservation/release
changes no Inventory balance, movement, source lot, allocation or requirement.

The approved activation rules remain: all unrelated debits must respect reservations;
cancellation releases them; completion requires explicit resolution; reopening never
reclaims stock. Phase 3B must implement those guards before enabling mutations.
Fulfillment must later consume matching reservation and physical stock atomically.
No fulfillment or frontend is delivered by Phase 3A. Production still consumes planned
inputs in Raw → Customs → Finished Goods FIFO order and credits actual-good output.
DEV remains 142/142; migration 143 has not been deployed.

## Finished Goods hard-reservation protection — local Phase 3B1

Local migration 144 adds the previously deferred physical-debit and Project guards;
it does not activate reservation APIs. Manual Remove, downward Correction, transfers
out and generic/PCB consumption may not leave FG physical stock below its reserved
quantity. Production planning uses only unreserved FG in unchanged warehouse/FIFO
priority. Neither another Project nor the owning Project may consume reserved stock
through ordinary operations; fulfillment must be a separate atomic operation.

Requirement removal/repointing/reduction and same-Project physical consumption are
rejected if they would invalidate explicit remaining reserved demand. No automatic
BOM/component-plan reduction is introduced. Cancellation releases reservations with
immutable receipts; completion requires explicit release/resolution, and reopening
never reclaims stock. Other Project status rules and shortage formulas are unchanged.

The local Phase 3A/3B1 acceptance gate passed. Migration 144 remains undeployed and
mutations stay private. Its scope excludes fulfillment and reservation UI.

## Finished Goods fulfillment — local Phase 3C, disabled

Migration 145 fulfills an existing active reservation against its exact Project/Product
and explicit outstanding requirement. Partial/full fulfillment reduces reservation and
FG physical quantity atomically, using FG-only FIFO and immutable movement, allocation,
receipt and AuditLog history. It never consumes another Project's reserved stock.
Reserve/release still changes no physical stock; production never auto-reserves output.

Qualifying consumption now also includes `finished_goods_reservation_fulfillment`.
Outstanding demand remains max(explicit planned quantity minus qualifying physical
consumption, 0), without changing planned requirements or Calculator BOMs. Fulfilled
units cannot be reserved again as unfulfilled demand. Raw plus Customs physical stock,
unrelated production priority and shortage notification eligibility remain unchanged.
Fulfillment queues existing deferred reconciliation, with one event/notification per
real episode transition and no retry duplicates.

New fulfillment requires an open Project and active Calculator-linked output Product.
Archived Products can still have reservations released; original fulfillment receipts
remain replayable under current authorization without repeating physical effects.
Fulfillment, reserve and release remain private and undeployed. Reservation frontend
and application activation are not implemented.

## 16. Three-warehouse and Finished Product Calculator rules

Tasks 001B–001C implement the fixed warehouse identities, warehouse-scoped ledger,
historical Raw Materials mapping, six independent warehouse permissions, trusted scoped
reads/adjustments, and atomic transfers. Tasks 001D–001E implement the Inventory tabs
and Finished Product Calculator locally. Task 001F adds multi-warehouse production;
Task 001G adds the warehouse-aware Project availability formula locally.

### Warehouse identities and stock

- `raw_materials` — Raw Materials — Skladište repromaterijala
- `finished_goods` — Finished Goods — Skladište gotovih proizvoda
- `customs` — Customs Warehouse — Carinsko skladište
- AlfaEV uses one warehouse-aware Inventory ledger. Products remain global, while each
  balance, movement, and source lot belongs to one warehouse and stock is counted
  independently per warehouse.
- Existing stock, movements, and source lots migrate to Raw Materials without
  duplication. Historical PCB output is not retrospectively moved to Finished Goods.
- Trusted Add/Remove/Correction operates inside one requested warehouse. A transfer
  requires adjustment authority in both distinct warehouses and atomically creates
  paired movements while conserving stock and retaining source-lot provenance.

### Production and availability

- Raw Materials and Customs are production-eligible. Finished Goods may also be
  consumed directly when a Work Order needs that finished Product as an input.
- Consumption may split across warehouses and every deduction records its actual source
  warehouse. Work Order Finish remains atomic and idempotent, and successful PCB
  production credits actual-good output to Finished Goods with output provenance.
- For ordinary inputs, source allocation is Raw Materials FIFO, then Customs FIFO,
  then unreserved Finished Goods FIFO; one requirement may split across warehouses.
  Calculator-linked finished Products used as inputs source exclusively from
  unreserved Finished Goods FIFO. Never recursively expand or consume their BOM.
- Customs remains separately accounted and may be consumed without a Raw Materials
  transfer. Declaration/release references and responsible actor are recorded where
  applicable, but mandatory evidence and legal-release rules await compliance approval.
- Project availability and shared shortage use Raw Materials plus Customs Warehouse
  stock, minus outstanding open-Project commitments. Finished Goods remains excluded.
- Raw↔Customs transfers conserve eligible stock and create no artificial shortage
  transition. Eligible↔Finished Goods transfers may change shortage, but deferred
  reconciliation evaluates only final transaction state.
- Existing shortage episode/event, recipient, read/dismiss, and AuditLog history is
  retained; migration 140 does not rerun baseline initialization or rewrite history.

### Finished Product Calculator

Local accounting correction (migration 148, not deployed): manufacture consumes saved
inputs once and credits actual-good output to Finished Goods. Later fulfillment/issue
deducts only the finished Product, not its original components. Hard reservations are
distinct from planning commitments: FG Physical is its warehouse balance, Committed
is the sum of positive remaining hard reservations across Projects, and Available is
Physical minus Committed. Raw planning continues to use Raw + Customs minus outstanding
open-Project commitments; no shortage rule or historical warehouse balance is changed.

- The normal experience remains **Finished Product Calculator** at `/pcb`. The
  approved Test Calculator V1 navigation renames only its sidebar container to
  **Product Calculator**, with separate Normal / Test destinations; implementation
  is pending. PCB/BOM entities, trusted identifiers and historical audits are unchanged.
- New calculator entries require a trimmed Name/Code and a manually entered exact
  three-digit text Serial Number (`000`–`999`), preserving leading zeroes.
- Ordinary Products and imports retain generated exact seven-digit serials. Authorized
  lookup/scanning accepts exact three- or seven-digit Serial Numbers.
- Serial Numbers are globally unique across Products, warehouses, and archived Product
  identities. Finished Product Calculator Name/Code is trimmed and case-insensitively
  unique across active and archived finished-product definitions. Ordinary Inventory
  component names do not gain global uniqueness.
- Calculator-initiated Produce no longer accepts a Project. It freezes a no-Project
  production Draft; historical Project-linked Work Orders remain readable unchanged.
- Migration 138 preflights historical PCB names for normalized duplicates before adding
  the unique index. No existing Product is renamed, merged, deleted, or assigned another Serial.

## 17. Test Calculator V1 — approved specification, not implemented

This section defines a new, separate blue-themed Test Calculator. It does not change
the Normal Calculator's definition, BOM, `/pcb` route or production workflow. The
sidebar container is Product Calculator with Normal / Test navigation. These are
approved future requirements, not implementation, deployment or acceptance claims.

### Creation, proof and immutable Save

- Enter a required nonblank name and existing active Products/components with positive
  exact whole-number quantities. Use authoritative Product kind and the
  `pcb_cards.output_product_id` link, never names/categories, to identify Calculator outputs.
- Prove Calculation previews Required, Eligible Available, Reservable and Missing.
  Proof creates no hold, stock change or promise of availability. Save requires a
  deadline date and recalculates current authority, demand, stock and expiry atomically.
- Save creates one immutable calculation and its item/warehouse allocation results.
  Partial and zero reservation are valid; display missing quantities explicitly.
  A failure rolls back the entire Save, not just the failed item.
- Save never deducts physical Inventory, creates InventoryMovement/FIFO allocations,
  creates an output Product/Work Order, or recursively consumes a selected Product's BOM.
- Saved calculations cannot be edited, extended, cancelled or consumed in V1.
  No automatic top-up, renewal or allocation of later arrivals is permitted.

### Sources, Project priority and formulas

For Product X at the serialized Save decision, use:

- `S(X)`: Raw Materials -> Customs -> Finished Goods for ordinary inputs;
  Finished Goods only for Calculator-linked finished Products.
- `P(w)`: physical balance in warehouse w.
- `H(w)`: existing hard Project FG reservations when w is FG; zero otherwise.
- `T(w,t)`: all saved Test holds in w with `expires_at > t`, using database time t.
- `F(w,t) = max(P(w) - H(w) - T(w,t), 0)`.
- `D(X)`: canonical global outstanding ordinary Project demand across open Projects;
  zero for Calculator-linked FG admission, whose Project priority is represented by H.
- `test_admission_capacity(X,t) = max(sum(F(w,t), w in S(X)) - D(X), 0)`.
- `new_reserved(X) = min(required(X), test_admission_capacity(X,t))`.
- `missing_at_save(X) = required(X) - new_reserved(X)`.

Deduct ordinary global demand once per Product, not once per warehouse. Assign the
admitted quantity across free warehouse quantities in the stated source priority.
These are quantity holds, not source-lot allocations. Existing hard reservations and
active Test holds are never reclaimed to satisfy a new Test.

Project priority is admission priority for a new Save. Existing ordinary planning
commitments remain soft; later requirement/lifecycle changes do not become globally
forbidden by this rule and do not edit/cancel prior Test holds. Existing Project
planning, physical-shortage formulas and FG reservation/fulfillment accounting remain
unchanged. A shortage in a Test does not itself create Project shortage notifications.

### Protection, expiry and history

- Every protected warehouse debit must leave `P(w) >= T(w,t) + H(w)`. New FG Project
  reservations must also respect Test-held FG; checking physical debits alone is insufficient.
- Protect against unrelated removals/corrections, transfers, manufacturing consumption
  and competing reservations. No silent relocation or bypass for an Admin/another workflow.
- The mandatory deadline is a Europe/Sarajevo calendar date. Its exclusive expiry is
  the next local midnight converted to a fixed `timestamptz` instant, not a fixed 24-hour
  duration. The deadline day is included; at `t >= expires_at` the hold is expired.
- Use database time, including a fresh check after lock waits. Reject a new Save if
  its computed expiry is not future. Reads/debits/reservations exclude expired holds
  without requiring a background job or a status-update write.
- Expiry changes effective availability only. Keep the original saved allocation,
  creator, timestamps, item quantities, deadline and receipt as readable history,
  labelled Expired. No deletion, renewal or retroactive movement occurs.
- Authorized Test Calculator viewers and active Admins may read saved calculation
  history. Current warehouse stock remains subject to separate warehouse-view authority.

### Inventory presentation (additional, not replacement accounting)

Preserve existing Physical, Project commitment/reservation and availability fields.
Add blue Committed to Tests and Available After Projects and Tests. For Raw planning,
Test totals cover Raw + Customs and must be labelled with that combined scope:

- Raw view: `Raw + Customs - existing Raw+Customs Project commitment - T(Raw,t) - T(Customs,t)`.
- FG view: `P(FG) - global hard FG Project reservations - T(FG,t)`.
- Customs view: `P(Customs) - T(Customs,t)`; do not subtract global Project demand again.

Raw planning availability may be negative and is distinct from hard-free stock or the
multi-warehouse Test admission capacity. Never clamp away a planning shortage or
subtract FG reservations/Project demand twice. Preserve warehouse Product membership,
search/order and permission boundaries; unavailable/redacted reads never become zeros.
The existing Raw+Customs Project commitment projection keeps its current Product and
lifecycle scope; D above is the separate ordinary-input Test admission priority.
