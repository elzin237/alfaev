# AlfaEV — PERMISSIONS.md

Status: Canonical authorization model v1.1  
Purpose: Define the permission architecture and the initial per-user permission checklist.

---

## 1. Authorization Model

AlfaEV has two account classes:

### Admin
Admin always has full access.

Admin permissions are not controlled by per-user toggles.

### Non-admin
A non-admin user's capabilities are controlled by explicit per-user permissions configured by Admin.

There is no fixed Worker role permission matrix.

Different non-admin users may have different capabilities.

---

## 2. Enforcement Rules

Permissions must be enforced in trusted backend/database authorization.

The frontend may:

- hide buttons
- disable actions
- hide navigation items

But frontend behavior is only UX.

Unauthorized backend/database operations must fail even if a user manually attempts them.

All permission changes must create Archive/Audit events.

---

## 3. Permanently Admin-only Capabilities

These capabilities are not delegable:

- Manage User Permissions
- Change Admin status
- Create user accounts
- Activate/deactivate user accounts
- Manually adjust Inventory quantity
- Create/edit/modify Calendar entries

A non-admin user must never be able to:

- grant permissions
- revoke permissions
- change another user's access
- change their own access
- promote themselves to Admin

Admin always has access to all other actions in the system.

Admin users do not need UserPermission rows for access because Admin bypass applies. Existing UserPermission rows are not deleted merely because a user is promoted to Admin; they remain stored, are ignored for access while Admin bypass applies, and become relevant again if the user is later demoted.

Changing Admin status remains permanently Admin-only and is never delegable.

---

## 4. Initial Delegable Permission Checklist

The Admin user-management UI should expose a clear checkbox/toggle matrix for non-admin users.

### Dashboard

- View Dashboard

### Projects

- View Projects
- Create Projects
- Edit Projects
- Delete/Archive Projects

### Nabavka / Procurement

- View Nabavka
- Create Nabavka Request
- Edit Nabavka Request
- Change Nabavka Status
- Resolve/Remove Nabavka Request

### Dobavljači / Suppliers

- View Suppliers
- Create Suppliers
- Edit Suppliers
- Delete/Archive Suppliers

Supplier reads require Admin access or View Suppliers (`suppliers.view`).

Supplier creation requires Admin access or Create Suppliers (`suppliers.create`).

Supplier editing requires Admin access or Edit Suppliers (`suppliers.edit`).

Supplier archive requires Admin access or Delete/Archive Suppliers (`suppliers.archive`). This permission does not authorize hard deletion or Supplier reactivation/unarchive.

Frontend visibility is UX only. Trusted backend/database operations remain authoritative and must re-check the actor's permission and the Supplier's lifecycle state.

### Skladište / Inventory

- View Inventory
- Add Products/Components
- Edit Product/Component Data
- Manage Brands
- Generate/Download Barcodes

Manual Inventory quantity adjustment is Admin-only and is therefore not a delegable checkbox.

Barcode scanning itself does not require a separate global permission if it is only used to select a product inside an already-authorized workflow.

Normal Brand reads within Inventory require Admin access or View Inventory (`inventory.view`).

Creating, editing, or archiving Brands requires Admin access or Manage Brands (`inventory.brands.manage`). This permission does not authorize hard deletion or Brand reactivation/unarchive.

### PCB Cards

- View PCB Cards
- Create PCB Card/BOM
- Edit PCB Card/BOM
- Produce PCB Cards
- Delete/Archive PCB Definitions

### Radni Nalozi / Work Orders

- View Work Orders
- Create Work Orders
- Edit Draft Work Orders
- Finish Work Orders
- Delete Draft Work Orders

PDF generation is part of Finish Work Order and does not need a separate permission.

### Calendar

All authenticated users may view Calendar.

Calendar modification is Admin-only.

Therefore Calendar does not require delegable view/manage checkboxes in the initial permission matrix.

### Archive

- View Archive

Non-admin users may view Archive only when this permission is enabled.

Archive remains read-only.

### Users

The Users module is completely Admin-only.

Non-admin users:

- do not see the Users navigation item
- cannot access the Users page
- cannot view a read-only user/employee directory
- cannot create users
- cannot edit user profiles
- cannot activate/deactivate users
- cannot change Admin status
- cannot manage permissions

No Users-related permissions are delegable.

---

## 5. Permission UI Behavior

When Admin opens a non-admin user account:

- show the user's current delegable permission checklist
- allow Admin to enable/disable allowed permissions
- save changes explicitly
- record permission changes in Archive

Example audit event:

`Admin enabled "Change Nabavka Status" for Marko Petrović.`

Permission changes should take effect consistently across:

- navigation visibility
- page access
- actions/buttons
- backend/database authorization

---

## 6. Account State

Each user has:

- Full Name
- Email
- Birthday
- Active/Inactive status
- Admin flag
- per-user permissions
- Created Date
- Last Login

Only Admin may:

- create users
- deactivate/reactivate accounts
- change Admin status
- change user permissions

Inactive users cannot authenticate or perform new actions.

Historical audit records must continue to reference inactive users correctly.

---

## 7. Archive Visibility

Admin:
- always has Archive access

Non-admin:
- may view Archive only if `View Archive` is enabled

Archive:
- read-only
- never editable
- never deletable through normal application workflows
