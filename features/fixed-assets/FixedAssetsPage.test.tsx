import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(), invalidateQueries: vi.fn(), refetch: vi.fn(), useAuth: vi.fn(),
  list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./fixedAssetService", async (importOriginal) => ({
  ...await importOriginal<typeof import("./fixedAssetService")>(),
  listFixedAssets: mocks.list,
  createFixedAsset: mocks.create,
  updateFixedAsset: mocks.update,
  archiveFixedAsset: mocks.archive,
}));

import FixedAssetsPage from "./FixedAssetsPage";
import type { FixedAsset } from "./fixedAssetService";

const active: FixedAsset = {
  id: "00000000-0000-0000-0000-000000000001", name: "Lathe", category: "oprema",
  purchaseDate: "2026-09-16", quantity: 42, isActive: true,
  createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", archivedAt: null,
};
const archived: FixedAsset = {
  ...active, id: "00000000-0000-0000-0000-000000000002", name: "Old device",
  category: "uredjaji", isActive: false, archivedAt: "2026-09-16T00:00:00Z",
};
const toolAsset: FixedAsset = {
  ...active, id: "00000000-0000-0000-0000-000000000003", name: "Tool", category: "alati",
};

function setRows(rows: FixedAsset[]) {
  mocks.useQuery.mockReturnValue({ isPending: false, isError: false,
    data: { ok: true, value: rows }, refetch: mocks.refetch });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useAuth.mockReturnValue({ profile: { id: "admin-profile" }, isAdmin: true });
  mocks.invalidateQueries.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ ok: true, value: active.id });
  mocks.update.mockResolvedValue({ ok: true, value: active.id });
  mocks.archive.mockResolvedValue({ ok: true, value: active.id });
  setRows([active, archived, toolAsset]);
});
afterEach(cleanup);

describe("Osnovna sredstva page", () => {
  it("renders all categories, quantity, date and archived read-only state", () => {
    render(<FixedAssetsPage />);
    expect(screen.getByText("Oprema")).toBeInTheDocument();
    expect(screen.getByText("Uređaji")).toBeInTheDocument();
    expect(screen.getByText("Alati")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-16")).toHaveLength(3);
    expect(screen.getAllByText("42")).toHaveLength(3);
    const oldRow = screen.getByText("Old device").closest("tr")!;
    expect(oldRow).toHaveTextContent("Archived");
    expect(within(oldRow).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(oldRow).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByText(/restore|reactivate|delete|barcode|serial number/i)).toBeNull();
  });

  it("shows loading, retryable safe error and empty states", () => {
    mocks.useQuery.mockReturnValueOnce({ isPending: true });
    const loading = render(<FixedAssetsPage />);
    expect(screen.getByText("Loading Fixed Assets...")).toBeInTheDocument();
    loading.unmount();
    mocks.useQuery.mockReturnValueOnce({ isPending: false, isError: true, refetch: mocks.refetch });
    const error = render(<FixedAssetsPage />);
    expect(screen.getByText("Unable to load Fixed Assets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalled();
    error.unmount();
    setRows([]);
    render(<FixedAssetsPage />);
    expect(screen.getByText("No Fixed Assets")).toBeInTheDocument();
  });

  it("fails closed without Admin state and disables the data query", () => {
    mocks.useAuth.mockReturnValue({ profile: { id: "ordinary-profile" }, isAdmin: false });
    render(<FixedAssetsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.queryByRole("button", { name: "Add Asset" })).toBeNull();
  });

  it("validates name, date and positive safe integer quantity before create", async () => {
    setRows([]);
    render(<FixedAssetsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add Asset" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Naziv is required.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Naziv/ }), { target: { value: "  Lathe  " } });
    fireEvent.change(screen.getByLabelText(/Datum nabavke/), { target: { value: "2026-09-16" } });
    for (const invalid of ["0", "-1", "1.5", "9007199254740992"]) {
      fireEvent.change(screen.getByRole("textbox", { name: /Količina/ }), { target: { value: invalid } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText(/Enter a positive whole-number quantity/)).toBeInTheDocument();
      expect(mocks.create).not.toHaveBeenCalled();
    }
    fireEvent.change(screen.getByRole("textbox", { name: /Količina/ }), { target: { value: "0007" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      name: "Lathe", category: "oprema", purchaseDate: "2026-09-16", quantity: "7",
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["fixed-assets", "admin-profile", "list"], exact: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks duplicate submission while a trusted create is pending", async () => {
    setRows([]);
    let finish: (value: { ok: true; value: string }) => void = () => undefined;
    mocks.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<FixedAssetsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add Asset" }));
    fireEvent.change(screen.getByLabelText("Naziv"), { target: { value: "Lathe" } });
    fireEvent.change(screen.getByLabelText("Datum nabavke"), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText("Količina"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish({ ok: true, value: active.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits only active assets and preserves safe error display", async () => {
    render(<FixedAssetsPage />);
    fireEvent.click(within(screen.getByText("Lathe").closest("tr")!).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Naziv")).toHaveValue("Lathe");
    expect(screen.getByLabelText("Količina")).toHaveValue("42");
    mocks.update.mockResolvedValueOnce({ ok: false, error: "Archived Fixed Assets cannot be changed." });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Archived Fixed Assets cannot be changed.")).toBeInTheDocument();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(active.id, expect.objectContaining({ quantity: "42" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["fixed-assets", "admin-profile", "list"], exact: true,
    });
  });

  it("requires archive confirmation and invalidates only the Fixed Asset list", async () => {
    render(<FixedAssetsPage />);
    fireEvent.click(within(screen.getByText("Lathe").closest("tr")!).getByRole("button", { name: "Archive" }));
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(screen.getByText(/historical and read-only/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.archive).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByText("Lathe").closest("tr")!).getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith(active.id));
    expect(mocks.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["fixed-assets", "admin-profile", "list"], exact: true,
    });
  });
});
