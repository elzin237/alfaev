import { beforeEach, describe, expect, it, vi } from "vitest";

const userDetailServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: userDetailServiceMocks.rpc },
}));

import { getUserAdmin } from "./userDetailService";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userDetailService", () => {
  it("maps only the approved detail fields", async () => {
    userDetailServiceMocks.rpc.mockResolvedValue({
      data: [
        {
          id: "00000000-0000-0000-0000-000000000101",
          full_name: "Ada Admin",
          email: "ada@example.com",
          birthday: "1990-01-02",
          is_active: true,
          is_admin: true,
          created_at: "2026-09-07T08:00:00.000Z",
          last_login_at: null,
        },
      ],
      error: null,
    });

    await expect(
      getUserAdmin("00000000-0000-0000-0000-000000000101"),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: "00000000-0000-0000-0000-000000000101",
        fullName: "Ada Admin",
        email: "ada@example.com",
        birthday: "1990-01-02",
        isActive: true,
        isAdmin: true,
        createdAt: "2026-09-07T08:00:00.000Z",
        lastLoginAt: null,
      },
    });
    expect(userDetailServiceMocks.rpc).toHaveBeenCalledWith("get_user_admin", {
      p_user_id: "00000000-0000-0000-0000-000000000101",
    });
  });

  it("maps not-found and provider failures to safe errors", async () => {
    userDetailServiceMocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "P0002" } })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "Raw database error" },
      });

    await expect(getUserAdmin("missing-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "user_not_found",
        message: "The AlfaEV user could not be found.",
      },
    });
    await expect(getUserAdmin("broken-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "user_detail_failed",
        message: "The AlfaEV user profile could not be loaded.",
      },
    });
  });

  it("fails closed for an invalid response shape", async () => {
    userDetailServiceMocks.rpc.mockResolvedValue({
      data: [{ id: "incomplete" }],
      error: null,
    });

    await expect(getUserAdmin("invalid-id")).resolves.toMatchObject({
      ok: false,
      error: { code: "user_detail_failed" },
    });
  });
});
