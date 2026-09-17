import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), hasPermission: vi.fn(), getPcbBomEditor: vi.fn(),
  saveInitialPcbBom: vi.fn(), isPcbCardId: vi.fn(),
}));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/pcbBomService", () => ({
  getPcbBomEditor: mocks.getPcbBomEditor,
  saveInitialPcbBom: mocks.saveInitialPcbBom,
  isPcbCardId: mocks.isPcbCardId,
}));

import { usePcbBomDetail } from "./usePcbBomDetail";
import { pcbBomChoicesQueryKey, pcbBomDetailQueryKey } from "../pcbQueryKeys";

const cardId = "11111111-1111-4111-8111-111111111111";
const card = { cardId, isActive: true, items: [], versionId: null, versionNumber: null };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => usePcbBomDetail(cardId), { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true }, isAdmin: false });
  mocks.isPcbCardId.mockReturnValue(true);
  mocks.getPcbBomEditor.mockResolvedValue({ ok: true, value: card });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.saveInitialPcbBom.mockResolvedValue({ ok: true, value: { versionId: "version-1", versionNumber: 1 } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB BOM detail query and edit authority", () => {
  it("scopes detail and choice keys by profile/card/search", async () => {
    expect(pcbBomDetailQueryKey("profile-1", cardId)).not.toEqual(pcbBomDetailQueryKey("profile-2", cardId));
    expect(pcbBomChoicesQueryKey("profile-1", cardId, "  serial ")).toEqual([
      "pcb", "bom-choices", "profile-1", cardId, "serial",
    ]);
    const { result } = setup();
    await waitFor(() => expect(result.current.detailQuery.data?.ok).toBe(true));
    expect(mocks.getPcbBomEditor).toHaveBeenCalledWith(cardId);
  });

  it("lets Admin edit without a permission RPC and fails archived cards closed", async () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "admin" } },
      profile: { id: "admin-profile", isActive: true }, isAdmin: true });
    const active = setup();
    await waitFor(() => expect(active.result.current.canEdit).toBe(true));
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    active.unmount();
    mocks.getPcbBomEditor.mockResolvedValue({ ok: true, value: { ...card, isActive: false } });
    const archived = setup();
    await waitFor(() => expect(archived.result.current.detailQuery.data?.ok).toBe(true));
    expect(archived.result.current.canEdit).toBe(false);
  });

  it("fails closed while pcb.edit is pending or returns an error", async () => {
    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = setup();
    await waitFor(() => expect(pending.result.current.detailQuery.data?.ok).toBe(true));
    expect(pending.result.current.canEdit).toBe(false);
    pending.unmount();
    mocks.hasPermission.mockResolvedValue({ ok: false, error: { message: "safe" } });
    const failed = setup();
    await waitFor(() => expect(failed.result.current.detailQuery.data?.ok).toBe(true));
    expect(failed.result.current.canEdit).toBe(false);
  });

  it("allows pcb.edit and invalidates only exact BOM detail after successful save", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, client } = setup();
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.save([]); });
    expect(mocks.saveInitialPcbBom).toHaveBeenCalledWith(cardId, []);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pcbBomDetailQueryKey("profile-1", cardId), exact: true,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    invalidate.mockClear();
    mocks.saveInitialPcbBom.mockResolvedValue({ ok: false, error: { code: "save_failed", message: "Safe" } });
    await act(async () => { await result.current.save([]); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not call the save service without edit authority", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.detailQuery.data?.ok).toBe(true));
    await act(async () => { await result.current.save([]); });
    expect(mocks.saveInitialPcbBom).not.toHaveBeenCalled();
  });
});
