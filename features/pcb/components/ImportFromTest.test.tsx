import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), auth: vi.fn(), permission: vi.fn(), list: vi.fn(), detail: vi.fn(), import: vi.fn(), conversions: vi.fn() }));
vi.mock("../../test-calculator/services/testCalculationConversionService", () => ({getTestConversions:mocks.conversions}));
vi.mock("../../../app/config/testCalculationImportActivation", () => ({ isTestCalculationImportEnabled: mocks.gate }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: {} }));
vi.mock("../../test-calculator/services/testCalculationHistoryService", async original => ({
  ...await original<typeof import("../../test-calculator/services/testCalculationHistoryService")>(), listTestCalculations: mocks.list, getTestCalculation: mocks.detail,
}));
vi.mock("../../test-calculator/services/testCalculationImportService", async original => ({
  ...await original<typeof import("../../test-calculator/services/testCalculationImportService")>(), importTestCalculation: mocks.import,
}));
import ImportFromTest from "./ImportFromTest";
import { importId as id, importIdentity as identity, importReceipt } from "../../../test/testCalculationImportFixtures";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { readTestImportRecovery } from "../../test-calculator/services/testCalculationImportRecoveryStore";
import type { TestHistoryDetail, TestHistoryHeader } from "../../test-calculator/services/testCalculationHistoryService";

const auth = { session: { user: { id: identity.authUserId }, access_token: "memory-token" },
  profile: { id: identity.profileId, authUserId: identity.authUserId, isActive: true }, isAdmin: true, isActive: true, isLoading: false, error: null };
const active: TestHistoryHeader = { calculationId: id(4), name: "Saved Test", creatorFullName: "Other employee", createdAt: "2026-10-29T12:34:00Z",
  deadlineDate: "2090-01-01", deadlineTimezone: "Europe/Sarajevo", expiresAt: "2090-01-01T23:00:00Z", status: "active", asOf: "2026-10-29T13:00:00Z" };
const expired: TestHistoryHeader = { ...active, calculationId: id(40), name: "Older expired Test", status: "expired", deadlineDate: "2026-10-28", expiresAt: "2026-10-28T23:00:00Z" };
const definition: TestHistoryDetail = { ...active, items: [{ itemId: id(9), productId: id(10), name: "Exact Component", serialNumber: "0000123", productKind: "component",
  required: "9007199254740993", held: "2", missing: "9007199254740991", holds: [] }] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/pcb"]}><Routes>
    <Route path="/pcb" element={<ImportFromTest />} /><Route path="/pcb/:id" element={<h1>Destination Calculator</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(wrapper());
  return { client, ...view, rerenderEntry: () => view.rerender(wrapper()) };
}
async function open() { await waitFor(() => expect(screen.getByRole("button", { name: "Import from Test" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Import from Test" })); await screen.findByText("Saved Test"); }
async function choose() { await open(); fireEvent.click(screen.getByRole("radio", { name: /Saved Test/ })); await screen.findByText("Required: 9007199254740993"); }
function fillSerial(serial = "006") { fireEvent.change(screen.getByLabelText("New output Product serial"), { target: { value: serial } }); }
async function confirmAndSubmit() { fillSerial(); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ })); fireEvent.click(screen.getByRole("button", { name: "Import Product Calculator" })); }
beforeEach(() => {
  vi.resetAllMocks(); installRecoveryBrowser(); mocks.gate.mockReturnValue(true); mocks.auth.mockReturnValue(auth);
  mocks.permission.mockResolvedValue({ ok: true, value: true }); mocks.list.mockResolvedValue({ ok: true, value: { rows: [active, expired], nextCursor: null } });
  mocks.detail.mockImplementation(async source => ({ ok: true, value: { ...definition, ...(source === expired.calculationId ? expired : active) } }));
  mocks.conversions.mockImplementation(async (ids:string[])=>({as_of:active.asOf,next_expiry:null,rows:ids.map(calculation_id=>({calculation_id,imported:false,can_navigate:false,destination:null,items:[]}))}));
  mocks.import.mockImplementation(async request => ({ ok: true, value: { ...importReceipt(), calculation_id: request.calculationId, serial_number: request.serialNumber } }));
});
afterEach(cleanup);
it("gate OFF exposes no button and mounts no auth/read/mutation hooks", () => {
  mocks.gate.mockReturnValue(false); setup(); expect(screen.queryByRole("button", { name: "Import from Test" })).not.toBeInTheDocument();
  expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.import).not.toHaveBeenCalled();
});
it("does not load history before opening and shows shared Active/Expired records in Sarajevo", async () => {
  setup(); expect(mocks.list).not.toHaveBeenCalled(); await open();
  expect(mocks.list).toHaveBeenCalledWith(20, null, "memory-token", expect.any(AbortSignal));
  expect(screen.getByText("Active")).toBeInTheDocument(); expect(screen.getByText("Expired")).toBeInTheDocument();
  expect(screen.getAllByText(/Created 29 Oct 2026 · 13:34/)).toHaveLength(2);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Older" } });
  expect(screen.queryByRole("radio", { name: /Saved Test/ })).not.toBeInTheDocument(); expect(screen.getByRole("radio", { name: /Older expired/ })).toBeInTheDocument();
});
it("uses bounded cursor pagination and can return to the previous page", async () => {
  const cursor = { createdAt: expired.createdAt, id: expired.calculationId };
  mocks.list.mockResolvedValueOnce({ ok: true, value: { rows: [active], nextCursor: cursor } }).mockResolvedValue({ ok: true, value: { rows: [expired], nextCursor: null } });
  setup(); await open(); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("Older expired Test");
  expect(mocks.list).toHaveBeenLastCalledWith(20, cursor, "memory-token", expect.any(AbortSignal)); expect(screen.getByText("Page 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("Page 1");
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(20, null, "memory-token", expect.any(AbortSignal)));
});
it("requires exact serial, previews bigint/component identity and deliberate confirmation", async () => {
  setup(); await choose(); expect(screen.getByText("(0000123)")).toBeInTheDocument();
  fillSerial("06"); expect(screen.getByRole("alert")).toHaveTextContent("three ASCII digits");
  fillSerial("１２３"); expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeDisabled();
  fillSerial(); expect(screen.getByRole("region", { name: "Import confirmation" })).toHaveTextContent("Source components: 1");
  expect(screen.getByText(/Physical Inventory stock will not change/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeDisabled(); expect(mocks.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ })); expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeEnabled();
  fillSerial("007"); expect(screen.getByRole("checkbox", { name: /I confirm/ })).not.toBeChecked();
});
it("imports once with leading zeros and navigates only from authoritative success", async () => {
  setup(); await choose(); await confirmAndSubmit(); const link = await screen.findByRole("link", { name: "Open Product Calculator" });
  expect(mocks.import).toHaveBeenCalledTimes(1); expect(mocks.import.mock.calls[0]![0]).toMatchObject({ calculationId: active.calculationId, serialNumber: "006" });
  expect(link).toHaveAttribute("href", `/pcb/${id(6)}`); fireEvent.click(link); expect(screen.getByRole("heading", { name: "Destination Calculator" })).toBeInTheDocument();
});
it("allows an Expired Test without browser-clock status recalculation", async () => {
  setup(); await open(); fireEvent.click(screen.getByRole("radio", { name: /Older expired Test/ })); await screen.findByText("Required: 9007199254740993");
  await confirmAndSubmit(); await screen.findByRole("link", { name: "Open Product Calculator" });
  expect(mocks.import.mock.calls[0]![0].calculationId).toBe(expired.calculationId);
});
it("unknown results survive dialog closure/reload and recover only the original payload", async () => {
  mocks.import.mockResolvedValueOnce({ ok: false, error: { uncertain: true, message: "Import outcome is uncertain." } });
  const first = setup(); await choose(); await confirmAndSubmit(); await screen.findByRole("button", { name: "Recover original request" });
  const original = mocks.import.mock.calls[0]![0]; expect(readTestImportRecovery(identity)?.request).toEqual(original); first.unmount();
  setup(); fireEvent.click(await screen.findByRole("button", { name: "Import from Test" }));
  const recover = await screen.findByRole("button", { name: "Recover original request" }); expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("New output Product serial")).not.toBeInTheDocument(); fireEvent.click(recover);
  await screen.findByRole("link", { name: "Open Product Calculator" }); expect(mocks.import.mock.calls[1]![0]).toEqual(original);
});
it("shows a terminal rejection without claiming success or abandoning uncertain intent", async () => {
  mocks.import.mockResolvedValueOnce({ ok: false, error: { uncertain: false, code: "PRD06", message: "Choose a unique output serial." } });
  setup(); await choose(); await confirmAndSubmit(); expect(await screen.findByRole("alert")).toHaveTextContent("unique output serial");
  expect(screen.queryByRole("link", { name: "Open Product Calculator" })).not.toBeInTheDocument(); expect(readTestImportRecovery(identity)).toBeNull();
});
it("prevents double submits and marks an in-flight import busy", async () => {
  let finish!: (value: unknown) => void; mocks.import.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setup(); await choose(); fillSerial(); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  const button = screen.getByRole("button", { name: "Import Product Calculator" }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1)); expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  await act(async () => { finish({ ok: true, value: { ...importReceipt(), serial_number: "006" } }); });
  await screen.findByRole("link", { name: "Open Product Calculator" });
});
it("loading, empty and denied history remain distinct with explicit retry", async () => {
  mocks.list.mockImplementationOnce(() => new Promise(() => {})); const first = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Import from Test" })); expect(await screen.findByRole("status")).toHaveTextContent("Loading saved calculations"); first.unmount();
  mocks.list.mockResolvedValueOnce({ ok: true, value: { rows: [], nextCursor: null } }); const empty = setup();
  fireEvent.click(await screen.findByRole("button", { name: "Import from Test" })); await screen.findByText("No saved calculations on this page."); empty.unmount();
  mocks.list.mockResolvedValueOnce({ ok: false, error: { code: "access_denied", message: "History denied" } }); setup();
  fireEvent.click(await screen.findByRole("button", { name: "Import from Test" })); expect(await screen.findByRole("alert")).toHaveTextContent("History denied");
  fireEvent.click(screen.getByRole("button", { name: "Retry history" })); await screen.findByText("Saved Test");
});
it("denies missing combined permissions and inactive actors", async () => {
  mocks.auth.mockReturnValue({ ...auth, isAdmin: false }); mocks.permission.mockImplementation(async key => ({ ok: true, value: key !== "pcb.edit" }));
  const denied = setup(); await waitFor(() => expect(mocks.permission).toHaveBeenCalledTimes(5));
  expect(screen.queryByRole("button", { name: "Import from Test" })).not.toBeInTheDocument(); expect(mocks.list).not.toHaveBeenCalled(); denied.unmount();
  mocks.auth.mockReturnValue({ ...auth, isActive: false }); setup(); expect(screen.queryByRole("button", { name: "Import from Test" })).not.toBeInTheDocument();
});
it("keyboard Escape closes and restores the opening control", async () => {
  setup(); const opener = await screen.findByRole("button", { name: "Import from Test" }); opener.focus(); await open();
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus(); fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(opener).toHaveFocus();
});
it("switching profiles closes the old selection and never reveals it in the new scope", async () => {
  const r = setup(); await choose(); fillSerial();
  mocks.auth.mockReturnValue({ ...auth, session: { user: { id: id(60) }, access_token: "new-token" }, profile: { id: id(61), authUserId: id(60), isActive: true } });
  r.rerenderEntry(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText("Required: 9007199254740993")).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({ ok: true, value: { rows: [], nextCursor: null } });
  fireEvent.click(await screen.findByRole("button", { name: "Import from Test" })); await screen.findByText("No saved calculations on this page.");
  expect(mocks.list).toHaveBeenLastCalledWith(20, null, "new-token", expect.any(AbortSignal));
  expect(screen.getByLabelText("New output Product serial")).toHaveValue(""); expect(mocks.import).not.toHaveBeenCalled();
});
it("detail failure never substitutes zero or permits confirmation", async () => {
  mocks.detail.mockResolvedValueOnce({ ok: false, error: { code: "access_denied", message: "Denied" } });
  setup(); await open(); fireEvent.click(screen.getByRole("radio", { name: /Saved Test/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Selected Test details are unavailable"); fillSerial();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry detail" })); await screen.findByText("Required: 9007199254740993");
});
it("tab focus remains within the dialog and content uses bounded responsive scrolling", async () => {
  setup(); await choose(); fillSerial(); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  const submit = screen.getByRole("button", { name: "Import Product Calculator" }), close = screen.getByRole("button", { name: "Close" });
  submit.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(submit).toHaveFocus();
  expect(screen.getByRole("dialog").className).toContain("max-h-[90dvh]"); expect(screen.getByRole("dialog").className).toContain("overflow-y-auto");
});
it("changing the selected Test invalidates the deliberate confirmation", async () => {
  setup(); await choose(); fillSerial(); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeEnabled();
  fireEvent.click(screen.getByRole("radio", { name: /Older expired Test/ })); await screen.findByRole("heading", { name: "Older expired Test" });
  expect(screen.getByRole("checkbox", { name: /I confirm/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Import Product Calculator" })).toBeDisabled();
});
it("late details for a previous selection cannot replace the selected source", async () => {
  let finish!: (value: unknown) => void;
  mocks.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setup(); await open(); fireEvent.click(screen.getByRole("radio", { name: /Saved Test/ }));
  await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("radio", { name: /Older expired Test/ })); await screen.findByRole("heading", { name: "Older expired Test" });
  await act(async () => { finish({ ok: true, value: definition }); });
  expect(screen.getByRole("heading", { name: "Older expired Test" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Saved Test" })).not.toBeInTheDocument();
});
it("already imported Tests are never selectable even without destination permission",async()=>{
  mocks.conversions.mockImplementation(async(ids:string[])=>({as_of:active.asOf,next_expiry:null,rows:ids.map(calculation_id=>({calculation_id,imported:true,can_navigate:false,destination:null,items:[]}))}));
  setup();fireEvent.click(await screen.findByRole("button",{name:"Import from Test"}));
  await screen.findByText("All calculations on this page have already been imported.");expect(screen.queryByRole("radio")).not.toBeInTheDocument();expect(mocks.import).not.toHaveBeenCalled();
});
