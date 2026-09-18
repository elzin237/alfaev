import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), producePcb: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../services/pcbProductionService", () => ({ producePcb: mocks.producePcb }));
import { usePcbProduction } from "./usePcbProduction";
import { inventoryBalanceQueryKey } from "../../inventory/inventoryBalanceQueryKeys";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { productDetailQueryKey, productListQueryPrefix } from "../../inventory/productQueryKeys";
import { projectPlanningQueryKey } from "../../projects/projectPlanningQueryKeys";
import {
  pcbBomDetailQueryKey, pcbBomHistoryQueryKey, pcbCardListQueryKey, pcbProductionHistoryQueryKey,
  pcbProductionProjectsQueryKey, pcbProductionSourceQueryKey,
} from "../pcbQueryKeys";

const cardId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const inputId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const submission = { pcbCardId: cardId, quantityToProduce: "5", projectId: null,
  affectedProductIds: [inputId, outputId] };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: true } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => usePcbProduction(cardId), { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1", isActive: true } });
  mocks.producePcb.mockResolvedValue({ ok: true, value: { runId: "run-1" } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB production mutation and cache", () => {
  it("calls the mutation once without automatic retry and invalidates affected read models", async () => {
    const { result, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.submit(submission); });
    expect(mocks.producePcb).toHaveBeenCalledTimes(1);
    expect(mocks.producePcb).toHaveBeenCalledWith(submission);
    const keys = [
      pcbProductionSourceQueryKey("profile-1", cardId),
      pcbBomDetailQueryKey("profile-1", cardId),
      pcbBomHistoryQueryKey("profile-1", cardId),
      pcbProductionHistoryQueryKey("profile-1", cardId),
      pcbCardListQueryKey("profile-1"),
      inventoryBalanceQueryKey("profile-1", inputId),
      inventoryBalanceQueryKey("profile-1", outputId),
      productDetailQueryKey("profile-1", inputId),
      productDetailQueryKey("profile-1", outputId),
    ];
    for (const queryKey of keys) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey, exact: true });
    }
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productListQueryPrefix("profile-1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: inventoryCommitmentsQueryKey("profile-1") });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: projectPlanningQueryKey("profile-1", projectId), exact: true });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: pcbProductionProjectsQueryKey("profile-1"), exact: true });
  });

  it("refreshes Project planning only for Project-linked success", async () => {
    const { result, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.submit({ ...submission, projectId }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectPlanningQueryKey("profile-1", projectId), exact: true });
  });

  it("does not retry a rejected mutation even when the global mutation default enables retry", async () => {
    mocks.producePcb.mockRejectedValueOnce(new Error("transport"));
    const { result } = setup();
    await act(async () => { await expect(result.current.submit(submission)).rejects.toThrow("transport"); });
    expect(mocks.producePcb).toHaveBeenCalledTimes(1);
  });

  it("refreshes stale precheck on failure, choices on Project or unknown outcome, and never invalidates success-only keys", async () => {
    const { result, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    for (const code of ["insufficient_inventory", "project_unavailable", "unknown_outcome"]) {
      mocks.producePcb.mockResolvedValueOnce({ ok: false, error: { code, message: "Safe" } });
      await act(async () => { await result.current.submit(submission); });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: pcbProductionSourceQueryKey("profile-1", cardId), exact: true });
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: pcbBomHistoryQueryKey("profile-1", cardId), exact: true });
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: pcbProductionHistoryQueryKey("profile-1", cardId), exact: true });
      if (code !== "insufficient_inventory") {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: pcbProductionProjectsQueryKey("profile-1"), exact: true });
      } else {
        expect(invalidate).not.toHaveBeenCalledWith({ queryKey: pcbProductionProjectsQueryKey("profile-1"), exact: true });
      }
      invalidate.mockClear();
    }
  });
});
