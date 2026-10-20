# AlfaEV — APP_FLOW.md

Status: Canonical application flow v1  
Purpose: Define how users move through AlfaEV and how the major business workflows interact.  
Rule: This document describes user/business flow. Critical mutations remain governed by BUSINESS_RULES.md, DATA_MODEL.md, PERMISSIONS.md, SECURITY_RULES.md, and ARCHITECTURE_RULES.md.

---

# 1. Application Entry

## Unauthenticated user

1. User opens AlfaEV.
2. Application checks authentication state.
3. No valid session:
   - redirect to `/login`.
4. User signs in.
5. Backend verifies:
   - valid account
   - active UserProfile.
6. Application loads:
   - user identity
   - Admin flag
   - delegable permissions.
7. Update Last Login where appropriate.
8. Redirect to Dashboard `/`.

---

## Authenticated but inactive user

1. Session exists.
2. AlfaEV detects `is_active = false`.
3. Application blocks access.
4. User cannot load protected modules or perform actions.

The backend must enforce this too.

---

# 2. Application Shell

After successful login, user enters the protected application layout.

Shell contains:

- Sidebar
- Topbar
- current feature page

Navigation is permission-aware.

### Admin
Sees all navigation items.

### Non-admin
Sees only modules available to that user.

Special rules:

- Calendar is visible to every authenticated user.
- Users is never visible to non-admin users.
- Dokumentacija and Osnovna sredstva are never visible to non-admin users.
- Dashboard may be visible when `dashboard.view` is granted.
- Dashboard widgets themselves still inherit source-module permissions.

---

# 3. Dashboard Flow

During early development:
- Dashboard remains a placeholder.

Near the end:
1. User opens `/`.
2. System loads only data the user is authorized to view.
3. Admin receives full cross-module overview.
4. Non-admin receives only permitted widgets.
5. Global Calendar/company information may appear for all users.
6. Dashboard never exposes unauthorized module data.

Expected eventual widgets may include:

- recent Projects
- recent Work Orders
- recent Products
- Inventory warnings/summary
- active Nabavka
- recent AuditLog business activity
- company Calendar information

Project Activity alerts appear only in an Alerts control on the right side of the
Dashboard content-heading row. They do not appear in the global Topbar. The inbox is
loaded with bounded normal fetches on Dashboard load, panel open, window focus, after
send/read actions, and explicit retry; V1 has no polling or Realtime subscription.

---

# 4. Project Flow

## Admin / authorized creator

1. Open Projects.
2. Create Project.
3. Enter:
   - name
   - customer/buyer
   - status
   - start date
   - delivery date.
4. Save Project.
5. Audit creation.

## Project lifecycle

Allowed stored statuses are Planned, In Progress, On Hold, Completed, and Cancelled.
Normal Project editing can select only Planned, In Progress, or On Hold. Completed is
entered only by the trusted final-Work-Order Finish flow, while Cancelled is entered
only by the separate trusted cancellation flow.

Transitions are not required to be a rigid state machine unless later specified, but only allowed status values may be stored.

### Completed Project

1. A trusted Finish operation completes the final unfinished Work Order for the Project.
2. The same transaction automatically changes the Project to Completed and sets server-owned completion metadata.
3. Normal Project business fields and planned requirements become read-only.
4. Historical planned and actual material usage remains visible.
5. If legitimate work must continue:
   - Admin explicitly reopens Project to In Progress.
6. Reopening is audited and makes still-outstanding requirements count as commitments again.

Normal Project editing may select Planned, In Progress, or On Hold. It cannot set
Completed directly. Existing Completed Projects remain preserved.

## Project Products and commitments

1. An authorized Project editor adds one or more Project Products, such as B24 or Main Cabinet.
2. For each Project Product, the editor selects active stock-tracked Products and enters the planned total required quantity.
3. AlfaEV prevents duplicate use of one Product within the same Project Product.
4. Planning updates do not change InventoryBalance or create InventoryMovement.
5. Inventory and Project views derive outstanding commitment separately for each Project and Product, then sum those values by Product.
6. Only qualifying physical consumption for that same Project and Product reduces its commitment; one Project's consumption never offsets another's.
7. Completed or Cancelled Projects contribute no commitment; unused material is released without a stock movement.

Qualifying consumption includes finished Work Order deductions and, where applicable,
Project-linked PCB production input deductions. Additions/output movements, unrelated
manual adjustments, and another Project's consumption are excluded, and the existing
PCB anti-double-counting rule remains authoritative.

## Project material usage

Project material totals are not manually edited.

They derive from:

- Finished Work Orders linked to Project
- Project-linked PCB production input consumption

The Project detail page provides traceability back to the original operation.

## Project Activity collaboration

1. An active Admin or user with `projects.view` opens the Project detail Activity
   timeline. It loads the newest 20 immutable human-authored updates, with keyset
   `Load more` pagination.
2. If the Project is `planned`, `in_progress`, or `on_hold`, an active Admin or user
   with `projects.edit` may enter a required title, required description, and at most
   one optional private JPEG/PNG/WebP image up to 5 MiB.
3. `Post update` submits one client-generated request UUID, permanently binds it to
   the Activity author, and creates Activity only. Only that author may replay it;
   another actor, including an Admin, receives generic `42501` before payload
   comparison. The author's conflicting reuse remains `PAC01`.
4. `Post & send alert` is shown/accepted only when the actor also has Admin or
   `projects.alerts.send` authority. The trusted operation snapshots every active
   Admin automatically. Active non-admin recipients require an explicit
   `projects.alerts.receive` assignment plus current effective `dashboard.view` and
   `projects.view` access. An alert sender is included when eligible under the same
   Admin or non-admin rules.
5. If no eligible recipient remains, the entire alert-intent submission fails and no
   Activity is saved. Otherwise Activity, alert, recipients, and narrow AuditLog events
   commit atomically. After that succeeds, the separate trusted image workflow uploads
   and attaches the optional image with the same author-bound request UUID; an image
   failure may leave the committed text Activity available for retry.
6. Completed/Cancelled Projects show historical Activity but no composer. An exact
   replay by the original author remains valid when current authorization is retained
   and creates no new recipient, audit, attachment, or other historical mutation.
7. Activity is append-only. A correction is another update; V1 has no edit, delete,
   Admin delete, image replace/remove, or alert resend.

## Dashboard Activity-alert flow

1. An explicitly addressed active recipient with current `dashboard.view` and
   `projects.view` opens the Dashboard Alerts control.
2. The bounded panel shows Project, Activity title, author, timestamp, and unread/read
   state, newest first; it does not duplicate the description/image.
3. Opening the panel does not mark anything read.
4. Clicking one notification marks only that recipient row read, then opens
   `/projects/<projectId>#activity-<activityId>`.
5. The Project route strictly validates the Activity UUID fragment. If the item is
   outside loaded Activity pages, an authorized narrow by-ID read renders it as a
   separate `Linked activity` without changing timeline cursors or ordering. A target
   already present in loaded pages uses its normal chronological row. Each genuine
   navigation event positions the resolved row inside the bounded Activity scroller,
   makes only the necessary explicit outer-page adjustment, focuses the row without a
   second browser scroll, and applies a restrained 2.5-second highlight. Reduced-motion
   users receive immediate positioning without animated emphasis.
6. A stored recipient row is hidden while current active/Dashboard/Project access is
   absent and may become visible again if that access is restored. Recipient membership
   itself is never recomputed retroactively.
7. Each Dashboard notification has a sibling three-dot menu with a
   `Dismiss notification` action. Confirmation is required. Successful dismissal
   permanently removes the row from only that recipient's active inbox and unread
   count, retains the Activity, alert, and recipient history, preserves `read_at`, and
   neither navigates nor affects other recipients. V1 has no undo or
   dismissed-notification archive.

---

# 5. Nabavka Flow

## Existing component request

1. User opens Nabavka.
2. Click Add Request.
3. Search/select existing Product.
4. AlfaEV fills:
   - Serial Number / Šifra
   - Name.
5. User enters Quantity; Supplier is not requested and remains unassigned.
6. Save as Active.
7. Sidebar Nabavka badge increments by 1.
8. Audit creation.

---

## Brand-new component request

1. User opens Add Request.
2. Indicates/selects that component does not yet exist.
3. Enters:
   - Name
   - Quantity.
4. Supplier is not requested and remains unassigned.
5. No Serial Number exists yet.
6. Save request as Active.
7. Request is clearly marked as not linked to a Product.
8. Sidebar badge increments.

### Admin creates component from request

1. Admin opens request.
2. Clicks `Create component from request`.
3. Supply any missing Product fields required for Inventory, such as Category/Brand.
4. Trusted backend:
   - allocates next 7-digit Serial Number
   - creates Product
   - links the Product to the historical request's Supplier only when one exists; Catalog Number/Description already belong to that Supplier
   - links request to Product
   - audits operation.
5. Request remains in its procurement lifecycle until resolved.

---

## Partly Delivered

1. Admin/authorized user receives only part of requested quantity.
2. Change status to Partly Delivered.
3. Enter/update Delivered So Far.
4. AlfaEV calculates Remaining.
5. Request continues to count in Sidebar badge.
6. No Inventory update occurs automatically.

---

## Resolved

1. Admin/authorized user marks request Resolved.
2. Request remains historical.
3. Sidebar badge decrements because Resolved is excluded.
4. No automatic Inventory mutation occurs.

Physical stock entry is handled separately through Admin Inventory adjustment.

---

# 6. Supplier Flow

1. Authorized user opens Suppliers.
2. View/search Supplier list.
3. Create Supplier when allowed.
4. Enter:
   - name
   - Catalog Number
   - optional Description
   - country
   - contact person
   - phone
   - email.
5. Link Products through ProductSupplier relationships.
6. Link eligible Products through ProductSupplier without entering relationship Catalog/Description metadata.
7. Audit meaningful changes.

Referenced Suppliers are archived rather than hard-deleted.

---

# 7. Product / Inventory Flow

## Create Product

1. Authorized user/Admin opens Inventory.
2. Click Add Component/Product.
3. Enter Product fields:
   - Name
   - Category
   - Brand where applicable
   - Supplier links selected from existing Supplier master records.
4. User does not enter Serial Number manually.
5. Trusted backend allocates the next 7-digit Serial Number.
6. Product is created.
7. InventoryBalance begins at configured initial quantity, normally zero unless Admin explicitly performs an allowed stock-entry adjustment.
8. Barcode can be generated from Serial Number.
9. Audit creation.

---

## Import Components from Excel

1. An active Admin or user with `inventory.products.create` opens Inventory and chooses Import Excel; no separate Sidebar item is added.
2. User downloads the canonical `.xlsx` template if needed, then uploads a `.xlsx` file with Name, Category, and optional Brand. The client parses data only; the file is not permanently uploaded to Storage.
3. Before any mutation, show a preview with spreadsheet row number, Name, Category, Brand, and ready/error status, plus total, ready, and invalid counts. Required Name/Category are trimmed and nonblank; blank Brand means none, and a supplied Brand must match an active existing Brand. Empty files, unsupported types, and invalid rows block confirmation. The user fixes the file and uploads it again; valid rows are not partially imported.
4. User explicitly confirms the complete valid preview. One trusted bulk operation rechecks authority, payload, every row, and current Brand state; browser preview is not authoritative and the browser does not call per-row Product creation.
5. The operation atomically creates one `component` per row with server-generated IDs/7-digit Serials and zero InventoryBalances, plus one immutable batch-level Product-creation audit listing created IDs/count. Excel cannot set kind, Serial, Supplier/Catalog Number, actor, timestamps, or initial stock; import creates no InventoryMovement.
6. On any failure, no Product, balance, or success audit persists. On success, refresh Inventory/Product queries. Physical stock entry remains separate.

---

## Barcode generation

1. Open Product detail.
2. Click Generate/View Barcode.
3. Barcode encodes Serial Number / Šifra.
4. User may open/download image.
5. Same barcode can be attached to physical warehouse box.

---

## Manual stock adjustment

Admin-only.

1. Admin opens Product.
2. Click Adjust Inventory.
3. Choose:
   - Add
   - Remove
   - Correction.
4. Enter Quantity.
5. Enter required Reason.
6. Trusted backend validates resulting quantity >= 0.
7. Atomically:
   - update InventoryBalance
   - create InventoryMovement
   - for Add/upward Correction, validate the exact selected ProductSupplier, read Catalog Number/Description from its active Supplier, and freeze those Supplier values in one source lot
   - for Remove/downward Correction, allocate and decrement existing source lots FIFO
   - create immutable outbound allocation rows and verify lot/balance reconciliation
   - create AuditLog.
8. UI refreshes current quantity/history.

Non-admin users cannot perform this operation regardless of UI manipulation.

---

# 8. PCB Definition Flow

## Create PCB Card

1. Authorized user/Admin opens PCB Cards.
2. Click Create PCB Card.
3. Enter only the required card name/code; AlfaEV trims it and rejects blank input. The user does not choose Serial Number, Product Category, Brand, kind, Supplier, or initial stock.
4. The trusted operation, authorized for an active Admin or `pcb.create`, creates one active `pcb_finished_good` Product with the normalized card Name, Category `PCB`, and no Brand, then links the new active PcbCard to it atomically.
5. That Product receives its own server-allocated 7-digit Serial Number / barcode identity and a zero InventoryBalance. Card creation adds no InventoryMovement, finished-goods stock, Supplier link, or Catalog Number. Exactly one Product creation audit and one `pcb_card.created` audit are recorded atomically; failed creation leaves no business or audit rows, though the consumed Serial is never reused.

After card creation, the later BOM workflow may:

6. Define BOM:
   - select an eligible existing active stock-tracked Product of kind `component` or `pcb_finished_good`, excluding this card's own output Product
   - enter quantity required per one PCB card.
7. Save active BOM version.
8. Audit creation.

Archiving a selected Product later does not remove or rewrite its existing BOM item; historical BOM versions continue to display that Product.

---

## Edit PCB BOM before production

If no production history exists:
- authorized editor may modify current BOM normally.

---

## Edit PCB BOM after production exists

1. User opens PCB card.
2. Chooses Edit BOM.
3. User proposes changes to component quantities/list; the existing used BOM definition and items remain immutable.
4. The trusted operation locks the card/current active version, creates the next version with those changes, deactivates the old used version from true to false, and activates the new version atomically. No other old-version field or item changes, and the old version cannot be reactivated.
5. Historical production remains linked to the exact old version.
6. Audit version change.

---

# 9. PCB Production Flow

1. User opens PCB card.
2. Click Produce.
3. Enter:
   - planned production quantity
   - optional Project.
   The optional picker shows only open Projects (`planned`, `in_progress`, `on_hold`) through a narrow trusted ID/Name/Status read available to active Admins or `pcb.produce` users; it does not require `projects.view` or grant Projects-module access.
4. AlfaEV loads latest active BOM.
5. Calculate every planned input:

`quantity_per_card × quantity_to_produce`

6. Display:
   - required
   - available physical `InventoryBalance.quantity`, not Available after Commitments
   - missing = max(required - available, 0).

## Create production Work Order

1. Show current missing components as precheck information; shortage does not block Draft creation.
2. Confirm creation with one durable request UUID.
3. Trusted backend freezes the active BOM, planned quantity, optional Project, generated description, and derived material rows in a Draft Work Order.
4. Creation records `work_order.created` and `pcb_production.work_order_created` but changes no Inventory and creates no completed production record.
5. Navigate to the Work Order only when the actor also has Work Order view authority; otherwise show its generated number safely.

---

## Successful production

In the Draft Work Order the production context and BOM-derived materials are read-only. An Admin or `work_orders.edit_draft` user may scan/add, change, and remove separate supplemental materials; `pcb.produce` alone does not grant this later editing authority. Supplemental materials are not constrained by Project planning and change no stock until Finish. The user enters actual successfully completed quantity from zero through planned quantity and confirms Finish.

Trusted backend transaction:

1. re-check authorization
2. re-check active BOM version/state
3. re-check the frozen PCB/BOM/Product identities, every supplemental Product, and every physical Inventory quantity
4. deduct all frozen BOM quantities plus all persisted supplemental quantities, aggregating a shared Product exactly once
5. create negative InventoryMovement rows
6. allocate each persisted material quantity across locked source lots FIFO; split-source allocations remain distinct historical rows
7. bind the PDF snapshot allocation fingerprint to the same allocation plan committed by Finish
8. add actual-good quantity to PCB finished-goods Product
9. create a positive output movement only when actual good is greater than zero
10. create PcbProductionRun
11. link optional Project
12. finish the Work Order and link its official PDF
13. append `work_order.finished` and `pcb_production.completed`
14. commit atomically without automatically completing Project

After success:
- finished PCB stock increases
- raw component stock decreases
- production history is visible.

---

# 10. Work Order Creation Flow

1. User opens Work Orders.
2. Click Create Work Order.
3. Trusted backend immediately allocates:
   - `RN-YYYY-NNNN`
4. Draft Work Order is created.
5. Number never changes or gets reused.

---

# 11. Work Order Draft Flow

1. User opens Draft.
2. Select Project.
3. Customer auto-fills from Project.
4. User enters short description.
5. User begins adding consumed materials.

### Barcode workflow

For each physical warehouse box:

1. scan barcode
2. scanner provides Serial Number / Šifra
3. AlfaEV resolves matching Product
4. Product appears in Work Order table
5. user manually enters Quantity consumed

If same Product is scanned again:
- prefer locating/updating the existing row instead of creating confusing duplicates.

### Save for later

1. User saves Draft.
2. All current data is preserved.
3. No Inventory quantity changes.
4. User may continue later.

### Delete Draft

If user has permission:
1. trusted backend locks the Draft and rejects stale or Finished state
2. Draft WorkOrderItems and the Draft are deleted atomically
3. exactly one immutable `work_order.deleted` audit records the deleted header and
   narrow material snapshot
4. Work Order Number is never reused
5. Inventory, Project, Product, PCB, PDF, and Storage state remains unchanged.

---

# 12. Work Order Finish Flow

1. User opens Draft.
2. Click Finish.
3. AlfaEV validates:
   - Work Order still Draft
   - user may Finish
   - Project exists
   - materials are valid
   - quantities > 0
   - Inventory is sufficient for every Product.

If insufficient:
- show missing stock
- do not Finish
- do not change Inventory.

If valid, trusted Finish operation:

1. re-check the selected Project lifecycle and the persisted Work Order materials
2. deduct every consumed Product exactly once
3. create Project-linked InventoryMovement records
4. mark Work Order Finished
5. record finisher/time
6. let the qualifying Project-linked physical consumption update derived planning reads
7. check for other unfinished Work Orders on the same Project
8. if none remain, automatically complete the Project and release unused commitment
9. generate/finalize permanent PDF
10. create required Work Order, Inventory, and Project-completion AuditLog history
11. commit/finalize safely as one coherent operation

After Finish:

- Work Order becomes read-only
- Inventory changes are permanent historical movements
- PDF is available
- no reopen
- no edit
- no delete.

One Project may have one or many Work Orders. Finishing one keeps the Project open
while another unfinished Work Order exists. ProjectProductComponent quantities are
never deducted separately from the Work Order consumption.

---

# 13. Documentation Flow

Admin only:

1. Open Dokumentacija.
2. Create or edit Name, fixed Category, Document Date, and exact non-negative Amount.
3. Optionally upload one validated PDF to private Supabase Storage.
4. Use authorized private/signed access to view or download it.
5. Replace or remove the PDF only through a trusted Admin business operation.
6. Archive rather than hard-delete historical records.
7. Audit meaningful record, archive, and PDF changes.

Non-admin users see no navigation item and cannot access the route, data, or PDF.

---

# 14. Fixed Assets Flow

Admin only:

1. Open Osnovna sredstva.
2. Create or edit Name, fixed Category, Purchase Date, and positive whole-number Quantity.
3. Archive rather than hard-delete historical assets.
4. Audit meaningful create/edit/archive changes.

Fixed Asset quantity does not update Product, Procurement, InventoryBalance, or
InventoryMovement.

---

# 15. Finished Work Order Correction Flow

Finished Work Orders are never edited.

If a mistake is discovered:

1. Admin initiates explicit correction/reversal process.
2. Enter required reason.
3. System creates reversing/corrective Inventory movements as needed.
4. Original Work Order remains unchanged.
5. Original PDF remains unchanged.
6. Audit correction action.

The exact correction UI can be finalized before implementation of that workflow, but historical immutability is mandatory.

---

# 16. Calendar Flow

## View

All authenticated active users:

1. open Calendar
2. see calendar
3. toggle categories:
   - Birthdays
   - Business Trips
   - Events
   - Vacations.
4. Calendar shows only selected categories.

Birthdays derive from User profiles.

## Manage

Admin-only:

1. create/edit Business Trip, Event, Vacation entries
2. save
3. audit meaningful changes.

No approval workflow exists for Vacation or Business Trip.

---

# 17. Archive Flow

## Admin

1. Open Archive.
2. View all Audit records.
3. Search/filter by:
   - date
   - user
   - module/entity
   - action
   - relevant record/context.

## Non-admin

Same read-only experience only if `archive.view` is granted.

No user can:
- edit Audit records
- delete Audit records.

---

# 18. Users / Permission Management Flow

Admin-only.

## Create User

1. Admin opens Users.
2. Click Create User.
3. Enter:
   - Full Name
   - Email
   - Birthday
   - Admin/non-admin status as appropriate.
4. Create account/profile using the selected authentication architecture.
5. If non-admin, configure permissions.
6. Audit creation/security changes.

---

## Edit User Profile

1. Admin opens an AlfaEV User.
2. Admin may edit:
   - Full Name
   - Email
   - Birthday
3. Email changes go through trusted backend orchestration so the Supabase Auth identity and `UserProfile.email` remain synchronized.
4. Successful email and profile changes create Audit history.

---

## Edit Permissions

1. Admin opens non-admin User.
2. Permission matrix displays delegable permissions.
3. Admin toggles allowed capabilities.
4. Save explicitly.
5. Backend validates Admin actor.
6. Permission grants/revocations are persisted.
7. Audit each meaningful permission change.

Non-admin users never gain permission-management capability.

---

## Deactivate User

1. Admin opens User.
2. Admin explicitly confirms deactivation.
3. Backend blocks self-deactivation.
4. Backend blocks deactivation when the target is the last active Admin.
5. Trusted AlfaEV backend marks the UserProfile inactive and records the acting Admin/time in current deactivation metadata.
6. Trusted server-side Auth administration disables future Supabase Auth sign-in without deleting the Auth user.
7. Existing sessions remain blocked by the authoritative AlfaEV `is_active` check.
8. Historical references remain intact.
9. Create an immutable Audit event.

---

## Reactivate User

1. Admin explicitly reactivates the User.
2. Trusted server-side Auth administration restores future Supabase Auth sign-in.
3. Trusted AlfaEV backend marks the UserProfile active.
4. Clear current `deactivated_at` and `deactivated_by_user_id` metadata.
5. Preserve historical deactivate/reactivate events in immutable AuditLog records.
6. Create an immutable reactivation Audit event.

---

## Change Admin Status

1. Admin opens another AlfaEV User.
2. Admin explicitly chooses Promote to Admin or Demote from Admin.
3. Backend blocks changes to the acting Admin's own Admin status.
4. Backend blocks demotion when the target is the last active Admin.
5. The target's Active/Inactive state remains unchanged.
6. Existing UserPermission rows remain preserved; Admin bypass applies while promoted and the preserved rows become relevant again after demotion.
7. Create an immutable Audit event for a successful meaningful change.

---

# 19. Permission Change Runtime Behavior

After permission changes:

- navigation must update
- route access must update
- page actions must update
- backend authorization must immediately reflect new permission state

Frontend cached permission state must not allow stale access to protected backend operations.

---

# 20. Archive/Audit Creation Principle

Meaningful business operations should create Audit records from trusted domain/backend operations.

Examples:

- Project created/edited/status changed
- Project Product/component requirement changed
- Project automatically completed by final Work Order Finish
- Project Activity created (narrow system event; free text/image excluded)
- Project Activity alert sent (safe IDs/state and recipient count only)
- Nabavka created/status changed/resolved
- Supplier changed
- Product created/archived
- Brand changed
- Inventory manually adjusted
- PCB BOM version changed
- PCB production completed
- Work Order created/deleted/finished
- Documentation record/PDF changed
- Fixed Asset changed
- Calendar changed
- User activated/deactivated
- permission granted/revoked.

Do not create audit records for:
- opening pages
- opening menus
- typing into unsaved fields
- filtering/searching
- cosmetic UI interactions.
- pure derived commitment/availability calculations.
- marking a Project Activity alert read or dismissing one recipient's notification.

---

# 21. Cross-Module Traceability Flow

AlfaEV must make important business history navigable across modules.

Examples:

### Work Order → Inventory
Finished Work Order shows the Inventory movements it caused.

### Work Order → Project
Project detail shows linked Finished Work Orders.

### PCB Production → Inventory
Production run shows consumed components and produced PCB finished goods.

### PCB Production → Project
If linked, Project detail shows that production contribution.

### Inventory → Source
Inventory Movement should identify source Work Order / PCB production / manual adjustment.

### Audit → Record
Archive entry should make it possible to identify/open the affected business record where appropriate.

---

# 22. Project Material Reporting Anti-Double-Count Rule

Project material reporting must preserve physical truth.

### Project-linked PCB production
If raw materials are consumed in a PCB production run linked directly to Project:
- those raw materials count toward Project material usage.

If the resulting finished PCB is later included in a Work Order:
- do not expand that PCB back into its BOM raw materials again.

### General-stock PCB production
If PCB production had no Project:
- its raw materials remain general production consumption.
- if finished PCB is later consumed in a Project Work Order, Project records the PCB finished-good item as the consumed stock item.
- do not retroactively assign its original frozen BOM or supplemental input consumption
  to that Project.

This avoids double-counting while keeping a traceable physical flow.

---

# 23. Logout Flow

1. User triggers Logout.
2. Authentication session is ended.
3. Local cached protected user/permission data is cleared.
4. Redirect to `/login`.
5. Protected routes become inaccessible.

---

# 24. Application Flow Definition of Done

The application flow is correctly implemented when:

- login and inactive-user handling are trusted
- navigation reflects authorization
- direct URLs cannot bypass authorization
- Dashboard respects module permissions
- Nabavka remains simple and does not mutate Inventory automatically
- Product Serial Numbers are always system-generated
- Inventory cannot change without a movement record
- PCB production Work Order creation changes no stock; its later atomic Finish consumes planned inputs and adds only actual-good finished-goods stock
- used BOM versions remain historical
- Draft Work Orders never affect Inventory
- Finished Work Orders are immutable
- Work Order PDFs remain tied to finished records
- Project material usage is derived without double counting
- Project Products model planned requirements without changing physical Inventory
- one Project may have multiple Work Orders, with requirements retained as planning data
- final Work Order Finish automatically completes the Project atomically
- Documentation PDFs remain private and Admin-only
- Fixed Assets remain Admin-only and separate from Inventory
- Calendar is globally readable but Admin-managed
- Archive is immutable
- Users is completely Admin-only
- all critical flows produce appropriate audit history
