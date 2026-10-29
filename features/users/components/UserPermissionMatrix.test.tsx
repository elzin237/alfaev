import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PERMISSION_KEYS,
  type PermissionKey,
} from "../../../app/auth/permissions";
import type {
  UserPermissionMatrixItem,
  UserPermissionModule,
} from "../services/userPermissionsService";
import UserPermissionMatrix from "./UserPermissionMatrix";

const groupLabels = [
  "Dashboard",
  "Projects",
  "Procurement",
  "Suppliers",
  "Inventory",
  "Product Calculator",
  "Work Orders",
  "Archive",
];

function moduleForPermission(
  permissionKey: PermissionKey,
): UserPermissionModule {
  if (permissionKey.startsWith("dashboard.")) return "dashboard";
  if (permissionKey.startsWith("projects.")) return "projects";
  if (permissionKey.startsWith("procurement.")) return "procurement";
  if (permissionKey.startsWith("suppliers.")) return "suppliers";
  if (permissionKey.startsWith("inventory.")) return "inventory";
  if (permissionKey.startsWith("pcb.")) return "pcb";
  if (permissionKey.startsWith("work_orders.")) return "work_orders";
  return "archive";
}

function permissionMatrix(): UserPermissionMatrixItem[] {
  return PERMISSION_KEYS.map((permissionKey) => ({
    permissionKey,
    module: moduleForPermission(permissionKey),
    label: permissionKey,
    description: `Description for ${permissionKey}.`,
    granted:
      permissionKey === "projects.view" || permissionKey === "archive.view",
  }));
}

afterEach(cleanup);

describe("UserPermissionMatrix", () => {
  it("displays legacy backend Procurement metadata in English without changing grants or keys", () => {
    const permission: UserPermissionMatrixItem = {
      permissionKey: "procurement.view", module: "procurement",
      label: "View Nabavka", description: "View Nabavka requests.", granted: false,
    };
    const onPermissionChange = vi.fn();
    render(<UserPermissionMatrix permissions={[permission]} isAdminTarget={false}
      onPermissionChange={onPermissionChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "View Procurement" });
    expect(screen.getByText("View Procurement requests.")).toBeInTheDocument();
    expect(screen.queryByText(/Nabavka/)).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(onPermissionChange).toHaveBeenCalledWith("procurement.view", true);
    expect(permission).toEqual({ permissionKey: "procurement.view", module: "procurement",
      label: "View Nabavka", description: "View Nabavka requests.", granted: false });
  });

  it("renders all delegable permissions once in canonical group order", () => {
    const onPermissionChange = vi.fn();

    render(
      <UserPermissionMatrix
        permissions={permissionMatrix()}
        isAdminTarget={false}
        onPermissionChange={onPermissionChange}
      />,
    );

    const renderedGroupLabels = screen
      .getAllByRole("group")
      .map((group) => group.querySelector("legend")?.textContent);
    const checkboxes = screen.getAllByRole("checkbox");

    expect(renderedGroupLabels).toEqual(groupLabels);
    expect(checkboxes).toHaveLength(PERMISSION_KEYS.length);
    for (const permissionKey of PERMISSION_KEYS) {
      expect(screen.getAllByRole("checkbox", { name: permissionKey }))
        .toHaveLength(1);
    }
    expect(screen.getByRole("checkbox", { name: "projects.view" }))
      .toBeChecked();
    expect(screen.getByRole("checkbox", { name: "projects.create" }))
      .not.toBeChecked();
    expect(checkboxes.every((checkbox) => !checkbox.hasAttribute("disabled")))
      .toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "projects.create" }));

    expect(onPermissionChange).toHaveBeenCalledWith("projects.create", true);
  });

  it("locks editing while a permission save is submitting", () => {
    render(
      <UserPermissionMatrix
        permissions={permissionMatrix()}
        isAdminTarget={false}
        isSubmitting
        onPermissionChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled")))
      .toBe(true);
  });

  it("does not expose permanently Admin-only capabilities or a Save action", () => {
    render(
      <UserPermissionMatrix
        permissions={permissionMatrix()}
        isAdminTarget={false}
      />,
    );

    expect(screen.queryByText(/users\.manage|calendar\.manage|inventory\.adjust/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i }))
      .not.toBeInTheDocument();
  });

  it("explains Admin bypass while preserving read-only explicit grant state", () => {
    const onPermissionChange = vi.fn();

    render(
      <UserPermissionMatrix
        permissions={permissionMatrix()}
        isAdminTarget
        onPermissionChange={onPermissionChange}
      />,
    );

    expect(screen.getByText(/full access through Admin bypass/i))
      .toBeInTheDocument();
    expect(screen.getByText(/become relevant again after demotion/i))
      .toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "projects.view" }))
      .toBeChecked();
    expect(screen.getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled")))
      .toBe(true);
    expect(onPermissionChange).not.toHaveBeenCalled();
  });
});
