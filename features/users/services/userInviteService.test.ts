import { beforeEach, describe, expect, it, vi } from "vitest";

const userInviteServiceMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: userInviteServiceMocks.invoke,
    },
  },
}));

import { inviteUserAdmin } from "./userInviteService";

const input = {
  fullName: "Ada Admin",
  email: "ada@example.com",
  birthday: "1990-01-02",
  isAdmin: true,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userInviteService", () => {
  it("invokes the trusted Edge Function with exactly the expected payload", async () => {
    userInviteServiceMocks.invoke.mockResolvedValue({
      data: {
        code: "user_invited",
        message: "The AlfaEV user invitation was created.",
        data: {
          profileId: "00000000-0000-0000-0000-000000000101",
        },
      },
      error: null,
    });

    await expect(inviteUserAdmin(input)).resolves.toEqual({
      ok: true,
      value: {
        profileId: "00000000-0000-0000-0000-000000000101",
      },
    });
    expect(userInviteServiceMocks.invoke).toHaveBeenCalledWith(
      "admin-invite-user",
      {
        body: input,
      },
    );
  });

  it("maps the backend duplicate response to safe specific copy", async () => {
    userInviteServiceMocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(
          JSON.stringify({
            code: "user_exists",
            message: "Raw backend duplicate details",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      },
    });

    await expect(inviteUserAdmin(input)).resolves.toEqual({
      ok: false,
      error: {
        code: "duplicate_user",
        message: "An AlfaEV user with this email already exists.",
      },
    });
  });

  it("fails safely for provider errors and malformed success data", async () => {
    userInviteServiceMocks.invoke
      .mockRejectedValueOnce(new Error("Raw network failure"))
      .mockResolvedValueOnce({
        data: { code: "user_invited", data: {} },
        error: null,
      });

    const safeFailure = {
      ok: false,
      error: {
        code: "invite_failed",
        message: "The user invitation could not be completed. Please try again.",
      },
    } as const;

    await expect(inviteUserAdmin(input)).resolves.toEqual(safeFailure);
    await expect(inviteUserAdmin(input)).resolves.toEqual(safeFailure);
  });
});
