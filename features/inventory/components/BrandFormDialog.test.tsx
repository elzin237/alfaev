import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import BrandFormDialog from "./BrandFormDialog";
import type { BrandMutationResult } from "../services/brandService";

afterEach(cleanup);

function renderDialog(
  options: {
    mode?: "create" | "edit";
    initialName?: string;
    onSubmit?: (name: string) => Promise<BrandMutationResult>;
  } = {},
) {
  const onClose = vi.fn();
  const onSucceeded = vi.fn();
  const onSubmit = options.onSubmit ?? vi.fn().mockResolvedValue({
    ok: true,
    value: { brandId: "brand-1" },
  });

  render(
    <BrandFormDialog
      open
      mode={options.mode ?? "create"}
      initialName={options.initialName}
      onClose={onClose}
      onSubmit={onSubmit}
      onSucceeded={onSucceeded}
    />,
  );

  return { onClose, onSucceeded, onSubmit };
}

describe("BrandFormDialog", () => {
  it("validates required and whitespace-only Brand names", async () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Brand Name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Brand" }));

    expect(await screen.findByText("Brand Name is required."))
      .toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prefills an active Brand edit and submits its trimmed name", async () => {
    const { onSubmit, onClose, onSucceeded } = renderDialog({
      mode: "edit",
      initialName: "Bosch",
    });
    const nameInput = screen.getByLabelText("Brand Name");

    expect(nameInput).toHaveValue("Bosch");
    fireEvent.change(nameInput, { target: { value: "  Bosch Rexroth  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Bosch Rexroth"));
    expect(onSucceeded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a safe duplicate error and keeps the dialog open", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "brand_duplicate",
        message: "A Brand with this name already exists.",
      },
    });
    const { onClose } = renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText("Brand Name"), {
      target: { value: "Bosch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Brand" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A Brand with this name already exists.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions while the first request is pending", async () => {
    let resolveSubmission: ((result: BrandMutationResult) => void) | undefined;
    const pendingSubmission = new Promise<BrandMutationResult>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText("Brand Name"), {
      target: { value: "Bosch" },
    });
    const submitButton = screen.getByRole("button", { name: "Add Brand" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(submitButton).toBeDisabled();

    resolveSubmission?.({ ok: true, value: { brandId: "brand-1" } });
    await pendingSubmission;
  });
});
