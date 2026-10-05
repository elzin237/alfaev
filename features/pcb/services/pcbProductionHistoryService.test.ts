import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { listPcbProductionHistory } from "./pcbProductionHistoryService";

const cardId = "11111111-1111-4111-8111-111111111111";
const row = {
  production_run_id: "22222222-2222-4222-8222-222222222222",
  completed_at: "2026-09-18T10:00:00+00:00",
  quantity_produced: "9007199254740993",
  project_id: null,
  project_name: null,
  bom_version_id: "33333333-3333-4333-8333-333333333333",
  bom_version_number: "9223372036854775807",
  produced_by_user_id: "44444444-4444-4444-8444-444444444444",
  produced_by_full_name: "Former Producer",
};
beforeEach(() => vi.clearAllMocks());

describe("PCB production history service", () => {
  it("reads the exact card via narrow RPC and preserves exact bigint strings", async () => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    expect(await listPcbProductionHistory(cardId)).toEqual({ ok: true, value: [{
      productionRunId: row.production_run_id, completedAt: row.completed_at,
      quantityProduced: "9007199254740993", projectId: null, projectName: null,
      bomVersionId: row.bom_version_id, bomVersionNumber: "9223372036854775807",
      producedByUserId: row.produced_by_user_id, producedByFullName: "Former Producer",
    }] });
    expect(mocks.rpc).toHaveBeenCalledWith("list_pcb_production_history", { p_pcb_card_id: cardId });
  });

  it("maps Project names and empty history", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...row,
      project_id: "55555555-5555-4555-8555-555555555555", project_name: "Historic Project",
    }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    const project = await listPcbProductionHistory(cardId);
    expect(project.ok && project.value[0]?.projectName).toBe("Historic Project");
    expect(await listPcbProductionHistory(cardId)).toEqual({ ok: true, value: [] });
  });

  it.each([
    { ...row, quantity_produced: 9007199254740993 },
    { ...row, quantity_produced: "9223372036854775808" },
    { ...row, bom_version_number: "1e2" },
    { ...row, completed_at: "not-a-date" },
    { ...row, project_id: null, project_name: "Fabricated" },
    { ...row, produced_by_full_name: "" },
    { ...row, email: "private@example.com" },
  ])("rejects malformed or over-broad history rows safely", async (malformed) => {
    mocks.rpc.mockResolvedValue({ data: [malformed], error: null });
    expect(await listPcbProductionHistory(cardId)).toMatchObject({ ok: false, error: { code: "history_failed" } });
  });

  it("maps provider and authorization failures without leaking details", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "private" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } })
      .mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private" } });
    for (const code of ["not_found", "access_denied", "history_failed"]) {
      const result = await listPcbProductionHistory(cardId);
      expect(result).toMatchObject({ ok: false, error: { code } });
      if (!result.ok) expect(result.error.message).not.toContain("private");
    }
    expect(await listPcbProductionHistory("invalid")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
});
