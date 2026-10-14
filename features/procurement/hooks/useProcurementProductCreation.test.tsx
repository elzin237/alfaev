import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  listBrands: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../inventory/services/brandService", () => ({
  listBrands: mocks.listBrands,
}));
vi.mock("../services/procurementService", () => ({
  createProductFromProcurementRequest: mocks.createProduct,
}));

import { useProcurementProductCreation } from "./useProcurementProductCreation";

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const input = {
  requestId: "00000000-0000-4000-8000-000000000001",
  name: "Relay",
  category: "Components",
  brandId: null,
};

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-admin" } },
    profile: { id: "profile-admin", isActive: true },
    isAdmin: true,
    isLoading: false,
    error: null,
  });
  mocks.listBrands.mockResolvedValue({ ok: true, value: [] });
  mocks.createProduct.mockResolvedValue({
    ok: true,
    value: {
      productId: "00000000-0000-4000-8000-000000000002",
      serialNumber: "0000123",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProcurementProductCreation", () => {
  it("allows only an active Admin and loads Brands only for an open workflow", async () => {
    const closed = renderHook(() => useProcurementProductCreation(false), {
      wrapper: wrapper(createClient()),
    });
    expect(closed.result.current.canCreateProduct).toBe(true);
    expect(mocks.listBrands).not.toHaveBeenCalled();
    closed.unmount();

    const open = renderHook(() => useProcurementProductCreation(true), {
      wrapper: wrapper(createClient()),
    });
    await waitFor(() => expect(mocks.listBrands).toHaveBeenCalledOnce());
    open.unmount();

    for (const authState of [
      {
        session: { user: { id: "auth-user" } },
        profile: { id: "profile-user", isActive: true },
        isAdmin: false,
        isLoading: false,
        error: null,
      },
      {
        session: { user: { id: "auth-inactive" } },
        profile: { id: "profile-inactive", isActive: false },
        isAdmin: true,
        isLoading: false,
        error: null,
      },
      {
        session: { user: { id: "auth-loading" } },
        profile: { id: "profile-loading", isActive: true },
        isAdmin: true,
        isLoading: true,
        error: null,
      },
      {
        session: { user: { id: "auth-error" } },
        profile: { id: "profile-error", isActive: true },
        isAdmin: true,
        isLoading: false,
        error: { code: "profile_load_failed", message: "safe" },
      },
      {
        session: null,
        profile: null,
        isAdmin: false,
        isLoading: false,
        error: null,
      },
    ]) {
      mocks.useAuth.mockReturnValue(authState);
      mocks.listBrands.mockClear();
      const denied = renderHook(() => useProcurementProductCreation(true), {
        wrapper: wrapper(createClient()),
      });
      expect(denied.result.current.canCreateProduct).toBe(false);
      expect(mocks.listBrands).not.toHaveBeenCalled();
      denied.unmount();
    }
  });

  it("invalidates Procurement and Inventory Product prefixes, but not the badge, after success", async () => {
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(() => useProcurementProductCreation(false), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.createProduct(input);
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["procurement", "profile-admin", "list"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-admin"],
    });
    expect(invalidate.mock.calls.some(([filters]) =>
      JSON.stringify(filters).includes("badge")
    )).toBe(false);
  });

  it("invalidates nothing after a safe backend failure", async () => {
    mocks.createProduct.mockResolvedValue({
      ok: false,
      error: { code: "request_already_linked", message: "safe" },
    });
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(() => useProcurementProductCreation(false), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.createProduct(input);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
