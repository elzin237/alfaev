import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CreateSupplierDialog from "./CreateSupplierDialog";
import type { SupplierCreateResult } from "../services/supplierService";

afterEach(cleanup);

function renderDialog(
  onSubmit: (input: {
    name: string;
    country: string;
    contactPersonName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  }) => Promise<SupplierCreateResult> = vi.fn().mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  }),
) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateSupplierDialog
      open
      onClose={onClose}
      onSubmit={onSubmit}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated, onSubmit };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Supplier Name"), {
    target: { value: "  Bosch  " },
  });
  fireEvent.change(screen.getByLabelText("Country"), {
    target: { value: "  Germany  " },
  });
}

describe("CreateSupplierDialog", () => {
  it("validates required Supplier Name and Country", async () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));

    expect(await screen.findByText("Supplier Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Country is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects an invalid optional email with friendly copy", async () => {
    const { onSubmit } = renderDialog();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));

    expect(await screen.findByText("Enter a valid Supplier email address."))
      .toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims fields, lowercases email, and accepts optional blanks", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      value: { supplierId: "supplier-1" },
    });
    const { onClose, onCreated } = renderDialog(onSubmit);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Contact Person"), {
      target: { value: "  Mira Marić  " },
    });
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  MIRA@BOSCH.EXAMPLE  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      name: "Bosch",
      country: "Germany",
      contactPersonName: "Mira Marić",
      contactPhone: null,
      contactEmail: "mira@bosch.example",
    }));
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps input and displays a safe backend error", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "supplier_duplicate",
        message: "A Supplier with this name already exists.",
      },
    });
    const { onClose } = renderDialog(onSubmit);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A Supplier with this name already exists.",
    );
    expect(screen.getByLabelText("Supplier Name")).toHaveValue("  Bosch  ");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks duplicate submission while the first request is pending", async () => {
    let resolveSubmission: ((result: SupplierCreateResult) => void) | undefined;
    const pendingSubmission = new Promise<SupplierCreateResult>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    renderDialog(onSubmit);
    fillRequiredFields();
    const submitButton = screen.getByRole("button", { name: "Add Supplier" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(submitButton).toBeDisabled();

    resolveSubmission?.({ ok: true, value: { supplierId: "supplier-1" } });
    await pendingSubmission;
  });
});
