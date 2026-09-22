import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import CreatedWorkOrderPage from "./CreatedWorkOrderPage";

afterEach(cleanup);

function renderDestination(options?: {
  path?: string;
  state?: unknown;
}) {
  const path = options?.path ??
    "/work-orders/00000000-0000-4000-8000-000000000010";
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state: options?.state }]}>
      <Routes>
        <Route path="/work-orders/:workOrderId" element={<CreatedWorkOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CreatedWorkOrderPage", () => {
  it("shows the exact backend-returned number and Draft state after creation", () => {
    renderDestination({
      state: {
        createdWorkOrder: {
          workOrderId: "00000000-0000-4000-8000-000000000010",
          workOrderNumber: "RN-2026-0042",
        },
      },
    });

    expect(screen.getByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Draft created");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: /save|finish|delete|scan|material/i,
    })).not.toBeInTheDocument();
  });

  it("does not invent Work Order data on a direct or reloaded route", () => {
    renderDestination();

    expect(screen.getByRole("heading", { name: "Work Order Draft" }))
      .toBeInTheDocument();
    expect(screen.queryByText(/RN-[0-9]{4}-[0-9]{4}/)).not.toBeInTheDocument();
    expect(screen.queryByText("Draft", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText(/details are not available/i)).toBeInTheDocument();
  });

  it("rejects mismatched or malformed navigation state", () => {
    renderDestination({
      state: {
        createdWorkOrder: {
          workOrderId: "00000000-0000-4000-8000-000000000099",
          workOrderNumber: "RN-2026-0042",
        },
      },
    });

    expect(screen.getByRole("heading", { name: "Work Order Draft" }))
      .toBeInTheDocument();
    expect(screen.queryByText("RN-2026-0042")).not.toBeInTheDocument();
  });
});
