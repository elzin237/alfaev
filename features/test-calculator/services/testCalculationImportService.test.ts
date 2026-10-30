import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../app/config/testCalculationImportActivation", () => ({ isTestCalculationImportEnabled: mocks.gate }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { importTestCalculation, parseTestImportReceipt, validImportSerial } from "./testCalculationImportService";
import { importRequest, importReceipt, importId } from "../../../test/testCalculationImportFixtures";
beforeEach(() => { vi.resetAllMocks(); mocks.gate.mockReturnValue(true); });
function reply(value: unknown) { const header = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue(value) }); mocks.rpc.mockReturnValue({ setHeader: header }); return header; }
describe("Test import exact service contract", () => {
  it.each(["007", "000", "999"])("accepts exact serial %s", value => expect(validImportSerial(value)).toBe(true));
  it.each(["7", "0007", " 007", "007\n", "１２３", "١٢٣", 7, null])("rejects serial %s", value => expect(validImportSerial(value)).toBe(false));
  it("parses microseconds and per-product numeric totals above bigint without loss", () => {
    expect(parseTestImportReceipt(importReceipt(), importRequest)).toEqual(importReceipt());
  });
  it("accepts zero/expired releases", () => {
    expect(parseTestImportReceipt({ ...importReceipt(), release_allocations: [], release_totals: [] }, importRequest)).not.toBeNull();
  });
  it.each([
    { imported_at: "2026-02-30T12:00:00Z" }, { imported_at: "infinity" }, { serial_number: "008" }, { calculation_id: importId(99) },
    { initial_bom_version_number: 1 }, { name: "" }, { private_receipt: {} }, { release_totals: [] },
    { release_totals: [{ product_id: importId(10), quantity: "18446744073709551615" }] },
  ])("rejects malformed or mismatched receipt %j", change => expect(parseTestImportReceipt({ ...importReceipt(), ...change }, importRequest)).toBeNull());
  it("rejects missing fields, duplicate allocations, numbers and unknown warehouses", () => {
    const r = importReceipt(); const { name: _name, ...incomplete } = r;
    expect(parseTestImportReceipt(incomplete, importRequest)).toBeNull();
    for (const change of [{ quantity: 9007199254740993 }, { quantity: "0" }, { quantity: "9223372036854775808" }, { warehouse_id: importId(99) }]) {
      expect(parseTestImportReceipt({ ...r, release_allocations: [{ ...r.release_allocations[0], ...change }] }, importRequest)).toBeNull();
    }
    expect(parseTestImportReceipt({ ...r, release_allocations: [...r.release_allocations, r.release_allocations[0]] }, importRequest)).toBeNull();
  });
  it("dispatches exactly the UUID/source/leading-zero serial with captured actor token", async () => {
    const header = reply({ data: importReceipt(), error: null });
    expect((await importTestCalculation(importRequest, "memory-token")).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("import_test_calculation", { p_request_id: importRequest.requestId, p_calculation_id: importRequest.calculationId, p_serial_number: "007" });
    expect(header).toHaveBeenCalledWith("Authorization", "Bearer memory-token");
  });
  it("gate OFF makes no RPC, including direct service invocation", async () => {
    mocks.gate.mockReturnValue(false); expect(await importTestCalculation(importRequest, "token")).toMatchObject({ ok: false, error: { code: "feature_disabled", uncertain: false } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("invalid input never dispatches", async () => { await importTestCalculation({ ...importRequest, serialNumber: "7" }, "token"); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("malformed success and thrown transport remain uncertain without retry", async () => {
    reply({ data: {}, error: null }); expect(await importTestCalculation(importRequest, "token")).toMatchObject({ ok: false, error: { uncertain: true } });
    mocks.rpc.mockImplementation(() => { throw Error("secret transport details"); });
    const value = await importTestCalculation(importRequest, "token"); expect(value).toMatchObject({ ok: false, error: { uncertain: true } }); expect(JSON.stringify(value)).not.toContain("secret");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(["42501", "TCI02", "TCI03", "PCB14", "PRD06"])("classifies confirmed rejection %s without exposing backend details", async code => {
    reply({ error: { code, message: "secret" } }); const value = await importTestCalculation(importRequest, "token");
    expect(value).toMatchObject({ ok: false, error: { code, uncertain: false } }); expect(JSON.stringify(value)).not.toContain("secret");
  });
});
