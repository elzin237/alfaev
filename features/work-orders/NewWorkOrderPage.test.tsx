import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

const newPageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  useWorkOrderCreation: vi.fn(),
  useWorkOrderViewAccess: vi.fn(),
}));

vi.mock("./hooks/useWorkOrderCreation", () => ({
  useWorkOrderCreation: newPageMocks.useWorkOrderCreation,
}));
vi.mock("./hooks/useWorkOrderViewAccess", () => ({
  useWorkOrderViewAccess: newPageMocks.useWorkOrderViewAccess,
}));

import NewWorkOrderPage from "./NewWorkOrderPage";

beforeEach(() => {
  newPageMocks.create.mockResolvedValue({
    ok: true,
    value: {
      workOrderId: "00000000-0000-4000-8000-000000000010",
      workOrderNumber: "RN-2026-0042",
    },
  });
  newPageMocks.useWorkOrderCreation.mockReturnValue({
    canCreate: true,
    create: newPageMocks.create,
    isPending: false,
  });
  newPageMocks.useWorkOrderViewAccess.mockReturnValue({
    canView: false,
    isChecking: false,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("NewWorkOrderPage", () => {
  it("never creates on mount and requires an explicit action", () => {
    render(<NewWorkOrderPage />, { wrapper: MemoryRouter });

    expect(newPageMocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Work Order" }))
      .toBeInTheDocument();
  });

  it("navigates to detail after creation when effective view access exists", async () => {
    newPageMocks.useWorkOrderViewAccess.mockReturnValue({
      canView: true,
      isChecking: false,
    });

    function LocationProbe() {
      const location = useLocation();
      return <p>{location.pathname} {JSON.stringify(location.state)}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/work-orders/new"]}>
        <Routes>
          <Route path="/work-orders/new" element={<NewWorkOrderPage />} />
          <Route path="/work-orders/:workOrderId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Work Order" }));

    expect(await screen.findByText(/\/work-orders\/00000000-0000-4000-8000-000000000010/))
      .toBeInTheDocument();
    expect(screen.getByText(/RN-2026-0042/)).toBeInTheDocument();
  });

  it("keeps create-only success inline with only the authoritative number and Draft state", async () => {
    render(<NewWorkOrderPage />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole("button", { name: "Create Work Order" }));

    expect(await screen.findByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Work Order Draft created successfully.",
    );
    expect(newPageMocks.create).toHaveBeenCalledOnce();
    await waitFor(() => expect(
      screen.queryByRole("button", { name: "Create Work Order" }),
    ).not.toBeInTheDocument());
    expect(screen.queryByLabelText(/project|customer|description|material/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /back to work orders/i }))
      .not.toBeInTheDocument();
  });

  it("waits for the centralized view-access decision before offering creation", () => {
    newPageMocks.useWorkOrderViewAccess.mockReturnValue({
      canView: false,
      isChecking: true,
    });

    render(<NewWorkOrderPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking Work Order access...",
    );
    expect(screen.queryByRole("button", { name: "Create Work Order" }))
      .not.toBeInTheDocument();
    expect(newPageMocks.create).not.toHaveBeenCalled();
  });
});
