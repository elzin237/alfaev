import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc } }));

import { listPcbBomVersions } from "./pcbBomHistoryService";

const cardId = "11111111-1111-4111-8111-111111111111";
const creatorId = "22222222-2222-4222-8222-222222222222";
const row = {
  bom_version_id: "33333333-3333-4333-8333-333333333333",
  version_number: "1",
  is_active: true,
  created_at: "2026-09-17T12:30:00+00:00",
  created_by_user_id: creatorId,
  created_by_full_name: "Historical Creator",
  production_used: false,
};

describe("PCB BOM version history service", () => {
  beforeEach(() => rpc.mockReset());

  it("returns an honest empty history through only the narrow RPC", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await listPcbBomVersions(cardId)).toEqual({ ok: true, value: [] });
    expect(rpc).toHaveBeenCalledWith("list_pcb_bom_versions", { p_pcb_card_id: cardId });
  });

  it.each(["1", "2", "3", "9223372036854775807"])(
    "preserves exact version %s and creator/use/status fields", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ ...row, version_number: versionNumber,
        is_active: false, production_used: true }], error: null });
      expect(await listPcbBomVersions(cardId)).toEqual({ ok: true, value: [{
        versionId: row.bom_version_id, versionNumber, isActive: false,
        createdAt: row.created_at, createdByUserId: creatorId,
        createdByFullName: "Historical Creator", productionUsed: true,
      }] });
    },
  );

  it("preserves newest-first order without converting version bigint through Number", async () => {
    rpc.mockResolvedValue({ data: [
      { ...row, bom_version_id: "55555555-5555-4555-8555-555555555555",
        version_number: "9223372036854775807", is_active: true },
      { ...row, bom_version_id: "44444444-4444-4444-8444-444444444444",
        version_number: "3", is_active: false, production_used: true },
      { ...row, version_number: "2", is_active: false, production_used: true },
    ], error: null });
    const result = await listPcbBomVersions(cardId);
    expect(result.ok && result.value.map((version) => version.versionNumber))
      .toEqual(["9223372036854775807", "3", "2"]);
  });

  it.each(["0", "-1", "1.5", "1e3", "01", "invalid", "9223372036854775808", 2])(
    "rejects malformed version %s", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ ...row, version_number: versionNumber }], error: null });
      expect(await listPcbBomVersions(cardId)).toMatchObject({ ok: false,
        error: { code: "history_failed" } });
    },
  );

  it("fails safely on malformed metadata, duplicate or unordered rows", async () => {
    for (const malformed of [
      { ...row, created_at: "not-a-date" },
      { ...row, created_by_full_name: " " },
      { ...row, production_used: "yes" },
      { ...row, created_by_user_id: "private" },
    ]) {
      rpc.mockResolvedValueOnce({ data: [malformed], error: null });
      expect(await listPcbBomVersions(cardId)).toMatchObject({ ok: false,
        error: { code: "history_failed" } });
    }
    rpc.mockResolvedValueOnce({ data: [row, row], error: null })
      .mockResolvedValueOnce({ data: [row, { ...row, bom_version_id: creatorId,
        version_number: "2" }], error: null });
    expect(await listPcbBomVersions(cardId)).toMatchObject({ ok: false,
      error: { code: "history_failed" } });
    expect(await listPcbBomVersions(cardId)).toMatchObject({ ok: false,
      error: { code: "history_failed" } });
  });

  it("maps only safe missing, denied and provider errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "private" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } })
      .mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private" } });
    for (const code of ["not_found", "access_denied", "history_failed"]) {
      const result = await listPcbBomVersions(cardId);
      expect(result).toMatchObject({ ok: false, error: { code } });
      if (!result.ok) expect(result.error.message).not.toContain("private");
    }
    expect(await listPcbBomVersions("invalid")).toMatchObject({ ok: false,
      error: { code: "not_found" } });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
