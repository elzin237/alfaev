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
8. Calendar
9. Archive
10. Users

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
- automatically derived components/materials consumed

Project material usage must not be manually maintained as a separate free-text list.

Material usage is derived from completed operations linked to the Project:

- finished Radni Nalozi contribute their actual consumed components
- draft Radni Nalozi do not count
- PCB production contributes when that production run is linked to the Project

Project totals must remain traceable back to the original completed operation.

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
- worker selects Supplier
- worker enters Number of Pieces / Quantity

#### Brand-new component
If the requested component does not yet exist in AlfaEV:

- worker may create the Nabavka request without an AlfaEV Serial Number / Šifra
- worker enters Name
- worker selects Supplier
- worker enters Number of Pieces / Quantity
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
- quantity to produce
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

Production must not complete if any required component is insufficient.

If stock is sufficient:

1. complete the production run
2. record the produced PCB quantity and exact BOM version used
3. deduct all consumed BOM components from Inventory
4. add the produced PCB cards to finished-goods Inventory stock
5. record Inventory movements for both component consumption and finished-goods output
6. record actor and timestamp
7. create audit history

The operation must be atomic: component deductions, production record creation, and finished-goods stock increase either all succeed or none do.

Produced PCB cards are real stock-tracked finished goods. Example: producing 20 E55 cards results in `+20 E55` finished-goods inventory in addition to deducting the required BOM components.

### Optional Project link

Project is optional on a PCB production run.

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

Inventory is deducted only on Finish.

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

## 10. Calendar

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

## 11. Archive / Audit Log

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
- Calendar
- users
- permissions

Do not log meaningless UI activity such as opening a menu or clicking a sidebar item.

Audit entries are immutable and cannot be edited or deleted.

Archive should support practical searching/filtering because the dataset will grow over time.

---

## 12. Users / Accounts

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

## 13. Permission Model

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

---

## 14. Removed Placeholder Modules

Unused placeholder pages from the current React prototype must be removed from product scope and navigation.

Do not implement fake modules merely because placeholder routes/components already exist.

Dashboard is the only intentional temporary placeholder.
