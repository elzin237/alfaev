import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), useProjectMaterialUsage: vi.fn() }));

vi.mock("../hooks/useProjectMaterialUsage", () => ({
  useProjectMaterialUsage: mocks.useProjectMaterialUsage,
}));

import { ProjectMaterialUsageSection } from "./ProjectMaterialUsageSection";

const projectId = "00000000-0000-4000-8000-000000000001";
const usage = {
  movementId: "00000000-0000-4000-8000-000000000002",
  projectId,
  productId: "00000000-0000-4000-8000-000000000003",
  serialNumber: "0000042",
  productName: "Archived Control Module",
  quantity: "9007199254740993",
  workOrderId: "00000000-0000-4000-8000-000000000004",
  workOrderNumber: "RN-2026-0041",
  consumedAt: "2026-09-30T12:34:56.123456+00:00",
};

function setState(options: {
  canViewWorkOrders?: boolean;
  data?: unknown;
  isError?: boolean;
  isPending?: boolean;
} = {}) {
  mocks.useProjectMaterialUsage.mockReturnValue({
    canViewWorkOrders: options.canViewWorkOrders ?? false,
    usageQuery: {
      data: options.data ?? { ok: true, value: [usage] },
      isError: options.isError ?? false,
      isPending: options.isPending ?? false,
      refetch: mocks.refetch,
    },
  });
}

function renderSection() {
  return render(
    <MemoryRouter>
      <ProjectMaterialUsageSection projectId={projectId} />
    </MemoryRouter>,
  );
}

beforeEach(() => setState());
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectMaterialUsageSection", () => {
  it("renders exact Finished Work Order usage without edit controls", () => {
    renderSection();
    const section = screen.getByRole("region", { name: "Material Usage" });
    expect(within(section).getByText("0000042")).toBeInTheDocument();
    expect(within(section).getByText("Archived Control Module")).toBeInTheDocument();
    expect(within(section).getByText("9007199254740993")).toBeInTheDocument();
    expect(within(section).getByText("Work Order")).toBeInTheDocument();
    expect(within(section).getByText("RN-2026-0041")).toBeInTheDocument();
    expect(section.querySelector(`time[datetime="${usage.consumedAt}"]`))
      .toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /edit|remove|delete/i }))
      .not.toBeInTheDocument();
  });

  it("links the source only when Work Order route access exists", () => {
    const plain = renderSection();
    expect(screen.queryByRole("link", { name: "RN-2026-0041" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("RN-2026-0041")).toBeInTheDocument();
    plain.unmount();

    setState({ canViewWorkOrders: true });
    renderSection();
    expect(screen.getByRole("link", { name: "RN-2026-0041" }))
      .toHaveAttribute("href", `/work-orders/${usage.workOrderId}`);
  });

  it("renders loading, retryable error, and honest empty states distinctly", () => {
    setState({ isPending: true });
    const loading = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("Loading material usage...");
    loading.unmount();

    setState({ data: { ok: false, error: { code: "project_usage_load_failed", message: "Safe usage error." } } });
    const failed = renderSection();
    expect(screen.getByRole("alert")).toHaveTextContent("Safe usage error.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    failed.unmount();

    setState({ data: { ok: true, value: [] } });
    renderSection();
    expect(screen.getByText("No finished Work Order material usage yet."))
      .toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
