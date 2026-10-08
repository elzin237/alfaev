import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261008110000_add_bounded_project_search.sql",
), "utf8");

describe("bounded Project search migration", () => {
  it("exposes only the list-safe Topbar projection with a fixed bound", () => {
    expect(migration).toContain(
      "create function public.search_projects(p_search text)",
    );
    expect(migration).toContain(
      "returns table (\n  project_id uuid,\n  name text,\n  status text\n)",
    );
    expect(migration).toContain("limit 8");
    expect(migration).not.toContain("customer_name");
    expect(migration).not.toContain("created_by_user_id");
    expect(migration).not.toContain("offset");
    expect(migration).not.toContain("count(");
  });

  it("normalizes empty input, bounds length, escapes LIKE metacharacters, and orders deterministically", () => {
    expect(migration).toContain(
      "normalized_search text := nullif(pg_catalog.btrim(p_search), '')",
    );
    expect(migration).toContain(
      "if normalized_search is null then\n    return;",
    );
    expect(migration).toContain("pg_catalog.length(normalized_search) > 100");
    expect(migration).toContain("pg_catalog.chr(92) || '%'");
    expect(migration).toContain("pg_catalog.chr(92) || '_'");
    expect(migration).toContain(
      "pg_catalog.lower(project.name),\n    project.name,\n    project.id",
    );
  });

  it("enforces the canonical active Admin-or-projects.view boundary and hardened ACL", () => {
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("public.current_active_user_profile_id()");
    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('projects.view')");
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated;\n\ngrant execute\n  on function public.search_projects(text)\n  to authenticated;",
    );
  });

  it("adds the exact trigram index justified by substring name search", () => {
    expect(migration).toContain(
      "create index projects_name_search_trgm_idx\n  on public.projects\n  using gin (pg_catalog.lower(name) extensions.gin_trgm_ops)",
    );
    expect(migration).toContain(
      "where pg_catalog.lower(project.name)\n    like contains_pattern escape '\\'",
    );
    expect(migration.match(/create index/g)).toHaveLength(1);
  });
});
