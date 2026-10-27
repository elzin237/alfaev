# AlfaEV — UI_SPEC.md

Status: Canonical UI/UX specification v1  
Purpose: Define how approved AlfaEV modules should behave visually and interactively while preserving the existing React/Tailwind visual language.  
Rule: This is a UI behavior specification, not permission/security enforcement. Backend authorization and business rules remain authoritative.

Warehouse rollout status: migrations 136–142 are deployed to alfaev-dev (142/142);
DEV `finish-work-order` v6 is ACTIVE. The warehouse frontend is implemented locally,
and read-only browser acceptance is complete. Controlled Stage 2 mutation acceptance
is pending and non-Admin browser acceptance is incomplete. No frontend production
deployment or warehouse production database rollout has occurred; production remains
at its previously verified migration state. Finished Goods Project reservation and
fulfillment backend code is local in undeployed migrations 143–145; application
activation and reservation frontend remain pending.

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
6. Finished Product Calculator
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
- bounded Project quick-search for active Admin or `projects.view` users
- non-interactive current user identity, with Admin indicated only for Admin users
- logout action

The Project quick-search uses only the canonical Project name, returns a small
bounded result set, and opens the existing Project detail route. The Topbar does
not show placeholder notification or account-menu controls. Project Activity alerts
belong in the Dashboard content heading and must never be added to Topbar, Project
search, current-user/Admin identity, or Logout.

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
- recent AuditLog business activity
- Calendar upcoming events

Rules:

- widget visibility inherits source-module permissions
- Admin sees all
- company-wide Calendar data may show to all authenticated users
- do not fetch unauthorized data and merely hide the widget

Dashboard should summarize, not duplicate full module pages.

The Dashboard content-heading row reserves its right side for the Project Activity
Alerts control and unread count. The left side remains:

- `Dashboard`
- `Overview of the work and projects available to you.`

The V1 Alerts panel uses bounded internal scrolling and provides loading,
empty, and error/retry states. It is keyboard accessible and closes by Escape or
outside click. Notifications are newest first. Activity rows show Project name,
Activity title, author, timestamp, and unread/read state without Activity description
or image. Issue-resolution rows show their existing resolver context. Shortage rows
show only trusted Project/Product display context, opening/resolution state, the shared
global deficit for openings, optional baseline indication, timestamp, and read state.

Opening the panel does not mark alerts read. Clicking an Activity or Issue-resolution
row marks only that recipient row read and navigates to
`/projects/<projectId>#activity-<activityId>`. Clicking a shortage row marks it read and
navigates to `/projects/<projectId>` without inventing an Activity target. V1 has no
Mark all as read or polling. Refetch on Dashboard load, panel open, window focus,
successful alert send, mark-read, and explicit retry. Task 001C1 supplies only a
private content-free `invalidate` database signal per authorized profile; no
notification content is rendered from it. Supabase supplies exactly one generated
transport `id` UUID in the delivered payload; the UI must ignore the payload entirely.
Task 001C2 mounts the application subscription once in the authenticated AppLayout and
refetches only through the existing trusted RPCs.

The Dashboard dismissal control is a sibling three-dot row menu with
`Dismiss notification`. It must not be nested inside or trigger the row navigation
control. The action requires an accessible confirmation dialog, returns focus to its
trigger on cancel, and permanently removes only the caller's row from the active inbox.
V1 has no undo or dismissed-notification archive. The Dashboard exposes dismissal only
through the confirmed sibling row action; notification-row activation remains the
independent mark-read-and-navigate action.

The persistent Sidebar displays the existing Project Activity unread count beside the
Dashboard item. Use the same compact red badge styling and alignment as Nabavka, hide
zero/error/unauthorized state, and display `99+` above 99. The badge uses the existing
profile-scoped Dashboard alert query and shared mutation reconciliation; it introduces
no polling, second count query, or extra navigation item. Task 001C2 adds the single
private per-profile Realtime invalidation subscription without changing the badge's
trusted RPC data source or rendering any Realtime payload.

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

Project Activity is a human-authored collaboration timeline, separate from AuditLog.

For an active Admin or user with `projects.edit`, an open Project (`planned`,
`in_progress`, or `on_hold`) shows a collapsible composer above the timeline with:

- Title
- Description
- optional single image
- `Post update`
- `Post & send alert` only when the actor also has Admin or
  `projects.alerts.send` authority

Title is required trimmed plain text, 1–120 characters. Description is required
trimmed plain text, 1–5000 characters, preserving internal newlines. The optional
image accepts JPEG, PNG, or WebP only, maximum 5 MiB. The UI may use the Activity title
as fallback alt text.

Completed/Cancelled Projects and users without post authority show the readable
timeline without the composer. Existing Activity remains readable for active Admin or
`projects.view` users.

Each timeline item shows:

- title
- description
- author
- absolute timestamp
- optional image
- `Alert sent` badge when an alert event exists

Successful posting collapses the composer and leaves a visible success confirmation
outside it. The `Recent activity` heading also remains outside the scrolling region.
Only a populated timeline scrolls independently, with a 42rem maximum height and no
fixed or minimum height. Small lists retain natural height, empty states remain compact,
and the keyboard-accessible region contains the Activity cards and explicit `Load more`
control. Posting a new Activity scrolls only this internal timeline to the newest
authoritative row and must not move the full Project page.

The timeline remains newest first, loads 20 initially, and uses `Load more` keyset
pagination. Compact image thumbnails appear within cards while the image viewer remains
viewport-level and must not be clipped by the scrolling region. A direct Activity link
not found in loaded pages uses an authorized by-ID read and presents the target
separately as `Linked activity` without changing timeline pagination. Once resolved,
the exact target is positioned using container-relative geometry, focused with browser
scroll prevention, and given a subtle 2.5-second border/background highlight with no
competing focus ring during the transient highlight. The effect
runs once per React Router navigation entry, including Back/Forward; background data or
image updates do not repeat it. Reduced-motion users receive immediate scrolling and no
animated highlight. Real-browser acceptance remains in H4. V1 does not include Project
Activity title search.

Activity is immutable. Do not provide edit/delete/Admin-delete, attachment
replace/remove, or alert-resend controls. While submitting, prevent duplicate submits;
the trusted request UUID/database contract remains the idempotency authority.

The Issue-resolution dialog requires a description and may select one optional
JPEG/PNG/WebP image up to 5 MiB with a local preview. Resolution text commits first.
While image upload follows, show explicit progress; if it fails, keep the immutable
resolution visible and offer an image-only retry using the same request identity.
Resolved Issues present resolution evidence separately from the original Activity
image. Do not expose replace/remove controls or a Storage path.

When `Post & send alert` has no eligible recipients, show the clear domain
error and keep the form content for correction/retry. Never silently downgrade it to
`Post update`.

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
- Quantity
- no Supplier field; Supplier remains unassigned at creation

### New Component
- Name
- Quantity
- no Supplier field; Supplier remains unassigned at creation
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
- Supplier: when assigned on a historical request, read-only/prefilled and not replaceable in this workflow; otherwise show `Not assigned`
- Catalog Number: read-only Supplier master value when the request has a Supplier; no Catalog/Description input is accepted in this workflow

Serial Number:

- displayed as `Generated automatically`
- never entered or selected by Admin

On success:
- Product is created
- a ProductSupplier relation is created only when the request has a Supplier; otherwise none is invented
- request links to Product
- Serial Number appears on Nabavka row
- request status, quantities, Supplier, and requested-name snapshot remain unchanged
- Inventory remains at the Product's three initialized zero warehouse balances until a separate authorized warehouse Inventory workflow records physical stock

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
- Catalog Number
- Description
- Country
- Contact Person
- Phone
- Email

### Products
Table of linked Products:

- Product
- Serial Number
- Relationship Status
- Product Status

Allow authorized user to manage Product-Supplier links.

Referenced archived Supplier:

- display archived state
- no new links

---

# 18. Skladište / Inventory UI

## Inventory list

Local migration-148 UI correction (not DEV/browser-accepted): Finished Goods displays
Physical Quantity, Committed to Projects (remaining hard reservations), and Available
after Commitments = Physical − Committed, from one authorized warehouse aggregate.
This is not Project planning demand. Raw Materials labels its own physical quantity
and, for callers allowed both warehouses, Eligible Stock (Raw + Customs), Outstanding
Project Commitments and Available after Commitments = eligible − outstanding.
Customs does not expose either commitment projection. Missing reads show Unavailable,
not zero. Bigint quantities are read as SQL text and formatted without rounding.

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
- current Supplier Catalog Number and optional Supplier Description (read-only relationship display)
- relationship management selects an existing Supplier and does not accept Catalog/Description inputs
- read-only Supplier Stock History with Date, Supplier, Catalog Number, Description, Received Quantity, Remaining Quantity, and Added By

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
- Supplier Catalog Number
- Supplier Description
- Relationship
- Supplier Status
- Actions

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
- exact 3- or 7-digit Serial Number text

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

1. scanner sends exact 3- or 7-digit text
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

# 22. Finished Product Calculator UI

## PCB list

Columns:

- Finished Product
- Serial Number
- Current Stock
- Active BOM Version
- Last Production
- status
- actions

Primary actions:

- Create Finished Product Calculator
- Produce

The creation dialog asks for required Name/Code and an exact three-digit Serial Number in a text input. It does not ask for Product Category, Brand, kind, Supplier, or initial stock. Leading zeroes are preserved and the trusted backend remains authoritative for uniqueness and creation.

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

Locally implemented Finished Product Calculator production form:

- Finished Product Calculator definition
- Planned Production Quantity
- no Project picker, Project-choice query, or new Project association

After Quantity input:

show calculated requirements table:

- Component
- Qty per Card
- Required
- Available
- Missing

Available is the trusted production-eligible quantity, not planning Available after Commitments. Ordinary inputs use Raw + Customs + unreserved Finished Goods; Calculator-linked finished inputs use unreserved FG only (local migration 148). Missing is `max(Required - Available, 0)`; display exact whole-number values. This precheck does not mutate Inventory. Finish uses the same eligibility and FIFO sourcing and credits actual-good output to FG without recursive BOM expansion.

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

The specialized Work Order shows frozen calculator definition, BOM version, planned quantity, output Product, and General Stock for new production. Historical Project-linked production retains its original Project context and remains readable and finishable. Its Materials table includes a Source column. Generated rows are labeled `BOM`, have read-only Quantity, and have no Remove control. An Admin or `work_orders.edit_draft` user receives the existing scanner/manual Product-entry control for supplemental rows labeled `Added material`; those rows have editable Quantity and Remove. Explain: `BOM materials are locked. Additional materials may be added.` The frozen production header remains read-only. Finish requires an explicit exact `Actual successfully completed quantity` from 0 through planned; its PDF and finished view include all consumed materials and show planned/output quantities.

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

One Project may have multiple Work Orders. Project selection supplies traceability and
the Customer snapshot. Planned component requirements are reference data only: the
generic Draft UI must not block an otherwise eligible material or quantity because it
is outside or above the Project plan.

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
Work Order creation date, frozen source-allocation Catalog Number, Product Name, and
allocation Quantity. `KAT. BROJ` is `—` for legacy/unknown or internally produced
stock, and mixed-source Product quantities render as separate rows. Unit, prices,
totals, authorized person, report, completion date, signatures, and stamp remain blank.
Material headers repeat when the table continues onto another page.

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
- `KAT. BROJ` displays the frozen Supplier Catalog Number from the committed source allocation, or `—` for legacy/unknown and internally produced stock; it never substitutes AlfaEV Product Serial Number
- `OPIS` remains Product name; split-source consumption renders separate material rows with each allocation quantity

## Project shortage notifications

The existing Dashboard Alerts panel presents Task 003A's trusted opening and resolution
notifications. Opening uses `Component shortage detected`, Product Serial Number /
Šifra and name, `Shared shortage quantity: <exact value>`, and—when applicable—
`Existing shortage detected`. Resolution uses `Component shortage resolved` and
`Resolved`. The quantity is the shared global Product deficit captured by the event,
never a Project-exclusive allocation. The UI does not calculate deficits, allocate
shortages among Projects, or create events during reads. Quantity-only changes
intentionally produce no notification. Rows retain the existing unread/read,
dismissal, pagination, keyboard, Sidebar badge, and private Realtime behavior.

## Warehouse Inventory and Finished Product Calculator UI

Tasks 001B–001C add the warehouse backend and six Admin permission-matrix choices.
Tasks 001D–001F implement the Inventory tabs, calculator rename/creation, and
warehouse-aware production. Migrations 136–142 are deployed to DEV (142/142), and DEV
`finish-work-order` v6 is ACTIVE. The frontend remains local and read-only browser
acceptance is complete; controlled Stage 2 mutation acceptance is pending and
non-Admin browser acceptance is incomplete.

- Keep `/inventory` and the established layout. Add permission-aware tabs named **Raw
  Materials**, **Finished Goods**, and **Customs Warehouse**. A visible tab shows only
  that warehouse's stock, balance, allowed adjustment actions, movement history,
  source-lot details, search, loading, error, and empty states. Hidden tabs must not be
  queried, and tab hiding is not backend authorization.
- Raw Materials preserves existing Product visibility, including historical Calculator
  stock. Finished Goods shows only Calculator-linked Products, including zero-stock
  and archived outputs. Customs starts empty and lists positive stock or retained
  committed movement history, remaining visible after depletion. Search respects membership.
- Calculator list/detail label output quantity **Finished Goods stock** and show actual
  Finished Goods quantity. BOM input/picker stock remains Raw Materials.
- First Customs transfer can start from an existing authorized Product detail in
  another warehouse. Customs-only discovery/intake has no new interface in this slice.
- Successful adjustments/transfers and Work Order Finish invalidate affected
  profile-scoped Inventory and Calculator queries for authoritative refetch, without
  optimistic stock arithmetic, polling or clearing another profile's cache.
- Shared responsive table/detail components and contained overflow remain preferred;
  the change must not redesign unrelated pages.
- User-facing **PCB Cards** text is **Finished Product Calculator**. The `/pcb`
  route and existing PCB/BOM identities remain unchanged.
- New calculator entry UI requires Name/Code and an exact three-digit Serial Number text
  input. It preserves leading zeroes and validates only `000`–`999`; ordinary Product
  creation/import continues to display generated seven-digit serial behavior.
- Produce keeps Planned Production Quantity plus the existing BOM/precheck and Create
  Production Work Order action. It has no Project selector/query and creates new
  calculator production without a Project association.
- Product/manual/barcode lookup fields used by Work Order materials accept exact three-
  or seven-digit serial text and reject invalid, ambiguous, or missing identities.
- Warehouse-specific Add/Remove/Correction controls appear only with the matching
  adjustment permission. The backend remains authoritative.
- Transfer appears only when the caller can adjust both the selected source and at
  least one distinct destination. It requires a positive quantity and reason, calls the
  trusted atomic transfer boundary, and reconciles both warehouses without an
  optimistic balance update.
- Tabs use `tablist`/`tab` semantics, arrow/Home/End keyboard operation, visible focus,
  and contained horizontal overflow. Product links preserve warehouse selection, and
  protected query keys include profile, warehouse, and Product identities.

## Test Calculator V1 UI — approved design, not implemented

- Sidebar container: Product Calculator. Provide Normal / Test navigation, keeping
  Normal's existing `/pcb` pages/forms unchanged. Test is a separate blue-themed page;
  do not recolor Normal or redesign unrelated modules. Do not claim a new route is live.
- Create Test Calculation: Name, authorized existing Product/component picker and
  positive whole-number total quantities. Preserve exact serial text/leading zeroes.
- Prove Calculation shows Product identity, Required, Eligible Available, Reservable
  and Missing. It creates no hold and cannot promise stock. After draft changes,
  invalidate the old proof; Save requires a proved current draft and deadline date.
- Deadline is visibly Europe/Sarajevo: "Reserved through this date; expires at the
  next local midnight." Server validation is authoritative; show the effective expiry.
- Save shows pending/error/uncertain states and the authoritative saved partial/zero
  reservation result. Missing is not presented as reserved. No physical deduction,
  Work Order/output creation or production action belongs to this page.
- History/list/detail is available to Test viewers/Admins, including other creators'
  entries. Show creator, saved time, items/quantities, original Reserved/Missing,
  deadline and Active/Expired status. Distinguish saved allocation from currently
  active holds. No Edit, Extend, Cancel, Renew, Consume or automatic top-up controls.
- Reuse identity-scoped durable exact-request recovery: explicit retry after restart,
  no replacement UUID, no auto-replay under another account, and no clear-journal
  shortcut for uncertain operations. Malformed/unavailable data never implies success.
- Inventory retains existing Physical, Project and availability columns. Add blue
  Committed to Tests and Available After Projects and Tests in Raw, FG and Customs,
  following BUSINESS_RULES section 17 formulas. In Raw planning, label Test/availability
  totals explicitly Raw + Customs; do not present them as Raw physical stock. Keep
  FG Project reservations distinct from ordinary soft Project demand.
- Keep negative Raw planning availability/shortage styling; Test commitments are blue
  but also labelled in text. Permission-redacted/failed quantities show Unavailable,
  never fabricated zero. Preserve search, Product membership, spacing, horizontal
  overflow, keyboard focus, loading/empty/error states and profile-scoped cache isolation.
- Refetch after Save and at the next server-provided expiry/on focus/reconnect. Never
  optimistically move stock, fabricate release events or rely on a UI timer for safety.
