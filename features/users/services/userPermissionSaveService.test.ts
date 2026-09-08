import { beforeEach, describe, expect, it, vi } from "vitest";

const permissionSaveServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: permissionSaveServiceMocks.rpc },
}));

import { saveUserPermissionsAdmin } from "./userPermissionSaveService";

const userId = "00000000-0000-0000-0000-000000000201";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userPermissionSaveService", () => {
  it("sends the complete expected and desired permission sets to the batch RPC", async () => {
    permissionSaveServiceMocks.rpc.mockResolvedValue({
      data: true,
      error: null,
    });

    await expect(
      saveUserPermissionsAdmin({
        userId,
        expectedPermissionKeys: ["projects.view"],
        desiredPermissionKeys: ["projects.view", "projects.create"],
      }),
    ).resolves.toEqual({ ok: true, value: { changed: true } });
    expect(permissionSaveServiceMocks.rpc).toHaveBeenCalledWith(
      "save_user_permissions_admin",
      {
        p_user_id: userId,
        p_expected_permission_keys: ["projects.view"],
        p_desired_permission_keys: ["projects.view", "projects.create"],
      },
    );
  });

  it("maps stale state to safe review-before-saving copy", async () => {
    permissionSaveServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PRM04", message: "Raw stale-state details" },
    });

    await expect(
      saveUserPermissionsAdmin({
        userId,
        expectedPermissionKeys: ["projects.view"],
        desiredPermissionKeys: ["projects.create"],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_permissions",
        message:
          "Permissions changed since you opened this page. Reload and review before saving.",
      },
    });
  });

  it("maps authorization, validation, target, and provider failures safely", async () => {
    for (const code of [
      "42501",
      "PRM01",
      "PRM02",
      "PRM03",
      "22023",
      "P0002",
      "XX000",
    ]) {
      permissionSaveServiceMocks.rpc.mockResolvedValueOnce({
        data: null,
        error: { code, message: "Raw backend details" },
      });
    }

    const expectedCodes = [
      "access_denied",
      "self_permission_change",
      "admin_target",
      "invalid_permissions",
      "invalid_permissions",
      "user_not_found",
      "permission_save_failed",
    ];

    for (const expectedCode of expectedCodes) {
      const result = await saveUserPermissionsAdmin({
        userId,
        expectedPermissionKeys: [],
        desiredPermissionKeys: [],
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: expectedCode },
      });
      if (!result.ok) {
        expect(result.error.message).not.toContain("Raw");
      }
    }
  });

  it("fails safely for invalid success data or a rejected request", async () => {
    permissionSaveServiceMocks.rpc
      .mockResolvedValueOnce({ data: "true", error: null })
      .mockRejectedValueOnce(new Error("Raw network failure"));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        saveUserPermissionsAdmin({
          userId,
          expectedPermissionKeys: [],
          desiredPermissionKeys: [],
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "permission_save_failed" },
      });
    }
  });
});
