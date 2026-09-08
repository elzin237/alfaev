import { beforeEach, describe, expect, it, vi } from "vitest";

const activeStateServiceMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { functions: { invoke: activeStateServiceMocks.invoke } },
}));

import { setUserActiveStateAdmin } from "./userActiveStateService";

const input = {
  userId: "00000000-0000-0000-0000-000000000201",
  isActive: false,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userActiveStateService", () => {
  it("invokes the trusted Edge Function with the exact typed payload", async () => {
    activeStateServiceMocks.invoke.mockResolvedValue({
      data: {
        code: "user_deactivated",
        message: "The AlfaEV user was deactivated.",
        data: { profileId: input.userId, isActive: false, changed: true },
      },
      error: null,
    });

    await expect(setUserActiveStateAdmin(input)).resolves.toEqual({
      ok: true,
      value: { profileId: input.userId, isActive: false, changed: true },
    });
    expect(activeStateServiceMocks.invoke).toHaveBeenCalledWith(
      "admin-set-user-active",
      { body: input },
    );
  });

  it.each([
    ["access_denied", "access_denied", "You do not have permission to change this account state."],
    ["self_deactivation", "self_deactivation", "You cannot deactivate your own account."],
    ["last_active_admin", "last_active_admin", "The last active administrator cannot be deactivated."],
    ["user_not_found", "user_not_found", "The AlfaEV user could not be found."],
    [
      "state_mismatch",
      "state_mismatch",
      "The account state could not be changed safely. Contact an administrator.",
    ],
    [
      "state_rollback_failed",
      "state_mismatch",
      "The account state could not be changed safely. Contact an administrator.",
    ],
  ])("maps %s to safe typed copy", async (backendCode, code, message) => {
    activeStateServiceMocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: backendCode }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      },
    });

    await expect(setUserActiveStateAdmin(input)).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it("fails safely for provider errors and malformed responses", async () => {
    activeStateServiceMocks.invoke
      .mockRejectedValueOnce(new Error("Raw provider failure"))
      .mockResolvedValueOnce({ data: { code: "user_deactivated" }, error: null });
    const failure = {
      ok: false,
      error: {
        code: "state_update_failed",
        message: "The account state could not be changed. Please try again.",
      },
    } as const;

    await expect(setUserActiveStateAdmin(input)).resolves.toEqual(failure);
    await expect(setUserActiveStateAdmin(input)).resolves.toEqual(failure);
  });
});
