# AlfaEV — ROUTES.md

Status: Canonical route map v1  
Purpose: Define the approved application routes, access rules, and route-level behavior for AlfaEV.  
Rule: Routes must reflect the locked product scope only. Do not preserve unused placeholder routes.

---

# 1. Routing Principles

1. Use React Router with TypeScript/TSX.
2. Keep route definitions centralized and easy to audit.
3. Authentication and authorization must be enforced at route level as well as backend level.
4. Route hiding is UX only; backend authorization remains authoritative.
5. Do not create placeholder routes for modules outside the locked scope.
6. Detail routes should use stable internal IDs in URLs rather than mutable names.
7. Human-facing numbers such as Serial Number / Šifra and Work Order Number may be displayed and searched, but internal route identity should remain stable.

---

# 2. Public Route

## `/login`

Purpose:
- real AlfaEV sign-in page

Access:
- unauthenticated users: allowed
- authenticated users: redirect to `/`

Behavior:
- authenticate user
- verify account is active
- load UserProfile and permissions
- update last login where appropriate
- redirect to Dashboard

The existing `localStorage` fake authentication is temporary and must be removed when real authentication is implemented.

---

# 3. Protected Application Shell

All routes below require:

- authenticated user
- active AlfaEV account

Protected routes render inside the main application layout:

- Sidebar
- Topbar
- main content area

Unauthorized users must not be allowed to bypass route access by typing URLs directly.

---

# 4. Dashboard

## `/`

Purpose:
- Dashboard

Early implementation:
- placeholder only

Final implementation:
- permission-aware cross-module overview

Access:
- Admin: full Dashboard
- non-admin: requires `dashboard.view`
- widgets/data also inherit permissions of their source modules

Dashboard must never reveal unauthorized module data.

---

# 5. Projects

## `/projects`

Purpose:
- project list
- search/filter
- create action when authorized

Access:
- Admin: allowed
- non-admin: requires `projects.view`

Actions depend on:
- `projects.create`
- `projects.edit`
- `projects.archive`

---

## `/projects/:projectId`

Purpose:
- Project detail

Shows:
- project name
- customer/buyer
- status
- start date
- delivery date
- planned Project Products and component requirements
- derived physical material usage and outstanding commitment
- linked Draft and Finished Work Orders
- linked PCB production where applicable
- relevant history/activity

Access:
- same read permission as Projects list

Rules:
- Completed Project is read-only
- Admin may explicitly reopen it to In Progress
- normal Project editing cannot manually set Completed
- finishing the final unfinished Work Order automatically completes the Project
- planning requirements are editable only while the Project is open and never directly deduct Inventory
- actual material usage and outstanding commitment are derived; physical usage is not manually edited

---

# 6. Nabavka / Procurement

## `/procurement`

Purpose:
- Nabavka list
- unresolved requests
- Partly Delivered tracking
- Resolved history
- add request action

Access:
- Admin: allowed
- non-admin: requires `procurement.view`

Actions depend on:
- `procurement.create`
- `procurement.edit`
- `procurement.change_status`
- `procurement.resolve`

Sidebar badge:
- count Active + Partly Delivered requests
- exclude Resolved

---

## `/procurement/:requestId`

Purpose:
- procurement request detail/edit view

Shows:
- existing Product link when present
- Serial Number / Šifra when linked
- requested name
- Supplier
- requested quantity
- delivered quantity
- remaining quantity
- status
- creator/history

Special Admin action:
- `Create component from request` when request is for a brand-new component

That action must use trusted backend logic and cannot be implemented as a frontend-only mutation.

---

# 7. Dobavljači / Suppliers

## `/suppliers`

Purpose:
- list all Suppliers
- search/filter
- add Supplier action when authorized

Access:
- Admin: allowed
- non-admin: requires `suppliers.view`

Actions depend on:
- `suppliers.create`
- `suppliers.edit`
- `suppliers.archive`

---

## `/suppliers/:supplierId`

Purpose:
- Supplier detail

Shows:
- supplier name
- country
- contact person
- phone
- email
- linked products/components
- supplier-specific Catalog Numbers

Access:
- same read permission as Suppliers list

---

# 8. Skladište / Inventory

## `/inventory`

Purpose:
- list/search Inventory products/components
- search by Name
- search by Serial Number / Šifra
- optional Catalog Number filtering/search
- Physical Quantity, Committed to Projects, and Available after Commitments
- Add Component action when authorized
- Import Excel action beside Add Component when authorized; upload, preview, and confirmation stay within `/inventory` rather than introducing a route or Sidebar item
- Brand management entry point when authorized

Access:
- Admin: allowed
- non-admin: requires `inventory.view`

Actions depend on:
- `inventory.products.create`
- `inventory.products.edit`
- `inventory.brands.manage`
- `inventory.barcodes.generate`

Manual quantity adjustment:
- Admin-only
- not delegable

Project commitment values are derived planning data. Outstanding commitment is first
calculated independently for each open Project and Product using only qualifying
physical consumption from that same Project/Product pair, then summed per Product.
One Project's consumption never offsets another's commitment. Commitments do not create
Inventory movements or modify physical quantity. Negative Available after Commitments
remains visible as a shortage warning.

---

## `/inventory/:productId`

Purpose:
- Product/component detail

Shows:
- Serial Number / Šifra
- Name
- Category
- Brand
- current quantity
- Suppliers
- supplier-specific Catalog Numbers
- barcode
- Inventory Movement history
- archive state

Admin-only actions:
- manual Inventory adjustment
- archive/deactivate when business rules allow

Permission-based actions:
- edit product
- manage Supplier links
- generate/download barcode

---

# 9. PCB Cards

## `/pcb`

Purpose:
- list all PCB card definitions
- active/latest BOM information
- create PCB card action when authorized
- start PCB production action when authorized

Access:
- Admin: allowed
- non-admin: requires `pcb.view`

Actions depend on:
- `pcb.create`
- `pcb.edit`
- `pcb.produce`
- `pcb.archive`

---

## `/pcb/:pcbCardId`

Purpose:
- PCB card detail

Shows:
- card name/code
- finished-goods Product
- current stock
- active BOM version
- BOM component list
- BOM version history
- production history

Rules:
- used BOM versions are immutable
- edits after production create a new BOM version

---

## `/pcb/:pcbCardId/produce`

Purpose:
- PCB production flow

Input:
- planned production quantity
- optional Project

Behavior:
1. load active BOM version
2. calculate total required components
3. show required / available / missing
4. show current shortage without treating it as a reservation
5. on confirm, idempotently create a frozen PCB-production Draft Work Order
6. change no Inventory and create no production run
7. after creation, use `/work-orders/:workOrderId` only when the actor has `work_orders.view`
8. Work Order Finish later consumes planned BOM inputs and adds actual-good output atomically

Access:
- Admin or `pcb.produce`

The optional Project picker does not require `projects.view` or grant `/projects` access. Its narrow trusted choices contain only ID, Name, and Status for open Projects (`planned`, `in_progress`, `on_hold`); the later production operation re-checks eligibility. Precheck Available is physical `InventoryBalance.quantity`, not Available after Commitments.

---

# 10. Radni Nalozi / Work Orders

## `/work-orders`

Purpose:
- list Draft and Finished Work Orders
- search by Work Order Number
- create Draft action

Access:
- Admin: allowed
- non-admin: requires `work_orders.view`

Actions depend on:
- `work_orders.create`
- `work_orders.edit_draft`
- `work_orders.finish`
- `work_orders.delete_draft`

---

## `/work-orders/new`

Purpose:
- create new Draft Work Order

On creation:
- trusted backend allocates `RN-YYYY-NNNN`
- number is never reused

Access:
- Admin or `work_orders.create`

---

## `/work-orders/:workOrderId`

Purpose:
- Work Order detail/edit view

Draft behavior:
- select Project
- Customer auto-fills from Project
- integrate material lines with that Project's planned requirements
- support multiple Work Orders per Project without double-allocating the same requirement
- scan Product barcode
- Product resolves by Serial Number / Šifra
- add Product to materials table
- user enters consumed quantity
- enter short description
- Save for later
- Delete Draft when authorized
- Finish when authorized

Finished behavior:
- read-only
- show immutable materials
- show linked Inventory movements
- show generated PDF
- no edit/reopen/delete controls

Finishing performs the physical stock deduction. If no other unfinished Work Order
remains for the Project, the same trusted transaction automatically completes the
Project and releases unused outstanding commitment. Project requirements are not
deducted separately.

---

## `/work-orders/:workOrderId/pdf`

Purpose:
- display/open the generated PDF for a Finished Work Order

Access:
- Admin or a user allowed to view that Work Order

Rules:
- PDF exists only for Finished Work Order
- PDF is tied permanently to the finished record
- no normal overwrite/delete action

---

# 11. Dokumentacija

## `/documents`

Purpose:
- Admin-only Documentation list and management
- create/read/edit/archive Documentation records
- upload/read/download/replace/remove one optional private PDF attachment

Fields:
- Naziv
- Kategorija: Uvoz, Izvoz, Nabavka, or Troškovi
- Datum
- Iznos
- optional PDF

Access:
- Admin only through `AdminRoute` or the equivalent existing Admin boundary
- no delegable permission

Non-admin behavior:
- navigation item hidden
- direct URL forbidden
- backend data and private PDF access denied

---

# 12. Osnovna sredstva

## `/fixed-assets`

Purpose:
- Admin-only Fixed Asset list and management
- create/read/edit/archive Fixed Assets

Fields:
- Naziv
- Kategorija: Oprema, Uređaji, or Alati
- Datum nabavke
- Količina

Access:
- Admin only through `AdminRoute` or the equivalent existing Admin boundary
- no delegable permission

Non-admin behavior:
- navigation item hidden
- direct URL forbidden
- backend data access denied

This route does not modify or expose warehouse Inventory as Fixed Asset quantity.

---

# 13. Calendar

## `/calendar`

Purpose:
- company calendar

Categories:
- Birthdays
- Business Trips
- Events
- Vacations

Access:
- all authenticated active users

Behavior:
- category filtering
- Birthday entries derived from User profiles
- Business Trips and Vacations are informational only

Modification:
- Admin-only

No separate approval routes are required.

---

# 14. Archive / Audit

## `/archive`

Purpose:
- immutable business audit/history view

Access:
- Admin: always allowed
- non-admin: requires `archive.view`

Features:
- search
- date filtering
- user filtering
- module/entity filtering
- action filtering
- record context

Rules:
- read-only
- no edit
- no delete

---

# 15. Users

## `/users`

Purpose:
- Admin-only user/account management

Access:
- Admin only

Non-admin behavior:
- route is forbidden
- Users navigation item is hidden
- no read-only user directory is exposed

Features:
- list users
- create user
- activate/deactivate
- open user detail
- manage permissions

---

## `/users/:userId`

Purpose:
- Admin-only user detail

Shows:
- Full Name
- Email
- Birthday
- Active/Inactive
- Admin flag
- Created Date
- Last Login
- delegable permission matrix
- relevant account history

Actions:
- edit profile
- activate/deactivate
- change Admin status
- update permissions

Every permission/account-security change must be audited.

---

# 16. Forbidden / Removed Routes

The current prototype contains routes for placeholder modules that are not part of the locked AlfaEV scope.

These must be removed rather than implemented.

Remove routes such as:

- `/production`
- `/quality`
- `/reports`
- `/settings`
- any other unused placeholder route not listed in this document

Do not keep dead navigation items pointing to removed modules.

---

# 17. Not Found / Unauthorized Behavior

## Unknown route

Use one clear application-level Not Found experience.

Behavior:
- authenticated user → show protected 404 inside application shell or safe redirect
- unauthenticated user → login flow

## Unauthorized route

Do not silently render forbidden content.

Preferred behavior:
- show a clear unauthorized state or redirect to Dashboard
- do not reveal protected record contents
- backend query/mutation must still fail independently

Exact UX can be finalized in UI_SPEC.md.

---

# 18. Route Guard Strategy

Conceptually:

```text
PublicRoute
  └─ /login

AuthenticatedRoute
  ├─ checks authenticated session
  ├─ checks active UserProfile
  └─ loads authorization context

PermissionRoute
  ├─ checks module/action read permission
  └─ renders protected feature route

AdminRoute
  └─ Users, Dokumentacija, Osnovna sredstva, and other permanently Admin-only areas/actions
```

Avoid creating separate hard-coded guards for every page when a reusable typed permission guard can express the rule safely.

---

# 19. Route Definition of Done

The route map is correct when:

- only locked AlfaEV modules remain
- every protected route requires authentication
- inactive users are blocked
- Users is Admin-only
- Dokumentacija and Osnovna sredstva are Admin-only
- Calendar is readable by all authenticated users
- Archive honors `archive.view`
- Dashboard is permission-aware
- detail routes use stable IDs
- removed placeholder routes no longer exist
- direct URL navigation cannot bypass permissions
