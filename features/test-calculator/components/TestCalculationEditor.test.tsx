import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), useAuth: vi.fn() }));
vi.mock("../services/testCalculatorSearchService", () => ({ searchTestCalculatorProducts: mocks.search }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
import TestCalculationEditor from "./TestCalculationEditor";
import type { TestCalculationDraft } from "../testCalculationDraft";
const product = { productId: "10000000-0000-4000-8000-000000000001", name: "Component A", serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg" } as const;
const initial: TestCalculationDraft = { name: "Test", deadlineDate: "2090-01-01", items: [{ product, quantity: "1" }] };
const renderEditor = (props: React.ComponentProps<typeof TestCalculationEditor> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TestCalculationEditor {...props} />
  </QueryClientProvider>);
const search = () => fireEvent.change(screen.getByLabelText("Search eligible Products"), { target: { value: "Component" } });
beforeEach(() => {
  mocks.useAuth.mockReturnValue({ session: { user: { id: "auth-a" } }, profile: { id: "profile-a", authUserId: "auth-a", isActive: true }, isActive: true, isLoading: false, error: null });
  mocks.search.mockResolvedValue({ ok: true, value: [product] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Test Calculation editor", () => {
  it("validates required fields and never enables Save", () => {
    const onProve = vi.fn(); renderEditor({ onProve });
    fireEvent.click(screen.getByRole("button", { name: "Prove Calculation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Calculation name is required");
    expect(screen.getByRole("alert")).toHaveTextContent("valid Sarajevo deadline");
    expect(screen.getByRole("alert")).toHaveTextContent("Select 1 to 100");
    expect(screen.getByRole("button", { name: "Save Test Calculation" })).toBeDisabled();
    expect(screen.getByLabelText("Search eligible Products")).toBeDisabled();
    expect(mocks.search).not.toHaveBeenCalled(); expect(onProve).not.toHaveBeenCalled();
  });
  it("searches via the mocked service, adds/removes and rejects duplicate selections", async () => {
    const invalidate = vi.fn(); renderEditor({ searchEnabledAfterActivation: true, onPreviewInvalidated: invalidate }); search();
    fireEvent.click(await screen.findByRole("button", { name: "Add Component A" }));
    expect(screen.getByLabelText("Required quantity for Component A")).toHaveValue("1");
    expect(screen.getAllByText("0000123").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Add Component A" }));
    expect(screen.getByRole("alert")).toHaveTextContent("only be selected once");
    expect(screen.getAllByRole("button", { name: "Remove Component A" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Component A" }));
    expect(screen.queryByLabelText("Required quantity for Component A")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("preserves bigint strings at the draft-only Prove boundary and invalidates on every edit", () => {
    const onProve = vi.fn(), invalidate = vi.fn(); renderEditor({ initialDraft: initial, onProve, onPreviewInvalidated: invalidate });
    fireEvent.change(screen.getByLabelText("Required quantity for Component A"), { target: { value: "9223372036854775807" } });
    fireEvent.click(screen.getByRole("button", { name: "Prove Calculation" }));
    expect(onProve).toHaveBeenCalledWith({ ...initial, items: [{ product, quantity: "9223372036854775807" }] });
    expect(screen.getByRole("status")).toHaveTextContent("Preview is not enabled");
    for (const [label,value] of [["Calculation name","Changed"],["Deadline (Europe/Sarajevo)","2090-02-01"],["Required quantity for Component A","9007199254740993"]])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    expect(invalidate).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(/Preview is not enabled/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Test Calculation" })).toBeDisabled();
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it.each(["0","1.2","1e4","-1","9223372036854775808"])("rejects invalid quantity %s visibly", quantity => {
    const prove = vi.fn(); renderEditor({ initialDraft: initial, onProve: prove });
    fireEvent.change(screen.getByLabelText("Required quantity for Component A"), { target: { value: quantity } });
    fireEvent.click(screen.getByRole("button", { name: "Prove Calculation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("positive whole number"); expect(prove).not.toHaveBeenCalled();
  });
  it("blocks a 101st Product without changing the draft", async () => {
    const items = Array.from({ length: 100 }, (_,i) => ({ product: { ...product, productId: `20000000-0000-4000-8000-${String(i).padStart(12,"0")}` }, quantity: "1" }));
    const invalidate = vi.fn(); renderEditor({ initialDraft: { ...initial, items }, searchEnabledAfterActivation: true, onPreviewInvalidated: invalidate }); search();
    fireEvent.click(await screen.findByRole("button", { name: "Add Component A" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Select 1 to 100"); expect(invalidate).not.toHaveBeenCalled();
  });
  it("shows loading then empty results without inventing selectable Products", async () => {
    let finish!: (value: unknown) => void; mocks.search.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderEditor({ searchEnabledAfterActivation: true }); search();
    expect(screen.getByRole("status")).toHaveTextContent("Searching eligible Products");
    await waitFor(() => expect(mocks.search).toHaveBeenCalled()); finish({ ok: true, value: [] });
    expect(await screen.findByText("No eligible Products found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });
  it("shows permission denial and no stale selectable results", async () => {
    mocks.search.mockResolvedValue({ ok: false, error: { code: "access_denied", message: "Test Product access denied." } });
    renderEditor({ searchEnabledAfterActivation: true }); search();
    expect(await screen.findByRole("alert")).toHaveTextContent("Test Product access denied");
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });
});
