# AlfaEV — SECURITY_RULES.md

Status: Canonical security rules v1  
Purpose: Define mandatory security controls for AlfaEV.  
Precedence: These rules override implementation convenience. Codex must not weaken them to make a task easier.

Warehouse rollout status: migrations 136–142 are deployed to alfaev-dev (142/142);
DEV `finish-work-order` v6 is ACTIVE. The warehouse frontend is implemented locally,
and read-only browser acceptance is complete. Controlled Stage 2 mutation acceptance
is pending and non-Admin browser acceptance is incomplete. No frontend production
deployment or warehouse production database rollout has occurred; production remains
at its previously verified migration state. Finished Goods Project reservation and
fulfillment/read backend code is local in undeployed migrations 143–146. Reservation
frontend and durable recovery are implemented locally; activation migration 147 is
prepared but unapplied. Application activation and real-browser mutation acceptance
remain pending.

---

# 1. Security Model

AlfaEV is an authenticated internal business application.

Security must assume that:

- authenticated users may attempt actions they are not authorized to perform
- browser code can be modified by the user
- hidden buttons are not security
- route guards are not sufficient security
- multiple users may modify related records concurrently
- historical/audit data must remain trustworthy

Authoritative protection belongs in the trusted backend/database.

---

# 2. Authentication

Use real Supabase Auth.

Rules:

- no public self-registration
- users are created/invited by Admin
- one Auth user maps to one AlfaEV UserProfile
- every protected request must have an authenticated actor
- inactive users are denied application access
- logout clears the active session
- do not implement authentication using localStorage flags

Do not store plaintext passwords anywhere in AlfaEV tables.

---

# 3. Active Account Enforcement

`UserProfile.is_active` must be enforced server-side.

An authenticated Supabase token is not sufficient if the AlfaEV profile is inactive.

`UserProfile.is_active` remains the authoritative AlfaEV access gate even when an older Supabase session/token has already been issued.

Trusted permission helpers/RLS must reject inactive users.

This prevents an already authenticated user from continuing to use AlfaEV after Admin deactivation.

Account activation/deactivation requires trusted Admin-only server orchestration across both layers:

- AlfaEV UserProfile active/deactivation state
- future Supabase Auth sign-in state

The browser must never receive service-role or other server-secret credentials used for Auth administration.

Self-deactivation and deactivation of the last active Admin must fail in trusted backend enforcement, not only in UI checks.

If either side of the Auth/UserProfile state change fails, the trusted operation must compensate safely and must not report success while the states are known to be inconsistent.

---

# 4. No Public Signup

Public user creation is disabled.

Only Admin may create/invite AlfaEV accounts.

User-management operations must execute through trusted Admin-only backend paths.

A non-admin must never be able to:

- create users
- reactivate users
- deactivate users
- promote users to Admin
- grant/revoke permissions

---

# 5. Authorization / Permissions

Admin:

- full authorized application access

Non-admin:

- only explicit per-user permissions

Security requirements:

- permission state stored in trusted database tables
- permission checks enforced by RLS/trusted functions
- frontend permission checks are UX only
- direct API/database attempts must still fail
- permission changes are audited

Permanently Admin-only:

- Users module
- permission management
- Admin-status changes
- account activation/deactivation
- manual Inventory quantity adjustment
- Calendar modification
- Dokumentacija records and private PDF attachments
- Osnovna sredstva

Brand authorization:

- normal Brand reads used by Inventory require Admin access or `inventory.view`
- Brand create/edit/archive operations require Admin access or `inventory.brands.manage`
- direct client mutation is not authoritative authorization
- trusted backend/database operations must re-check Brand mutation authorization and current archive state

Supplier authorization:

- Supplier reads require Admin access or `suppliers.view`
- Supplier creation requires Admin access or `suppliers.create`
- Supplier editing requires Admin access or `suppliers.edit`
- Supplier archive requires Admin access or `suppliers.archive`
- direct client mutation is not authoritative authorization
- trusted backend/database operations must re-check Supplier mutation authorization and current lifecycle state
- trusted Supplier create/update operations require a normalized nonblank Supplier `catalog_number` for active Suppliers and normalize optional Supplier `description` to trimmed text or `NULL`

Product authorization:

- Product reads require Admin access or `inventory.view`
- direct client Product `INSERT`, `UPDATE`, and `DELETE` are denied
- trusted Product create/edit operations must re-check authorization and allow only active Brands for new Product references or Brand changes
- confirmed `.xlsx` Component bulk import requires an active Admin or `inventory.products.create`; `inventory.view` alone is read-only and no new permission key is added
- the browser may parse and preview the untrusted file, but must not orchestrate row-by-row Product creation; one trusted backend operation revalidates every row and Brand at execution time before creating the batch atomically
- the bulk operation must derive actor, IDs, `component` kind, 7-digit Serials, timestamps, and zero-balance initialization server-side; client-supplied Serial, kind, Product/actor IDs, timestamps, or initial stock are never trusted
- any invalid row, unavailable/archived Brand, malformed payload, or denied actor fails the entire import: no Product, balance, or success audit persists; serial sequence values consumed by a rolled-back transaction are never reused
- a successful import records one immutable batch-level Product-creation audit identifying created Product IDs and count, without redundant per-row import audit events; importing alone creates no InventoryMovement
- Product archive/deactivate requires an active Admin or `inventory.products.edit`; `inventory.products.create` does not authorize archive and `inventory.view` remains read-only
- Product archive/deactivate remains a trusted backend lifecycle mutation; do not add a separate `inventory.products.archive` permission
- historical Products may continue to reference archived Brands
- archived Products remain readable for authorized historical access but are immutable through normal Product editing
- no normal hard-delete or reactivation/unarchive workflow is supported

ProductSupplier authorization:

- ProductSupplier reads require an active Admin, `inventory.view`, or `suppliers.view`; either view permission is sufficient and both are not required
- trusted Product-side ProductSupplier read operations may expose only the related Supplier ID, Supplier Name, live Supplier Catalog Number, optional Supplier Description, and Supplier active/archive state needed to display the relationship to those authorized readers
- a trusted minimal Supplier-choice lookup for creating ProductSupplier relationships may return only active Supplier IDs and Names, and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`
- these narrow cross-domain reads do not grant general Supplier-table access or expose Supplier Country, Contact Person, Phone, Email, or other Supplier details; normal Supplier reads continue to require an active Admin or `suppliers.view`
- trusted Supplier-side ProductSupplier read operations may expose only the related Product ID, Serial Number, Name, and active/archive state needed to display the relationship to those authorized readers
- a trusted minimal Product-choice lookup for creating ProductSupplier relationships may return only active Product IDs, Serial Numbers, and Names, and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`
- these narrow cross-domain reads do not grant general Product-table access or expose Product Category, Brand, lifecycle timestamps/actors, or other Product details; normal Product reads continue to require an active Admin or `inventory.view`
- direct client ProductSupplier mutation is not authoritative authorization
- trusted ProductSupplier add/archive requires an active Admin, `inventory.products.edit`, or `suppliers.edit`; current relationships have no per-link Catalog Number or Description editor
- one shared trusted backend authority applies regardless of whether the operation originates from Product detail or Supplier detail
- new relationships must re-check that both the Product and Supplier are active
- archived relationships are immutable, historically readable where authorized, and cannot be hard-deleted or reactivated through normal workflows
- Product or Supplier archive must not delete or cascade historical ProductSupplier relationships
- no separate ProductSupplier permission key is added
- ProductSupplier is eligibility/traceability only; deprecated relationship Catalog/Description columns are not authoritative and no live application read or write path may use them as Supplier master data
- Inventory Add and upward Correction remain Admin-only and additionally require an exact active ProductSupplier source belonging to the target active Product and active Supplier
- Inventory Add/upward Correction must derive Catalog Number and optional Description from the locked active Supplier row; the browser cannot submit either value as authority
- source-lot and allocation tables grant no browser writes; all receipt, FIFO consumption, allocation, and balance reconciliation occurs through trusted database functions
- narrow Inventory provenance reads may expose frozen Supplier name, Catalog Number, optional description, exact quantities, receipt date, and actor full name only; they do not broaden Supplier or UserProfile access

---

# 6. Row Level Security

Enable RLS on all user/business tables exposed through Supabase APIs.

Do not leave production business tables publicly readable/writable.

Policies must distinguish:

- authenticated/active user
- Admin
- user with explicit permission
- forbidden access

Use reusable security helper functions where possible rather than copying large policy expressions everywhere.

RLS must prevent IDOR-style access through direct record IDs.

---

# 7. Service Role

The Supabase service-role key must never appear in:

- frontend source
- Vite environment variables exposed to browser
- client logs
- downloadable bundles

Service role may only be used in trusted server/Edge Function contexts when required.

Prefer normal authenticated database calls/RPCs when service role is unnecessary.

---

# 8. Critical Mutations Must Be Trusted

The browser must not directly orchestrate multi-step critical state changes.

At minimum, trusted backend/database operations are required for:

- Product Serial Number allocation
- confirmed Excel Component bulk import
- Work Order number allocation
- manual Inventory adjustment
- Create Product from Nabavka
- PCB production
- Work Order Finish
- permission changes
- Admin-status changes
- account activation/deactivation
- Brand create/edit/archive
- Supplier create/edit/archive
- ProductSupplier add/archive

These operations must re-check authorization and current state at execution time.

---

# 9. Inventory Integrity

Inventory security rules:

1. quantity can never become negative
2. no feature directly overwrites quantity
3. every quantity mutation creates InventoryMovement
4. critical stock operations run transactionally
5. trusted backend re-checks current quantity
6. frontend calculations are informational only
7. stale client state must not be trusted

For stock deductions use database row locking/concurrency-safe update strategy.

---

# 10. Manual Inventory Adjustment

Permanently Admin-only.

Required input:

- target Product
- adjustment type: Add, Remove, or Correction
- quantity interpreted according to the selected adjustment type
- reason, trimmed and nonblank

The target Product must exist and be active. The trusted Task 060 operation must re-check Product active state at execution time. Archived Products remain historically readable and retain their InventoryBalance and InventoryMovement history, but cannot receive new manual Add, Remove, or Correction adjustments or movements.

Adjustment semantics:

- Add uses a positive amount to add; `delta = +quantity` and quantity must be greater than zero.
- Remove uses a positive amount to remove; `delta = -quantity`, quantity must be greater than zero, and the resulting stock cannot be negative.
- Correction uses the desired final stock quantity, not a delta; the target must be greater than or equal to zero and `delta = target_quantity - current_quantity`.
- A Correction target of zero is valid.
- A Correction target equal to current stock is an invalid no-op and creates neither InventoryMovement nor AuditLog.
- Manual movement types are exactly `manual_add`, `manual_remove`, and `manual_correction`.

The trusted Task 060 operation must atomically:

1. authorize the active Admin
2. re-check that the target Product exists and is active
3. call the Task 059 Inventory mutation primitive exactly once
4. create exactly one InventoryMovement through that primitive
5. append exactly one immutable AuditLog entry

If authorization, validation, balance mutation, movement insertion, or audit insertion fails, the balance change, InventoryMovement, and AuditLog must all roll back.

Reject:

- missing or blank reason
- Add or Remove quantity less than or equal to zero
- Remove result below zero
- Correction target below zero
- Correction target equal to current stock
- missing or archived Product
- non-admin actor

---

# 11. PCB Security

PcbCard reads require an active Admin or `pcb.view`.

Task 085 establishes only the PcbCard table, constraints, protected output-Product relationship, and SELECT RLS baseline. Direct normal-client PcbCard INSERT, UPDATE, and DELETE are denied. Trusted create, edit, archive, BOM, and production operations belong to their later owning tasks.

Every PcbCard must reference exactly one Product through a required, unique, history-preserving `output_product_id` foreign key. The referenced Product must have `product_kind = 'pcb_finished_good'`, and one Product may be the output of at most one PcbCard. The output Product relationship is immutable after card creation. Relation-level integrity must continue to accept the historical link if the output Product is archived later.

New PcbCard rows start active with no archive metadata. Active state requires both `archived_at` and `archived_by_user_id` to be null; archived state requires both values to be non-null. Actor references and the output Product reference use history-preserving deletion behavior. Task 085 adds no archive, hard-delete, or reactivation operation.

Trusted Finished Product Calculator creation accepts only Name/Code and an exact three-digit Serial Number. The client cannot supply Product kind/category/ID, actor identity, timestamps, or initial stock. Creation requires an active Admin or `pcb.create`; neither `pcb.view` nor Inventory Product permissions are required. The trusted operation derives the active `pcb_finished_good` Product, preserves the supplied Serial as text, links exactly that Product to the new active card, and relies on three-warehouse zero-balance initialization. It creates no InventoryMovement or Supplier relationship. Product, three zero balances, PcbCard, and exactly one `product.created` plus one `pcb_card.created` immutable audit event commit atomically or all roll back. Global constraints arbitrate concurrent Serial and normalized-name conflicts.

## PCB Production Security

PCB production uses two trusted atomic boundaries: creating a specialized Draft Work Order, then finishing that Work Order. Creating the Draft never changes Inventory and never creates a PcbProductionRun.

The locally implemented `/pcb/:pcbCardId/produce` workflow requires an active Admin or `pcb.produce`. New calculator-initiated production has no Project picker/query or Project association; the trusted creation boundary rejects a non-null Project for a new request. Historical Project-linked contexts and exact request replays remain readable and finishable without rewriting their links. Finishing that production never automatically completes a linked Project. General Project RLS and `/projects` authorization remain unchanged.

Creation requires only an active Admin or `pcb.produce`, not `work_orders.create`. It freezes the exact PcbCard, active BOM version, positive bigint planned quantity, General Stock context, auto-generated description, and BOM-derived WorkOrderItems behind a durable unique client request UUID. Each BOM-derived row has authoritative `pcb_bom` origin and cannot be edited, deleted, replaced, or forged through a normal/manual path. An active Admin or user with `work_orders.edit_draft` may later manage a separate complete set of `manual` supplemental rows through a narrow trusted operation; `pcb.produce` alone does not grant that authority. The frozen header and production context remain unavailable to generic Draft editing. After creation, normal Work Order view, finish, and delete-Draft permissions apply; `pcb.produce` grants no broad Work Order access. The legacy `produce_pcb(uuid,text,uuid)` immediate-stock RPC is not executable by normal authenticated clients.

PCB stock sufficiency uses trusted production-eligible physical quantities under
the warehouse/hard FG reservation rules, not Available after soft Project Commitments.
The approved Test Calculator V1 extension must also exclude active Test holds, without
changing the normal production workflow. Ordinary Project commitments remain a planning
read model, distinct from hard FG Project reservations and time-limited Test holds.

At Work Order Finish, require an active Admin or `work_orders.finish` and, before committing:

- re-check the Work Order Finish authority after blocking locks
- verify the frozen PCB Card/BOM identity still exists and matches the production context
- use the exact frozen BOM version even if another version became active after Draft creation
- verify exact planned quantity remains frozen
- validate exact bigint actual-good quantity from 0 through planned quantity
- re-read all required Inventory balances
- validate sufficient stock for the combined frozen-BOM plus supplemental quantity of every input Product
- prevent race-condition overspending

Atomic Finish consumes every frozen BOM row plus every persisted supplemental row. When both origins reference the same Product, validation and locking use their exact combined quantity. Ordinary inputs follow Raw Materials FIFO, Customs FIFO, then unreserved Finished Goods FIFO. Calculator-linked finished inputs use unreserved FG FIFO only, without recursive BOM expansion (local migration 148). Each consumed Product/warehouse and source lot is recorded. Output stock is credited only to Finished Goods and only by actual-good quantity. Actual good zero is valid, still consumes every input, and creates no output movement. Atomic success creates:

- PcbProductionRun
- input Inventory deductions
- input InventoryMovement rows
- finished PCB output Inventory increase
- one output InventoryMovement only when actual-good quantity is greater than zero
- AuditLog

If any step fails:
- no partial production state
- no partial Inventory mutation

Client-side "stock available" display is not authorization or final validation.

---

# 12. PCB BOM History

When adding or changing a BOM item, trusted backend validation must require an existing active stock-tracked Product of kind `component` or `pcb_finished_good` and reject the PcbCard's own `output_product_id`. Later Product archival must not invalidate, delete, or rewrite the existing BOM reference; historical versions remain readable with their referenced Product.

Once any PcbProductionRun references a BOM version, the run itself establishes that the version was used; do not add a separate used flag. Its `pcb_card_id`, `version_number`, `created_at`, and `created_by_user_id` cannot change. The version cannot be deleted, and its PcbBomItems cannot be inserted, updated, or deleted.

The only allowed update to a used version is `is_active = true` to `is_active = false`, with every other field unchanged, so a trusted new-version rollover can supersede it. This never permits editing its BOM definition. Reactivation (`false` to `true`) and every other used-version update are forbidden. Edits after production create a new version; Task 093 owns the trusted atomic rollover, not Task 092.

Backend policies/functions must enforce this.

Do not rely on disabled Edit buttons.

---

# 13. Work Order Draft Security

Draft Work Order:

- requires authenticated authorized actor to create/edit
- Work Order Number is generated by trusted backend
- Draft edits do not change Inventory
- trusted Draft header updates require an active Admin or `work_orders.edit_draft`;
  they do not additionally require `work_orders.view` or Project permissions
- trusted Draft header updates lock the Work Order and reject a stale expected
  `updated_at` before applying changes or treating a submission as a no-op
- a new/replacement Project must currently be `planned`, `in_progress`, or
  `on_hold`; an already-selected historical Project may remain selected
- Customer snapshot is derived from the selected Project and is never accepted
  from the client

Barcode scan input:

- trusted Product resolution requires an active Admin or `work_orders.edit_draft`
  and an existing Draft Work Order; it does not additionally require
  `work_orders.view` or `inventory.view`
- validate exact three- or seven-digit Serial Number text on the backend without
  trimming or numeric conversion
- resolve only an existing active Product by unique Product Serial Number;
  `component` and `pcb_finished_good` are eligible
- expose only Product ID, Serial Number, and Name through this narrow read
- do not broaden Product RLS or grant general Product-table access
- do not trust arbitrary product data supplied by client
- resolution is read-only and creates no WorkOrderItem, Inventory mutation, or
  AuditLog entry
- Current Inventory display may use a narrow trusted Draft-context read authorized
  for active Admin or `work_orders.edit_draft`; it exposes only the matching active
  Product ID and physical InventoryBalance quantity, without granting general
  Product or InventoryBalance access
- displayed Current Inventory is an informational snapshot, not a reservation;
  Finish re-checks authoritative physical Inventory before deduction
- Save for Later uses one trusted atomic desired-state operation for the Draft
  header and complete Materials set; it requires an exact expected `updated_at`,
  and any meaningful header or material change advances that unified Draft version
- desired material quantities are positive whole `bigint` decimal strings; new
  Product references are revalidated as active `component` or
  `pcb_finished_good` Products and locked against a concurrent archive
- unchanged or quantity-updated persisted item rows preserve their original ID and
  add metadata; a normalized full no-op performs no write and creates no audit
- persisted Draft materials may be reloaded through a narrow trusted read for an
  active Admin, `work_orders.view`, or `work_orders.edit_draft` actor; this does
  not broaden normal Product or InventoryBalance RLS
- Project requirements are planning/reference data only: generic Draft materials need
  not appear in them and are not capped by their remaining planned quantities
- selecting a Project supplies traceability and a trusted Customer snapshot; it does
  not reserve Project requirements or physical Inventory
- Project row locking preserves Project-selection/lifecycle serialization; a Project
  switch locks both old and new Projects in deterministic order
- Draft persistence never checks physical stock, reserves it, deducts it, or otherwise
  mutates Inventory; authoritative Product and physical-stock checks occur at Finish

New Draft material references may only target valid active Products where business
rules permit. A previously persisted reference remains historical if its Product is
archived later; it may remain, have its Draft quantity changed, or be removed, while
Finish performs its own authoritative Product and Inventory checks.

Draft deletion uses only a trusted backend operation authorized for an active Admin
or an active actor with `work_orders.delete_draft`; it does not additionally require
Work Order view/edit or Project/Inventory permissions. The operation locks the parent
Work Order, re-checks actor continuity and authority, verifies the exact expected
`updated_at`, and rejects Finished Work Orders. It deletes that Draft's WorkOrderItem
rows and parent atomically, appends exactly one immutable `work_order.deleted` audit,
and never reclaims its Work Order Number. Draft deletion does not mutate Inventory,
Projects, Products, PCB data, PDFs, or Storage. Direct browser deletes remain denied.

---

# 14. Work Order Finish Security

Finish is a critical trusted operation.

Before Finish:

- verify actor has Finish permission or is Admin
- verify Work Order is still Draft
- verify expected version/timestamp to prevent stale finalize
- validate Project
- validate all item quantities
- validate all referenced Products
- re-check Inventory balances
- reject negative resulting stock

Task 117 exposes this validation through a narrow trusted read-only preflight for an
active Admin or `work_orders.finish` actor. It locks the Work Order first, verifies
the exact expected `updated_at`, then locks the active actor authority, selected open
Project, referenced Products, and physical InventoryBalance rows in deterministic
order. InventoryBalance rows use `FOR UPDATE` so same-transaction finalization can
reuse them without a lock upgrade; a standalone preflight releases them when its
transaction ends and remains advisory only. It revalidates the persisted material set against current Project planning and
returns per-material physical availability/missing quantities. Insufficient stock is
a valid preflight result, not a mutation failure. Preflight creates no reservation,
mutation, InventoryMovement, AuditLog, PDF, or Storage state, and it grants no general
Project, Product, or Inventory read access.

On success:

- create all Inventory deductions
- create all InventoryMovement rows
- mark Work Order Finished
- lock historical data
- link valid permanent PDF
- create AuditLog

Finished Work Order:

- cannot be edited
- cannot be reopened
- cannot be deleted

Enforce in backend/database.

---

# 15. Work Order PDF Security

Canonical Work Order PDF is generated by trusted server-side code.

The trusted PDF snapshot contains FIFO source-allocation rows, not Product Serial Number as catalog data. It returns a canonical allocation fingerprint. Finish re-locks and recomputes the same FIFO plan and commits only when the fingerprint still matches; otherwise it fails without Inventory, Work Order, PDF, Project, or audit mutation. This prevents a PDF generated for one catalog source from committing against another source after a concurrent stock change.

Do not trust a client-generated PDF as the permanent official document.

The trusted renderer snapshot is available only through the Work Order Finish boundary:
active Admin or `work_orders.finish`, with the exact expected Draft version. It reuses
the Task 117 validation/locking path and returns only renderer-required Work Order,
Project-name, Customer-snapshot, Description, date, and persisted material identity /
quantity fields. It grants no general Project, Product, or Inventory read access.

Storage rules:

- private `work-order-pdfs` bucket accepting only `application/pdf` objects up to
  10 MiB
- no public permanent URL
- authorize access before issuing signed/controlled link
- use unpredictable object keys/internal IDs
- prevent arbitrary path access

Object names are server-generated and use the internal Work Order UUID:

- temporary: `_tmp/<work_order_id>/<object_uuid>.pdf`
- final: `final/<work_order_id>/<object_uuid>.pdf`

Authenticated browsers cannot read temporary objects or write, replace, or delete
any object in this bucket, including when the actor is Admin. Trusted service-role
code owns all temporary/final byte operations. A final object is browser-readable
only to an active Admin or `work_orders.view` actor after the Work Order is Finished
and an immutable `WorkOrderPdf` row references that exact path. `work_orders.finish`
alone grants no PDF read access. An uploaded but unreferenced final candidate remains
inaccessible.

`WorkOrderPdf` metadata is read-only to the same authorized viewers, only for a
Finished Work Order. Direct browser INSERT/UPDATE/DELETE is denied, and database-level
immutability prevents replacement or deletion even through later trusted workflows.

Finalize safely:

- generate temporary PDF
- revalidate Work Order before transaction
- atomically finish and link PDF reference
- delete temporary object if transaction fails

PDF content must come from trusted database records, not unsanitized arbitrary HTML.

---

# 16. Barcode Security

Barcode is a representation of Product Serial Number, not proof of authorization.

Scanning a valid barcode:

- identifies Product
- does not grant permission to consume/modify stock

Validate scanner input:

- exactly supported format
- exact 3- or 7-digit text, without numeric conversion
- Product exists
- Product is eligible for the requested workflow

Do not execute arbitrary commands/URLs from scanned barcode content.

---

# 17. Serial Number Security

Serial Number / Šifra:

- ordinary Product/import serials are allocated only by trusted database/backend
- approved Finished Product Calculator serials are supplied as exact three-digit text
  to a trusted, concurrency-safe creation boundary
- unique constraint enforced in database
- accepted from a user only for the approved three-digit calculator creation flow
- never reused

Use a concurrency-safe sequence for ordinary seven-digit Products and a concurrency-safe
global uniqueness constraint for both three- and seven-digit identities.

Format display must not weaken uniqueness.

---

# 18. Work Order Number Security

Work Order Number:

- allocated only by trusted database/backend
- unique constraint
- yearly counter concurrency-safe
- never reused

Client may display requested next number only if treated as non-authoritative; authoritative assignment occurs in trusted backend.

---

# 19. Nabavka Security

Nabavka does not mutate Inventory automatically.

ProcurementRequest reads require an active Admin or `procurement.view`.

Direct normal-client ProcurementRequest INSERT, UPDATE, and DELETE are denied. Task 075 establishes only the table, constraints, history-preserving foreign keys, and SELECT RLS baseline. Trusted create, delivery-update, resolve, and Product-link operations are added only by their later owning tasks.

Every new ProcurementRequest must be created through a trusted operation that fixes the initial state to `status = 'active'`, `delivered_quantity = 0`, `resolved_at = NULL`, and `resolved_by_user_id = NULL`. The client cannot choose a different initial lifecycle state.

Existing Product request:
- client may submit Product ID
- the trusted creation operation verifies at execution time that Product exists and is active
- the trusted operation copies the current Product name into the required `requested_name` request-time snapshot
- later Product renames or archival must not rewrite or clear the historical request snapshot or Product reference

Brand-new Product request:
- has no Product Serial Number
- may start with `product_id = NULL`
- requires a trimmed, nonblank worker-supplied `requested_name`
- worker cannot assign one manually

Procurement Request creation does not accept or require a Supplier and stores `supplier_id = NULL`; null means Supplier was not selected at request time. Existing historical non-null Supplier references remain protected by the Supplier foreign key, and later Supplier archival must not remove or rewrite them.

While a request is unresolved, trusted delivery updates keep `active` for zero delivered pieces and `partly_delivered` for any positive delivered quantity. Reaching the full requested quantity does not authorize silent resolution and may remain `partly_delivered` until the explicit Task 082 resolve operation. Resolution may occur at any delivered quantity from zero through the requested quantity. Resolved requests are terminal in the current scope, remain readable as history, and have no reopen, hard-delete, or reactivation path.

Task 080 trusted Delivered Quantity updates require an active Admin or `procurement.change_status`. `procurement.edit` alone does not authorize changing `delivered_quantity` or the Active/Partly Delivered lifecycle state, and the trusted mutation does not require `procurement.view`. The client submits only the request ID and desired Delivered Quantity; the backend atomically derives `active` when Delivered Quantity is zero and `partly_delivered` when it is positive.

The trusted delivery and resolve operations must enforce whole-number quantities, `requested_quantity > 0`, and `0 <= delivered_quantity <= requested_quantity`. Task 080 does not change `requested_quantity`. `remaining_quantity` is derived as `requested_quantity - delivered_quantity` and is never persisted.

Task 080 cannot modify a Resolved request or resolve, reopen, delete, or reactivate one. Task 082 remains the only explicit Resolve workflow and requires an active Admin or `procurement.resolve`; `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not imply terminal-resolution authority. The trusted Resolve mutation does not require `procurement.view`.

The Task 082 trusted Resolve operation accepts a request currently in `active` or `partly_delivered`, including at any valid Delivered Quantity from zero through Requested Quantity. It derives the actor from trusted authenticated context, sets `status = 'resolved'`, and sets `resolved_at`, `resolved_by_user_id`, `updated_at`, and `updated_by_user_id` server-side. It must not change Requested Quantity, Delivered Quantity, Product relation, requested-name snapshot, Supplier relation, or creation metadata. An already-Resolved request is rejected rather than accepted as a no-op.

Resolution is terminal in the current scope: a Resolved request cannot receive normal modifications, delivery updates, another resolution, reopening, reactivation, or hard deletion. Every successful resolution and exactly one immutable AuditLog entry must commit atomically. Denied or invalid attempts persist neither mutation nor audit. Resolution never mutates Inventory.

Every meaningful Task 080 delivery update must atomically create exactly one immutable AuditLog entry. A normalized/no-op Delivered Quantity submission changes no update metadata and creates no audit noise. Denied or failed delivery operations persist neither mutation nor audit, and no Procurement delivery/status operation automatically mutates Inventory.

Resolution metadata must remain equivalent to lifecycle state: `status = 'resolved'` if and only if both `resolved_at` and `resolved_by_user_id` are non-null. Both fields must be null for `active` and `partly_delivered` requests.

`Create component from request`:
- is permanently Admin-only, uses no delegable permission, and does not require `procurement.view` inside the trusted mutation
- accepts only an `active` or `partly_delivered` ProcurementRequest whose `product_id` is still `NULL`; reject resolved or already-linked requests
- locks the ProcurementRequest and re-checks eligibility so competing Admin attempts cannot create two Products for one request
- derives the request Supplier from `ProcurementRequest.supplier_id`; the client cannot substitute a different Supplier
- when that Supplier is non-null, requires it to still exist and be active; any supplied Brand must also exist and be active
- validates a required trimmed, nonblank Product Name and Category; Product Name may differ from the historical `requested_name` snapshot
- creates exactly one active `component` Product and allocates its permanent 7-digit Serial Number server-side; the client cannot choose it
- when Supplier is non-null, requires that active Supplier to already own a normalized nonblank Catalog Number and creates exactly one active ProductSupplier relation without accepting Catalog/Description input
- when Supplier is null, creates the Product without a ProductSupplier relation
- links `ProcurementRequest.product_id` without modifying its requested-name snapshot, Supplier, quantities, status, resolution metadata, or creation metadata
- creates the required immutable Product and Procurement-link AuditLog history plus ProductSupplier history only when a relationship is created
- commits Product creation, optional ProductSupplier creation, Procurement linking, and all required audits atomically

Failed or denied attempts persist no Product, ProductSupplier, Procurement link, or audit. A consumed ordinary Product Serial sequence value is not reused after rollback. Product creation initializes three zero InventoryBalance rows, one per warehouse, but this workflow creates no InventoryMovement and never adds delivered Procurement quantity to stock. Physical stock remains a separate authorized warehouse Inventory workflow.

---

# 20. Project Security

Project reads require an active Admin or `projects.view`.

Direct normal-client Project INSERT, UPDATE, and DELETE are denied. Project writes require a trusted operation that re-checks the active actor's corresponding `projects.create`, `projects.edit`, or `projects.archive` permission, or Admin status.

Normal Project field and status edits require an active Admin or `projects.edit`. The normal edit operation may change only `name`, `customer_name`, `start_date`, `delivery_date`, and a normal status of `planned`, `in_progress`, or `on_hold`; it must never set `completed` or `cancelled`. Only the trusted final-Work-Order Finish transaction may enter `completed`, set `completed_at` server-side, and keep `cancelled_at` `NULL`. Clients never provide lifecycle timestamps. A normal edit/status operation must not move a Project out of `completed`.

The `cancelled` status is the Project archive/removal state. Cancellation is a separate trusted operation requiring an active Admin or `projects.archive`; `projects.edit` alone never authorizes cancellation. Only a Project currently in `planned`, `in_progress`, or `on_hold` may be cancelled. Cancellation sets `status = 'cancelled'` and `cancelled_at` server-side while leaving `completed_at` `NULL`. A Completed Project cannot be cancelled directly. Cancellation never hard-deletes the Project. Cancelled Projects remain historically readable, are immutable, cannot change status, and have no restore/reactivation path in the current scope. Do not add separate Project `is_active`, `archived_at`, or archived-by fields.

Completed Project:

- protected from normal edits
- can only be reopened by Admin
- reopening is only the explicit `completed` to `in_progress` transition
- reopening clears the current `completed_at` and must be audited

Do not let a generic update endpoint silently change Completed Project fields.

Project status/timestamp consistency must be enforced at the database boundary: only `completed` may have `completed_at`, only `cancelled` may have `cancelled_at`, and all other statuses require both values to be `NULL`.

Every meaningful Project edit, normal status change, or cancellation appends exactly one AuditLog entry atomically with the mutation. A normalized no-op normal edit/status submission creates no update and no audit noise. Denied or failed operations persist neither mutation nor audit.

Project material usage is derived from trusted completed movement sources.

ProjectProduct and ProjectProductComponent reads require an active Admin or
`projects.view`. Their trusted mutations require an active Admin or `projects.edit`.
Direct table writes are not authoritative. Completed and Cancelled Projects reject
normal planning mutations. New or changed component requirements may reference only
Products that are active at execution time, while historical references survive later
Product archival.

Project commitments are derived planning data and must never directly decrement
InventoryBalance or create InventoryMovement. The trusted read model must first compute
`max(planned_requirement(P, X) - actual_project_consumption(P, X), 0)` independently
for each open Project P and Product X, then sum those isolated values into Product X's
`committed_to_projects`. Consumption from one Project must never reduce another
Project's commitment.

Only physical consumption for the same Project and Product qualifies: finished Work
Order deductions and, where applicable, Project-linked PCB production input
deductions. Inventory additions/output movements, unrelated manual adjustments, and
another Project's consumption do not qualify. Raw PCB inputs and later finished-PCB
consumption must not be double-counted. Available after Commitments is eligible
physical stock (Raw Materials plus Customs Warehouse, excluding Finished Goods) minus
the summed commitment; it may be negative and must not be clamped or used as a
substitute for authoritative physical-stock checks. A combined eligible-stock read is
shown only to an active Admin or a caller authorized to view both eligible warehouses;
one warehouse permission must not leak the other warehouse through the aggregate.

One Project may own multiple Work Orders. Their generic Draft materials are truthful
proposed actual-use records and may fall outside or exceed the Project plan; Project
requirements remain planning/reference data rather than an allocation boundary. Work
Order Finish remains the only physical consumption event and must not also deduct
ProjectProductComponent quantities.

Project Activity is an append-only human collaboration record and is not AuditLog.
Each Activity has an immutable `activity_kind` of `general` or `issue`; pre-existing
rows are General updates. The original author, content, classification, optional image,
and creation metadata never change.
Its title is required trimmed nonblank plain text of 1–120 characters. Its description
is required trimmed nonblank plain text of 1–5000 characters and preserves internal
newlines. Frontend checks are UX only; trusted backend validation is authoritative.
Reading Activity, including a direct deep-linked Activity, requires an active Admin or
`projects.view`; no separate Activity-read permission exists. Posting requires an
active Admin or `projects.edit`, and the trusted
write must lock/re-check that the Project is currently `planned`, `in_progress`, or
`on_hold`. Completed and Cancelled Projects retain readable historical Activity but
reject new posts.

A Project Activity fragment is navigation input only. The client accepts only the
anchored `#activity-<UUID>` form, normalizes valid UUID hex, and issues no target lookup
for malformed or unrelated hashes. The trusted by-ID read independently enforces the
active-user/`projects.view` boundary and exact Project/Activity relationship. Neither
notification identifiers, recipient identifiers, Storage paths, nor signed image URLs
belong in the route.

`Post & send alert` requires both Activity-post authority and alert-send authority:
the actor must be an active Admin or have `projects.edit`, and must also be an active
Admin or have `projects.alerts.send`. Alert recipients are selected explicitly at send
time. Every active Admin is included automatically. Each non-admin recipient must be
active, have an explicit `projects.alerts.receive` assignment, and have current
effective `dashboard.view` and `projects.view` access. An alert sender is included in
the recipient snapshot whenever that sender satisfies the same Admin or non-admin
eligibility rules as every other recipient. If that set is empty, the entire operation
fails; no Activity or partial alert fanout persists.

Recipient membership is snapshotted at send time, but current access still governs
reads. A stored recipient can see/open the historical notification only while active
and currently authorized by effective `dashboard.view` and `projects.view` access for
its Project.
Permission removal hides rather than deletes the recipient history; restoring access
may make the historically addressed notification visible again. Marking a notification
read changes only that recipient's row and occurs only on notification click, not panel
open or unrelated Project navigation.

An authorized recipient may permanently dismiss only its own Dashboard notification.
Dismissal is a separate one-way `dismissed_at` transition: it retains the recipient row,
preserves `read_at`, affects no other recipient, and never deletes or changes Activity,
alert, image, or AuditLog history. Admin access never bypasses recipient ownership.
Direct browser table mutation remains forbidden; a narrow trusted owner-only mutation
must enforce current active `dashboard.view` and `projects.view` access. Dismissal creates
no AuditLog event and V1 provides no undo or dismissed-notification archive.

All Activity/alert tables must use RLS with no broad browser writes. Trusted functions
must be `SECURITY DEFINER`, use an empty `search_path`, grant execution only to
`authenticated`, perform explicit active-user/Project checks, and expose bounded reads.
Activity and notification history use keyset pagination, default 20 and allowed 1–50;
OFFSET and unbounded reads are forbidden.

An Activity may have at most one immutable private image attachment. Only JPEG, PNG,
or WebP is allowed, up to 5 MiB; SVG and animated formats are forbidden. Trusted upload
handling must validate byte signatures and decoded image data where supported, choose
a random server-generated object path, permit only signed authorized reads, and prevent
browser replacement/deletion. Storage mutation is service-role-only. The cross-system
workflow must clean definitive orphans best-effort and reconcile indeterminate database
outcomes idempotently without exposing service credentials or arbitrary signing.
V1 attachment mutation is limited to the active Activity author, using the Activity's
original request UUID and current Admin-or-`projects.edit` authority while the Project
is writable; Admin does not bypass authorship. Exact referenced-object reads require
current active Admin-or-`projects.view` authority and issue a five-minute signed URL.

Every submission uses one client-generated request UUID that is permanently owned by
the original Activity author. An identical retry by that author for the same Project,
normalized title/description, and alert intent must return the same Activity;
conflicting reuse by that author must fail with `PAC01`. A different actor, including
an Admin, is denied with generic `42501` before payload comparison. An exact authorized
historical replay remains valid after Project completion/cancellation and performs no
new fanout, AuditLog append, attachment mutation, or history rewrite. Database
uniqueness is authoritative. One database
transaction must atomically cover Activity, optional alert event, recipient snapshot
rows, and narrow AuditLog events. After that succeeds, the separate trusted image
workflow may upload and attach the optional immutable image with the same author-bound
request UUID. Database failure leaves no posting rows committed; image failure may
leave the already committed text Activity available for image retry.

The trusted operation appends `project_activity.created` without copying the full
description or image into AuditLog. Alert generation additionally appends
`project_activity.alert_sent` with only safe identifiers/state and recipient count.
Mark-read and per-recipient dismissal create no AuditLog event.

An existing Issue may be resolved exactly once by an active Admin or an active user
with `projects.edit`, including after its Project is Completed or Cancelled. Resolution
does not reopen or otherwise mutate the Project. A trusted resolver-bound request UUID,
required normalized description, server timestamp, and resolver profile are stored in
one immutable resolution row. Exact same-resolver retries return that row; changed
payload fails with `PIR01`, another resolver receives generic `42501`, and a second
resolution fails. The original Activity remains immutable. Optional resolution-image
evidence uses a separate service-role-only prepare/attach/reconcile boundary tied to
the exact resolution, original request UUID, and original active resolver with current
Admin or `projects.edit`. The server validates decoded JPEG/PNG/WebP bytes (maximum
5 MiB), derives the hash/path, and writes only to the private Activity-image bucket.
Definite failures remove their candidate; uncertain outcomes reconcile exact immutable
metadata. Authorized reads revalidate active Admin or `projects.view` and sign only the
exact attachment for 300 seconds with `private, no-store`.

Issue resolution atomically creates one `issue_resolved` notification event, snapshots
all active Admins and active non-Admins with effective `dashboard.view` plus
`projects.view`, and appends one narrow `project_activity.issue_resolved` AuditLog
event. Neither `projects.alerts.send` nor `projects.alerts.receive` participates in this
automatic delivery; the resolver is included only when eligible. Zero eligible
recipients is valid. Manual Activity-alert eligibility and zero-recipient rollback are
unchanged. Recipient read/dismissal, private Realtime invalidation, current-access
rechecks, and direct-table denial apply identically to every notification kind.

Project-alert Realtime is a private, content-free invalidation signal only. The
database calls `realtime.send` with `{}` and broadcasts event `invalidate` on exactly one
`project-alert-notifications:<profile-uuid>` topic after that recipient's inbox/count
state changes. Supabase adds exactly one opaque transport `id` UUID, so the delivered
payload is exactly `{ "id": "<transport-uuid>" }`. That UUID is not a notification,
recipient, Project, Activity, or user identity, and the frontend must ignore the entire
payload. Private-channel authorization requires the active topic owner plus
current effective `dashboard.view` and `projects.view` access; Admin bypass applies to
those module permissions, never to topic ownership. There is no client-send policy,
direct recipient-table read, notification content, count, identifier, or other
protected business metadata in the message. The trusted inbox/count RPCs remain authoritative.
Realtime authorization can be connection-cached, so the signal must remain
content-free. Task 001C2 uses the current JWT to join only the captured profile topic,
ignores the payload, and refetches through the trusted RPCs. Logout, profile/access loss,
inactive transition, or unmount removes the channel and protected profile cache; late
callbacks are ignored. Polling remains forbidden.

When a Work Order finishes, the trusted transaction must check for other unfinished
Work Orders on the same Project. If none remain, it atomically completes the Project,
sets server-owned lifecycle/update metadata, releases unused commitment, and appends
the required immutable audit history together with Work Order and Inventory changes.
No partial Finished/Inventory/Project state is permitted. The existing Admin-only
`completed` to `in_progress` reopen remains valid.

---

# 20A. Documentation Security

Dokumentacija is permanently Admin-only at navigation, route, read, mutation, and
Storage layers. No delegable permission key is allowed. Non-admin and anonymous callers
must not receive Documentation data or PDF access through direct API attempts.

Documentation create/edit/archive and PDF upload/read/download/replace/remove require
a trusted active-Admin operation. Record mutations and meaningful PDF changes are
audited. Normal workflows do not hard-delete historical records and do not reactivate
archived records.

The optional PDF is stored in private Supabase Storage. Never store PDF bytes in
PostgreSQL, expose a public bucket/public URL, or send service-role credentials to the
browser. Validate PDF type, store only the private object path/reference on the
business record, and issue access only through authorized private/signed mechanisms.

---

# 20B. Fixed Asset Security

Osnovna sredstva is permanently Admin-only at navigation, route, read, and mutation
layers. No delegable permission key is allowed. Non-admin and anonymous callers must
not receive Fixed Asset data through direct API attempts.

Trusted active-Admin operations own create/edit/archive and immutable audit creation.
Normal workflows do not hard-delete or reactivate archived assets. Fixed Asset quantity
must never update or authorize changes to Product, ProcurementRequest,
InventoryBalance, or InventoryMovement.

---

# 21. Calendar Security

Read:

- all authenticated active users

Write:

- Admin only

Birthdays derive from UserProfile.

Do not expose extra User-account security data through Calendar queries.

Calendar views should return only fields required for Calendar display.

---

# 22. Users Module Security

Users route/module is Admin-only.

Non-admin must be blocked at:

- navigation
- route
- data query
- mutation layer

Never rely only on hiding the Sidebar item.

Sensitive User-management responses should expose only fields needed by Admin UI.

---

# 23. Permission Escalation Prevention

A non-admin must never be able to:

- edit `is_admin`
- insert/update UserPermission for themselves or others
- call Admin-only user-management functions successfully

Permission/Admin writes require authenticated Admin actor in trusted backend.

Use database constraints/policies/functions to make self-escalation impossible.

Writes to `UserProfile.is_admin` require trusted authorization by the currently active Admin actor. Browser/UI state is never authoritative.

An Admin-status operation must fail server-side when the actor targets their own Admin status or when demotion would remove the last active Admin. Last-active-Admin protection must be concurrency-safe.

Non-admin users must not be able to promote themselves through direct API or database attempts.

Admin-status changes do not require Supabase Auth mutation. They do not change account Active/Inactive state.

An inactive Admin-marked profile has no AlfaEV access because active-state enforcement remains authoritative over Admin bypass.

---

# 24. Audit Log Integrity

AuditLog is append-only.

Application users cannot:

- update AuditLog
- delete AuditLog

Audit entries should be created by trusted business operations and/or controlled database mechanisms.

Required context where relevant:

- actor
- action
- entity
- record
- before/after
- source
- timestamp

Avoid allowing clients to forge arbitrary actor identity.

Actor identity comes from authenticated session/trusted context.

---

# 25. Inventory Movement Integrity

InventoryMovement is immutable.

Clients must not directly:

- insert fake movements
- edit movements
- delete movements

Movements are created through trusted Inventory operations.

Source references must correspond to the real operation that caused the movement.

Inventory Movement history reads require an active Admin or `inventory.view`.

A trusted movement-history read may return the InventoryMovement fields required by the history UI together with `actor_user_id` and the actor's `full_name`. It must not expose the actor's email, birthday, Admin status, permissions, or any other UserProfile field. This narrow actor display boundary does not broaden general UserProfile RLS or UserProfile access.

Movement history includes movements for active and archived Products and is ordered newest first. It is read-only: the history UI and its read operation provide no UPDATE, DELETE, or reversal action, and existing InventoryMovement immutability remains authoritative.

---

# 26. Historical Record Protection

Protect historical records server-side:

- Finished Work Orders
- WorkOrderPdf references
- used PCB BOM versions
- completed PCB production runs
- InventoryMovement
- AuditLog
- immutable identifiers

Archived/deactivated master data remains available for historical joins.

---

# 27. Input Validation

Validate all externally supplied values.

At minimum:

- IDs
- enum/status values
- quantities
- dates
- email
- Serial Number scan values
- text lengths
- nullable/required fields

Reject unexpected properties where practical.

Use typed validation schemas in frontend/server, plus database constraints.

---

# 28. Text / XSS Safety

React escapes text by default.

Do not introduce `dangerouslySetInnerHTML` for business/user-entered content without explicit review and sanitization.

Store normal plain text for:

- descriptions
- reasons
- names
- contact fields

PDF generation must escape/render text safely rather than interpreting it as executable HTML.

---

# 29. SQL Injection

Use:

- Supabase query APIs
- parameterized SQL
- safe Postgres function arguments

Never concatenate raw user input into SQL strings.

Dynamic filtering/sorting must use allowlisted fields.

---

# 30. Error Handling / Information Disclosure

User-facing errors should be domain-safe.

Do not expose:

- raw SQL
- stack traces
- service-role credentials
- internal database structure unnecessarily

Known errors should map to clear messages such as:

- Insufficient inventory
- You do not have permission
- Work Order is already Finished
- Product not found
- This record changed; reload and try again

Detailed technical errors may be logged securely for developers.

---

# 31. Storage Security

All business-document Storage is private.

Policies must prevent:

- anonymous reads
- unauthorized reads
- arbitrary overwrites
- path traversal/object guessing access

Use signed/authorized access.

Generated PDF objects should use stable internal identifiers rather than user-supplied filenames as security boundaries.

Documentation PDFs follow the same private-storage baseline and are Admin-only. Each
Documentation record may reference at most one optional validated PDF object. Upload,
read/download, replacement, and removal require trusted active-Admin authorization;
the browser never receives service-role credentials.

---

# 32. Environment Separation

Development and production must use separate backend environments/projects.

Never:

- run normal development against production data
- share production service-role secrets with local frontend
- commit secrets

Environment configuration must clearly identify target environment.

---

# 33. Database Migrations

Security-critical database behavior belongs in version-controlled migrations.

Include:

- RLS
- grants/revokes
- security helper functions
- trusted RPCs
- constraints
- sequences
- immutable-history protections
- Storage policies where managed as code

Do not make undocumented production policy edits.

---

# 34. Backups and Recovery

Production PostgreSQL and stored Work Order PDFs are business records.

Before production launch:

- verify Supabase production backup/recovery capability
- define expected backup retention suitable for Alfa Proteh
- ensure Work Order PDF Storage is included in operational recovery planning
- verify restore procedure/documentation exists

Do not treat Audit/history as disposable cache.

---

# 35. Concurrency / Race Conditions

Critical workflows must be designed for multiple simultaneous users.

Protect:

- Product Serial Number generation
- Work Order number generation
- Inventory deductions
- PCB production
- Work Order Finish
- Project lifecycle synchronization across multiple Work Orders
- final-Work-Order automatic Project completion
- one-time Product creation from Nabavka
- permission updates where stale state matters

Use database transactions, sequences, row locks, unique constraints, and optimistic version checks as appropriate.

---

# 36. Authorization-Aware Dashboard

Dashboard queries must honor the same permissions as the source modules.

Do not:

- run an unrestricted aggregate query
- return hidden module data to frontend
- merely hide unauthorized widgets after data has already been fetched

Only authorized data should leave the backend.

---

# 37. Logging

Application/Edge Function logs must not contain:

- passwords
- access tokens
- refresh tokens
- service-role keys
- sensitive secret values

Log IDs/context needed for debugging without dumping entire protected records unnecessarily.

---

# 38. Dependency Security

Keep dependencies intentional and updated.

Before adding a package:

- verify it is actively maintained
- avoid duplicate libraries that solve the same problem
- prefer small well-established packages
- avoid executing untrusted package-generated HTML/scripts

Run dependency/security review before production release.

---

# 39. Production Security Gate

Before production launch, verify at minimum:

- real Auth enabled
- public sign-up disabled
- inactive accounts blocked server-side
- RLS enabled on all exposed business tables
- Admin-only Users enforced server-side
- Admin-only Dokumentacija and Osnovna sredstva enforced server-side
- non-admin permission escalation impossible
- service-role secret absent from frontend
- Inventory cannot go negative
- manual adjustment Admin-only
- PCB production atomic
- Work Order Finish atomic/safely finalized
- final unfinished Work Order completes its Project atomically
- Project commitments cannot mutate physical Inventory directly
- Finished Work Orders immutable
- used BOM versions immutable
- InventoryMovement immutable
- AuditLog immutable
- private PDF Storage
- private Admin-only Documentation PDF access
- signed/authorized PDF access
- dev/prod separation
- migrations reproducible
- critical RLS/transaction tests passing
- `npm run typecheck` passes
- production build passes

---

# 40. Security Definition of Done

A feature is not complete merely because its UI works.

A protected feature is complete only when:

- authentication is enforced
- authorization is enforced in trusted backend
- invalid states are rejected
- concurrency is considered
- audit/history requirements are satisfied
- relevant writes are transactional
- direct API attempts cannot bypass UI restrictions
- errors fail safely
- automated tests cover critical security/business paths

## Automatic Project shortage alerts

Shortage detection is a trusted database responsibility. Browser roles cannot read or
mutate shortage episodes, immutable shortage events, or the reconciliation queue
directly. Reconciliation uses the canonical global Product availability calculation,
locks affected Products in UUID order, and evaluates final transaction state through a
deferred queue. System shortage notifications have no user sender. Recipient snapshots
contain only active Admins and active non-Admins with effective `dashboard.view` and
`projects.view`; notification ownership, dismissal, read state, and private Realtime
isolation remain unchanged. The trusted recipient-owned inbox derives shortage display
context only through the constrained notification → event → episode → Product chain.
It exposes only Product ID/name/Serial Number, opening or resolution, the immutable
global deficit snapshot, and baseline-detection state; it does not expose recipient
identities, Inventory internals, or unrelated Product fields. Increased/decreased
events remain internal history and never become Dashboard notifications.

## Task 001L — atomic automatic FG requirement reservations (local, undeployed)

`mutate_project_requirement` is the only request-aware FG requirement write boundary.
An active Admin or all of `projects.view`, `projects.edit`,
`inventory.finished_goods.view`, and `inventory.finished_goods.reserve` is required
for any FG-affecting change. Ordinary material authorization remains `projects.edit`
or Admin. No permission is granted implicitly and no browser table writes are added.

The request UUID locks original-actor/payload ownership before domain mutation.
Expected Product/quantity state rejects stale requirement edits. Project, affected
Products in UUID order, FG balances and reservation states serialize stock/demand
changes. Excess is released before the immediate FGR06 check sees the new plan.
Zero allocation and removed requirements have immutable, private replay receipts.
Receipt replay returns historical results only; it never recreates cancelled or
released reservations. Current authorization still applies. Legacy FG CRUD rejects
the bypass; its ordinary-material behavior is retained through private helpers.

Requirement recovery uses the existing backend/Auth-user/profile/Project scope and
Web Lock, with a separate strictly validated pending-intent record. It is persisted
and read back before dispatch; manual and automatic pending operations conflict.
No tokens or stock snapshots are stored. Restart requires explicit exact replay.
Malformed success and permission loss retain uncertainty. Records clear only after
a conclusive backend outcome and fresh authorized planning/FG reconciliation. Device
owners/XSS/storage clearing remain outside the browser journal's confidentiality and
durability guarantee; they do not weaken backend authorization or idempotency.

This is local implementation, not deployment or browser acceptance evidence.

## Finished Goods reservations — Phase 3A non-executable boundary

Local, undeployed migration 143 introduces a dedicated
`inventory.finished_goods.reserve` capability; no existing adjustment, Finish or
production permission implies it and no grants are assigned automatically.
The permission registry recognizes it without implementing reservation UI.

All three reservation mutation routines (the shared algorithm and reserve/release
wrappers) deny EXECUTE to PUBLIC, anon, authenticated and service_role. An Admin JWT
does not override that ACL. Database-owner execution in rollback-only local tests is
not browser access. Existing application functions do not invoke these routines.
This boundary MUST remain closed until Phase 3B protects every stock-debit, planning
edit and lifecycle path. Current operational hard reservations remain unavailable.

Both new tables have RLS enabled and no direct application/service table privileges.
Only two STABLE SECURITY DEFINER, empty-search-path read RPCs are authenticated-facing.
They require active Admin or both `projects.view` and `inventory.finished_goods.view`,
scope results to the supplied Project, and expose neither request UUIDs nor actors.
The internal mutation algorithm requires active Admin or all four of Project view,
Project edit, FG view and the dedicated reserve permission; it rechecks after waits.
Request replay checks original actor before payload comparison and never increments
quantity or appends another receipt/audit. Events cannot be updated or deleted.

No reservation fulfillment, debit protection, cancellation release or completion
integration is claimed in Phase 3A. DEV remains migration 142; no remote rollout is
authorized by the foundation's existence.

## Finished Goods debit protection — local Phase 3B1

Local migration 144 adds three private VOLATILE SECURITY DEFINER trigger helpers with
empty search paths: stock protection, explicit demand protection, and Project lifecycle
protection. No PUBLIC, anon, authenticated or service_role EXECUTE is granted. The
foundation's reserve/release/helper routines remain private, including to Admin JWTs.
The two replaced production helpers remain SECURITY INVOKER and non-browser-facing.

All FG balance decreases check reserved stock under the balance row lock. Trusted
prechecks/fingerprints allocate only unreserved quantities without exposing Project
attribution. Demand safeguards serialize on the Project row. Cancellation's trusted
`projects.archive`/Admin authority releases reservations as a lifecycle side effect,
not as general reserve authority; it appends retained actor-attributed receipts/audits.
Completion rejects unresolved reservations and reopening never recreates them.

Application-table ACLs/RLS and production/adjustment permissions are not broadened.
The function inventory recognizes exactly three additional trusted helpers (182 total
application SECURITY DEFINER functions with migrations 143/144). Local backend
acceptance passed; mutation activation and remote deployment remain unauthorized.

## Atomic Finished Goods fulfillment — local Phase 3C

Migration 145 adds exactly two private SECURITY DEFINER functions with empty search
paths (184 application SECURITY DEFINER functions total). Fulfillment requires active
Admin or Project view/edit plus FG view and dedicated reserve capability. It rechecks
after waits and retains actor/delegated-permission locks. No browser/service EXECUTE,
table access, permission grants, stock-guard bypass or RLS weakening is introduced.

Request UUIDs share the reserve/release ownership namespace. Check original actor
before payload differences; exact replay returns original immutable results without
new movement, allocation, receipt, audit or shortage fanout. Version and exact identity
checks prevent concurrent/stale execution against a different reservation or Project.

The single transaction reduces only the matching reservation and debits FG via the
existing FIFO primitive. Other Projects' protected stock remains guarded. Immutable
fulfilled receipts have unique movement links; reciprocal deferred checks enforce
source type/ID, Project/Product/warehouse, actor, quantity and allocation correspondence.
Orphan or spoofed fulfillment movements cannot commit. Failures roll back all effects.
The existing shortage queue/reconciler handles qualifying fulfillment consumption;
its physical eligibility and notification authorization rules are unchanged.
Everything remains local, disabled for application mutations and undeployed.

## Warehouse and Finished Product Calculator security

Tasks 001B–001C establish warehouse identity, composite integrity, independent
permissions, exact-warehouse trusted reads/adjustments, and two-sided transfer
authorization. Inventory tabs, calculator creation, warehouse-aware production, and
Raw-plus-Customs Project availability have their database changes deployed to DEV
through migration 142; the frontend remains local. Read-only browser acceptance is
complete, while controlled Stage 2 mutation and non-Admin acceptance remain pending.

- Trusted listing combines the complete escaped search predicate with membership:
  Raw retains compatibility visibility; Finished Goods requires a Card output link
  (including archived/zero-stock outputs); Customs requires positive quantity or
  committed movement history. Search cannot bypass membership.
- Membership grants no authorization and does not restrict existing trusted detail,
  adjustment, transfer or production operations. Calculator reads retain active Admin
  or `pcb.view` and the narrow projection, not general warehouse access. Output stock
  is Finished Goods; BOM input/picker stock stays Raw. The three read RPCs retain
  STABLE SECURITY DEFINER, empty search_path and unchanged ACLs/RLS.
- Inventory remains one trusted ledger, but balances, movements, and source lots become
  scoped to one of `raw_materials`, `finished_goods`, or `customs`.
- Active Admins retain the canonical bypass. Non-Admins require the exact warehouse
  permission for every trusted read or adjustment; hiding a tab is never authorization.
- The independently delegable permissions are
  `inventory.raw_materials.view`, `inventory.raw_materials.adjust`,
  `inventory.finished_goods.view`, `inventory.finished_goods.adjust`,
  `inventory.customs.view`, and `inventory.customs.adjust`. Access to one warehouse
  grants no access to another.
- Existing `inventory.view` holders receive an explicit Raw Materials view grant during
  migration. `inventory.view` must not become an implicit all-warehouse capability.
  Product create/edit permissions remain independent.
- Manual Add, Remove, and Correction keep their existing semantics but require the
  target warehouse's adjustment permission and trusted backend enforcement.
- The Inventory Add source-choice read requires active Admin or the exact target
  warehouse's `adjust` permission. It returns only active adjustment-source fields and
  does not broaden Supplier or ProductSupplier table access; the legacy source-choice
  RPC remains Admin-only.
- Warehouse Product detail requires active Admin or the exact target warehouse's
  `view` permission. It returns global Product/Brand detail plus only that warehouse's
  balance and separate balance timestamp, without granting direct Product/Brand access
  or leaking another warehouse's stock.
- Transfers require matching adjustment permission for both distinct warehouses,
  re-check authorization under the trusted transaction, lock balances in stable
  warehouse-ID order, preserve FIFO provenance, and commit paired movements atomically.
- Production deductions and output credit remain one atomic Work Order Finish. Every
  deduction records its actual warehouse; mixed-source consumption must neither
  duplicate nor omit stock changes. Output is credited only after successful Finish.
- Product identities and Serial Numbers remain global across warehouses. New Finished
  Product Calculator entries use a caller-supplied exact three-digit text Serial Number;
  ordinary Products/imports retain trusted generated seven-digit serials. Authorized
  lookup and scanning accept only exact three- or seven-digit identities.
- Customs stock may be production-eligible without a Raw Materials transfer, but this
  software rule is not evidence of legal clearance. Mandatory declarations, release
  evidence, validation, and responsible-actor requirements remain a compliance decision.
- Automatic ordinary-input allocation is Raw Materials FIFO, Customs FIFO, then unreserved
  Finished Goods FIFO. Calculator-linked finished inputs use unreserved FG FIFO only
  (local migration 148, not deployed); no recursive BOM consumption is permitted.
  Work Order Finish uses its existing trusted permission and does not grant
  general warehouse adjustment authority. Per-warehouse quantities stay behind trusted
  production/read projections.
- `get_finished_goods_inventory_commitments()` requires an active Admin or effective
  `inventory.finished_goods.view`, not `projects.view`. Its STABLE SECURITY DEFINER
  body has an empty search path and exposes only Product ID and warehouse aggregates;
  authenticated EXECUTE only, PUBLIC/anon/service_role denied. Private helpers remain
  private, with no direct table grants or RLS changes. No foreign Project identity is
  returned. Frontend SQL text projection preserves bigint values before JSON parsing;
  profile-scoped cache invalidation refetches rather than incrementing cached totals.
- Project availability aggregates Raw Materials plus Customs only when the caller may
  view both warehouses. Finished Goods is excluded, and no warehouse breakdown is
  exposed through Project planning. Shortage reconciliation remains trusted, deferred,
  final-state-only, and inaccessible to browser roles.
- The migration-142 correction, deployed to DEV, queues qualifying negative Project-linked
  Work Order/PCB input movements from every warehouse, without granting browser
  access to movements, the queue, episodes, or events. It reuses the private
  SECURITY DEFINER queue helper with an empty search path; existing RPC permissions,
  Raw-plus-Customs availability, and notification eligibility are unchanged.

### Finished Goods reservation context — local Phase 3D1

`get_project_finished_goods_reservation_context(uuid)` is STABLE SECURITY DEFINER
with an empty search_path, explicit authenticated EXECUTE and PUBLIC/anon/service_role
denial. Active Admin or both Project view and FG view are mandatory. No other
warehouse, adjustment, production or reservation permission substitutes for these.
Only explicitly required FG Products and the supplied Project's reservation identity
are projected; all other Projects contribute anonymous aggregate quantities only.

One consistent statement snapshot supplies physical FG, global reserved/free stock,
own reservation/version and canonical explicit demand. Archived Product and closed
Project history are not hidden; historical demand does not re-enter open commitments.
The shared demand calculation is a private SECURITY INVOKER helper with empty
search_path and no application/service EXECUTE. Existing RLS/table ACLs, immutable
history, mutation ACLs and all mutation authorization remain unchanged.
Historical Phase 3D1 checkpoint: read model implemented locally; frontend pending, mutation activation pending,
DEV deployment pending. This read is not authority to reserve, release or fulfill.

Phase 3D3B now implements local mutation UI with all four effective permissions
or active Admin, open-Project controls, trusted Product eligibility, frozen request
UUID/payload retries and captured-profile cache reconciliation. Prepared migration
147 grants only the three public wrappers to authenticated, validating negative
helper/table privileges; it is unapplied. Internal authorization, RLS, accounting and
immutable receipts are unchanged. No live activation or browser acceptance is claimed.

Phase 3D3C adds an untrusted browser recovery journal, not authentication or stock
authority. Its exact schema contains only backend/Auth-user/profile/Project scope,
original request UUID and immutable parameters, timestamps and resolution labels.
No tokens, credentials, Product names or Inventory snapshots are persisted. Logout
clears the active session/query cache but does not discard unresolved intentions.
Other identities cannot view/replay them through the application. A token captured
only in memory pins each HTTP request to its authenticated identity during switches.

Persist/read-back before dispatch and exclusive Web Locks are mandatory. Unavailable
or corrupted storage, unsupported locking and payload conflicts disable new conflicting
operations. Never silently overwrite/delete unresolved recovery data or generate a
replacement UUID. On restart all saved states require explicit replay; saved success
is not proof. Clear only after verified backend outcome and new authorized state
reconciliation. A permission denial/UUID conflict cannot resolve earlier uncertainty.
Browser storage is not tamper-proof or confidential against device owners/XSS;
backend authorization/idempotency remain final. Manual storage clearing/eviction is
outside the durable guarantee and requires reconciliation guidance, not false success.

## Test Calculator V1 security — approved, not implemented or activated

The Test feature is a separate hard-hold domain, not authority to manufacture, change
Project requirements, alter permissions or write Inventory. Apply the dedicated
view/manage and eligible-warehouse boundaries in PERMISSIONS section 10. Shared Test
history reads do not grant current hidden-warehouse data or another actor's replay.

### Trusted Save and retry ownership

- Preview writes nothing. One trusted Save must validate the entire bounded payload,
  Product identity/activity, positive exact quantities, deadline, current permissions
  and authoritative reservation/admission formulas. Browser proof is not authorization.
- Lock the request UUID, reject cross-actor reuse with generic access denial before
  payload comparison, and reject any changed immutable payload. Include name, Product
  quantities and deadline in canonical request ownership. Zero/partial results also
  get immutable receipts; replay must not create another hold or save audit.
- Recheck and hold required current authority through the mutation after blocking
  locks. Serialize all affected Product/warehouse capacity and ordinary Project-demand
  admission decisions with compatible ordering. Test/Test, Test/debit, Test/Project
  reservation and Test/requirement-lifecycle races must not overbook or deadlock.
- Header, items, holds, receipt and immutable save audit commit/roll back together.
  All tables retain RLS; application roles have no direct table writes. Public trusted
  wrappers use explicit authenticated EXECUTE, SECURITY DEFINER and empty search_path;
  helpers stay private. Do not weaken existing RLS/ACLs or grant service-role bypasses.

### Universal protection and expiry

- For every warehouse balance decrease, enforce physical >= active Test holds plus
  existing hard FG Project reservations for that warehouse under its balance lock.
  New/increased Test and FG Project reservations must enforce the same combined bound.
  Protect adjustment removals/downward corrections, transfers, production and Project
  fulfillment without disabling triggers, bypass flags or implicit Admin exceptions.
- Shared production precheck/allocation/Finish/PDF-fingerprint projections must exclude
  Test-held quantities while preserving FIFO and immutable historical provenance.
  No Test Save/expiry creates movements, lot allocations, output, Work Orders or changes
  the original component stock; Calculator-linked inputs never expand their BOM.
- The authoritative deadline is a Sarajevo date converted to exclusive next local
  midnight. Use server/database time, not browser time or transaction-start time cached
  across a lock wait. Recheck after waits; expired holds contribute zero everywhere.
  A background job/status update must never be necessary to release effective capacity.
- Expiry is not deletion, renewal, a movement or a new audit mutation. Read original
  allocation history as Expired. Later stock/Project changes do not top up, edit or
  cancel immutable Test holds. Test shortages do not generate Project notifications.

### Durable recovery and fail-closed projections

Persist original request UUID/payload before dispatch using validated backend/Auth-user/
profile-scoped recovery and cross-tab exclusion. Store exact decimal quantities and
deadline, never tokens/credentials. Do not silently discard an uncertain request on
logout, identity switch, reload or restart. Replay requires explicit action under the
same current identity/authority; malformed success remains uncertain.

Historical receipts are not live stock. Clear resolved intent only after conclusive
backend outcome and new authorized reconciliation; an expired replay never reactivates
holds. Corrupt/unavailable storage or unknown outcome blocks conflicting new Saves.
Browser storage is not a defense against device owners/XSS/eviction; do not claim it is.

Inventory aggregates use one authorized snapshot, exact bigint/numeric transport and
current effective expiry. Redacted/failed data is Unavailable, not zero. Warehouse
aggregates reveal no private calculation identity/creator/request or other Project
identity. No existing Project shortage/history rewrite or backfill is part of V1.

TC-02 implementation checkpoint: local undeployed migration 151 creates only the
three private Test tables and `test_calculator.view` / `test_calculator.manage`
definitions. No user gets an automatic grant. Both new trigger helpers are SECURITY
INVOKER with empty search paths and no application/PUBLIC EXECUTE. RLS plus table
revocations deny direct access even to Admin JWTs and service_role; no Test read or
mutation wrapper is activated. Existing SECURITY DEFINER inventory and Inventory/FG
protection remain unchanged. Stock protection, authority-enforcing RPCs and live
expiry reads described above are required later work, not provided by this foundation.

TC-03 local migration 152 adds only two authorized STABLE SECURITY DEFINER read RPCs
with empty search paths; expected application SECURITY DEFINER inventory becomes 192
on the local upgraded schema (190 existing plus two reads). Explicit authenticated
EXECUTE never bypasses active Test view/manage and all eligible warehouse-view checks.
PUBLIC/anon/service_role are denied EXECUTE and private tables remain inaccessible.
Selection validation rejects duplicates, archived/missing/unlinked or unauthorized
Products, malformed/extra fields and non-string/out-of-range quantities. Missing and
unauthorized Product IDs share generic access denial; search filters unauthorized rows.
Outputs contain only authorized Product identities and anonymous quantity aggregates.

Preview calculates existing hard FG reservations, active Test holds at one statement
time and ordinary demand priority without writes, row/advisory mutation locks or
receipt inspection. Provisional warehouse quantities are not reservations or FIFO
allocations. No caller-supplied context can exclude old holds. Save will recalculate;
this read is never authority to deduct/reserve stock or a guarantee after expiry or
concurrent changes. Nothing is activated or deployed to DEV by this local task.

TC-04 local migration 153 adds one VOLATILE SECURITY DEFINER Save wrapper with
empty search_path (local application inventory 193). Request ownership is checked
before payload comparison. Advisory UUID serialization and Product/balance locks
prevent duplicate or competing Saves from allocating the same stock. Current actor,
required grants and warehouse authority are rechecked after waits; actor/grant rows
are held through the transaction. The deadline is checked after waits and again
before return. All immutable records and audit roll back on any failure.
Private deferred total checks execute inside the trusted Save boundary; no invoker
helper is elevated and no table/receipt read grant is added. Expired exact retries
return only the original actor's receipt, never create new holds or recalculate it.
This is not operational stock protection: other debit/production/Project admission
paths still require TC-05 through TC-07 before activation. No DEV deployment occurs.

TC-05 local migration 154 adds one private invoker-only numeric active-Test helper
and one private SECURITY DEFINER trigger (local application inventory 194), both
with empty search_path and no PUBLIC/anon/authenticated/service_role EXECUTE grants.
Every existing quantity-decrease path hits the balance-row guard, including Admin
adjustments, downward corrections, transfers and low-level trusted deltas. No Admin,
fulfillment or transfer bypass exists. The existing FG Project guard is untouched.
Database wall time is observed inside the VOLATILE guard after the UPDATE row-lock
wait; fixed-snapshot transactions fail closed. No additional reverse-order locks,
RLS changes, direct table grants, hold mutation or physical/provenance rewrite occurs.
TC-06 must align production reads/plans with these holds, and TC-07 must protect Test
holds during new/increased Project reservations before operational activation.

TC-06 local migration 155 adds only a private SECURITY INVOKER production-capacity
helper and replaces two existing invoker-only production helpers with the same
signatures, empty search paths and private ACLs. No authenticated/PUBLIC/anon/
service_role EXECUTE is added; application SECURITY DEFINER inventory stays 194.
Production eligibility uses current database-time Test holds and existing hard FG
reservations, never soft demand or private Test identities. The allocation planner
reads expiry after Product/balance/lot waits and freezes per-warehouse free capacity
for its FIFO plan; existing Finish and fingerprint checks plus the TC-05 row guard
remain authoritative. No bypass, table grant, RLS change, reservation mutation or
historical rewrite is introduced. Project/Test admission remains TC-07 before activation.

TC-07 local migration 156 patches only the two reviewed post-lock FG admission checks
inside `change_finished_goods_project_reservation` and `mutate_project_requirement`.
Their exact signatures, owners, SECURITY DEFINER/search_path configuration and ACLs
are preserved (application inventory remains 194); no grant, policy or table change
is made. Migration source assertions reject drift rather than replacing unrelated
logic. Active Test capacity is re-read using database wall time after stock/state
waits; fixed-snapshot new admission fails closed. Existing Product/balance ordering
serializes Save against manual/automatic reservations and fulfillment, without taking
Project locks from Save. Original actor-bound receipt replay, permission/version/demand
checks remain intact. No soft-demand hardening, physical deduction on Reserve/Release,
Test-hold mutation, lifecycle policy change or automatic reallocation is introduced.
This local foundation is not DEV/application activation; later V1 gates remain required.

TC-08 local migration 157 adds one STABLE SECURITY DEFINER Inventory-only read with
empty search_path (application inventory 195), authenticated EXECUTE only and explicit
active identity plus warehouse-view checks. Raw combined quantities require Raw AND
Customs views; FG and Customs require only their own views. No Test permission is
required or substituted for Inventory authority. Existing membership/search filters
remain in force, including archived visibility, zero FG outputs and Customs history.
All quantities are exact TEXT; failed/unauthorized reads raise errors, never redacted
zero substitutes. Only authorized Product/warehouse quantity aggregates and expiry
timing are returned, not Test identities/creators/receipts/profile data. One server
as-of time governs positive active holds and their earliest relevant expiry. No table
grants, policies, mutation/accounting paths or historical rows change. There is no
client-supplied as-of parameter or expiry worker dependency.

Task 9/16 local migration 158 adds two STABLE SECURITY DEFINER history reads with
empty search_path (application inventory 197). `list_test_calculations` and
`get_test_calculation` require an active identity and Admin or Test view before
returning any existence/data. Shared history is not restricted to its creator;
Test manage or Inventory view alone does not authorize it. Current Inventory views
are not required for saved historical quantities. Anonymous, PUBLIC and service_role
EXECUTE are denied; no table/RLS/policy grants change.
Explicit projections expose only saved item/warehouse results and the creator's
current Full Name, never auth IDs, email, private request UUIDs/payloads or receipts.
This does not broaden UserProfile access or transfer actor-bound replay ownership.
Bounded keyset pagination and validated IDs fail closed. One server as-of classifies
expiry; history reads make no mutations, notifications, renewals or stock allocations.
