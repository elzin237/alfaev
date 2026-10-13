# AlfaEV — FEATURES.md

Status: Canonical feature scope v1  
Purpose: Define the approved AlfaEV product modules and their required behavior.  
Rule: Do not add placeholder or speculative modules that are not listed here.

---

## 1. Product Purpose

AlfaEV is an internal Alfa Proteh operational system for managing:

- projects
- procurement / Nabavka
- suppliers / Dobavljači
- products/components and inventory / Skladište
- PCB card definitions and PCB production
- work orders / Radni Nalozi
- Documentation / Dokumentacija
- fixed assets / Osnovna sredstva
- company calendar
- users and per-user permissions
- permanent audit/archive history

Every user has an individual account. Meaningful business actions must be attributable to the authenticated user who performed them.

---

## 2. Main Navigation

Final main navigation:

1. Dashboard
2. Projects
3. Nabavka
4. Dobavljači
5. Skladište
6. PCB Cards
7. Radni Nalozi
8. Dokumentacija
9. Osnovna sredstva
10. Calendar
11. Archive
12. Users

Unused placeholder pages from the current prototype must be removed.

Dashboard is the only page that may remain a temporary placeholder during early implementation.

---

## 3. Dashboard

### Early implementation
Keep Dashboard as a placeholder while the real modules are built.

### Final implementation
Build the real Dashboard near the end of the project, using live data from completed modules.

Expected dashboard content includes:

- important/recent projects
- recent Radni Nalozi
- recent products/components
- important inventory information
- active Nabavka information
- recent system activity
- other high-value cross-module summaries

Dashboard access must inherit module permissions:

- Admin sees the full Dashboard
- non-admin users only see widgets/data from modules they are authorized to view
- explicitly company-wide information may be shown to all authenticated users
- Dashboard must never leak data from an unauthorized module

Exact dashboard widgets should be finalized only after the underlying modules exist.

---

## 4. Projects

Projects are a core entity.

Each Project contains at minimum:

- project name
- buyer/customer
- status
- start date
- delivery/due date
- planned Project Products and their required stock-tracked components
- automatically derived components/materials actually consumed

Project Products are Project-specific deliverable/grouping records such as B24,
Control Unit, or Main Cabinet. They are not Inventory Products and do not receive
AlfaEV Serial Numbers merely because they exist on a Project.

Each Project Product may contain multiple component requirements. A requirement
references an eligible stock-tracked AlfaEV Product and records the planned total
whole-number quantity required for that Project Product. The same Product cannot
appear twice within one Project Product. Creating or changing a requirement may
select only an active Product; later Product archival preserves history.

Planning and physical usage are separate:

- planned Project requirements create outstanding commitments, not Inventory movements
- physical Inventory remains `InventoryBalance.quantity`
- actual consumption remains derived from completed Project-linked Inventory movements
- Draft Work Orders never deduct stock
- Project planning must never directly decrement Inventory

Commitment is calculated separately for each Project and Product before it is summed
for Inventory display. For an open Project P and Product X:

- planned requirement is the sum of Product X requirements within Project P
- actual consumption is qualifying physical consumption of Product X attributable to Project P
- outstanding commitment is `max(planned requirement - actual consumption, 0)`

`committed_to_projects` for Product X is then the sum of those per-Project outstanding
values across Projects in `planned`, `in_progress`, or `on_hold`. Consumption from one
Project must never reduce another Project's commitment. Completed and Cancelled
Projects contribute zero. Reopening a Completed Project to `in_progress` makes that
Project's own still-outstanding requirement contribute again after subtracting only
that Project's own prior consumption.

Qualifying actual consumption includes finished Work Order deductions linked to the
same Project and Product and, where applicable, Project-linked PCB production input
deductions. Inventory additions/outputs, unrelated manual adjustments, and another
Project's consumption do not reduce the commitment. Preserve the material-usage rule
that prevents double-counting raw PCB inputs and later finished-PCB consumption.

Project material usage must not be maintained as an unrelated free-text list.

Material usage is derived from completed operations linked to the Project:

- finished Radni Nalozi contribute their actual consumed components
- draft Radni Nalozi do not count
- PCB production contributes all frozen BOM and supplemental input consumption when
  that production run is linked to the Project

Project totals must remain traceable back to the original completed operation.

Normal Project editing may use Planned, In Progress, and On Hold, but may no longer
set Completed manually. Completing the final unfinished Work Order for the Project
automatically completes the Project in the same trusted transaction. The existing
Admin-only Completed to In Progress reopen remains supported.

Locked Project statuses:

- Planned
- In Progress
- On Hold
- Completed
- Cancelled

---

## 5. Nabavka / Procurement

Nabavka is intentionally simple.

### Add request workflow

Nabavka supports both existing and brand-new components.

#### Existing component
If the requested component already exists in AlfaEV:

- worker selects the existing product/component
- Serial Number / Šifra is populated automatically
- Name is populated automatically
- worker enters Number of Pieces / Quantity
- Supplier is not requested and may remain unassigned

#### Brand-new component
If the requested component does not yet exist in AlfaEV:

- worker may create the Nabavka request without an AlfaEV Serial Number / Šifra
- worker enters Name
- worker enters Number of Pieces / Quantity
- Supplier is not requested and may remain unassigned
- the request is clearly marked as not yet linked to an AlfaEV product

Admin may later use a `Create component from request` action.

That action:

1. creates the real Product/Component record
2. lets AlfaEV generate the next unique 7-digit Serial Number / Šifra
3. links the new Product/Component back to the Nabavka request

Workers never manually invent Serial Number / Šifra values.

Actual Product/Component creation remains under Admin control.

Workers/non-admin users may add Nabavka requests if they have the required permission.

### Statuses

Locked statuses:

- Active
- Partly Delivered
- Resolved

For Partly Delivered requests, display:

- requested quantity
- delivered so far
- remaining quantity

This is informational only.

### Inventory relationship

Nabavka does not automatically update Inventory.

When goods arrive, Admin/CEO updates Inventory manually through the Inventory workflow.

### Sidebar badge

The Nabavka sidebar item must show a badge containing the number of unresolved request rows:

- Active counts
- Partly Delivered counts
- Resolved does not count

The badge counts request rows, not requested piece quantities.

Example:
- one request for 500 pieces = badge +1
- five separate requests = badge 5

---

## 6. Dobavljači / Suppliers

The Suppliers page contains:

- list of all suppliers
- Add Supplier action

Each Supplier contains at minimum:

- supplier name
- country
- contact person name
- contact phone number
- contact email

Products/components and Suppliers have a many-to-many relationship:

- one product/component may be purchased from multiple Suppliers
- one Supplier may supply multiple products/components
- Catalog Number belongs to the specific Product–Supplier relationship
- the same product may therefore have different Catalog Numbers from different Suppliers
- Catalog Number remains non-unique

Supplier records should be reusable by Nabavka and product/component workflows.

---

## 7. Skladište / Inventory

### Brands

AlfaEV must support adding/editing product/component Brands.

Brand management belongs to Inventory/product administration and does not require a separate main-navigation page.

Products/components may reference a Brand.


Inventory tracks Alfa Proteh products/components and stock.

Authorized users can bulk-create Components from a canonical `.xlsx` template containing only required Name, required free-text Category, and optional existing active Brand. Each valid row creates a distinct `component` with its own server-allocated Serial Number and zero initial InventoryBalance; no Supplier/Catalog Number or stock movement is imported. An explicit preview and confirmation precede one all-or-nothing trusted import, and the Product list refreshes after success. The file is not permanently stored for MVP.

### Product/component fields

At minimum:

- Serial Number / Šifra
- Name
- Category
- Catalog Number
- Quantity

### Serial Number / Šifra

Locked rules:

- generated automatically by AlfaEV
- unique across AlfaEV
- 7-digit sequential format
- starts at `0000001`
- increments sequentially
- never reused
- used as the barcode value

Stored/barcode format:
`0000001`

The UI may optionally display the value with spaces for readability.

### Catalog Number

Locked rules:

- separate from Serial Number / Šifra
- supplier-related reference
- stored on the Product–Supplier relationship rather than as one global Product field
- a product may have multiple Suppliers
- each Supplier may use a different Catalog Number for the same product
- not unique
- two different products/components may share the same Catalog Number
- must never be used as the primary identifier

### Search/filter

Inventory must support finding/filtering products by at least:

- name
- Serial Number / Šifra

Catalog Number search may also be provided.

### Barcode

For each relevant product/component AlfaEV must support:

- generating a barcode from the Serial Number / Šifra
- viewing/opening the barcode
- downloading the barcode image

The same code is used on physical component boxes in the warehouse.

### Inventory traceability

Inventory changes must be traceable.

Meaningful movement/change sources include:

- manual additions
- manual removals
- corrections
- finished Radni Nalozi
- completed PCB production

The system records actor, time, quantities and source context through Inventory history and the Archive/Audit Log.

Inventory may never go below zero.

Inventory must eventually display three distinct quantities per Product:

- Physical Quantity: the real `InventoryBalance.quantity`
- Committed to Projects: outstanding planned requirement for open Projects after actual Project-linked consumption
- Available after Commitments: Physical minus Committed

Available after Commitments is not clamped to zero. A negative value is a useful
shortage signal and must be shown clearly. Planning commitments do not create
InventoryMovement rows and do not reserve or deduct physical stock.

---

## 8. PCB Cards

PCB Cards has two major responsibilities:

1. define PCB card types and their BOMs
2. perform PCB production

### PCB card definition

A PCB card definition contains:

- card name/code
- list of required inventory components
- quantity of each component required for one finished PCB card

Example:

E55:
- Connector A × 16
- Component B × 2
- Component C × 4

BOM rows must reference real AlfaEV products/components.

The page must show a list of all PCB card definitions.

### PCB production

User chooses:

- PCB card
- planned production quantity
- optional Project

AlfaEV calculates the total required quantity of every BOM component.

Example for 20 E55 cards:
- 16 × 20 = 320 Connector A
- 2 × 20 = 40 Component B
- 4 × 20 = 80 Component C

The system compares requirements against current Inventory.

If stock is insufficient, show:

- component
- required quantity
- available quantity
- missing quantity

Current shortage is informative while creating the Draft; it does not reserve stock. Production must not Finish if any required component is insufficient at Finish time.

Creation first freezes the PCB Card, active BOM, planned quantity, optional Project, generated description, and BOM-derived material rows in an idempotent specialized Draft Work Order without changing Inventory. Those rows remain immutable. While Draft, an Admin or `work_orders.edit_draft` user may manage a separate supplemental material set without changing the frozen plan or creating Project-planning/Inventory effects.

At Finish the user enters actual successfully completed quantity from zero through planned. If stock is sufficient:

1. complete the production run
2. record actual-good quantity and the exact frozen BOM version used
3. deduct BOM components for the planned quantity plus every saved supplemental material quantity; aggregate a Product that appears in both origins
4. add only actual-good PCB cards to finished-goods Inventory stock
5. record Inventory movements for both component consumption and finished-goods output
6. record actor and timestamp
7. create audit history

The Finish operation must be atomic: component deductions, actual output, production record, Work Order/PDF finalization, and audit history either all succeed or none do. Actual good zero creates no output movement and adds no stock.

Produced PCB cards are real stock-tracked finished goods. Example: producing 20 E55 cards results in `+20 E55` finished-goods inventory in addition to deducting the required BOM components.

### Optional Project link

Project is optional traceability on a PCB production Work Order/run and Finish never automatically completes it.

If a Project is selected:
- consumed components contribute to that Project's derived material usage

If Project is empty:
- production is treated as general stock/future-use production

Inventory deduction and audit history happen in both cases.

### BOM versioning

Before a PCB card has production history:
- Admin may edit its BOM normally

After production history exists:
- BOM changes must create a new BOM version
- old production runs remain linked to the exact version used
- new production uses the latest active version
- historical BOM data must never be silently overwritten

---

## 9. Radni Nalozi / Work Orders

Users must be able to create Radni Nalog documents.

Each Work Order contains at minimum:

- automatically generated Radni Nalog number
- Project
- Customer
- consumed materials/components table
- short description

One Project may have one or many Work Orders. Do not impose a restriction of one
Work Order per Project. Planned component requirements remain planning/reference data:
a generic Draft may record eligible materials outside the plan or above a remaining
planned quantity. Actual physical consumption is authoritative only at Finish.

### Work Order number

AlfaEV generates the human-readable Work Order number automatically.

Format:

`RN-YYYY-NNNN`

Examples:

- `RN-2026-0001`
- `RN-2026-0002`
- `RN-2027-0001`

Rules:

- sequence resets each year
- number is assigned when the Work Order is created, including drafts
- number never changes
- number is never reused, even if a draft is later deleted
- generation must be handled safely by trusted backend/database logic
- the database may still use a separate internal UUID

### Project/customer behavior

The user manually selects an existing Project.

Customer is then automatically populated from the selected Project's buyer/customer.

### Barcode materials workflow

Physical warehouse component boxes use the same barcode/code as the matching AlfaEV product Serial Number / Šifra.

While editing a Work Order:

1. user scans barcode on a physical box
2. AlfaEV finds the matching product
3. product is added to the Work Order materials table
4. product data is populated automatically
5. user manually enters only the consumed quantity

### Work Order actions

#### Delete
Draft Work Orders may be deleted subject to permissions and audit rules.

#### Save for later
Save the current Work Order as an unfinished draft.

Saving a draft:
- preserves current state
- allows later continuation
- does not affect Inventory

#### Finish
Finishing a Work Order:

- marks it Finished
- deducts consumed materials from Inventory
- records Inventory movements
- records actor and timestamp
- creates audit history
- generates a printable PDF
- reduces the Project's outstanding commitment through the resulting Project-linked physical consumption
- automatically completes the Project when no other unfinished Work Order remains

Inventory is deducted only on Finish.

The final Work Order transaction must atomically finish the Work Order, deduct stock,
record movements and audits, and complete the Project when appropriate. Project
requirements are not deducted separately, so the same material is never deducted twice.

### Finished Work Order behavior

Once Finished:

- read-only
- cannot be edited
- cannot be reopened
- cannot be deleted
- Inventory deductions remain preserved
- generated PDF remains tied to the record

If a mistake is discovered later, use an explicit correction/reversal workflow rather than rewriting the original record.

### PDF

Finished Work Orders generate a PDF that the CEO can:

- open
- print
- physically sign

Exact PDF visual layout will be designed later.

---

## 10. Dokumentacija

Dokumentacija is a permanently Admin-only module for company Documentation records.

Each record contains:

- Naziv / Name
- Kategorija / Category: Uvoz, Izvoz, Nabavka, or Troškovi
- Datum / Document Date
- Iznos / Amount
- optional private PDF attachment
- creation/update and historical archive metadata

Name is required, trimmed, and nonblank. Category is restricted to `uvoz`, `izvoz`,
`nabavka`, or `troskovi`. Document Date is required. Amount is an exact non-negative
decimal monetary value; floating-point storage is forbidden and no currency field is
currently included.

The optional PDF is stored in private Supabase Storage, never as PostgreSQL bytes or
through a public URL. Only Admin may upload, read, download, replace, or remove it.
Meaningful create/edit/archive/PDF changes are audited. Records are archived rather
than hard-deleted and have no current reactivation workflow.

---

## 11. Osnovna sredstva

Osnovna sredstva is a permanently Admin-only company-assets module.

Each Fixed Asset contains:

- Naziv / Name
- Kategorija / Category: Oprema, Uređaji, or Alati
- Datum nabavke / Purchase Date
- Količina / Quantity
- creation/update and historical archive metadata

Name is required, trimmed, and nonblank. Category is restricted to `oprema`,
`uredjaji`, or `alati`. Purchase Date is required. Quantity is a whole number greater
than zero.

Fixed Assets are independent of Products, Procurement, InventoryBalance, and
InventoryMovement. Admin may create, read, edit, and archive them. There is no normal
hard delete or current reactivation workflow, and meaningful changes are audited.

---

## 12. Calendar

Calendar contains an actual calendar view.

Supported categories:

- Birthdays
- Business Trips
- Events
- Vacations

Users can show/hide one or multiple categories.

### Birthdays
Birthdays come automatically from User profiles.

### Business Trips
Informational only. No approval workflow.

### Vacations
Informational only. No approval workflow.

### Events
Standard company calendar entries.

### Permissions
All authenticated users may view Calendar data.

Only Admin may create/edit/modify Calendar data.

---

## 13. Archive / Audit Log

Archive is a permanent history of meaningful business/data changes.

Each audit entry must record enough information to identify:

- user/actor
- action
- timestamp
- affected module/entity
- affected record
- previous value where relevant
- new value where relevant
- source/context where relevant

Audit coverage includes meaningful changes to:

- products/components
- inventory
- projects
- Nabavka
- suppliers
- PCB cards/BOMs
- PCB production
- Radni Nalozi
- Documentation records and PDF changes
- Fixed Assets
- Project Products and component requirements
- Calendar
- users
- permissions

Do not log meaningless UI activity such as opening a menu or clicking a sidebar item.

Audit entries are immutable and cannot be edited or deleted.

Archive should support practical searching/filtering because the dataset will grow over time.

---

## 14. Users / Accounts

Each AlfaEV user has an individual account.

Required account/profile fields:

- Full Name
- Email
- Birthday
- Active / Inactive status
- Admin flag
- per-user permissions
- Created Date
- Last Login

The Users page is completely Admin-only.

Non-admin users must not:

- see the Users navigation item
- access the Users page
- view a read-only employee/user directory

Only Admin can:

- create users
- view/manage users
- activate/deactivate users
- change Admin status
- modify permissions

The current localStorage-based fake login is temporary and must eventually be replaced with real authentication.

---

## 15. Permission Model

AlfaEV does not use a rigid Admin/Worker role matrix.

Instead:

### Admin
Admin always has full access to all modules/actions.

### Non-admin user
Permissions are controlled individually by Admin using per-user checkboxes/toggles.

Permissions are action-based and module-based.

Examples include:

- view
- create
- edit
- delete/archive
- finish
- change status
- adjust inventory
- produce PCB cards

Permissions must be enforced by trusted backend authorization, not only by hidden/disabled UI controls.

All permission changes must be recorded in Archive.

`Manage user permissions` is Admin-only and can never be delegated.

Dokumentacija and Osnovna sredstva are also permanently Admin-only modules. They do
not receive delegable permission keys.

---

## 16. Removed Placeholder Modules

Unused placeholder pages from the current React prototype must be removed from product scope and navigation.

Do not implement fake modules merely because placeholder routes/components already exist.

Dashboard is the only intentional temporary placeholder.
# Supplier Catalog Inventory Provenance

- Required Catalog Number and optional description on active ProductSupplier relationships
- Immutable Supplier, legacy/unknown, and internal-production source lots while preserving aggregate InventoryBalance
- Admin Inventory Add/upward Correction selects an exact ProductSupplier; outbound stock consumes FIFO automatically
- Immutable outbound allocation history for Work Order and PCB consumption
- Product detail Supplier Stock History
- Official Work Order PDFs render frozen Supplier Catalog Number allocations and split mixed-source quantities into truthful rows
