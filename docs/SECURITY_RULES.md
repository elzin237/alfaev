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

Product authorization:

- Product reads require Admin access or `inventory.view`
- direct client Product `INSERT`, `UPDATE`, and `DELETE` are denied
- trusted Product create/edit operations must re-check authorization and allow only active Brands for new Product references or Brand changes
- Product archive/deactivate requires an active Admin or `inventory.products.edit`; `inventory.products.create` does not authorize archive and `inventory.view` remains read-only
- Product archive/deactivate remains a trusted backend lifecycle mutation; do not add a separate `inventory.products.archive` permission
- historical Products may continue to reference archived Brands
- archived Products remain readable for authorized historical access but are immutable through normal Product editing
- no normal hard-delete or reactivation/unarchive workflow is supported

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

Admin-only.

Required input:

- adjustment type
- quantity
- reason

Trusted operation records:

- quantity before
- delta
- quantity after
- reason
- actor
- timestamp
- InventoryMovement
- AuditLog

Reject:

- missing reason
- zero/invalid quantity
- result below zero
- non-admin actor

---

# 11. PCB Production Security

PCB production must be a trusted atomic operation.

Before committing:

- verify actor may produce PCB
- verify PCB card is active
- verify BOM version is valid/active
- verify quantity to produce is positive
- re-read all required Inventory balances
- validate sufficient stock for every input
- prevent race-condition overspending

Atomic success creates:

- PcbProductionRun
- input Inventory deductions
- input InventoryMovement rows
- finished PCB output Inventory increase
- output InventoryMovement
- AuditLog

If any step fails:
- no partial production state
- no partial Inventory mutation

Client-side "stock available" display is not authorization or final validation.

---

# 12. PCB BOM History

Once a BOM version has production history:

- BOM version is immutable
- its BOM items are immutable
- edits create a new version

Backend policies/functions must enforce this.

Do not rely on disabled Edit buttons.

---

# 13. Work Order Draft Security

Draft Work Order:

- requires authenticated authorized actor to create/edit
- Work Order Number is generated by trusted backend
- Draft edits do not change Inventory

Barcode scan input:

- validate exact expected Serial Number format
- resolve by unique Product Serial Number
- do not trust arbitrary product data supplied by client

Draft rows may only reference valid active Products where business rules permit.

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

Do not trust a client-generated PDF as the permanent official document.

Storage rules:

- private bucket
- no public permanent URL
- authorize access before issuing signed/controlled link
- use unpredictable object keys/internal IDs
- prevent arbitrary path access

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

Existing Product request:
- client may submit Product ID
- backend/RLS verifies Product exists and is visible/valid

Brand-new Product request:
- has no Product Serial Number
- worker cannot assign one manually

`Create component from request`:
- Admin-only
- trusted transaction
- re-check request is still unlinked
- allocate Product Serial Number
- create Product
- create Supplier relationship as appropriate
- link request
- audit action

---

# 20. Project Security

Project writes require corresponding permission or Admin.

Completed Project:

- protected from normal edits
- can only be reopened by Admin
- reopening must be explicit and audited

Do not let a generic update endpoint silently change Completed Project fields.

Project material usage is derived from trusted completed movement sources.

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
- non-admin permission escalation impossible
- service-role secret absent from frontend
- Inventory cannot go negative
- manual adjustment Admin-only
- PCB production atomic
- Work Order Finish atomic/safely finalized
- Finished Work Orders immutable
- used BOM versions immutable
- InventoryMovement immutable
- AuditLog immutable
- private PDF Storage
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
