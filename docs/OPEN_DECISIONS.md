# AlfaEV — OPEN_DECISIONS.md

Status: All currently identified blocking product decisions are resolved.  
Rule: Codex must not guess any item in this file.

---

## 1. Supplier ↔ Catalog Number modeling — RESOLVED

Locked:
- one product/component may be purchased from multiple Suppliers
- one Supplier may supply multiple products/components
- Product↔Supplier is many-to-many
- Catalog Number belongs to the Product–Supplier relationship
- the same product may have a different Catalog Number for each Supplier
- Catalog Number is not unique
- Serial Number / Šifra remains AlfaEV's unique internal product/component identifier

---

## 2. Nabavka requests for brand-new components — RESOLVED

Locked:

### Existing component
- worker selects an existing AlfaEV Product/Component
- Serial Number / Šifra and Name are populated from the existing record
- worker enters Quantity; Supplier is not requested at creation

### Brand-new component
- worker may create a Nabavka request before the Product/Component exists
- no AlfaEV Serial Number / Šifra is assigned yet
- worker enters Name and Quantity; Supplier is not requested at creation
- request is marked as not yet linked to a Product/Component
- Admin later uses `Create component from request`
- AlfaEV creates the actual Product/Component
- AlfaEV generates the next unique 7-digit Serial Number / Šifra
- the new Product/Component is linked back to the original Nabavka request

Workers never manually invent Serial Number / Šifra values.

---

## 3. Radni Nalog number generation — RESOLVED

Locked:

- AlfaEV generates the Work Order number automatically
- human-readable format is `RN-YYYY-NNNN`
- sequence resets each calendar year
- number is assigned when the Work Order is created, including Draft
- number never changes
- number is never reused, even if a Draft is later deleted
- trusted backend/database logic must generate the sequence safely
- the database may use a separate internal UUID

---

## 4. Finished PCB cards and Inventory — RESOLVED

Locked:

- successfully produced PCB cards become finished-goods Inventory stock
- PCB production deducts all required BOM components
- PCB production records the exact BOM version used
- PCB production adds the produced PCB quantity to finished-goods stock
- input consumption and output creation are recorded as Inventory movements
- the whole operation is atomic
- audit history records the production and stock changes

Important follow-through:
- if PCB production is linked to a Project and the resulting PCB finished goods are later issued through a Work Order, Project material reporting must avoid double-counting the same underlying material consumption

---

## 5. Users page visibility for non-admin users — RESOLVED

Locked:

- Users page is completely Admin-only
- non-admin users do not see the Users navigation item
- non-admin users cannot access the Users page
- non-admin users do not get a read-only employee/user directory
- user creation, editing, activation/deactivation, Admin status, and permission management remain Admin-only

---

## 6. Dashboard permission behavior — RESOLVED

Locked:

- Dashboard inherits module permissions by default
- Admin sees the full Dashboard
- non-admin users only see widgets/data from modules they are authorized to view
- explicitly company-wide information may be shown to all authenticated users
- Calendar data may be shown company-wide because Calendar viewing is available to all authenticated users
- Dashboard must not leak unauthorized module data
