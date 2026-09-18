import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), listHistory: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../services/pcbProductionHistoryService", () => ({ listPcbProductionHistory: mocks.listHistory }));
import { usePcbProductionHistory } from "./usePcbProductionHistory";
import { pcbProductionHistoryQueryKey } from "../pcbQueryKeys";

const cardId = "11111111-1111-4111-8111-111111111111";
function setup(id = cardId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => usePcbProductionHistory(id), { wrapper }), client };
}
beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: true } });
  mocks.listHistory.mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB production history query", () => {
  it("uses a profile/card-scoped key and reads without mutation", async () => {
    expect(pcbProductionHistoryQueryKey("profile-1", cardId)).not.toEqual(
      pcbProductionHistoryQueryKey("profile-2", cardId));
    const { result, client } = setup();
    await waitFor(() => expect(result.current.data).toEqual({ ok: true, value: [] }));
    expect(mocks.listHistory).toHaveBeenCalledWith(cardId);
    expect(client.getQueryData(pcbProductionHistoryQueryKey("profile-1", cardId))).toEqual({ ok: true, value: [] });
  });

  it("stays disabled for inactive/no profile or invalid card IDs", () => {
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: false } });
    setup();
    mocks.useAuth.mockReturnValue({ profile: null });
    setup();
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: true } });
    setup("invalid");
    expect(mocks.listHistory).not.toHaveBeenCalled();
  });

  it("preserves a typed safe read failure for the section error state", async () => {
    mocks.listHistory.mockResolvedValue({ ok: false, error: {
      code: "history_failed", message: "PCB production history could not be loaded.",
    } });
    const { result } = setup();
    await waitFor(() => expect(result.current.data).toMatchObject({
      ok: false, error: { code: "history_failed" },
    }));
  });
});
