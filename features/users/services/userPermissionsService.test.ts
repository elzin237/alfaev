import { beforeEach, describe, expect, it, vi } from "vitest";

const userPermissionsServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: userPermissionsServiceMocks.rpc },
}));

import { PERMISSION_KEYS } from "../../../app/auth/permissions";
import { getUserPermissionsAdmin } from "./userPermissionsService";

const targetUserId = "00000000-0000-0000-0000-000000000201";

function permissionRows() {
  return PERMISSION_KEYS.map((permissionKey, index) => ({
    permission_key: permissionKey,
    module: permissionKey.slice(0, permissionKey.indexOf(".")),
    label: `Permission ${index + 1}`,
    description: `Permission description ${index + 1}.`,
    granted: permissionKey === "projects.view",
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("userPermissionsService", () => {
  it("maps the complete canonical matrix through the trusted read RPC", async () => {
    userPermissionsServiceMocks.rpc.mockResolvedValue({
      data: permissionRows(),
      error: null,
    });

    const result = await getUserPermissionsAdmin(targetUserId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(PERMISSION_KEYS.length);
      expect(result.value[1]).toEqual({
        permissionKey: "projects.view",
        module: "projects",
        label: "Permission 2",
        description: "Permission description 2.",
        granted: true,
      });
    }
    expect(userPermissionsServiceMocks.rpc).toHaveBeenCalledWith(
      "get_user_permissions_admin",
      { p_user_id: targetUserId },
    );
  });

  it("fails closed for incomplete, duplicate, or invalid response data", async () => {
    const incompleteRows = permissionRows().slice(0, -1);
    const duplicateRows = [
      ...permissionRows().slice(0, -1),
      {
        permission_key: "dashboard.view",
        module: "dashboard",
        label: "Duplicate Dashboard permission",
        description: "Duplicate canonical permission.",
        granted: false,
      },
    ];
    const invalidRows: unknown[] = permissionRows();
    invalidRows[0] = {
      permission_key: "dashboard.view",
      module: "dashboard",
      label: "View Dashboard",
      description: "View the Dashboard.",
      granted: false,
      unexpected: "field",
    };

    userPermissionsServiceMocks.rpc
      .mockResolvedValueOnce({ data: incompleteRows, error: null })
      .mockResolvedValueOnce({ data: duplicateRows, error: null })
      .mockResolvedValueOnce({ data: invalidRows, error: null });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(getUserPermissionsAdmin(targetUserId)).resolves.toEqual({
        ok: false,
        error: {
          code: "permission_matrix_failed",
          message: "The user's permissions could not be loaded.",
        },
      });
    }
  });

  it("accepts the deployed 39-permission RPC order and normalizes without changing grants", async () => {
    const canonical = permissionRows();
    const reserve = canonical.find(row => row.permission_key === "inventory.finished_goods.reserve")!;
    const deployed = canonical.filter(row => row !== reserve);
    deployed.splice(deployed.findIndex(row => row.permission_key === "inventory.barcodes.generate") + 1, 0, reserve);
    expect(deployed).toHaveLength(39);
    expect(deployed.map(row => row.permission_key)).not.toEqual([...PERMISSION_KEYS]);
    userPermissionsServiceMocks.rpc.mockResolvedValue({ data: deployed, error: null });
    const result = await getUserPermissionsAdmin(targetUserId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map(row => row.permissionKey)).toEqual([...PERMISSION_KEYS]);
      expect(result.value.map(row => row.granted)).toEqual(canonical.map(row => row.granted));
    }
  });

  it("accepts reordered valid rows but rejects unknown keys or a same-length duplicate set", async () => {
    userPermissionsServiceMocks.rpc.mockResolvedValueOnce({ data: permissionRows().reverse(), error: null });
    expect((await getUserPermissionsAdmin(targetUserId)).ok).toBe(true);
    const unknown = permissionRows().map(row => ({ ...row }));
    unknown[0] = { ...unknown[0]!, permission_key: "users.admin" as typeof PERMISSION_KEYS[number] };
    const duplicate = permissionRows();
    duplicate[1] = { ...duplicate[0]! };
    for (const data of [unknown, duplicate]) {
      userPermissionsServiceMocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await getUserPermissionsAdmin(targetUserId)).ok).toBe(false);
    }
  });

  it("maps missing users and provider failures to safe typed errors", async () => {
    userPermissionsServiceMocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "P0002" } })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "Raw database details" },
      })
      .mockRejectedValueOnce(new Error("Raw network details"));

    await expect(getUserPermissionsAdmin(targetUserId)).resolves.toEqual({
      ok: false,
      error: {
        code: "user_not_found",
        message: "The AlfaEV user could not be found.",
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(getUserPermissionsAdmin(targetUserId)).resolves.toEqual({
        ok: false,
        error: {
          code: "permission_matrix_failed",
          message: "The user's permissions could not be loaded.",
        },
      });
    }
  });
});
