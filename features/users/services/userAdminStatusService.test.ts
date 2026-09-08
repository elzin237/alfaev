import { beforeEach, describe, expect, it, vi } from "vitest";

const adminStatusServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: adminStatusServiceMocks.rpc },
}));

import { setUserAdminStatus } from "./userAdminStatusService";

const userId = "00000000-0000-0000-0000-000000000201";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userAdminStatusService", () => {
  it("calls the trusted RPC with the exact requested status", async () => {
    adminStatusServiceMocks.rpc.mockResolvedValue({ data: userId, error: null });

    await expect(setUserAdminStatus(userId, true)).resolves.toEqual({
      ok: true,
      value: { profileId: userId, isAdmin: true },
    });
    expect(adminStatusServiceMocks.rpc).toHaveBeenCalledWith(
      "set_user_admin_status_admin",
      { p_user_id: userId, p_is_admin: true },
    );
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to change this Admin status."],
    ["AUS01", "self_admin_status_change", "You cannot change your own Admin status."],
    ["AUS02", "last_active_admin", "The last active administrator cannot be demoted."],
    ["P0002", "user_not_found", "The AlfaEV user could not be found."],
  ])("maps %s to safe typed copy", async (backendCode, code, message) => {
    adminStatusServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "Raw database error" },
    });

    await expect(setUserAdminStatus(userId, false)).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it("fails safely for provider errors and malformed success data", async () => {
    adminStatusServiceMocks.rpc
      .mockRejectedValueOnce(new Error("Raw provider failure"))
      .mockResolvedValueOnce({ data: "wrong-profile", error: null });
    const failure = {
      ok: false,
      error: {
        code: "admin_status_update_failed",
        message: "The Admin status could not be changed. Please try again.",
      },
    } as const;

    await expect(setUserAdminStatus(userId, true)).resolves.toEqual(failure);
    await expect(setUserAdminStatus(userId, true)).resolves.toEqual(failure);
  });
});
