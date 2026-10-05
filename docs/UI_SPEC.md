# AlfaEV — UI_SPEC.md

Status: Canonical UI/UX specification v1  
Purpose: Define how approved AlfaEV modules should behave visually and interactively while preserving the existing React/Tailwind visual language.  
Rule: This is a UI behavior specification, not permission/security enforcement. Backend authorization and business rules remain authoritative.

---

# 1. UI Principles

AlfaEV is an internal operational tool.

The UI should optimize for:

- speed
- clarity
- low cognitive load
- reliable data entry
- obvious status
- traceability
- predictable actions
- desktop-first operational use
- responsive usability on smaller screens

Do not redesign the application into a different visual style.

Preserve the current approved:

- typography direction
- spacing rhythm
- Tailwind-based design language
- Sidebar / Topbar shell
- dark/light treatment already used by the prototype where applicable

Visual changes should support functionality rather than introduce a new brand system.

---

# 2. General Layout

Protected application layout contains:

- left Sidebar
- Topbar
- main content area

Desktop:

- Sidebar remains visible
- content area uses available width
- data-heavy pages may use wide tables

Mobile/smaller widths:

- Sidebar collapses into an overlay/drawer
- Topbar exposes menu control
- forms stack vertically
- tables may become horizontally scrollable or convert to compact card rows where needed

Do not hide essential data solely because the viewport is narrow.

---

# 3. Sidebar

Final navigation order:

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

Rules:

- Users, Dokumentacija, and Osnovna sredstva are visible only to Admin.
- Other items respect module visibility permissions.
- Calendar is visible to all authenticated users.
- Dashboard visibility follows the locked Dashboard permission model.
- Removed placeholder modules must not appear.

## Nabavka badge

Display a compact numeric badge beside Nabavka.

Badge value:

- count Active requests
- plus Partly Delivered requests
- exclude Resolved requests

Badge counts rows, not quantity.

Examples:

`Nabavka  4`

The badge should update after relevant mutations without requiring a full page reload.

---

# 4. Topbar

Topbar should remain lightweight.

Expected responsibilities:

- mobile Sidebar toggle
- optional page/global search entry if retained
- current user identity/profile access
- logout action

Do not overload Topbar with module-specific actions.

Primary create/edit actions belong in the relevant page header.

---

# 5. Page Header Pattern

Each module page should use a consistent page header.

Structure:

- page title
- concise supporting description if useful
- primary action on the right when authorized
- optional secondary actions

Example:

`Projects`
`Track active Alfa Proteh projects and delivery dates.`

`[ Add Project ]`

Permission behavior:

- if user cannot perform an action, do not render a fake enabled button
- disabled states may be used only when the reason should be visible to the user
- backend remains authoritative

---

# 6. List / Table Pattern

Data-heavy modules should use a consistent list/table shell.

Recommended features:

- search input
- relevant filters
- sortable columns where useful
- pagination or incremental loading when dataset grows
- clear empty state
- row click/open detail behavior
- compact status badge
- right-aligned row actions

Avoid placing too many action buttons inside every row.

Prefer:

- row click → detail
- overflow menu for secondary actions

Tables must not depend on color alone to communicate status.

---

# 7. Search and Filters

Search should be debounced where server-backed.

Use clear field labels/placeholders.

Examples:

## Inventory
Search by:

- Name
- Serial Number / Šifra
- optional Catalog Number

## Work Orders
Search by:

- Work Order Number
- Project
- Customer where useful

## Archive
Filter by:

- date range
- user
- module/entity
- action
- search text

Filters should be easy to clear.

Show active filter count when multiple filters exist.

---

# 8. Status Badges

Use one reusable StatusBadge component with domain-specific variants.

Project:

- Planned
- In Progress
- On Hold
- Completed
- Cancelled

Nabavka:

- Active
- Partly Delivered
- Resolved

Work Order:

- Draft
- Finished

Status badge must include readable text.

Do not encode meaning using color only.

---

# 9. Forms

Use a consistent form system.

Recommended:

- React Hook Form
- Zod
- shared field components

Each field should have:

- visible label
- clear validation message
- required indicator where relevant
- consistent spacing
- no placeholder-only labeling

Use appropriate control types:

- text input
- select/combobox
- date picker/input
- numeric input
- textarea
- permission checkbox/toggle

Primary form actions appear at the bottom/right.

Avoid multi-column forms on narrow screens.

---

# 10. Dialogs / Modals

Use dialogs for:

- focused small forms
- confirmations
- status transitions
- barcode preview
- manual Inventory adjustment

Use full pages for:

- complex record creation
- large BOM editing
- Work Order editing
- detail-heavy workflows

Dialogs must:

- trap focus
- close with Escape where safe
- provide Cancel
- prevent accidental close during critical submitting state

---

# 11. Confirmation Pattern

Destructive or irreversible actions require explicit confirmation.

Examples:

- archive Product
- archive Supplier
- delete Draft Work Order
- Finish Work Order
- complete PCB production
- deactivate User
- reopen Completed Project

Confirmation copy should state the consequence.

Example:

`Finish Work Order RN-2026-0041?`

`This will deduct Inventory and permanently lock the Work Order.`

Buttons:

- Cancel
- Finish Work Order

Do not use vague labels such as `Yes`.

---

# 12. Loading / Error / Empty States

Every server-backed page must support:

- loading
- error
- empty
- success refresh

## Loading
Prefer:

- skeleton rows/cards
- inline spinner for small operations

Avoid full-screen loading for normal page mutations.

## Error
Show:

- concise user-facing message
- retry when appropriate

Do not expose raw database errors.

## Empty
Use contextual empty states.

Example:

`No Work Orders yet.`

If authorized:

`[ Create Work Order ]`

---

# 13. Toast / Feedback Pattern

Use transient toasts for successful non-critical actions.

Examples:

- Project saved
- Permission updated
- Supplier archived
- Barcode downloaded

Do not rely on toasts for critical information users must read.

Critical failures should remain visible near the affected form/action.

---

# 14. Dashboard

## Early phase
Keep as placeholder.

Do not build fake production widgets.

## Final phase
Use permission-aware widgets.

Potential sections:

- Projects summary
- recent Work Orders
- active Nabavka
- Inventory alerts / recent products
- recent business activity
- Calendar upcoming events

Rules:

- widget visibility inherits source-module permissions
- Admin sees all
- company-wide Calendar data may show to all authenticated users
- do not fetch unauthorized data and merely hide the widget

Dashboard should summarize, not duplicate full module pages.

---

# 15. Projects UI

## Projects list

Recommended columns:

- Project Name
- Customer
- Status
- Start Date
- Delivery Date
- optional material usage summary
- actions

Filters:

- status
- date range if useful

Primary action:

- Add Project

Only when authorized.

---

## Project detail

Header:

- Project Name
- Customer
- Status
- Start / Delivery dates
- edit action if allowed

Sections:

### Overview
Core Project fields.

### Products
Project-specific Products/groupings and their planned component requirements.

Show enough information to understand:

- Project Product Name
- required stock-tracked Product
- Serial Number / Šifra
- planned total quantity
- actual Project-linked consumption where available
- outstanding commitment

Authorized Project editors may manage planning only while the Project is open.
Completed and Cancelled Projects are read-only.

### Material Usage
Derived read-only list/table.

Recommended columns:

- Product
- Serial Number / Šifra
- Quantity
- Source Type
- Source Record
- Date

Source examples:

- RN-2026-0041
- PCB Production Run

### Related Work Orders
List Finished/Draft Work Orders linked to Project.

### PCB Production
Only Project-linked runs.

### Activity
Relevant Audit events.

Completed Project:

- show clear `Completed` state
- normal edit controls hidden/disabled
- Admin-only `Reopen Project` action
- confirmation required

Normal Project editing must not offer Completed as a target status. Completion is
shown as the result of finishing the final unfinished Work Order. Existing Completed
Projects and the Admin-only Reopen Project action remain supported.

---

# 16. Nabavka UI

## List

Recommended columns:

- Serial Number / Šifra
  - show `Not assigned` for brand-new unlinked component
- Name
- Supplier
- Requested Quantity
- Delivered
- Remaining
- Status
- Created By
- actions

Search:

- Name
- Serial Number

Filters:

- Active
- Partly Delivered
- Resolved
- Supplier

Default view should emphasize unresolved requests.

---

## Add request

Start with a choice/search experience:

### Existing Product
- search/select Product
- Serial Number auto-fills
- Name auto-fills
- Supplier select
- Quantity

### New Component
- Name
- Supplier
- Quantity
- clear message:
  `Serial Number will be generated later when Admin creates the Product.`

Do not ask worker to invent a Serial Number.

---

## Partly Delivered update

Small dialog:

- Requested
- Delivered So Far
- Remaining
- input: Delivered So Far or Delivered Now

Choose one implementation consistently.

Recommended:
- input `Delivered So Far`
- validate 0 <= delivered <= requested

Status updates automatically or explicitly according to implementation.

No Inventory update occurs.

---

## Resolve request

Show the Resolve action only when the current actor is an active Admin or has `procurement.resolve`, and only for Active or Partly Delivered requests. Other Procurement permissions do not imply Resolve access.

Because resolution is terminal in the current scope, require the existing confirmation-dialog pattern before invoking the trusted Resolve operation. The confirmation must clearly state that the request will become Resolved and cannot currently be reopened.

After success, refresh the Procurement list and Sidebar badge. Do not change Delivered Quantity or Inventory, do not add reopen/reactivate controls, and do not show Resolve for an already-Resolved request.

---

## Create component from request

Admin-only.

Show this action only for an Active or Partly Delivered request that is not yet linked to a Product. Do not show it for Resolved or already-linked requests.

Open a focused form prefilled from Nabavka. Product Name starts from the immutable requested-name snapshot, but Admin may edit the final Product Name before creation. The snapshot itself is never changed.

Fields:

- Name: required, trimmed, nonblank
- Category: required, trimmed, nonblank free text
- Brand: optional; active choices only
- Supplier: read-only/prefilled from the request and not replaceable in this workflow
- Catalog Number: optional; blank becomes no Catalog Number and nonblank casing is preserved

Serial Number:

- displayed as `Generated automatically`
- never entered or selected by Admin

On success:
- Product is created
- the required ProductSupplier relation to the request Supplier is created
- request links to Product
- Serial Number appears on Nabavka row
- request status, quantities, Supplier, and requested-name snapshot remain unchanged
- Inventory remains at the Product's initialized zero balance until the separate Admin Inventory workflow records physical stock

---

# 17. Dobavljači / Suppliers UI

## List

Columns:

- Supplier Name
- Country
- Contact Person
- Phone
- Email
- status
- actions

Primary action:

- Add Supplier

---

## Supplier detail

Sections:

### Contact
- Name
- Country
- Contact Person
- Phone
- Email

### Products
Table of linked Products:

- Product
- Serial Number
- Catalog Number

Allow authorized user to manage Product-Supplier links.

Referenced archived Supplier:

- display archived state
- no new links

---

# 18. Skladište / Inventory UI

## Inventory list

Columns:

- Serial Number / Šifra
- Name
- Category
- Brand
- Physical Quantity
- Committed to Projects
- Available after Commitments
- primary Supplier or supplier count
- status
- actions

Search:

- Name
- Serial Number
- Catalog Number where implemented

Primary actions:

- Import Excel, for an active Admin or `inventory.products.create` user
- Add Component
- Manage Brands, if authorized

Committed quantity is the sum of outstanding values calculated independently for each
open Project and Product. Only qualifying physical consumption attributed to that same
Project/Product pair reduces its outstanding value; consumption from one Project never
offsets another's. Available is Physical minus Committed and may be negative. Display a
clear shortage warning for negative values. Do not present commitments as stock
movements or editable physical quantity. Where relevant, provide a way to understand
which Projects account for the commitment without inventing reservation movements.

---

## Import Components from Excel

- Keep Import Excel beside Add Component on Inventory; do not add a Sidebar item or dedicated route.
- Provide a downloadable canonical `.xlsx` template with Name, Category, and Brand columns. Accept `.xlsx` only; treat it as untrusted data, never execute macros/scripts, and do not permanently store it for MVP. Enforce the trusted backend's 1000-row maximum in the client too; choose a reasonable file-size limit during implementation.
- Parse locally and preview before mutation. Show row number, Name, Category, Brand, and status/error, with total/ready/invalid counts. Name/Category are required, trimmed, and nonblank; Category remains free text. Brand is optional, blank means none, and a supplied value must resolve to an existing active Brand. No implicit Brand creation.
- Empty/unsupported files or any invalid row block final Import. Let the user correct the spreadsheet and upload again; never silently import only valid rows. Duplicate-looking rows may be warned about but must not be silently deduplicated.
- Explicit confirmation submits all rows to one trusted bulk operation. Excel never supplies Serial, Product kind, IDs, actor/timestamps, initial stock, Supplier, or Catalog Number. The backend revalidates all rows and current Brands; on success show the result and refresh Product/Inventory queries, and on failure show no partial success.

---

## Add Product

Fields:

- Name
- Category
- Brand
- Supplier(s)
- Catalog Number per Supplier

Serial Number:

- not editable
- display:
  `Generated automatically when saved`

Initial quantity:

Recommended UI:
- Product creation itself creates master record
- Admin uses explicit Inventory adjustment/stock-entry action for stock
- avoid silently mixing product creation and stock mutation unless later locked otherwise

---

## Product detail

Header:

- Name
- Serial Number
- current Quantity
- archived/active state

Sections:

### Product Information
- Category
- Brand

### Suppliers
- Supplier
- Catalog Number

### Barcode
- barcode preview
- Open
- Download

### Inventory History
Table:

- Date
- Type
- Delta
- Before
- After
- Source
- User
- Reason

### Admin actions
- Adjust Inventory
- Archive Product

---

# 19. Manual Inventory Adjustment UI

Admin-only.

Dialog fields:

- Type
  - Add
  - Remove
  - Correction
- Quantity
- required Reason

Display before confirmation:

- Current Quantity
- Adjustment
- Resulting Quantity

If result would be negative:

- show validation error
- block submit

Confirmation for significant Remove/Correction actions is recommended.

---

# 20. Barcode UI

Barcode format:

- Code 128
- value = 7-digit Serial Number

Product detail should show:

- readable Serial Number
- barcode image
- Open/Preview
- Download

Barcode image should have:

- sufficient white margin
- readable human text where useful
- print-safe dimensions

Do not store barcode images if deterministic generation is sufficient.

---

# 21. Barcode Scanner UX in Work Orders

Assume scanner behaves like keyboard input.

Work Order page should include a dedicated scan target.

Example:

`Scan component barcode`

Behavior:

1. scanner sends 7-digit value
2. submit on Enter
3. validate format
4. resolve Product
5. add/focus Product row
6. move focus to Quantity input
7. user enters quantity

Success feedback should be immediate.

If Product already exists in table:

- focus existing row
- do not create duplicate row

Errors:

- invalid barcode
- Product not found
- Product archived/ineligible

Scanner input should reset after each scan.

---

# 22. PCB Cards UI

## PCB list

Columns:

- PCB Card
- Serial Number
- Current Stock
- Active BOM Version
- Last Production
- status
- actions

Primary actions:

- Create PCB Card
- Produce

The later Add PCB Card UI (Task 087) asks only for the required card Name/Code. It does not ask for Serial Number, Product Category, Brand, kind, Supplier, or initial stock. Task 086 creates the trusted backend operation only and adds no UI.

---

## PCB detail

Header:

- Card Name
- Serial Number
- current finished-goods stock
- active BOM version

Sections:

### Active BOM
Table:

- Component
- Serial Number
- Qty per Card
- Current Stock

### BOM History
- Version
- Created Date
- Created By
- Production Used?
- active/historical state

### Production History
- Date
- Quantity
- Project
- BOM Version
- Produced By

---

# 23. PCB BOM Editor

Use a focused page or large dialog.

Actions:

- Add Component
- Remove Component
- edit Qty per Card

Each row:

- Product search/select
- Serial Number display
- Quantity per Card

Validation:

- no duplicate Product in same BOM
- quantity > 0
- new or changed BOM inputs must reference an existing active stock-tracked Product of kind `component` or `pcb_finished_good`
- cannot select the PCB output Product itself

Here, Component names the BOM input row; it does not limit `product_kind` to `component`.
Archiving a referenced Product later does not remove it from historical BOM versions; its reference remains visible.

If current BOM has production history:

- UI clearly states:
  `Saving changes will create a new BOM version.`

Do not suggest that old production will change.

---

# 24. PCB Production UI

Production form:

- PCB Card
- Planned Production Quantity
- optional Project selected from open (`planned`, `in_progress`, `on_hold`) choices showing only Project Name/Status; the choice read exposes only Project ID/Name/Status and does not require Projects-module access beyond the active Admin or `pcb.produce` production authority

After Quantity input:

show calculated requirements table:

- Component
- Qty per Card
- Required
- Available
- Missing

Available is current physical `InventoryBalance.quantity`, not Available after Commitments. Missing is `max(Required - Available, 0)`; display exact whole-number values. This precheck does not mutate Inventory or complete production.

Whether stock is currently sufficient or insufficient:

- show an honest current-stock state
- allow `Create Production Work Order` when PCB/Product inputs are otherwise eligible

If insufficient:

- missing rows clearly emphasized
- explain that the Work Order may be created but cannot Finish until authoritative stock is sufficient

Before final confirm:

`Create production Work Order for E55?`

`This creates a Draft Work Order for 20 planned cards and freezes the current BOM materials. Inventory will not change until the Work Order is finished.`

After creation:

- navigate to the Work Order when `work_orders.view` is available, otherwise show only the generated Work Order number and Draft-created confirmation
- do not refresh stock/history as though production completed

The specialized Work Order shows frozen PCB Card, BOM version, planned quantity, output Product, and Project/General Stock. Generated material rows have no edit/remove/scanner controls. Finish requires an explicit exact `Actual successfully completed quantity` from 0 through planned; its PDF and finished view show both quantities.

---

# 25. Work Orders List UI

Columns:

- Work Order Number
- Project
- Customer
- Status
- Created Date
- Finished Date
- Created By
- actions

Search:

- Work Order Number
- Project
- Customer

Filters:

- Draft
- Finished

Primary action:

- Create Work Order

---

# 26. New / Draft Work Order UI

Header:

- Work Order Number
  - generated automatically
- Draft badge

Fields:

- Project selector
- Customer
  - auto-filled
  - read-only
- Short Description

One Project may have multiple Work Orders. The Draft UI must make its relationship to
the selected Project's planned component requirements understandable and must not
allow the same planned requirement to be silently double-allocated across Draft Work
Orders.

Materials section:

- dedicated barcode scan field
- materials table

Table columns:

- Serial Number
- Product Name
- Quantity
- Current Inventory
- remove row

Quantity remains manually entered.

Footer actions:

- Delete Draft
- Save for Later
- Finish Work Order

Order visually:

- destructive Delete separated
- Save secondary
- Finish primary

---

# 27. Work Order Finish UX

When user clicks Finish:

1. validate fields locally
2. show confirmation summary
3. trusted backend revalidates Inventory
4. show blocking loading state for finalization
5. on success:
   - status becomes Finished
   - editor becomes read-only
   - PDF action appears
   - Project completes automatically when no other unfinished Work Order remains

Confirmation should summarize:

- Work Order Number
- Project
- number of material lines
- consequence:
  `Inventory will be deducted and this Work Order can no longer be edited.`

Also explain when applicable that finishing the final unfinished Work Order will
complete the Project. The UI must not suggest that planned requirements themselves are
deducted from Inventory.

If Inventory became insufficient since page load:

- show exact affected Product(s)
- keep Work Order Draft
- do not lose data

---

# 28. Finished Work Order UI

Read-only.

Header:

- Work Order Number
- Finished badge
- Project
- Customer
- Finished Date
- Finished By

Sections:

- Description
- Materials
- Inventory movements
- PDF

Actions:

- Open PDF
- Print via browser/PDF viewer
- correction/reversal entry point when that workflow is implemented

No:

- Edit
- Reopen
- Delete

---

# 29. Work Order PDF UI

The canonical document is an A4 portrait, formal/industrial digital version of the
approved Alfa Proteh Radni Nalog reference.

Application-level behavior is locked:

- Finished Work Order exposes `Open PDF`
- PDF opens in a controlled viewer/new browser context
- authorized users may print
- download may be allowed if desired by implementation
- no edit/replace action

Document layout:

- Alfa Proteh branding at top left and `RADNI NALOG` with Broj/Datum at top right
- `PROJEKAT`, `NARUČILAC`, and `DATUM` identity block
- `OPIS RADOVA`, `Ovlašteno lice`, and `IZVJEŠTAJ O IZVRŠENIM RADOVIMA` sections
- `UTROŠAK MATERIJALA` table with `R.BROJ`, `KAT. BROJ`, `OPIS`, `JED. MJERE`,
  `KOLIČINA`, `JED. CIJENA`, and `UKUPNA CIJENA`
- footer area for completion date, `M.P.`, and signature/stamp

Populate only trusted Work Order Number, Project Name, Customer snapshot, Description,
Work Order creation date, and persisted Product Serial Number/Name/Quantity. Unit,
prices, totals, authorized person, report, completion date, signatures, and stamp remain
blank. Material headers repeat when the table continues onto another page.

---

# 29A. Dokumentacija UI

Admin-only route `/documents`.

Provide a clear list and focused create/edit/archive flow for:

- Naziv
- Kategorija: Uvoz, Izvoz, Nabavka, Troškovi
- Datum
- Iznos
- optional PDF

Use exact decimal amount display/input semantics. PDF actions are Upload, Open/View,
Download, Replace, and Remove as authorized Admin business operations. Explain archive
consequences; provide no hard-delete or restore action. Private/signed PDF access must
not be represented as a public permanent URL.

---

# 29B. Osnovna sredstva UI

Admin-only route `/fixed-assets`.

Provide a clear list and focused create/edit/archive flow for:

- Naziv
- Kategorija: Oprema, Uređaji, Alati
- Datum nabavke
- Količina

Quantity is a positive whole number. Provide no Inventory controls, hard delete, or
restore action.

---

# 30. Calendar UI

Use a real calendar view.

Filters/toggles:

- Birthdays
- Business Trips
- Events
- Vacations

Allow multiple selected simultaneously.

Use distinct visual markers but always include readable labels/details.

All users:
- view
- filter

Admin:
- Add Event
- Edit entries
- Delete/archive entries where appropriate

Birthday entries:
- read-only
- sourced from User profiles

Business Trip/Vacation:
- informational
- no approval controls

---

# 31. Archive UI

Archive is a read-only data-heavy page.

Recommended columns:

- Date/Time
- User
- Module
- Action
- Record
- Summary

Filters:

- date range
- user
- module
- action
- free-text search

Row click/detail panel may show:

- summary
- before values
- after values
- metadata/source links

Never render edit/delete controls.

Where possible, affected record references should be navigable.

---

# 32. Users UI

Completely Admin-only.

## Users list

Columns:

- Full Name
- Email
- Active/Inactive
- Admin
- Last Login
- Created Date
- actions

Primary action:

- Create User

---

## User detail

Sections:

### Profile
- Full Name
- Email
- Birthday
- Active/Inactive
- Admin status
- Created Date
- Last Login

### Permissions
Only for non-admin users.

Show grouped permission checkboxes by module.

Examples:

Projects:
- View
- Create
- Edit
- Archive

Nabavka:
- View
- Create
- Edit
- Change Status
- Resolve

Inventory:
- View
- Add Products
- Edit Products
- Manage Brands
- Generate/Download Barcodes

PCB:
- View
- Create
- Edit
- Produce
- Archive

Work Orders:
- View
- Create
- Edit Draft
- Finish
- Delete Draft

Archive:
- View

Do not display permanently Admin-only capabilities as grantable checkboxes.

Permission changes require explicit Save.

Audit all changes.

---

# 33. Permission-aware UI Rules

When permission is absent:

- hide protected create/edit actions
- prevent route access where applicable
- avoid fetching unauthorized data
- show clear unauthorized state if user reaches a forbidden route

Do not render a disabled button for every unavailable capability if it adds clutter.

Use disabled-with-explanation only where understanding the unavailable action helps the workflow.

---

# 34. Unsaved Changes

Forms with meaningful edits should warn before accidental navigation when feasible.

High-value areas:

- Draft Work Order
- PCB BOM editor
- large Project edits

Do not create aggressive warnings for tiny forms that save instantly.

---

# 35. Accessibility

At minimum:

- keyboard-accessible controls
- visible focus states
- semantic buttons/labels
- form errors associated with fields
- dialogs with focus management
- sufficient contrast
- status not communicated by color alone

Barcode scanner workflow must also work without a mouse.

---

# 36. Responsive Behavior

Primary target is desktop operational use.

Still support smaller screens.

Rules:

- Sidebar becomes drawer
- tables may scroll horizontally
- action bars stack
- form grids collapse to one column
- dialogs fit viewport
- barcode scan input remains easy to focus
- critical actions remain reachable without horizontal clipping

Do not build a separate mobile application layout.

---

# 37. Reusable Component Candidates

Likely shared components:

- `PageHeader`
- `DataTable`
- `SearchInput`
- `FilterBar`
- `StatusBadge`
- `EmptyState`
- `ConfirmDialog`
- `FormField`
- `PermissionGate`
- `BarcodePreview`
- `InventoryDelta`
- `EntityLink`
- `LoadingState`
- `ErrorState`

Do not over-generalize them prematurely.

Extract when there is real shared behavior.

---

# 38. UI File Architecture

TSX files should stay focused.

Example:

```text
features/inventory/
  pages/
    InventoryPage.tsx
    ProductDetailPage.tsx

  components/
    InventoryTable.tsx
    ProductForm.tsx
    InventoryAdjustmentDialog.tsx
    BarcodeCard.tsx
    InventoryMovementTable.tsx

  hooks/
    useInventory.ts

  services/
    inventoryService.ts

  types/
    inventory.ts

  validation/
    productSchemas.ts
```

Pages compose feature components.

Business logic should not accumulate inside page TSX files.

---

# 39. Visual Regression Rule

When converting current placeholder/prototype pages into functional pages:

- preserve approved shell
- preserve established spacing/typography
- preserve existing brand styling
- do not redesign unrelated screens

Functionality may require new tables/forms/dialogs, but visual changes should remain coherent with the current AlfaEV UI.

---

# 40. UI Definition of Done

A feature UI is complete when:

- correct data is shown
- permissions control visible actions
- loading/error/empty states exist
- form validation is clear
- destructive actions are confirmed
- responsive behavior is usable
- keyboard interaction works for critical flows
- barcode scanning is fast and predictable
- irreversible actions explain consequences
- TSX files remain focused
- repeated patterns use reusable components where appropriate
- no backend/security rule is assumed to be enforced only by the UI
