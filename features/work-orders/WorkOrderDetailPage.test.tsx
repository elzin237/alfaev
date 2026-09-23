import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const pageMocks = vi.hoisted(() => ({
  detailRefetch: vi.fn(),
  projectChoicesRefetch: vi.fn(),
  useWorkOrderDetail: vi.fn(),
}));

vi.mock("./hooks/useWorkOrderDetail", () => ({
  useWorkOrderDetail: pageMocks.useWorkOrderDetail,
}));

import WorkOrderDetailPage from "./WorkOrderDetailPage";

const workOrderId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000020";
const replacementProjectId = "00000000-0000-4000-8000-000000000021";
const draft = {
  id: workOrderId,
  workOrderNumber: "RN-2026-0042",
  status: "draft" as const,
  projectId,
  projectName: "Alpha Project",
  customerName: "Alpha Customer Snapshot",
  description: "Build enclosure",
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};
const projectChoices = [
  {
    id: projectId,
    name: "Alpha Project",
    customerName: "Alpha Current Customer",
    status: "planned" as const,
  },
  {
    id: replacementProjectId,
    name: "Beta Project",
    customerName: "Beta Customer",
    status: "in_progress" as const,
  },
];

function successfulHook(overrides: Record<string, unknown> = {}) {
  return {
    canEditDraft: true,
    detailQuery: {
      data: { ok: true, value: draft },
      isError: false,
      isPending: false,
      refetch: pageMocks.detailRefetch,
    },
    projectChoicesQuery: {
      data: { ok: true, value: projectChoices },
      isError: false,
      isPending: false,
      refetch: pageMocks.projectChoicesRefetch,
    },
    ...overrides,
  };
}

function renderPage(path = `/work-orders/${workOrderId}`, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WorkOrderDetailPage", () => {
  it("shows not found for an invalid route ID", () => {
    renderPage("/work-orders/not-a-uuid");

    expect(screen.getByRole("heading", { name: "Work Order not found" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("shows loading, retryable failure, and safe missing states", () => {
    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: undefined,
        isError: false,
        isPending: true,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const loading = renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Work Order...");
    loading.unmount();

    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_detail_failed",
            message: "The Work Order details could not be loaded.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const failed = renderPage();
    expect(screen.getByRole("heading", { name: "Unable to load Work Order" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.detailRefetch).toHaveBeenCalledOnce();
    failed.unmount();

    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_not_found",
            message: "The Work Order could not be found.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();
    expect(screen.getByRole("heading", { name: "Work Order not found" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("uses authoritative detail on a direct route and ignores navigation-state data", () => {
    renderPage(`/work-orders/${workOrderId}`, {
      createdWorkOrder: {
        workOrderId,
        workOrderNumber: "RN-1999-9999",
      },
    });

    expect(screen.getByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.queryByText("RN-1999-9999")).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Work Orders" }))
      .toHaveAttribute("href", "/work-orders");
  });

  it("renders the editable local shell and previews Customer from a new Project", () => {
    renderPage();

    expect(screen.getByLabelText("Customer")).toHaveValue(
      "Alpha Customer Snapshot",
    );
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Build enclosure",
    );
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    expect(screen.getByLabelText("Customer")).toHaveValue("Beta Customer");
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Local description" },
    });
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Local description",
    );
    expect(screen.getByText(/changes are local and are not saved/i))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Materials" }))
      .toBeInTheDocument();
    expect(screen.getByText("Materials will be added in a later step."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|finish|delete/i }))
      .not.toBeInTheDocument();
  });

  it("renders a Draft read-only when edit authority is unavailable", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      projectChoicesQuery: {
        data: undefined,
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.queryByRole("combobox", { name: "Project" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Short Description" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Alpha Customer Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Build enclosure")).toBeInTheDocument();
  });

  it("preserves an existing historical Project absent from new choices", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: {
          ok: true,
          value: {
            ...draft,
            projectName: "Completed Historical Project",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
      projectChoicesQuery: {
        data: { ok: true, value: projectChoices.slice(1) },
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue(
      projectId,
    );
    expect(screen.getByRole("option", {
      name: "Completed Historical Project (current)",
    })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Beta Project" }))
      .toBeInTheDocument();
  });

  it("keeps loaded Draft data visible when Project choices fail", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      projectChoicesQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_project_choices_failed",
            message: "Project choices could not be loaded.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Build enclosure",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project choices could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.projectChoicesRefetch).toHaveBeenCalledOnce();
  });

  it("shows a minimal read-only Finished state without Draft controls", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      detailQuery: {
        data: { ok: true, value: { ...draft, status: "finished" } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText(/Finished Work Order detail experience is not implemented/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Short Description")).not.toBeInTheDocument();
  });
});
