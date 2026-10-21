# AlfaEV — SECURITY_RULES.md

Status: Canonical security rules v1  
Purpose: Define mandatory security controls for AlfaEV.  
Precedence: These rules override implementation convenience. Codex must not weaken them to make a task easier.

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

Task 086 owns trusted backend-only PcbCard creation. The sole client input is the card Name/Code; the client cannot supply Product fields, Serial Number, actor identity, or initial stock. Creation requires an active Admin or `pcb.create`; neither `pcb.view` nor Inventory Product permissions are required. The trusted operation derives the active `pcb_finished_good` Product and its unique 7-digit Serial Number server-side, links exactly that Product to the new active card, and relies on normal zero InventoryBalance initialization. It creates no InventoryMovement or Supplier relationship. Product, zero balance, PcbCard, and exactly one `product.created` plus one `pcb_card.created` immutable audit event must commit atomically or all roll back. A consumed Serial Number is never reused even if that transaction rolls back.

## PCB Production Security

PCB production uses two trusted atomic boundaries: creating a specialized Draft Work Order, then finishing that Work Order. Creating the Draft never changes Inventory and never creates a PcbProductionRun.

The `/pcb/:pcbCardId/produce` workflow requires an active Admin or `pcb.produce`; selecting an optional Project does not additionally require `projects.view` or grant general Project reads. A trusted narrow choice read for this workflow may expose only Project ID, Name, and Status to an active Admin or `pcb.produce` user. General Project RLS and `/projects` access remain unchanged. New production planning may link only a Project currently in `planned`, `in_progress`, or `on_hold`; the trusted creation operation re-checks its existence and status. The Project is optional traceability only, does not create a new commitment, and finishing PCB production never automatically completes it.

Creation requires only an active Admin or `pcb.produce`, not `work_orders.create`. It freezes the exact PcbCard, active BOM version, positive bigint planned quantity, optional Project, auto-generated description, and BOM-derived WorkOrderItems behind a durable unique client request UUID. Each BOM-derived row has authoritative `pcb_bom` origin and cannot be edited, deleted, replaced, or forged through a normal/manual path. An active Admin or user with `work_orders.edit_draft` may later manage a separate complete set of `manual` supplemental rows through a narrow trusted operation; `pcb.produce` alone does not grant that authority. The frozen header and production context remain unavailable to generic Draft editing. After creation, normal Work Order view, finish, and delete-Draft permissions apply; `pcb.produce` grants no broad Work Order access. The legacy `produce_pcb(uuid,text,uuid)` immediate-stock RPC is not executable by normal authenticated clients.

PCB stock sufficiency uses current physical `InventoryBalance.quantity`, not Available after Commitments. Project commitments are a planning read model, not a physical-stock reservation.

At Work Order Finish, require an active Admin or `work_orders.finish` and, before committing:

- re-check the Work Order Finish authority after blocking locks
- verify the frozen PCB Card/BOM identity still exists and matches the production context
- use the exact frozen BOM version even if another version became active after Draft creation
- verify exact planned quantity remains frozen
- validate exact bigint actual-good quantity from 0 through planned quantity
- re-read all required Inventory balances
- validate sufficient stock for the combined frozen-BOM plus supplemental quantity of every input Product
- prevent race-condition overspending

Atomic Finish consumes every frozen BOM row plus every persisted supplemental row. When both origins reference the same Product, validation, locking, and consumption use their exact combined quantity and one canonical input movement. Output stock increases only by actual-good quantity. Actual good zero is valid, still consumes every input, and creates no output movement. Atomic success creates:

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
- validate the exact seven-digit Serial Number format on the backend without
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
- current expected 7-digit value
- Product exists
- Product is eligible for the requested workflow

Do not execute arbitrary commands/URLs from scanned barcode content.

---

# 17. Serial Number Security

Serial Number / Šifra:

- allocated only by trusted database/backend
- unique constraint enforced in database
- never accepted as a user-chosen identifier
- never reused

Use a concurrency-safe sequence.

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

Failed or denied attempts persist no Product, ProductSupplier, Procurement link, or audit. A consumed Serial sequence value need not be reused after rollback. Normal Product creation still initializes one zero InventoryBalance through the existing schema mechanism, but this workflow creates no InventoryMovement and never adds delivered Procurement quantity to stock. Physical stock remains a separate Admin Inventory workflow.

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
consumption must not be double-counted. Available after Commitments is physical
InventoryBalance quantity minus the summed commitment; it may be negative and must not
be clamped or used as a substitute for authoritative physical-stock checks.

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
