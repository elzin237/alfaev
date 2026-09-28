import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const pageMocks = vi.hoisted(() => ({
  detailRefetch: vi.fn(),
  projectChoicesRefetch: vi.fn(),
  reloadLatestDraft: vi.fn(),
  resolveBarcode: vi.fn(),
  saveDraft: vi.fn(),
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
    isSaving: false,
    isResolvingBarcode: false,
    reloadLatestDraft: pageMocks.reloadLatestDraft,
    resolveBarcode: pageMocks.resolveBarcode,
    saveDraft: pageMocks.saveDraft,
    ...overrides,
  };
}

function pageTree(path = `/work-orders/${workOrderId}`, state?: unknown) {
  return (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(path = `/work-orders/${workOrderId}`, state?: unknown) {
  return render(pageTree(path, state));
}

beforeEach(() => {
  pageMocks.reloadLatestDraft.mockResolvedValue(undefined);
  pageMocks.saveDraft.mockResolvedValue({
    ok: true,
    value: {
      workOrderId,
      updatedAt: "2026-09-22T10:01:00.123456+00:00",
    },
  });
  pageMocks.resolveBarcode.mockResolvedValue({
    ok: true,
    value: {
      id: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      name: "Relay Module",
    },
  });
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
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeEnabled();
    expect(screen.getByRole("heading", { name: "Materials" }))
      .toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .toBeInTheDocument();
    expect(screen.getByText("Scanned Products will appear here in a later step."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finish|delete/i }))
      .not.toBeInTheDocument();
  });

  it("resolves only the latest scanned Product without saving the Draft or a material", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    scanner.focus();
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(pageMocks.resolveBarcode)
      .toHaveBeenCalledExactlyOnceWith("0000123"));
    expect(screen.getByText("Resolved Product")).toBeInTheDocument();
    expect(screen.getByText("Serial Number:")).toHaveTextContent("0000123");
    expect(screen.getByText("Name: Relay Module")).toBeInTheDocument();
    expect(scanner).toHaveValue("");
    expect(scanner).toHaveFocus();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/Product added|Material added|saved material/i))
      .not.toBeInTheDocument();

    pageMocks.resolveBarcode.mockResolvedValueOnce({
      ok: true,
      value: {
        id: "00000000-0000-4000-8000-000000000031",
        serialNumber: "7654321",
        name: "Controller Board",
      },
    });
    fireEvent.change(scanner, { target: { value: "7654321" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Name: Controller Board"))
      .toBeInTheDocument();
    expect(screen.getByText("Serial Number:")).toHaveTextContent("7654321");
    expect(screen.queryByText(/0000123/)).not.toBeInTheDocument();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
  });

  it("blocks overlapping scans, shows pending state, and refocuses when enabled", async () => {
    let finishResolution: ((value: unknown) => void) | undefined;
    pageMocks.resolveBarcode.mockReturnValue(new Promise((resolve) => {
      finishResolution = resolve;
    }));
    const page = renderPage();
    let scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    fireEvent.change(scanner, { target: { value: "0000124" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    expect(pageMocks.resolveBarcode).toHaveBeenCalledExactlyOnceWith("0000123");

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      isResolvingBarcode: true,
    }));
    page.rerender(pageTree());
    scanner = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    expect(scanner).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Resolving Product...");

    finishResolution?.({
      ok: true,
      value: {
        id: "00000000-0000-4000-8000-000000000030",
        serialNumber: "0000123",
        name: "Relay Module",
      },
    });
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook());
    page.rerender(pageTree());
    await waitFor(() => expect(screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    })).toHaveFocus());
  });

  it.each([
    ["product_not_found", "No Product was found for this Serial Number."],
    [
      "product_unavailable",
      "This Product is archived or unavailable for this Work Order.",
    ],
    [
      "product_resolution_failed",
      "The Product could not be resolved. Please try again.",
    ],
  ])("shows safe inline %s feedback without fake resolved state", async (
    code,
    message,
  ) => {
    pageMocks.resolveBarcode.mockResolvedValue({
      ok: false,
      error: { code, message },
    });
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Resolved Product")).not.toBeInTheDocument();
    expect(scanner).not.toBeDisabled();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
  });

  it("keeps invalid scanner input local and does not trigger Save for Later", () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a 7-digit Serial Number.",
    );
    expect(scanner).toHaveValue("123");
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/Captured Serial Number/)).not.toBeInTheDocument();
  });

  it("saves local Project and Description with the exact authoritative timestamp", async () => {
    const preciseDraft = {
      ...draft,
      updatedAt: "2026-09-22T10:00:00.123456+00:00",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: preciseDraft },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const page = renderPage();

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "  Backend trims this  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    await waitFor(() => expect(pageMocks.saveDraft)
      .toHaveBeenCalledExactlyOnceWith({
        projectId: replacementProjectId,
        description: "  Backend trims this  ",
        expectedUpdatedAt: "2026-09-22T10:00:00.123456+00:00",
      }));
    expect(screen.getByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Project")).toHaveValue(replacementProjectId);
    expect(screen.getByRole("heading", { name: "Materials" }))
      .toBeInTheDocument();

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: {
          ok: true,
          value: {
            ...preciseDraft,
            projectId: replacementProjectId,
            projectName: "Beta Project",
            customerName: "Authoritative Beta Customer",
            description: "Backend trims this",
            updatedAt: "2026-09-22T10:01:00.654321+00:00",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    page.rerender(pageTree());
    expect(screen.getByLabelText("Customer")).toHaveValue(
      "Authoritative Beta Customer",
    );
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Backend trims this",
    );
  });

  it("synchronizes a normalized no-op Description after successful save", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: { ...draft, description: "Test" } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "  Test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Short Description")).toHaveValue("Test");
    expect(pageMocks.saveDraft).toHaveBeenCalledExactlyOnceWith({
      projectId,
      description: "  Test  ",
      expectedUpdatedAt: draft.updatedAt,
    });
  });

  it("synchronizes a whitespace-only normalized no-op to an empty Description", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: { ...draft, description: null } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Short Description")).toHaveValue("");
    expect(pageMocks.saveDraft).toHaveBeenCalledExactlyOnceWith({
      projectId,
      description: "   ",
      expectedUpdatedAt: draft.updatedAt,
    });
  });

  it("blocks duplicate submission and shows the pending save state", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    pageMocks.saveDraft.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    renderPage();

    const saveButton = screen.getByRole("button", { name: "Save for Later" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(pageMocks.saveDraft).toHaveBeenCalledOnce();
    resolveSave?.({
      ok: true,
      value: { workOrderId, updatedAt: draft.updatedAt },
    });
    await waitFor(() => expect(screen.getByText("Draft saved."))
      .toBeInTheDocument());

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      isSaving: true,
    }));
    cleanup();
    renderPage();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("preserves local state after a stale save and reloads only on explicit action", async () => {
    pageMocks.saveDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_work_order",
        message:
          "This Draft changed since you loaded it. Reload the latest version before saving.",
      },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Unsaved local value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Draft changed since you loaded it.",
    );
    expect(screen.getByLabelText("Project")).toHaveValue(replacementProjectId);
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Unsaved local value",
    );
    expect(pageMocks.reloadLatestDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload latest Draft" }));
    await waitFor(() => expect(pageMocks.reloadLatestDraft).toHaveBeenCalledOnce());
  });

  it("keeps local fields intact and never shows success after an ordinary save failure", async () => {
    pageMocks.saveDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "work_order_update_failed",
        message: "The Draft could not be saved. Please try again.",
      },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Keep this value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Draft could not be saved. Please try again.",
    );
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Keep this value",
    );
    expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Materials will be added in a later step."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save for Later" }))
      .not.toBeInTheDocument();
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
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|delete|finish/i }))
      .not.toBeInTheDocument();
  });
});
