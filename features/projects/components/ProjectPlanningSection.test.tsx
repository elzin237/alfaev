import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useProjectPlanning: vi.fn(),
  useProjectFinishedGoods: vi.fn(),
  fgQuery: { isError: false, data: { ok: true, value: [] } } as Record<string, unknown>,
  refetch: vi.fn(),
  choicesRefetch: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  removeGroup: vi.fn(),
  createRequirement: vi.fn(),
  updateRequirement: vi.fn(),
  removeRequirement: vi.fn(),
}));
vi.mock("../hooks/useProjectPlanning", () => ({
  useProjectPlanning: mocks.useProjectPlanning,
}));
vi.mock("../hooks/useProjectFinishedGoods", () => ({
  useProjectFinishedGoods: mocks.useProjectFinishedGoods,
}));

import { ProjectPlanningSection } from "./ProjectPlanningSection";
import type { ProjectPlanningGroup } from "../services/projectPlanningService";

const projectId = "00000000-0000-4000-8000-000000000001";
const groupId = "00000000-0000-4000-8000-000000000002";
const componentId = "00000000-0000-4000-8000-000000000003";
const productId = "00000000-0000-4000-8000-000000000004";
const pcbId = "00000000-0000-4000-8000-000000000005";

const groups: ProjectPlanningGroup[] = [{
  id: groupId,
  projectId,
  name: "B24",
  requirements: [
    {
      id: componentId,
      productId,
      serialNumber: "0000123",
      productName: "Relay",
      productKind: "component",
      requiredQuantity: 50n,
      inventoryContext: {
        category: "Control",
        brandName: "Bosch",
        physicalQuantity: 10n,
        committedToProjects: 16n,
        availableAfterCommitments: -6n,
      },
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      productId: pcbId,
      serialNumber: "0000456",
      productName: "PCB Output",
      productKind: "pcb_finished_good",
      requiredQuantity: 20n,
      inventoryContext: {
        category: "PCB",
        brandName: null,
        physicalQuantity: 30n,
        committedToProjects: 10n,
        availableAfterCommitments: 20n,
      },
    },
  ],
}];

function setPlanningState(options: {
  canManage?: boolean;
  data?: { ok: true; value: ProjectPlanningGroup[] } |
    { ok: false; error: { code: string; message: string } };
  isPending?: boolean;
  isError?: boolean;
  choiceData?: { ok: true; value: Array<{
    productId: string; serialNumber: string; name: string;
    productKind: "component" | "pcb_finished_good";
  }> };
  choicePending?: boolean;
  choiceError?: boolean;
} = {}) {
  mocks.useProjectPlanning.mockReturnValue({
    finishedGoodsCommitmentsQuery: mocks.fgQuery,
    planningQuery: {
      data: options.data ?? { ok: true, value: groups },
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      refetch: mocks.refetch,
    },
    choicesQuery: {
      data: options.choiceData ?? { ok: true, value: [
        { productId, serialNumber: "0000123", name: "Relay", productKind: "component" },
        { productId: pcbId, serialNumber: "0000456", name: "PCB Output", productKind: "pcb_finished_good" },
      ] },
      isPending: options.choicePending ?? false,
      isError: options.choiceError ?? false,
      refetch: mocks.choicesRefetch,
    },
    canManage: options.canManage ?? false,
    createGroup: mocks.createGroup,
    updateGroup: mocks.updateGroup,
    removeGroup: mocks.removeGroup,
    createRequirement: mocks.createRequirement,
    updateRequirement: mocks.updateRequirement,
    removeRequirement: mocks.removeRequirement,
  });
}

beforeEach(() => {
  mocks.fgQuery = { isError: false, data: { ok: true, value: [{ productId: pcbId,
    physicalQuantity: 4n, committedToProjects: 3n, availableAfterCommitments: 1n }] } };
  const success = { ok: true, value: { id: groupId } };
  for (const name of [
    "createGroup", "updateGroup", "removeGroup", "createRequirement",
    "updateRequirement", "removeRequirement",
  ] as const) {
    mocks[name].mockResolvedValue(success);
  }
  setPlanningState();
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectPlanningSection", () => {
  it("uses compact centered requirement columns with accessible global-figure descriptions", () => {
    setPlanningState({ canManage: true });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map(header => header.getAttribute("aria-label"))).toEqual([
      "Serial", "Product", "Kind", "Category", "Brand", "Required", "Committed", "Available", "Shortage", "Actions",
    ]);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveClass("text-center", "px-2", "py-3", "whitespace-nowrap");
      const help = header.querySelector("[tabindex='0']")!;
      expect(help).toHaveAttribute("title"); expect(help).toHaveClass("focus-visible:outline-2");
      expect(document.getElementById(help.getAttribute("aria-describedby")!)).toHaveAttribute("role", "tooltip");
    }
    expect(within(table).getByRole("columnheader", { name: "Committed" })).toHaveAccessibleDescription(/Committed to Projects \(global\).*hard FG Project reservations/);
    expect(within(table).getByRole("columnheader", { name: "Available" })).toHaveAccessibleDescription(/Available After Commitments \(global\).*Raw \+ Customs.*FG physical/);
    expect(within(table).getByRole("columnheader", { name: "Shortage" })).toHaveAccessibleDescription(/Global shared shortage.*Not specific to this requirement row/);
    for (const record of within(table).getAllByRole("row").slice(1)) {
      for (const cell of [within(record).getByRole("rowheader"), ...within(record).getAllByRole("cell")]) expect(cell).toHaveClass("text-center", "px-2", "py-3");
      const cells = within(record).getAllByRole("cell");
      for (const cell of cells.slice(4, 8)) expect(cell).toHaveClass("min-w-24", "tabular-nums");
      expect(within(record).getByRole("button", { name: "Edit Requirement" }).parentElement).toHaveClass("justify-center");
    }
    expect(table).toHaveClass("min-w-full");
    expect(table).not.toHaveClass("min-w-[72rem]");
    expect(screen.getByTestId(`requirements-scroll-${groupId}`)).toHaveClass("overflow-auto", "max-h-[28rem]");
    expect(mocks.updateRequirement).not.toHaveBeenCalled();
  });

  it("shows compact requirement totals and starts collapsed", () => {
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    const section = screen.getByRole("region", { name: "Products" });
    const productScroll = screen.getByTestId("project-products-scroll");
    expect(productScroll).toHaveClass(
      "max-h-[50rem]", "max-w-full", "overflow-x-hidden", "overflow-y-auto",
    );
    expect(productScroll).not.toHaveClass("h-[50rem]", "min-h-[50rem]");
    expect(within(section).getByRole("heading", { name: "B24" })).toBeInTheDocument();
    expect(within(section).getByText("Requirements: 2")).toBeInTheDocument();
    expect(within(section).queryByText(/Raw \+ Customs/)).not.toBeInTheDocument();
    const toggle = within(section).getByRole("button", { name: "Show 2 requirements" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the Products header outside a bounded list while rendering every Product card", () => {
    const manyGroups = Array.from({ length: 8 }, (_, index): ProjectPlanningGroup => ({
      ...groups[0]!,
      id: `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
      name: `Product ${index + 1}`,
      requirements: groups[0]!.requirements.map((requirement, requirementIndex) => ({
        ...requirement,
        id: `00000000-0000-4000-8001-${String(index * 10 + requirementIndex).padStart(12, "0")}`,
      })),
    }));
    setPlanningState({ canManage: true, data: { ok: true, value: manyGroups } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);

    const section = screen.getByRole("region", { name: "Products" });
    const productScroll = screen.getByTestId("project-products-scroll");
    const header = within(section).getByRole("heading", { name: "Products" });
    const addProduct = within(section).getByRole("button", { name: "Add Product" });
    expect(productScroll).not.toContainElement(header);
    expect(productScroll).not.toContainElement(addProduct);
    for (const group of manyGroups) {
      expect(within(productScroll).getByRole("heading", { name: group.name }))
        .toBeInTheDocument();
    }
    expect(within(productScroll).queryByRole("button", { name: /next|previous/i }))
      .not.toBeInTheDocument();
  });

  it("expands and collapses the Inventory-style requirements table with authoritative values", () => {
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    const toggle = screen.getByRole("button", { name: "Show 2 requirements" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide requirements");
    const table = screen.getByRole("table");
    for (const heading of [
      "Serial", "Product", "Kind", "Category", "Brand", "Required",
      "Committed", "Available", "Shortage",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    const shortageRow = within(table).getByRole("row", { name: /0000123/ });
    expect(shortageRow).toHaveTextContent("Relay");
    expect(shortageRow).toHaveTextContent("Component");
    expect(shortageRow).toHaveTextContent("Control");
    expect(shortageRow).toHaveTextContent("Bosch");
    expect(shortageRow).toHaveTextContent("50");
    expect(within(shortageRow).getAllByRole("cell").map(cell => cell.textContent))
      .toEqual(["Relay", "Component", "Control", "Bosch", "50", "16", "-6", "6"]);
    expect(within(shortageRow).getByText("6")).toHaveClass("text-red-700");
    const coveredRow = within(table).getByRole("row", { name: /0000456/ });
    expect(coveredRow).toHaveTextContent("PCB Output");
    expect(coveredRow).toHaveTextContent("Finished PCB Product");
    expect(within(coveredRow).getAllByRole("cell").map(cell => cell.textContent))
      .toEqual(["PCB Output", "Finished PCB Product", "PCB", "—", "20", "3", "1", "6"]);
    expect(within(coveredRow).getByText("6")).toHaveClass("text-red-700");
    expect(mocks.useProjectFinishedGoods).not.toHaveBeenCalled();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
    expect(within(table).getByText(/global figures across Projects/)).toBeInTheDocument();
    for (const name of ["FG Reserved", "FG Shortage"])
      expect(within(table).queryByRole("columnheader", { name })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Eligible Stock (Raw + Customs)" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Raw + Customs planning shortage" })).not.toBeInTheDocument();
    expect(within(table).queryByText(/Shortage:/)).not.toBeInTheDocument();
    expect(coveredRow).not.toHaveClass("text-red-700");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    { isPending: true },
    { isError: true, data: { ok: true, value: [{ productId: pcbId, physicalQuantity: 4n, committedToProjects: 3n, availableAfterCommitments: 1n }] } },
    { data: { ok: false, error: { message: "Access denied" } } },
    { data: { ok: true, value: [] } },
  ])("never substitutes Raw + Customs or fabricated zeros for unavailable FG aggregates: case %#", query => {
    mocks.fgQuery = query;
    setPlanningState();
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    const row = screen.getByRole("row", { name: /0000456/ });
    expect(within(row).getAllByRole("cell").slice(-3).map(cell => cell.textContent))
      .toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(within(screen.getByRole("row", { name: /0000123/ })).getAllByRole("cell").slice(-3).map(cell => cell.textContent))
      .toEqual(["16", "-6", "6"]);
  });

  it("keeps global FG demand and stock lossless and does not use the requirement row quantity", () => {
    const demand = 900719925474099312345n;
    const requirements = groups[0]!.requirements.map(r => r.productKind === "pcb_finished_good" ? {
      ...r, requiredQuantity: 8n, inventoryContext: { ...r.inventoryContext!,
        physicalQuantity: 999999999999999999999n, committedToProjects: demand,
        availableAfterCommitments: 999999999999999999999n - demand },
    } : r);
    mocks.fgQuery = { data: { ok: true, value: [{ productId: pcbId, physicalQuantity: 9007199254740993n,
      committedToProjects: 9007199254740992n, availableAfterCommitments: 1n }] } };
    setPlanningState({ data: { ok: true, value: [{ ...groups[0]!, requirements }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    expect(within(screen.getByRole("row", { name: /0000456/ })).getAllByRole("cell").slice(-4).map(cell => cell.textContent))
      .toEqual(["8", "9007199254740992", "1", (demand - 9007199254740993n).toString()]);
  });

  it("shows FG reservation and availability but not shortage when global demand is permission-redacted", () => {
    const requirements = groups[0]!.requirements.map(r => ({ ...r, inventoryContext: null }));
    setPlanningState({ data: { ok: true, value: [{ ...groups[0]!, requirements }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    expect(within(screen.getByRole("row", { name: /0000456/ })).getAllByRole("cell").slice(-3).map(cell => cell.textContent))
      .toEqual(["3", "1", "Unavailable"]);
    expect(within(screen.getByRole("row", { name: /0000123/ })).getAllByRole("cell").slice(-3).map(cell => cell.textContent))
      .toEqual(["Unavailable", "Unavailable", "Unavailable"]);
  });

  it("edits Required quantity inline with bigint-safe text and refreshes authoritative context", async () => {
    const quantity = "9007199254740993";
    const updatedGroups: ProjectPlanningGroup[] = [{
      ...groups[0]!,
      requirements: [{
        ...groups[0]!.requirements[0]!,
        requiredQuantity: BigInt(quantity),
        inventoryContext: {
          category: "Control",
          brandName: "Bosch",
          physicalQuantity: 20n,
          committedToProjects: 16n,
          availableAfterCommitments: 4n,
        },
      }, groups[0]!.requirements[1]!],
    }];
    setPlanningState({ canManage: true });
    mocks.updateRequirement.mockImplementationOnce(async () => {
      setPlanningState({ canManage: true, data: { ok: true, value: updatedGroups } });
      return { ok: true, value: { id: componentId } };
    });
    const view = render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit required quantity for Relay" }));
    const input = screen.getByLabelText("Required quantity for Relay");
    expect(input).toHaveValue(50);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: quantity } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(mocks.updateRequirement).toHaveBeenCalledWith(
      componentId, productId, quantity,
    ));
    view.rerender(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByRole("button", { name: "Edit required quantity for Relay" }))
      .toHaveTextContent(quantity);
    expect(screen.getByRole("status")).toHaveTextContent("Requirement quantity updated.");
    expect(screen.queryByText(/Raw \+ Customs planning shortages:/)).not.toBeInTheDocument();
  });

  it("cancels inline quantity editing without mutation and restores trigger focus", async () => {
    setPlanningState({ canManage: true });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    const trigger = screen.getByRole("button", { name: "Edit required quantity for Relay" });
    fireEvent.click(trigger);
    const input = screen.getByLabelText("Required quantity for Relay");
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.updateRequirement).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Required quantity for Relay")).not.toBeInTheDocument();
    const restoredTrigger = screen.getByRole("button", { name: "Edit required quantity for Relay" });
    await waitFor(() => expect(restoredTrigger).toHaveFocus());

    fireEvent.click(restoredTrigger);
    fireEvent.keyDown(screen.getByLabelText("Required quantity for Relay").closest("form")!, {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Required quantity for Relay")).not.toBeInTheDocument();
    expect(mocks.updateRequirement).not.toHaveBeenCalled();
  });

  it("rejects invalid inline quantities and keeps safe failures in edit context", async () => {
    setPlanningState({ canManage: true });
    mocks.updateRequirement.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "mutation_failed",
        message: "The Project plan could not be changed. Please try again.",
      },
    });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit required quantity for Relay" }));
    const input = screen.getByLabelText("Required quantity for Relay");
    for (const invalid of ["0", "-1", "1.5", "9223372036854775808"]) {
      fireEvent.change(input, { target: { value: invalid } });
      fireEvent.submit(input.closest("form")!);
      expect(screen.getByRole("alert")).toHaveTextContent("positive whole number");
      expect(mocks.updateRequirement).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "The Project plan could not be changed. Please try again.",
    ));
    expect(input).toHaveValue(35);
    expect(screen.queryByText(/postgres|supabase/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Requirement quantity updated.")).not.toBeInTheDocument();
  });

  it("prevents duplicate inline quantity saves while the trusted update is pending", async () => {
    let resolveUpdate!: (result: { ok: true; value: { id: string } }) => void;
    mocks.updateRequirement.mockReturnValueOnce(new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    setPlanningState({ canManage: true });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit required quantity for Relay" }));
    const input = screen.getByLabelText("Required quantity for Relay");
    fireEvent.change(input, { target: { value: "35" } });
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.updateRequirement).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolveUpdate({ ok: true, value: { id: componentId } }));
    await waitFor(() => expect(screen.queryByLabelText("Required quantity for Relay"))
      .not.toBeInTheDocument());
  });

  it("shows empty Project and empty requirement states", () => {
    setPlanningState({ data: { ok: true, value: [] } });
    const empty = render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByText("No Project Products yet")).toBeInTheDocument();
    empty.unmount();
    setPlanningState({ data: { ok: true, value: [{ ...groups[0]!, requirements: [] }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByText(/No component requirements planned/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /requirements/i })).not.toBeInTheDocument();
  });

  it("keeps expansion independent per Project Product and uses native keyboard-focusable buttons", () => {
    const secondGroup: ProjectPlanningGroup = {
      ...groups[0]!,
      id: "00000000-0000-4000-8000-000000000020",
      name: "B25",
      requirements: [{
        ...groups[0]!.requirements[0]!,
        id: "00000000-0000-4000-8000-000000000021",
      }],
    };
    setPlanningState({ data: { ok: true, value: [groups[0]!, secondGroup] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    const first = screen.getByRole("button", { name: "Show 2 requirements" });
    const second = screen.getByRole("button", { name: "Show 1 requirement" });
    expect(first.tagName).toBe("BUTTON");
    first.focus();
    expect(first).toHaveFocus();
    fireEvent.click(first, { detail: 0 });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "true");
  });

  it("bounds large expanded requirement sets inside a sticky, horizontally contained table", () => {
    const requirements = Array.from({ length: 100 }, (_, index) => ({
      ...groups[0]!.requirements[0]!,
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      serialNumber: String(index + 1).padStart(7, "0"),
    }));
    setPlanningState({ data: { ok: true, value: [{ ...groups[0]!, requirements }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 100 requirements" }));
    const productScroll = screen.getByTestId("project-products-scroll");
    const scroll = screen.getByTestId(`requirements-scroll-${groupId}`);
    expect(productScroll).toContainElement(scroll);
    expect(productScroll).toHaveClass("max-h-[50rem]", "overflow-y-auto");
    expect(scroll).toHaveClass("max-h-[28rem]", "max-w-full", "overflow-auto");
    expect(scroll.querySelector("thead")).toHaveClass("sticky", "top-0");
    expect(within(scroll).getAllByRole("row")).toHaveLength(101);
  });

  it("omits shortage totals and marks Inventory context unavailable when not authorized", () => {
    const requirements = groups[0]!.requirements.map((requirement) => ({
      ...requirement,
      inventoryContext: null,
    }));
    setPlanningState({ data: { ok: true, value: [{ ...groups[0]!, requirements }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByText("Requirements: 2")).toBeInTheDocument();
    expect(screen.queryByText(/Raw \+ Customs planning shortages:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("shows loading, safe read error and retry", () => {
    setPlanningState({ isPending: true });
    const loading = render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Project Products");
    loading.unmount();
    setPlanningState({
      data: { ok: false, error: { code: "load_failed", message: "The Project plan could not be loaded." } },
    });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    expect(screen.getByRole("alert")).toHaveTextContent("The Project plan could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("hides every mutation control in read-only states, including closed Projects", () => {
    for (const status of ["planned", "completed", "cancelled"] as const) {
      const view = render(<ProjectPlanningSection projectId={projectId} status={status} />);
      expect(screen.queryByRole("button", { name: "Add Product" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Requirement" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit Requirement" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
      expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Edit required quantity/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove Requirement" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("creates and renames a Project Product, allowing duplicate names and trimming input", async () => {
    setPlanningState({ canManage: true });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    const dialog = screen.getByRole("dialog", { name: "Add Product" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Name is required");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  B24  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));
    await waitFor(() => expect(mocks.createGroup).toHaveBeenCalledWith("B24"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Product" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const edit = screen.getByRole("dialog", { name: "Rename Project Product" });
    expect(within(edit).getByLabelText("Name")).toHaveValue("B24");
    fireEvent.change(within(edit).getByLabelText("Name"), { target: { value: "  B25  " } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save Name" }));
    await waitFor(() => expect(mocks.updateGroup).toHaveBeenCalledWith(groupId, "B25"));
  });

  it("requires explicit removal and keeps child-present errors visible", async () => {
    setPlanningState({ canManage: true });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Product" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Project Product" }))
      .getByRole("button", { name: "Cancel" }));
    expect(mocks.removeGroup).not.toHaveBeenCalled();
    mocks.removeGroup.mockResolvedValueOnce({
      ok: false,
      error: { code: "children_present", message: "Remove all component requirements before removing this Project Product." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Product" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Project Product" }))
      .getByRole("button", { name: "Remove Product" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "Remove all component requirements",
    ));
  });

  it("uses trusted Product choices, validates quantity, and adds a requirement", async () => {
    setPlanningState({ canManage: true, data: { ok: true, value: [{ ...groups[0]!, requirements: [] }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    const dialog = screen.getByRole("dialog", { name: "Add Requirement" });
    expect(within(dialog).getByRole("option", { name: /0000123.*Relay/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /0000456.*PCB Output/ })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Product"), { target: { value: productId } });
    for (const quantity of ["0", "-1", "1.5"]) {
      fireEvent.change(within(dialog).getByLabelText("Required Quantity"), { target: { value: quantity } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Requirement" }));
      expect(within(dialog).getByRole("alert")).toHaveTextContent("positive whole number");
    }
    fireEvent.change(within(dialog).getByLabelText("Required Quantity"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(mocks.createRequirement).toHaveBeenCalledWith(groupId, productId, "5"));
  });

  it("preserves an existing historical Product choice while editing and confirms removal", async () => {
    setPlanningState({ canManage: true, choiceData: { ok: true, value: [{
      productId: pcbId, serialNumber: "0000456", name: "PCB Output",
      productKind: "pcb_finished_good",
    }] } });
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 requirements" }));
    const editButtons = screen.getAllByRole("button", { name: "Edit Requirement" });
    fireEvent.click(editButtons[0]!);
    const dialog = screen.getByRole("dialog", { name: "Edit Requirement" });
    expect(within(dialog).getByRole("option", { name: /current historical Product/ }))
      .toHaveValue(productId);
    expect(within(dialog).getByLabelText("Product")).toHaveValue(productId);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(mocks.updateRequirement).toHaveBeenCalledWith(componentId, productId, "50"));
    const removeButtons = screen.getAllByRole("button", { name: "Remove Requirement" });
    fireEvent.click(removeButtons[0]!);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Requirement" }))
      .getByRole("button", { name: "Remove Requirement" }));
    await waitFor(() => expect(mocks.removeRequirement).toHaveBeenCalledWith(componentId));
  });
});
