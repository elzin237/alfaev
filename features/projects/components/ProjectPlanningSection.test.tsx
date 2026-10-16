import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useProjectPlanning: vi.fn(),
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
  it("shows compact requirement totals and starts collapsed", () => {
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    const section = screen.getByRole("region", { name: "Products" });
    expect(within(section).getByRole("heading", { name: "B24" })).toBeInTheDocument();
    expect(within(section).getByText("Requirements: 2")).toBeInTheDocument();
    expect(within(section).getByText("Shortages: 1")).toBeInTheDocument();
    expect(within(section).getByText("Covered: 1")).toBeInTheDocument();
    const toggle = within(section).getByRole("button", { name: "Show 2 requirements" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
  });

  it("expands and collapses the Inventory-style requirements table with authoritative values", () => {
    render(<ProjectPlanningSection projectId={projectId} status="planned" />);
    const toggle = screen.getByRole("button", { name: "Show 2 requirements" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide requirements");
    const table = screen.getByRole("table");
    for (const heading of [
      "Serial Number", "Product", "Kind", "Category", "Brand", "Required",
      "Physical Quantity", "Committed to Projects",
      "Available After Commitments", "Shortage",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    const shortageRow = within(table).getByRole("row", { name: /0000123/ });
    expect(shortageRow).toHaveTextContent("Relay");
    expect(shortageRow).toHaveTextContent("Component");
    expect(shortageRow).toHaveTextContent("Control");
    expect(shortageRow).toHaveTextContent("Bosch");
    expect(shortageRow).toHaveTextContent("50");
    expect(shortageRow).toHaveTextContent("10");
    expect(shortageRow).toHaveTextContent("16");
    expect(shortageRow).toHaveTextContent("-6");
    expect(shortageRow).toHaveTextContent("Shortage: 6");
    const coveredRow = within(table).getByRole("row", { name: /0000456/ });
    expect(coveredRow).toHaveTextContent("PCB Output");
    expect(coveredRow).toHaveTextContent("Finished PCB Product");
    expect(coveredRow).toHaveTextContent("None");
    expect(coveredRow).not.toHaveClass("text-red-700");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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
    const scroll = screen.getByTestId(`requirements-scroll-${groupId}`);
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
    expect(screen.queryByText(/Shortages:/)).not.toBeInTheDocument();
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
    await waitFor(() => expect(mocks.createRequirement).toHaveBeenCalledWith(groupId, productId, 5));
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
    await waitFor(() => expect(mocks.updateRequirement).toHaveBeenCalledWith(componentId, productId, 50));
    const removeButtons = screen.getAllByRole("button", { name: "Remove Requirement" });
    fireEvent.click(removeButtons[0]!);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Requirement" }))
      .getByRole("button", { name: "Remove Requirement" }));
    await waitFor(() => expect(mocks.removeRequirement).toHaveBeenCalledWith(componentId));
  });
});
