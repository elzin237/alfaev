import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));

import PcbBomEditor from "./PcbBomEditor";
import type { PcbBomDetail } from "../services/pcbBomService";

const cardId = "11111111-1111-4111-8111-111111111111";
const archivedId = "22222222-2222-4222-8222-222222222222";
const activeId = "33333333-3333-4333-8333-333333333333";
const newId = "44444444-4444-4444-8444-444444444444";

const detail: PcbBomDetail = {
  cardId, name: "Controller", isActive: true,
  outputProductId: "55555555-5555-4555-8555-555555555555",
  outputSerialNumber: "0000001", outputCurrentStock: "0",
  versionId: "66666666-6666-4666-8666-666666666666", versionNumber: 1,
  items: [
    { itemId: "77777777-7777-4777-8777-777777777777", productId: archivedId,
      name: "Historical PCB", serialNumber: "0000002", productKind: "pcb_finished_good",
      isActive: false, currentStock: "2", quantityPerCard: "3" },
    { itemId: "88888888-8888-4888-8888-888888888888", productId: activeId,
      name: "Active Component", serialNumber: "0000003", productKind: "component",
      isActive: true, currentStock: "7", quantityPerCard: "2" },
  ],
};

const choices = [
  { productId: newId, name: "New PCB Input", serialNumber: "0000004",
    productKind: "pcb_finished_good", currentStock: "5" },
  { productId: activeId, name: "Active Component", serialNumber: "0000003",
    productKind: "component", currentStock: "7" },
  { productId: detail.outputProductId, name: "Own Output", serialNumber: "0000001",
    productKind: "pcb_finished_good", currentStock: "0" },
];

describe("PCB BOM editor", () => {
  const onSave = vi.fn();
  beforeEach(() => {
    mocks.useQuery.mockReturnValue({ isPending: false, isError: false,
      data: { ok: true, value: choices }, refetch: vi.fn() });
    onSave.mockResolvedValue({ ok: true, value: { versionId: detail.versionId, versionNumber: 1 } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renders both kinds, stock, serial and an unchanged archived input read-only", () => {
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    expect(screen.getByText("Historical PCB")).toBeInTheDocument();
    expect(screen.getByText("PCB finished good")).toBeInTheDocument();
    expect(screen.getByText("Active Component")).toBeInTheDocument();
    expect(screen.getByText("0000002")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByLabelText("Qty per Card for Historical PCB")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save BOM" })).toBeDisabled();
  });

  it("is fully read-only without edit authority", () => {
    render(<PcbBomEditor detail={detail} canEdit={false} profileId="profile" onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "Add Product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save BOM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Qty per Card for/)).not.toBeInTheDocument();
  });

  it("does not treat BOM row order alone as a change", () => {
    render(<PcbBomEditor detail={{ ...detail, items: [...detail.items].reverse() }}
      canEdit profileId="profile" onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save BOM" })).toBeDisabled();
  });

  it("saves an unrelated quantity change with archived input unchanged", async () => {
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Qty per Card for Active Component"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { productId: archivedId, quantityPerCard: "3" },
      { productId: activeId, quantityPerCard: "4" },
    ]));
    expect(screen.getByRole("status")).toHaveTextContent("version 1 saved");
  });

  it("allows removing an archived input and an empty initial save", async () => {
    const view = render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { productId: activeId, quantityPerCard: "2" },
    ]));
    view.unmount();
    onSave.mockClear();
    render(<PcbBomEditor detail={{ ...detail, versionId: null, versionNumber: null, items: [] }}
      canEdit profileId="profile" onSave={onSave} />);
    expect(screen.getByText("No BOM inputs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });

  it("searches narrow choices and excludes own output and already selected Products", async () => {
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    expect(screen.getByLabelText("Search Products")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search Products"), { target: { value: "  New PCB  " } });
    await waitFor(() => expect(mocks.useQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["pcb", "bom-choices", "profile", cardId, "New PCB"],
    })));
    expect(screen.getByRole("button", { name: /New PCB Input/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Own Output/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Active Component/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New PCB Input/ }));
    expect(screen.getByText("New PCB Input")).toBeInTheDocument();
    expect(screen.getByLabelText("Qty per Card for New PCB Input")).toHaveValue("1");
  });

  it("preserves an unchanged huge archived quantity through an unrelated save", async () => {
    const huge = "9223372036854775807";
    const withHuge = { ...detail, items: [{ ...detail.items[0]!, quantityPerCard: huge }, detail.items[1]!] };
    render(<PcbBomEditor detail={withHuge} canEdit profileId="profile" onSave={onSave} />);
    expect(screen.getByText(huge)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save BOM" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Qty per Card for Active Component"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { productId: archivedId, quantityPerCard: huge },
      { productId: activeId, quantityPerCard: "4" },
    ]));
  });

  it("allows editing an active quantity to exact PostgreSQL bigint max", async () => {
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Qty per Card for Active Component"), {
      target: { value: "9223372036854775807" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { productId: archivedId, quantityPerCard: "3" },
      { productId: activeId, quantityPerCard: "9223372036854775807" },
    ]));
  });

  it.each(["0", "-2", "1.5", "1e3", "abc", "9223372036854775808"])(
    "rejects invalid Qty per Card %s", async (quantity) => {
      render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Qty per Card for Active Component"), { target: { value: quantity } });
      fireEvent.click(screen.getByRole("button", { name: "Save BOM" }));
      expect(screen.getByRole("alert")).toHaveTextContent("positive whole number");
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("blocks duplicate submit and displays only a safe service error", async () => {
    let resolve: ((value: { ok: false; error: { code: "save_failed"; message: string } }) => void) | undefined;
    onSave.mockReturnValue(new Promise((finish) => { resolve = finish; }));
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Qty per Card for Active Component"), { target: { value: "4" } });
    const button = screen.getByRole("button", { name: "Save BOM" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolve?.({ ok: false, error: { code: "save_failed", message: "PCB BOM could not be saved." } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be saved"));
  });

  it("fails Product choices closed on lookup error", () => {
    mocks.useQuery.mockReturnValue({ isPending: false, isError: true, refetch: vi.fn() });
    render(<PcbBomEditor detail={detail} canEdit profileId="profile" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    expect(screen.getByText("Product choices could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New PCB Input/ })).not.toBeInTheDocument();
  });
});
