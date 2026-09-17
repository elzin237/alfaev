import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), isPcbCardId: vi.fn(), listPcbBomVersions: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../services/pcbBomService", () => ({ isPcbCardId: mocks.isPcbCardId }));
vi.mock("../services/pcbBomHistoryService", () => ({ listPcbBomVersions: mocks.listPcbBomVersions }));

import { usePcbBomHistory } from "./usePcbBomHistory";
import { pcbBomHistoryQueryKey } from "../pcbQueryKeys";

const cardId = "11111111-1111-4111-8111-111111111111";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => usePcbBomHistory(cardId), { wrapper }), client };
}

describe("PCB BOM history query", () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: true } });
    mocks.isPcbCardId.mockReturnValue(true);
    mocks.listPcbBomVersions.mockResolvedValue({ ok: true, value: [] });
  });
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("uses a profile/card-scoped key distinct from active BOM detail", async () => {
    expect(pcbBomHistoryQueryKey("profile-1", cardId)).toEqual([
      "pcb", "bom-history", "profile-1", cardId,
    ]);
    expect(pcbBomHistoryQueryKey("profile-1", cardId))
      .not.toEqual(pcbBomHistoryQueryKey("profile-2", cardId));
    const { result } = setup();
    await waitFor(() => expect(result.current.data).toEqual({ ok: true, value: [] }));
    expect(mocks.listPcbBomVersions).toHaveBeenCalledWith(cardId);
  });

  it("does not query for inactive profile or invalid card ID", async () => {
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: false } });
    const inactive = setup();
    expect(inactive.result.current.fetchStatus).toBe("idle");
    inactive.unmount();
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: true } });
    mocks.isPcbCardId.mockReturnValue(false);
    const invalid = setup();
    expect(invalid.result.current.fetchStatus).toBe("idle");
    expect(mocks.listPcbBomVersions).not.toHaveBeenCalled();
  });
});
