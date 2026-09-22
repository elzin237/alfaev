# AlfaEV — TECH_STACK.md

Status: Recommended production stack v1  
Purpose: Define the production technology choices for a scalable, secure, maintainable AlfaEV implementation.  
Rule: Preserve the existing React/Vite/Tailwind UI foundation. Add backend infrastructure deliberately; do not introduce unrelated frameworks or rewrite the frontend.

---

# 1. Frontend

## Core

- React 19
- React DOM 19
- TypeScript (strict)
- Vite 8
- React Router 8
- Tailwind CSS 4
- `@tailwindcss/vite`
- `lucide-react`
- npm
- ES modules

Use the already migrated TS/TSX application as the frontend foundation.

Do not rewrite the application into Next.js or another frontend framework.

---

# 2. Backend Platform

Recommended backend:

- Supabase

Use Supabase for:

- PostgreSQL database
- Authentication
- Row Level Security
- private file Storage
- trusted Postgres functions / RPC
- Edge Functions only where a server runtime is genuinely required

This stack fits AlfaEV because the application is relational, permission-heavy, audit-heavy, and contains transactional Inventory workflows.

---

# 3. Database

Use PostgreSQL through Supabase.

Database responsibilities include:

- canonical relational data
- unique constraints
- foreign keys
- check constraints
- immutable historical records
- per-user permissions
- Row Level Security
- concurrency-safe counters/sequences
- atomic Inventory transactions
- atomic PCB production
- atomic Work Order Finish database state
- audit/history persistence

Critical business invariants must be enforceable at the database/trusted-backend layer rather than relying on React code.

---

# 4. Authentication

Use Supabase Auth.

Initial authentication model:

- Admin-created/invited users only
- no public sign-up
- email-based user identity
- secure password/invite flow
- session handled by Supabase Auth
- application profile stored separately in `UserProfile`

Each authenticated Supabase user maps to exactly one AlfaEV UserProfile.

Account access also requires:

- `UserProfile.is_active = true`

Deactivating an AlfaEV account must block application access even if an old authentication session/token still exists.

---

# 5. Authorization

Use:

- Supabase Row Level Security
- database permission helper functions
- per-user permission records
- Admin bypass rules
- trusted RPCs/functions for critical mutations

Frontend permission checks are only UX.

The database/trusted backend is authoritative.

Never use the Supabase service-role key in browser code.

---

# 6. Supabase Client

Use the official Supabase JavaScript/TypeScript client.

Frontend responsibilities:

- authenticated reads allowed by RLS
- safe non-critical writes allowed by explicitly designed RLS policies
- invoking trusted RPCs/functions
- retrieving private signed Storage URLs when authorized

Do not scatter raw Supabase calls through TSX pages.

Wrap data access in feature-specific repositories/services/hooks.

---

# 7. Data Fetching / Server State

Recommended:

- TanStack Query

Use for:

- query caching
- loading/error state
- invalidation after mutations
- deduplicating server reads
- permission-aware data fetching
- keeping feature TSX components small

Do not use a global state library merely to store server data.

Local UI state should remain local React state where appropriate.

---

# 8. Forms and Validation

Recommended:

- React Hook Form
- Zod

Use Zod/typed schemas for:

- form input validation
- parsing domain input
- shared frontend validation
- trusted server/Edge Function input validation where applicable

Database constraints remain authoritative for invariants.

Do not duplicate inconsistent handwritten validation across pages.

---

# 9. Inventory / Critical Domain Operations

Use trusted PostgreSQL functions/RPCs for operations that require:

- authorization check
- state validation
- row locking/concurrency control
- multiple related writes
- Inventory movements
- Audit Log creation
- atomic commit

Required trusted operations include at least:

- Product creation / Serial Number allocation
- manual Inventory adjustment
- Create Product from Nabavka
- PCB production
- Work Order number allocation
- Work Order Finish
- permission changes / Admin-sensitive mutations

Use database transactions for these operations.

---

# 10. Serial Number Generation

Use a PostgreSQL sequence or equivalent trusted database counter.

Business format:

`0000001` through `9999999`

Rules:

- sequential
- 7 digits
- concurrency-safe
- unique
- never reused

Database may store either:

- numeric sequence value plus formatted display
- or generated 7-character representation

The public/barcode value must always be exactly 7 digits.

---

# 11. Work Order Number Generation

Use trusted database logic with a yearly counter.

Format:

`RN-YYYY-NNNN`

Example:

`RN-2026-0001`

Requirements:

- unique
- assigned at Draft creation
- concurrency-safe
- sequence resets by year
- authoritative year and reset boundary use the IANA timezone `Europe/Sarajevo`
- never reused after Draft deletion

Use a database unique constraint on the human-facing Work Order number.

---

# 12. Barcode

Use Code 128 for AlfaEV Product barcodes.

Reason:

- encodes the exact 7-digit AlfaEV Serial Number directly
- works with standard USB/Bluetooth HID barcode scanners
- does not require adding a check digit to the AlfaEV Serial Number

Barcode reader assumption:

- standard scanner behaves as keyboard/HID input
- scanned value is validated as a 7-digit AlfaEV Serial Number
- no proprietary scanner SDK is required for the initial implementation

Barcode image may be generated deterministically in the frontend for viewing/downloading.

Recommended implementation library can be selected during the Inventory task; avoid storing duplicate barcode image files unless a real need appears.

---

# 13. Work Order PDF Generation

Generate Finished Work Order PDFs in trusted server-side code.

Recommended runtime:

- Supabase Edge Function

Recommended PDF approach:

- a deterministic server-side PDF library suitable for the Edge Function runtime
- no browser-generated document should be treated as the canonical signed/printable record

Store final PDFs in a private Supabase Storage bucket.

Recommended bucket concept:

`work-order-pdfs`

Rules:

- private
- access controlled
- no public object URLs
- authorized users receive signed/controlled access

## Safe finalization strategy

Database transactions cannot atomically include external Storage bytes.

Therefore use a safe orchestration pattern:

1. Edge Function authenticates and authorizes the actor.
2. Read/validate the Draft Work Order snapshot.
3. Generate PDF bytes from that snapshot.
4. Upload to a temporary/private Storage key.
5. Call trusted `finish_work_order` RPC with an expected Draft version/timestamp and the prepared PDF key.
6. RPC re-validates:
   - Work Order is still Draft
   - Draft did not change
   - Inventory is still sufficient
   - actor is authorized
7. RPC atomically:
   - deducts Inventory
   - creates InventoryMovement rows
   - marks Work Order Finished
   - links the final PDF reference
   - creates Audit Log
8. If RPC fails, delete the temporary PDF object.
9. Only after successful RPC is the Work Order exposed as Finished.

This prevents a Work Order from appearing Finished without a valid final document and prevents stale PDF generation from silently finalizing changed data.

---

# 14. File Storage

Use Supabase Storage only for files that genuinely require persistence.

Required persistent files include:

- generated Finished Work Order PDF
- optional DocumentationRecord PDF

Do not store:

- generated barcode images that can be recreated deterministically
- arbitrary user uploads outside explicitly approved features

Storage buckets containing business documents must remain private.

DocumentationRecord PDFs:

- use private Supabase Storage
- never use a public bucket or public object URL
- require Admin-only authorized upload/read/download/replace/remove access
- store only the private object path/reference in PostgreSQL, never PDF bytes
- support only one optional PDF per DocumentationRecord in the current scope

---

# 15. Styling / UI

Preserve:

- Tailwind CSS 4
- current AlfaEV visual language
- existing approved layouts/components where applicable

Do not introduce a full UI framework unless a concrete need appears.

Reusable internal components should be built in the project rather than mixing multiple competing design systems.

---

# 16. Calendar

Keep Calendar implementation inside the React application.

A calendar UI package may be selected during the Calendar implementation if it materially reduces complexity, but it must:

- support React 19
- support month/event rendering
- support category filtering
- not force a visual redesign
- remain replaceable behind feature-level components

Do not lock the architecture to a calendar vendor before implementation review.

---

# 17. Testing

AlfaEV should introduce automated testing as functionality becomes real.

Recommended layers:

## Unit tests
- Vitest
- pure domain calculations
- permission helpers
- BOM calculations
- formatting
- validation

## React/component tests
- React Testing Library where valuable
- forms
- permission-driven UI
- important interaction states

## Backend/integration tests
Critical coverage for:

- RLS authorization
- Admin/non-admin permission boundaries
- Serial Number uniqueness
- Work Order number allocation
- Inventory non-negative invariant
- manual Inventory adjustment
- PCB production atomicity
- Work Order Finish atomicity
- immutable Audit records
- used BOM immutability

## End-to-end
Recommended:
- Playwright

High-value flows:

- login
- permission-gated navigation
- create Project
- Nabavka request
- Inventory barcode lookup
- PCB production
- Work Order barcode flow / Finish
- PDF access
- Calendar
- Users Admin-only
- Archive read access

Do not build an excessive test suite before features exist, but critical business/security paths must be automated before production release.

---

# 18. Code Quality / Validation Commands

At minimum keep:

- `npm run typecheck`
- `npm run build`

Add appropriate scripts as the project grows:

- `npm run test`
- `npm run test:run`
- `npm run test:e2e`
- linting if/when configured

Strict TypeScript remains a permanent gate.

---

# 19. Environments

Use separate environments for development and production.

Recommended:

- separate Supabase development project
- separate Supabase production project
- separate environment variables
- production credentials never used for local development

Do not point normal local development at the production database.

Database changes are managed through versioned migrations.

---

# 20. Database Migrations

All schema/RLS/function changes must be versioned migrations.

Do not make undocumented one-off production changes.

Migrations should cover:

- tables
- indexes
- constraints
- RLS policies
- helper functions
- trusted RPCs
- sequences/counters
- Storage policies where applicable

Production migrations should be reviewable and reproducible.

---

# 21. Deployment

Recommended frontend hosting:

- Vercel

Frontend deployment:

- Vite production build
- environment-specific Supabase public configuration
- HTTPS only

Backend:

- Supabase hosted infrastructure
- Supabase Edge Functions for trusted runtime workloads such as PDF generation

The architecture does not depend heavily on Vercel-specific backend features.

---

# 22. Secrets

Browser-safe:

- Supabase project URL
- Supabase publishable/anon key

Server-only:

- Supabase service-role key
- any future third-party private credentials

Server-only secrets must exist only in trusted server/Edge Function environment.

Never commit secrets into Git.

---

# 23. Dependencies We Do Not Need

Do not introduce without a real requirement:

- Redux/Zustand merely for server state
- Next.js
- Express/NestJS separate backend
- GraphQL layer
- microservices
- message queues
- external search engine
- ORM abstraction solely for fashion
- public object Storage
- giant generic admin frameworks

Supabase/Postgres is sufficient for the current locked scope.

---

# 24. Stack Summary

```text
Frontend
React 19
TypeScript strict
Vite 8
React Router 8
Tailwind CSS 4
lucide-react
TanStack Query
React Hook Form
Zod

Backend
Supabase
PostgreSQL
Supabase Auth
Row Level Security
Postgres functions/RPC
Supabase Edge Functions where needed
Supabase private Storage

Domain
Immutable Inventory Movement ledger
Immutable Audit Log
Versioned PCB BOMs
Transactional stock operations

Documents
Server-generated Work Order PDFs
Optional validated DocumentationRecord PDFs
Private Storage

Testing
Vitest
React Testing Library
Playwright
Backend/RLS integration tests

Deployment
Vercel frontend
Supabase backend
```

---

# 25. Tech Stack Definition of Done

The production stack is correctly implemented when:

- frontend remains React/Vite/TSX rather than being rewritten
- TypeScript stays strict
- real authentication replaces localStorage fake auth
- no public sign-up exists
- all tables are protected appropriately
- critical workflows use trusted atomic backend operations
- no service-role secret reaches the browser
- Finished Work Order PDFs are private and server-generated
- DocumentationRecord PDFs are private, validated, optional Admin-managed uploads
- database changes are migration-driven
- dev and production environments are separated
- critical security/business flows have automated tests before production
