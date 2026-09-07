import { beforeEach, describe, expect, it, vi } from "vitest";

const profileQueryMocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("../../lib/supabase/client", () => ({
  supabase: { from: profileQueryMocks.from },
}));

import { loadUserProfile } from "./profileService";

beforeEach(() => {
  vi.resetAllMocks();
  profileQueryMocks.from.mockReturnValue({ select: profileQueryMocks.select });
  profileQueryMocks.select.mockReturnValue({ eq: profileQueryMocks.eq });
  profileQueryMocks.eq.mockReturnValue({ single: profileQueryMocks.single });
});

describe("profileService", () => {
  it("returns profile_not_found when PostgREST reports no matching row", async () => {
    profileQueryMocks.single.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST116",
        message: "Raw PostgREST details must not escape the service",
      },
    });

    await expect(loadUserProfile("auth-user-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "profile_not_found",
        message: "No AlfaEV profile is linked to this account.",
      },
    });
  });

  it("returns profile_load_failed for another Supabase error with null data", async () => {
    profileQueryMocks.single.mockResolvedValue({
      data: null,
      error: {
        code: "08006",
        message: "Raw database details must not escape the service",
      },
    });

    await expect(loadUserProfile("auth-user-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "profile_load_failed",
        message: "The AlfaEV profile could not be loaded.",
      },
    });
  });

  it("returns profile_not_found when data is absent without an error", async () => {
    profileQueryMocks.single.mockResolvedValue({ data: null, error: null });

    await expect(loadUserProfile("auth-user-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "profile_not_found",
        message: "No AlfaEV profile is linked to this account.",
      },
    });
  });

  it("loads exactly one profile and maps database fields", async () => {
    profileQueryMocks.single.mockResolvedValue({
      data: {
        id: "profile-id",
        auth_user_id: "auth-user-id",
        full_name: "Ada Admin",
        email: "ada@example.com",
        birthday: "1990-01-01",
        is_admin: true,
        is_active: false,
        created_at: "2026-09-07T00:00:00.000Z",
        last_login_at: null,
      },
      error: null,
    });

    const result = await loadUserProfile("auth-user-id");

    expect(profileQueryMocks.from).toHaveBeenCalledWith("user_profiles");
    expect(profileQueryMocks.eq).toHaveBeenCalledWith(
      "auth_user_id",
      "auth-user-id",
    );
    expect(profileQueryMocks.single).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      value: {
        id: "profile-id",
        authUserId: "auth-user-id",
        fullName: "Ada Admin",
        email: "ada@example.com",
        birthday: "1990-01-01",
        isAdmin: true,
        isActive: false,
        createdAt: "2026-09-07T00:00:00.000Z",
        lastLoginAt: null,
      },
    });
  });
});
