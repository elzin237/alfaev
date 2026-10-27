import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTestCalculatorAtomicBatch, testCalculatorBatchSteps, TEST_CALCULATOR_MIGRATIONS } from "../scripts/deployment/test-calculator-atomic-batch";

describe("reviewed atomic Test deployment body", () => {
  it("preserves every approved SQL byte and writes its ledger row inside the same body", () => {
    const steps = testCalculatorBatchSteps();
    expect(steps).toHaveLength(8);
    for (const step of steps) {
      expect(step.sql).toBe(readFileSync(`supabase/migrations/${step.file}`, "utf8"));
      expect(step.ledger).toContain(`values('${step.file.slice(0, 14)}','${step.file.slice(15, -4)}',array[`);
      expect(step.ledger).toContain(step.sql.replace(/'/g, "''"));
    }
    expect(steps.map(s => s.file)).toEqual(TEST_CALCULATOR_MIGRATIONS.map(([file]) => file));
  });
  it("requires the external single-transaction runner and contains no transaction escape", () => {
    const batch = buildTestCalculatorAtomicBatch();
    expect(batch).not.toMatch(/^\s*(?:begin\s*;|commit\s*;|rollback\s*;|\\)/im);
    expect(batch).toContain("requires exact clean migration 150");
    expect(batch).toContain("<> 158"); expect(batch).toContain("<> 197");
    expect(batch).not.toMatch(/\bconcurrently\b|\bvacuum\b|\balter system\b/i);
    expect(readFileSync("scripts/deployment/test-calculator-atomic-batch.ts", "utf8")).toContain("--single-transaction");
  });
  it("excludes only the verified platform event-trigger identity, retaining application counts", () => {
    const batch = buildTestCalculatorAtomicBatch();
    expect(batch).toContain("to_regprocedure('public.rls_auto_enable()')");
    for (const identity of ["p.proowner='postgres'::regrole", "p.prorettype='pg_catalog.event_trigger'::regtype",
      "p.prokind='f'", "p.pronargs=0", "p.prosecdef", "l.lanname='plpgsql'", "p.proacl is null",
      "p.proconfig=array['search_path=pg_catalog']", "evtname='ensure_rls'", "evtfoid=platform",
      "evtevent='ddl_command_end'", "evtenabled='O'", "cardinality(evttags)=3", "oid <> platform"])
      expect(batch).toContain(identity);
    expect(batch).toContain("<> 190"); expect(batch).toContain("<> 197");
    expect(batch).not.toContain("<> 198");
  });
});
