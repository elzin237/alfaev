import { beforeEach, describe, expect, it, vi } from "vitest";

const usersServiceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: usersServiceMocks.rpc },
}));

import { listUsersAdmin } from "./usersService";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("usersService", () => {
  it("maps the approved Admin list fields to typed application fields", async () => {
    usersServiceMocks.rpc.mockResolvedValue({
      data: [
        {
          id: "00000000-0000-0000-0000-000000000101",
          full_name: "Ada Admin",
          email: "ada@example.com",
          is_active: true,
          is_admin: true,
          created_at: "2026-09-07T08:00:00.000Z",
          last_login_at: "2026-09-07T09:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(listUsersAdmin()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: "00000000-0000-0000-0000-000000000101",
          fullName: "Ada Admin",
          email: "ada@example.com",
          isActive: true,
          isAdmin: true,
          createdAt: "2026-09-07T08:00:00.000Z",
          lastLoginAt: "2026-09-07T09:00:00.000Z",
        },
      ],
    });
    expect(usersServiceMocks.rpc).toHaveBeenCalledWith("list_users_admin");
  });

  it("returns safe error copy without exposing database details", async () => {
    usersServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Raw database details must not escape the service",
      },
    });

    await expect(listUsersAdmin()).resolves.toEqual({
      ok: false,
      error: {
        code: "users_list_failed",
        message: "The AlfaEV users list could not be loaded.",
      },
    });
  });

  it("fails safely when the RPC response shape is invalid", async () => {
    usersServiceMocks.rpc.mockResolvedValue({
      data: [{ id: "incomplete-row" }],
      error: null,
    });

    await expect(listUsersAdmin()).resolves.toEqual({
      ok: false,
      error: {
        code: "users_list_failed",
        message: "The AlfaEV users list could not be loaded.",
      },
    });
  });
});
