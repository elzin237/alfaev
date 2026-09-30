import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const viewerMocks = vi.hoisted(() => ({
  getWorkOrderPdfAccess: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("./services/workOrderPdfAccessService", () => ({
  getWorkOrderPdfAccess: viewerMocks.getWorkOrderPdfAccess,
}));
vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: viewerMocks.useAuth,
}));

import WorkOrderPdfViewerPage from "./WorkOrderPdfViewerPage";

const workOrderId = "11000000-0000-4000-8000-000000000001";
const signedUrl =
  "https://example.supabase.co/storage/v1/object/sign/work-order-pdfs/final/id/object.pdf?token=signed-token";

function renderViewer(path = `/work-orders/${workOrderId}/pdf`) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/work-orders/:workOrderId/pdf"
            element={<WorkOrderPdfViewerPage />}
          />
          <Route
            path="/work-orders/:workOrderId"
            element={<p>Work Order detail destination</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  viewerMocks.useAuth.mockReturnValue({
    profile: { id: "profile-1", isActive: true },
  });
  viewerMocks.getWorkOrderPdfAccess.mockResolvedValue({
    ok: true,
    value: { signedUrl, expiresIn: 300 },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WorkOrderPdfViewerPage", () => {
  it("loads authorized access and renders the signed URL only in the native PDF frame", async () => {
    renderViewer();

    expect(screen.getByText("Preparing Work Order PDF...")).toBeInTheDocument();
    const frame = await screen.findByTitle("Official Work Order PDF");
    expect(frame).toHaveAttribute("src", signedUrl);
    expect(viewerMocks.getWorkOrderPdfAccess)
      .toHaveBeenCalledExactlyOnceWith(workOrderId);
    expect(screen.getByText(/browser PDF viewer to print/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Work Order" }))
      .toHaveAttribute("href", `/work-orders/${workOrderId}`);
    expect(screen.queryByRole("button", { name: /edit|replace|delete/i }))
      .not.toBeInTheDocument();
  });

  it("scopes signed access by profile and does not load for an inactive identity", () => {
    viewerMocks.useAuth.mockReturnValue({
      profile: { id: "profile-inactive", isActive: false },
    });
    renderViewer();
    expect(viewerMocks.getWorkOrderPdfAccess).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Official Work Order PDF")).not.toBeInTheDocument();
  });

  it("does not query for malformed route IDs", () => {
    renderViewer("/work-orders/not-a-uuid/pdf");
    expect(screen.getByText("Work Order PDF not found")).toBeInTheDocument();
    expect(viewerMocks.getWorkOrderPdfAccess).not.toHaveBeenCalled();
  });

  it("shows safe retryable errors and obtains a fresh URL only on explicit retry", async () => {
    viewerMocks.getWorkOrderPdfAccess
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "pdf_access_failed",
          message: "The official Work Order PDF could not be opened. Please try again.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { signedUrl, expiresIn: 300 },
      });
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The official Work Order PDF could not be opened. Please try again.",
    );
    expect(viewerMocks.getWorkOrderPdfAccess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(viewerMocks.getWorkOrderPdfAccess)
      .toHaveBeenCalledTimes(2));
    expect(await screen.findByTitle("Official Work Order PDF"))
      .toHaveAttribute("src", signedUrl);
  });

  it("refreshes an expired link only when the user requests it", async () => {
    const refreshedUrl = signedUrl.replace("signed-token", "fresh-token");
    viewerMocks.getWorkOrderPdfAccess
      .mockResolvedValueOnce({
        ok: true,
        value: { signedUrl, expiresIn: 300 },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { signedUrl: refreshedUrl, expiresIn: 300 },
      });
    renderViewer();

    expect(await screen.findByTitle("Official Work Order PDF"))
      .toHaveAttribute("src", signedUrl);
    expect(viewerMocks.getWorkOrderPdfAccess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh PDF access" }));
    await waitFor(() => expect(screen.getByTitle("Official Work Order PDF"))
      .toHaveAttribute("src", refreshedUrl));
    expect(viewerMocks.getWorkOrderPdfAccess).toHaveBeenCalledTimes(2);
  });
});
