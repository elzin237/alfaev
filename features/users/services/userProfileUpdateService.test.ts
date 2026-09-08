import { beforeEach, describe, expect, it, vi } from "vitest";

const userProfileUpdateMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { functions: { invoke: userProfileUpdateMocks.invoke } },
}));

import { updateUserProfileAdmin } from "./userProfileUpdateService";

const input = {
  userId: "00000000-0000-0000-0000-000000000101",
  fullName: "Ada Admin",
  email: "ada@example.com",
  birthday: "1990-01-02",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userProfileUpdateService", () => {
  it("invokes the trusted profile-update function with the exact payload", async () => {
    userProfileUpdateMocks.invoke.mockResolvedValue({
      data: {
        code: "user_updated",
        message: "The AlfaEV user profile was updated.",
        data: { profileId: input.userId },
      },
      error: null,
    });

    await expect(updateUserProfileAdmin(input)).resolves.toEqual({
      ok: true,
      value: { profileId: input.userId },
    });
    expect(userProfileUpdateMocks.invoke).toHaveBeenCalledWith(
      "admin-update-user-profile",
      { body: input },
    );
  });

  it.each([
    ["user_exists", "duplicate_user", "An AlfaEV user with this email already exists."],
    ["user_not_found", "user_not_found", "The AlfaEV user could not be found."],
    [
      "identity_mismatch",
      "identity_mismatch",
      "The user identity could not be safely updated. Contact an administrator.",
    ],
  ])("maps %s to safe typed copy", async (backendCode, code, message) => {
    userProfileUpdateMocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: backendCode }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      },
    });

    await expect(updateUserProfileAdmin(input)).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it("does not expose provider errors or malformed success data", async () => {
    userProfileUpdateMocks.invoke
      .mockRejectedValueOnce(new Error("Raw provider failure"))
      .mockResolvedValueOnce({ data: { code: "user_updated" }, error: null });
    const safeFailure = {
      ok: false,
      error: {
        code: "update_failed",
        message: "The user profile could not be updated. Please try again.",
      },
    } as const;

    await expect(updateUserProfileAdmin(input)).resolves.toEqual(safeFailure);
    await expect(updateUserProfileAdmin(input)).resolves.toEqual(safeFailure);
  });
});
