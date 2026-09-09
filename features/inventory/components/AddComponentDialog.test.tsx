import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brand } from "../services/brandService";
import type { ProductCreationResult } from "../services/productService";
import AddComponentDialog from "./AddComponentDialog";

const activeBrand: Brand = {
  id: "brand-active",
  name: "ABB",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archivedAt: null,
};

const archivedBrand: Brand = {
  id: "brand-archived",
  name: "Archived Bosch",
  isActive: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  archivedAt: "2026-08-02T00:00:00.000Z",
};

function renderDialog(options: {
  brands?: Brand[];
  isBrandsLoading?: boolean;
  brandLoadError?: string | null;
  onSubmit?: (input: {
    name: string;
    category: string;
    brandId: string | null;
  }) => Promise<ProductCreationResult>;
} = {}) {
  const onClose = vi.fn();
  const onRetryBrands = vi.fn();
  const onSucceeded = vi.fn();
  const onSubmit = options.onSubmit ?? vi.fn().mockResolvedValue({
    ok: true,
    value: { productId: "product-1", serialNumber: "0000123" },
  });

  render(
    <AddComponentDialog
      open
      brands={options.brands ?? [activeBrand, archivedBrand]}
      isBrandsLoading={options.isBrandsLoading ?? false}
      brandLoadError={options.brandLoadError ?? null}
      onRetryBrands={onRetryBrands}
      onClose={onClose}
      onSubmit={onSubmit}
      onSucceeded={onSucceeded}
    />,
  );

  return { onClose, onRetryBrands, onSubmit, onSucceeded };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  Resistor  " },
  });
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "  Passive Components  " },
  });
}

afterEach(cleanup);

describe("AddComponentDialog", () => {
  it("validates required Name and Category without exposing forbidden fields", async () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Component" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Category is required.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/serial/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/product kind/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/quantity|stock/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers only active Brands and submits an optional Brand as null", async () => {
    const { onSubmit, onClose, onSucceeded } = renderDialog();
    const brandSelect = screen.getByLabelText(/Brand/);

    expect(within(brandSelect).getByRole("option", { name: "ABB" }))
      .toBeInTheDocument();
    expect(within(brandSelect).queryByRole("option", {
      name: "Archived Bosch",
    })).not.toBeInTheDocument();

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Add Component" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      name: "Resistor",
      category: "Passive Components",
      brandId: null,
    }));
    expect(onSucceeded).toHaveBeenCalledWith({
      productId: "product-1",
      serialNumber: "0000123",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submits the selected active Brand and blocks duplicate submissions", async () => {
    let resolveSubmission: ((result: ProductCreationResult) => void) | undefined;
    const pendingSubmission = new Promise<ProductCreationResult>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    renderDialog({ onSubmit });
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Brand/), {
      target: { value: activeBrand.id },
    });
    const submitButton = screen.getByRole("button", { name: "Add Component" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Resistor",
      category: "Passive Components",
      brandId: activeBrand.id,
    });
    expect(submitButton).toBeDisabled();

    resolveSubmission?.({
      ok: true,
      value: { productId: "product-1", serialNumber: "0000123" },
    });
    await pendingSubmission;
  });

  it("fails closed while Brands load and shows a retryable safe Brand error", () => {
    const loading = renderDialog({ isBrandsLoading: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading active Brands...",
    );
    expect(screen.getByRole("button", { name: "Add Component" }))
      .toBeDisabled();
    loading.onClose.mockClear();
    cleanup();

    const failed = renderDialog({
      brandLoadError: "The Brand list could not be loaded.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Brand list could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failed.onRetryBrands).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add Component" }))
      .toBeDisabled();
  });

  it("keeps a safe backend error visible and the dialog open", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "brand_unavailable",
        message: "The selected Brand is unavailable. Choose an active Brand or no Brand.",
      },
    });
    const { onClose } = renderDialog({ onSubmit });
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Add Component" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected Brand is unavailable.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
