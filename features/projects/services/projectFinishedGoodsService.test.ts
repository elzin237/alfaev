import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { finishedGoodsProjection, getProjectFinishedGoods } from "./projectFinishedGoodsService";

const projectId = "00000000-0000-4000-8000-000000000001";
const reservationId = "00000000-0000-4000-8000-000000000008";
const row = { product_id: "00000000-0000-4000-8000-000000000003", product_name: "Historical Calculator",
  serial_number: "007", planned_requirement: "20", actual_project_consumption: "2", outstanding_demand: "18",
  physical_quantity: "20", globally_reserved_quantity: "8", available_quantity: "12", project_reserved_quantity: "3",
  reservation_id: reservationId, reservation_version: "2" };

beforeEach(() => {
  vi.resetAllMocks(); mocks.rpc.mockReturnValue({ select: mocks.select });
  mocks.select.mockResolvedValue({ data: [row], error: null });
});

describe("Project Finished Goods trusted read service", () => {
  it("uses only the canonical RPC, exact Project argument and server-side text casts", async () => {
    expect(await getProjectFinishedGoods(projectId)).toEqual({ ok: true, value: [{
      productId: row.product_id, productName: row.product_name, serialNumber: "007",
      plannedRequirement: 20n, actualProjectConsumption: 2n, outstandingDemand: 18n,
      physicalQuantity: 20n, globallyReservedQuantity: 8n, availableQuantity: 12n, projectReservedQuantity: 3n,
      reservationId, reservationVersion: 2n,
    }] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_project_finished_goods_reservation_context", { p_project_id: projectId });
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(finishedGoodsProjection);
    for (const key of ["planned_requirement", "actual_project_consumption", "outstanding_demand", "physical_quantity",
      "globally_reserved_quantity", "available_quantity", "project_reserved_quantity", "reservation_version"])
      expect(finishedGoodsProjection.split(",")).toContain(`${key}::text`);
  });
  it("preserves null/zero absent reservations and retained zero-state identities and versions", async () => {
    mocks.select.mockResolvedValueOnce({ data: [{ ...row, project_reserved_quantity: "0", reservation_id: null, reservation_version: "0" }], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: true, value: [{ reservationId: null, reservationVersion: 0n, projectReservedQuantity: 0n }] });
    mocks.select.mockResolvedValueOnce({ data: [{ ...row, project_reserved_quantity: "0", reservation_version: "3" }], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: true, value: [{ reservationId, reservationVersion: 3n }] });
  });
  it("supports empty data, zero stock and consumption exceeding planned demand", async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null });
    expect(await getProjectFinishedGoods(projectId)).toEqual({ ok: true, value: [] });
    mocks.select.mockResolvedValueOnce({ data: [{ ...row, physical_quantity: "0", globally_reserved_quantity: "0", available_quantity: "0",
      actual_project_consumption: "21", outstanding_demand: "0", project_reserved_quantity: "0" }], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: true, value: [{ physicalQuantity: 0n, outstandingDemand: 0n }] });
  });
  it("preserves exact aggregates beyond bigint and exact stock/version above 2^53", async () => {
    mocks.select.mockResolvedValueOnce({ data: [{ ...row, planned_requirement: "18446744073709551614", actual_project_consumption: "0",
      outstanding_demand: "18446744073709551614", physical_quantity: "9007199254740993", globally_reserved_quantity: "1",
      available_quantity: "9007199254740992", project_reserved_quantity: "1", reservation_version: "9007199254740993" }], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: true, value: [{ plannedRequirement: 18446744073709551614n,
      physicalQuantity: 9007199254740993n, availableQuantity: 9007199254740992n, reservationVersion: 9007199254740993n }] });
  });
  it.each([
    { physical_quantity: 20 }, { physical_quantity: 9007199254740993 }, { physical_quantity: "9223372036854775808" },
    { planned_requirement: "20.5" }, { actual_project_consumption: "2e0" }, { available_quantity: "-1" },
    { available_quantity: "13" }, { outstanding_demand: "19" }, { project_reserved_quantity: "9" },
    { reservation_id: null }, { reservation_version: "0" }, { reservation_id: "invalid" },
    { serial_number: "7" }, { product_name: " " }, { foreign_project_id: projectId }, { reservation_version: "02" },
  ])("fails closed for malformed or inconsistent response %j", async patch => {
    mocks.select.mockResolvedValueOnce({ data: [{ ...row, ...patch }], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: false, error: { code: "load_failed" } });
  });
  it("rejects duplicate Product rows and invalid Project IDs", async () => {
    mocks.select.mockResolvedValueOnce({ data: [row, row], error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: false });
    mocks.rpc.mockClear();
    expect(await getProjectFinishedGoods("invalid")).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "access_denied"], ["P0002", "project_not_found"], ["22023", "invalid_request"],
    ["PGRST202", "not_available"], ["42883", "not_available"], ["OTHER", "load_failed"]])("maps %s without leaking backend details", async (code, expected) => {
    mocks.select.mockResolvedValueOnce({ data: null, error: { code, message: "PRIVATE SQL DETAILS" } });
    const result = await getProjectFinishedGoods(projectId);
    expect(result).toMatchObject({ ok: false, error: { code: expected } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE SQL");
  });
  it("maps thrown errors and malformed data safely", async () => {
    mocks.select.mockRejectedValueOnce(new Error("PRIVATE"));
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: false });
    mocks.select.mockResolvedValueOnce({ data: {}, error: null });
    expect(await getProjectFinishedGoods(projectId)).toMatchObject({ ok: false });
  });
  it("sends text projections through the real SDK and retains precision across JSON decoding (mock HTTP only)", async () => {
    const wire = { ...row, physical_quantity: "9007199254740993", available_quantity: "9007199254740985" };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify([wire]), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createClient("https://local-unit-test.invalid", "unit-only-publishable-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
    });
    mocks.rpc.mockImplementation(client.rpc.bind(client));
    expect(await getProjectFinishedGoods(projectId, new AbortController().signal, "captured-read-token")).toMatchObject({ ok: true, value: [{ physicalQuantity: 9007199254740993n }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/get_project_finished_goods_reservation_context");
    expect(new URL(String(url)).searchParams.get("select")).toBe(finishedGoodsProjection);
    expect(JSON.parse(String(options?.body))).toEqual({ p_project_id: projectId });
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer captured-read-token");
  });
});
