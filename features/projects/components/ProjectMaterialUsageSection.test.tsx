import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), useProjectMaterialUsage: vi.fn() }));

vi.mock("../hooks/useProjectMaterialUsage", () => ({
  useProjectMaterialUsage: mocks.useProjectMaterialUsage,
}));

import { ProjectMaterialUsageSection } from "./ProjectMaterialUsageSection";

const projectId = "00000000-0000-4000-8000-000000000001";
const usage = {
  productId: "00000000-0000-4000-8000-000000000003",
  serialNumber: "0000042",
  productName: "Archived Control Module",
  quantity: "18446744073709551614",
};

function setState(options: {
  data?: unknown;
  isError?: boolean;
  isPending?: boolean;
} = {}) {
  mocks.useProjectMaterialUsage.mockReturnValue({
    usageQuery: {
      data: options.data ?? { ok: true, value: [usage] },
      isError: options.isError ?? false,
      isPending: options.isPending ?? false,
      refetch: mocks.refetch,
    },
  });
}

beforeEach(() => setState());
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectMaterialUsageSection", () => {
  it("renders the narrow aggregate projection with exact bigint-safe quantity text", () => {
    render(<ProjectMaterialUsageSection projectId={projectId} />);
    const section = screen.getByRole("region", { name: "Material Usage" });
    expect(within(section).getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["Serial Number", "Product", "Quantity"]);
    expect(within(section).getByText("0000042")).toBeInTheDocument();
    expect(within(section).getByText("Archived Control Module")).toBeInTheDocument();
    expect(within(section).getByText("18446744073709551614")).toBeInTheDocument();
    for (const removed of ["Source Type", "Source Record", "Date"]) {
      expect(within(section).queryByRole("columnheader", { name: removed }))
        .not.toBeInTheDocument();
    }
  });

  it("filters locally by Product name and Serial Number and clearing restores all rows", () => {
    const second = {
      productId: "00000000-0000-4000-8000-000000000004",
      serialNumber: "0001088",
      productName: "Power Relay",
      quantity: "7",
    };
    setState({ data: { ok: true, value: [usage, second] } });
    render(<ProjectMaterialUsageSection projectId={projectId} />);
    const search = screen.getByPlaceholderText(
      "Search materials by Product name or Serial Number",
    );

    fireEvent.change(search, { target: { value: "POWER" } });
    expect(screen.getByText("Power Relay")).toBeInTheDocument();
    expect(screen.queryByText("Archived Control Module")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "0042" } });
    expect(screen.getByText("Archived Control Module")).toBeInTheDocument();
    expect(screen.queryByText("Power Relay")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No materials match your search.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("Archived Control Module")).toBeInTheDocument();
    expect(screen.getByText("Power Relay")).toBeInTheDocument();
  });

  it("keeps every row in a bounded independent scroll area with a sticky header", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...usage,
      productId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      serialNumber: String(index + 100).padStart(7, "0"),
      productName: `Material ${index + 1}`,
      quantity: String(index + 1),
    }));
    setState({ data: { ok: true, value: rows } });
    render(<ProjectMaterialUsageSection projectId={projectId} />);

    expect(screen.getAllByRole("row")).toHaveLength(13);
    const scroll = screen.getByTestId("material-usage-scroll");
    expect(scroll).toHaveClass("max-h-[36rem]", "overflow-auto");
    expect(scroll.querySelector("thead")).toHaveClass("sticky", "top-0");
    expect(scroll).not.toContainElement(screen.getByRole("searchbox"));
  });

  it("uses natural height for small lists and no scrolling box for empty usage", () => {
    const small = render(<ProjectMaterialUsageSection projectId={projectId} />);
    expect(screen.getByTestId("material-usage-scroll")).toHaveClass("max-h-[36rem]");
    small.unmount();

    setState({ data: { ok: true, value: [] } });
    render(<ProjectMaterialUsageSection projectId={projectId} />);
    expect(screen.getByText("No Project material usage yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("material-usage-scroll")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("renders loading and retryable error states", () => {
    setState({ isPending: true });
    const loading = render(<ProjectMaterialUsageSection projectId={projectId} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading material usage...");
    loading.unmount();

    setState({ data: { ok: false, error: { code: "project_usage_load_failed", message: "Safe usage error." } } });
    render(<ProjectMaterialUsageSection projectId={projectId} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Safe usage error.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
