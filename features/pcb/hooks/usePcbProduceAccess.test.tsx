import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), hasPermission: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
import { usePcbProduceAccess } from "./usePcbProduceAccess";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(usePcbProduceAccess, { wrapper });
}
beforeEach(() => {
  mocks.useAuth.mockReturnValue({ session: { user: { id: "auth" } },
    profile: { id: "profile", isActive: true }, isAdmin: false });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB produce action visibility", () => {
  it("shows for active Admin without a permission query", () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "admin" } },
      profile: { id: "admin-profile", isActive: true }, isAdmin: true });
    expect(setup().result.current).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });
  it("shows only after trusted pcb.produce query succeeds", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result } = setup();
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.hasPermission).toHaveBeenCalledWith("pcb.produce");
  });
  it("fails closed on denied, pending, failed, or inactive access", async () => {
    const denied = setup();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current).toBe(false);
    denied.unmount();
    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    expect(setup().result.current).toBe(false);
    cleanup();
    mocks.hasPermission.mockResolvedValue({ ok: false, error: { message: "safe" } });
    expect(setup().result.current).toBe(false);
    cleanup();
    mocks.useAuth.mockReturnValue({ session: { user: { id: "inactive" } },
      profile: { id: "inactive-profile", isActive: false }, isAdmin: true });
    expect(setup().result.current).toBe(false);
  });
});
