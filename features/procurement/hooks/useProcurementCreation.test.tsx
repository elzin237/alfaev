import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const creationHookMocks = vi.hoisted(() => ({
  createProcurementRequestForNewComponent: vi.fn(),
  createProcurementRequestForProduct: vi.fn(),
  hasPermission: vi.fn(),
  searchProcurementProductChoices: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: creationHookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: creationHookMocks.hasPermission,
}));
vi.mock("../services/procurementService", () => ({
  createProcurementRequestForNewComponent:
    creationHookMocks.createProcurementRequestForNewComponent,
  createProcurementRequestForProduct:
    creationHookMocks.createProcurementRequestForProduct,
  searchProcurementProductChoices:
    creationHookMocks.searchProcurementProductChoices,
}));

import {
  useProcurementCreation,
  useProcurementCreationChoices,
} from "./useProcurementCreation";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const input = {
  productId: "00000000-0000-4000-8000-000000000001",
  requestedQuantity: 5,
};

beforeEach(() => {
  creationHookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  creationHookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
  creationHookMocks.createProcurementRequestForProduct.mockResolvedValue({
    ok: true,
    value: { requestId: "00000000-0000-4000-8000-000000000003" },
  });
  creationHookMocks.createProcurementRequestForNewComponent.mockResolvedValue({
    ok: true,
    value: { requestId: "00000000-0000-4000-8000-000000000004" },
  });
  creationHookMocks.searchProcurementProductChoices.mockResolvedValue({
    ok: true,
    value: [],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProcurementCreation", () => {
  it("allows Admin immediately and resolves procurement.create independently for non-Admins", async () => {
    const queryClient = createQueryClient();
    const nonAdmin = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(nonAdmin.result.current.canCreate).toBe(true));
    expect(creationHookMocks.hasPermission).toHaveBeenCalledWith(
      "procurement.create",
    );
    nonAdmin.unmount();

    creationHookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    creationHookMocks.hasPermission.mockClear();
    const admin = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(createQueryClient()),
    });
    expect(admin.result.current.canCreate).toBe(true);
    expect(creationHookMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("fails closed while permission is pending or fails", async () => {
    creationHookMocks.hasPermission.mockReturnValue(
      new Promise(() => undefined),
    );
    const pending = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(createQueryClient()),
    });
    expect(pending.result.current.canCreate).toBe(false);
    pending.unmount();

    creationHookMocks.hasPermission.mockResolvedValue({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(createQueryClient()),
    });
    await waitFor(() => expect(creationHookMocks.hasPermission)
      .toHaveBeenCalled());
    expect(failed.result.current.canCreate).toBe(false);
  });

  it("invalidates only the Procurement list, badge, and historical Supplier options after success", async () => {
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.canCreate).toBe(true));

    await act(async () => {
      await result.current.createExistingProductRequest(input);
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["procurement", "profile-1", "list"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["procurement", "profile-1", "badge"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["procurement", "profile-1", "supplier-options"],
      exact: true,
    });
  });

  it("uses the same exact invalidation boundary for brand-new requests", async () => {
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.createNewComponentRequest({
        requestedName: "New Relay",
        requestedQuantity: 3,
      });
    });

    expect(creationHookMocks.createProcurementRequestForNewComponent)
      .toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("does not invalidate Procurement caches after a failed creation", async () => {
    creationHookMocks.createProcurementRequestForNewComponent.mockResolvedValue({
      ok: false,
      error: { code: "procurement_creation_failed", message: "safe" },
    });
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(useProcurementCreation, {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.createNewComponentRequest({
        requestedName: "New Relay",
        requestedQuantity: 3,
      });
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("loads profile-scoped narrow creation choices only while enabled", async () => {
    const queryClient = createQueryClient();
    const disabled = renderHook(
      () => useProcurementCreationChoices("  00001  ", false),
      { wrapper: wrapperFor(queryClient) },
    );
    expect(disabled.result.current.productChoicesQuery.fetchStatus).toBe("idle");
    expect(creationHookMocks.searchProcurementProductChoices)
      .not.toHaveBeenCalled();
    disabled.unmount();

    const enabled = renderHook(
      () => useProcurementCreationChoices("  00001  ", true),
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() => expect(
      enabled.result.current.productChoicesQuery.isSuccess,
    ).toBe(true));
    expect(creationHookMocks.searchProcurementProductChoices)
      .toHaveBeenCalledWith("00001");
    expect(queryClient.getQueryData([
      "procurement",
      "profile-1",
      "creation",
      "product-choices",
      "00001",
    ])).toEqual({ ok: true, value: [] });
  });
});
