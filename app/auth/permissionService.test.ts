import { beforeEach, describe, expect, it, vi } from "vitest";

const permissionServiceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../../lib/supabase/client", () => ({
  supabase: { rpc: permissionServiceMocks.rpc },
}));

import { hasPermission } from "./permissionService";
import { PERMISSION_KEYS } from "./permissions";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("permissionService", () => {
  it("contains exactly the canonical delegable permission keys", () => {
    expect(PERMISSION_KEYS).toHaveLength(32);
    expect(new Set(PERMISSION_KEYS).size).toBe(32);
    expect(PERMISSION_KEYS).not.toContain("users.manage");
    expect(PERMISSION_KEYS).not.toContain("calendar.manage");
    expect(PERMISSION_KEYS).not.toContain("inventory.adjust");
  });

  it("delegates a typed permission check to the trusted RPC", async () => {
    permissionServiceMocks.rpc.mockResolvedValue({
      data: true,
      error: null,
    });

    await expect(hasPermission("projects.view")).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(permissionServiceMocks.rpc).toHaveBeenCalledWith(
      "has_permission",
      { permission_key: "projects.view" },
    );
  });

  it("returns a safe intentional error without exposing provider details", async () => {
    permissionServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Raw database details must not escape the service",
      },
    });

    await expect(hasPermission("projects.view")).resolves.toEqual({
      ok: false,
      error: {
        code: "permission_check_failed",
        message: "Your access could not be verified.",
      },
    });
  });
});
