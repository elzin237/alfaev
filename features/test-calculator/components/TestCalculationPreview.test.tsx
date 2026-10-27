import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), search: vi.fn(), auth: vi.fn() }));
vi.mock("../services/testCalculationPreviewService", () => ({ previewTestCalculation: mocks.preview }));
vi.mock("../services/testCalculatorSearchService", () => ({ searchTestCalculatorProducts: mocks.search }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
import TestCalculationEditor from "./TestCalculationEditor";
import type { TestCalculationDraft } from "../testCalculationDraft";
import type { TestPreviewResult } from "../services/testCalculationPreviewService";
const product = { productId: "20000000-0000-4000-8000-000000000001", name: "Component", serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg" } as const;
const draft: TestCalculationDraft = { name: "Test", deadlineDate: "2090-01-01", items: [{ product, quantity: "5" }] };
const active = { session: { user: { id: "auth-a" } }, profile: { id: "profile-a", authUserId: "auth-a", isActive: true }, isActive: true, isLoading: false, error: null };
const result = (available="3",required="5"): TestPreviewResult => ({ ok: true, value: {
  rows: [{ productId: product.productId, name: "Authoritative Component", serialNumber: "0000123", productKind: "component",
    required, eligibleFree: available, projectPriority: "0", available, reservable: (BigInt(available)<BigInt(required)?BigInt(available):BigInt(required)).toString(),
    missing: (BigInt(required)-(BigInt(available)<BigInt(required)?BigInt(available):BigInt(required))).toString(),
    warehouses: [{ warehouseId: "raw", warehouseCode: "raw_materials", quantity: available }] }],
  asOf: "2026-10-27T11:00:00.123456Z", saveWillRecalculate: true,
} });
function renderEditor(initialDraft=draft, enabled=true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TestCalculationEditor initialDraft={initialDraft} previewEnabledAfterActivation={enabled} searchEnabledAfterActivation /></QueryClientProvider>);
  return { ...view, client };
}
const prove = () => fireEvent.click(screen.getByRole("button", { name: "Prove Calculation" }));
beforeEach(() => { mocks.auth.mockReturnValue(active); mocks.preview.mockResolvedValue(result()); mocks.search.mockResolvedValue({ ok: true, value: [{ ...product, productId: "20000000-0000-4000-8000-000000000002", name: "Other" }] }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Prove Calculation editor integration (mock services only)", () => {
  it.each(["0","3","5"])("shows authoritative full/partial/zero availability %s with exact payload", async available => {
    mocks.preview.mockResolvedValue(result(available)); renderEditor(); prove();
    const region = await screen.findByRole("region", { name: "Test Calculation preview" });
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith([{ product_id: product.productId, quantity: "5" }]);
    expect(within(region).getAllByRole("columnheader").map(h=>h.textContent)).toEqual(["Component/Product","Quantity per calculation","Required","Available","Reservable","Missing"]);
    expect(within(region).getAllByRole("cell").slice(1).map(c=>c.textContent)).toEqual(["5","5",available,available,(5n-BigInt(available)).toString()]);
    expect(region).toHaveTextContent("Availability is provisional and will be recalculated when the calculation is saved.");
    expect(region).toHaveTextContent("Raw Materials:"); expect(region).toHaveTextContent("2026-10-27T11:00:00.123456Z");
    expect(screen.getByRole("button", { name: "Save Test Calculation" })).toBeDisabled();
    expect(region.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });
  it("retains SQL bigint values without rounding in transport or table", async () => {
    const large = "9223372036854775807"; mocks.preview.mockResolvedValue(result(large,large));
    renderEditor({ ...draft, items: [{ product, quantity: large }] }); prove();
    const region=await screen.findByRole("region", { name: "Test Calculation preview" });
    expect(within(region).getAllByRole("cell").slice(1).map(c=>c.textContent)).toEqual([large,large,large,large,"0"]);
    expect(mocks.preview.mock.calls[0]![0][0].quantity).toBe(large);
  });
  it.each([["Calculation name","Changed"],["Deadline (Europe/Sarajevo)","2090-02-01"],["Required quantity for Component","7"]])("invalidates a successful proof on edit: %s", async (label,value) => {
    renderEditor(); prove(); await screen.findByRole("region", { name: "Test Calculation preview" });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.queryByRole("region", { name: "Test Calculation preview" })).not.toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
  it("invalidates proof on Product add/remove without automatic preview", async () => {
    renderEditor(); prove(); await screen.findByRole("region", { name: "Test Calculation preview" });
    fireEvent.change(screen.getByLabelText("Search eligible Products"), { target: { value: "Other" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Other" }));
    expect(screen.queryByRole("region", { name: "Test Calculation preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Other" }));
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
  it("blocks duplicate submissions and ignores a late response after edit, even if draft is reverted", async () => {
    let finish!: (value: TestPreviewResult) => void; mocks.preview.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    renderEditor(); prove(); prove(); expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Prove Calculation" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Proving calculation");
    fireEvent.change(screen.getByLabelText("Calculation name"), { target: { value: "Changed" } });
    fireEvent.change(screen.getByLabelText("Calculation name"), { target: { value: "Test" } });
    await act(async()=>{finish(result());});
    expect(screen.queryByRole("region", { name: "Test Calculation preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prove Calculation" })).not.toBeDisabled();
  });
  it("hides late and completed results across account changes, including switching back", async () => {
    let finish!: (value: TestPreviewResult) => void; mocks.preview.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const view=renderEditor(); prove();
    mocks.auth.mockReturnValue({ ...active, session: { user: { id: "auth-b" } }, profile: { ...active.profile, id: "profile-b", authUserId: "auth-b" } });
    fireEvent.change(screen.getByLabelText("Search eligible Products"), { target: { value: "Other" } });
    mocks.auth.mockReturnValue(active);
    fireEvent.change(screen.getByLabelText("Search eligible Products"), { target: { value: "" } });
    await act(async()=>{finish(result());});
    expect(screen.queryByRole("region", { name: "Test Calculation preview" })).not.toBeInTheDocument();
    expect(view.client.getQueryCache().getAll().every(q=>!q.queryKey.includes("auth-b") || q.queryKey[0]!=="test-calculation-preview")).toBe(true);
  });
  it.each(["permission","network"])("clears old success and shows %s error without fabricated quantities", async kind => {
    renderEditor(); prove(); await screen.findByRole("region", { name: "Test Calculation preview" });
    if(kind==="permission")mocks.preview.mockResolvedValue({ ok: false, error: { code: "access_denied", message: "You do not have permission to preview." } });
    else mocks.preview.mockRejectedValue(new Error("secret backend connection"));
    prove(); const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent(kind==="permission"?"do not have permission":"could not be loaded");
    expect(alert).not.toHaveTextContent("secret backend connection");
    expect(screen.queryByRole("region", { name: "Test Calculation preview" })).not.toBeInTheDocument();
  });
  it("cannot dispatch preview when opt-in is absent", async () => {
    renderEditor(draft,false); prove(); expect(mocks.preview).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("not enabled");
  });
});
