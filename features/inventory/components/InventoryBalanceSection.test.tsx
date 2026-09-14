import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useInventoryBalance: vi.fn(),
  refetch: vi.fn(),
  adjust: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: sectionMocks.useAuth,
}));
vi.mock("../hooks/useInventoryBalance", () => ({
  useInventoryBalance: sectionMocks.useInventoryBalance,
}));

import InventoryBalanceSection from "./InventoryBalanceSection";

function setSectionState(options: {
  isAdmin?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: { productId: string; quantity: number; updatedAt: string } }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  const defaultData = {
    ok: true as const,
    value: {
      productId: "product-1",
      quantity: 10,
      updatedAt: "2026-09-14T10:00:00.000Z",
    },
  };
  sectionMocks.useAuth.mockReturnValue({ isAdmin: options.isAdmin ?? true });
  sectionMocks.useInventoryBalance.mockReturnValue({
    balanceQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? (options.isPending ? undefined : defaultData),
      refetch: sectionMocks.refetch,
    },
    adjust: sectionMocks.adjust,
  });
}

beforeEach(() => {
  sectionMocks.adjust.mockResolvedValue({
    ok: true,
    value: { movementId: "movement-1", quantityBefore: 10, quantityAfter: 11 },
  });
  setSectionState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("InventoryBalanceSection", () => {
  it("shows current balance and the action only to Admins with an active Product", () => {
    const rendered = render(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjust Inventory" }))
      .toBeEnabled();

    setSectionState({ isAdmin: false });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.queryByRole("button", { name: "Adjust Inventory" }))
      .not.toBeInTheDocument();

    setSectionState({ isAdmin: true });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive={false} />,
    );
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust Inventory" }))
      .not.toBeInTheDocument();
  });

  it("renders balance loading and safe retryable error states", () => {
    setSectionState({ isPending: true });
    const rendered = render(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Inventory balance...",
    );
    expect(screen.getByRole("button", { name: "Adjust Inventory" }))
      .toBeDisabled();

    setSectionState({
      data: {
        ok: false,
        error: {
          code: "inventory_balance_load_failed",
          message: "The Inventory balance could not be loaded.",
        },
      },
    });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Inventory balance could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sectionMocks.refetch).toHaveBeenCalledOnce();
  });

  it("opens the focused dialog only after balance data is available", () => {
    render(<InventoryBalanceSection productId="product-1" productIsActive />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));

    expect(screen.getByRole("dialog", { name: "Adjust Inventory" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("10").length).toBeGreaterThan(1);
    expect(sectionMocks.useInventoryBalance).toHaveBeenCalledWith("product-1");
  });
});
