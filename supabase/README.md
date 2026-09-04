# Supabase migration workflow

Install repository dependencies and verify the pinned Supabase CLI:

```bash
npm install
npx supabase --version
```

Create each database change as a versioned migration:

```bash
npx supabase migration new <name>
```

## Local workflow

Docker must be running before starting the local Supabase stack.

```bash
npx supabase start
npx supabase db reset
npx supabase stop
```

`db reset` rebuilds the local database and reapplies the migrations from a clean
state. Migrations are the source of truth for database schema and security
changes.

## Hosted development workflow

Use only the dedicated development project for normal development:

```bash
npx supabase login
npx supabase link --project-ref <dev-project-ref>
npx supabase db push
```

Verify the target project before linking or pushing. Never use production for
normal development, and never commit credentials or project secrets.
