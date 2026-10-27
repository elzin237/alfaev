import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const permissionEditorMocks = vi.hoisted(() => ({
  saveUserPermissionsAdmin: vi.fn(),
}));

vi.mock("../services/userPermissionSaveService", () => ({
  saveUserPermissionsAdmin: permissionEditorMocks.saveUserPermissionsAdmin,
}));

import UserPermissionEditor from "./UserPermissionEditor";
import type { SaveUserPermissionsResult } from "../services/userPermissionSaveService";
import type { UserPermissionMatrixItem } from "../services/userPermissionsService";

const userId = "00000000-0000-0000-0000-000000000201";
const adminProfileId = "00000000-0000-0000-0000-000000000101";
const permissions: UserPermissionMatrixItem[] = [
  {
    permissionKey: "dashboard.view",
    module: "dashboard",
    label: "View Dashboard",
    description: "View the Dashboard.",
    granted: false,
  },
  {
    permissionKey: "projects.view",
    module: "projects",
    label: "View Projects",
    description: "View Projects.",
    granted: true,
  },
  {
    permissionKey: "projects.create",
    module: "projects",
    label: "Create Projects",
    description: "Create Projects.",
    granted: false,
  },
];

function renderEditor(isAdminTarget = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSaved = vi.fn();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <UserPermissionEditor
        permissions={permissions}
        userId={userId}
        currentAdminProfileId={adminProfileId}
        isAdminTarget={isAdminTarget}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );

  return { ...rendered, queryClient, onSaved };
}

beforeEach(() => {
  vi.resetAllMocks();
  permissionEditorMocks.saveUserPermissionsAdmin.mockResolvedValue({
    ok: true,
    value: { changed: true },
  });
});

afterEach(cleanup);

describe("UserPermissionEditor", () => {
  it("preserves Test grants while editing existing permissions after the 41-key rollout", async () => {
    const expanded: UserPermissionMatrixItem[] = [...permissions, ...(["test_calculator.view", "test_calculator.manage"] as const).map(permissionKey => ({
      permissionKey, module: "test_calculator" as const, label: permissionKey, description: "Test permission", granted: true,
    }))];
    render(<QueryClientProvider client={new QueryClient()}><UserPermissionEditor permissions={expanded} userId={userId}
      currentAdminProfileId={adminProfileId} isAdminTarget={false} onSaved={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByRole("group", { name: "Test Calculator" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Create Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));
    await waitFor(() => expect(permissionEditorMocks.saveUserPermissionsAdmin).toHaveBeenCalled());
    expect(permissionEditorMocks.saveUserPermissionsAdmin.mock.calls[0]![0]).toMatchObject({
      expectedPermissionKeys: ["projects.view", "test_calculator.view", "test_calculator.manage"],
      desiredPermissionKeys: ["projects.view", "projects.create", "test_calculator.view", "test_calculator.manage"],
    });
  });
  it("edits a non-admin draft and saves complete expected and desired sets", async () => {
    const { queryClient, onSaved } = renderEditor();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const saveButton = screen.getByRole("button", {
      name: "Save Permissions",
    });

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Create Projects" }))
      .toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Create Projects" }));

    expect(saveButton).toBeEnabled();
    expect(permissionEditorMocks.saveUserPermissionsAdmin)
      .not.toHaveBeenCalled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(permissionEditorMocks.saveUserPermissionsAdmin).toHaveBeenCalledWith({
        userId,
        expectedPermissionKeys: ["projects.view"],
        desiredPermissionKeys: ["projects.view", "projects.create"],
      });
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "permissions", adminProfileId, userId],
      exact: true,
    });
    expect(onSaved).toHaveBeenCalledWith("Permissions updated.");
    expect(saveButton).toBeDisabled();
  });

  it("blocks duplicate saves and editing while a save is pending", async () => {
    let resolveSave: ((result: SaveUserPermissionsResult) => void) | undefined;
    const pendingSave = new Promise<SaveUserPermissionsResult>((resolve) => {
      resolveSave = resolve;
    });
    permissionEditorMocks.saveUserPermissionsAdmin.mockReturnValue(pendingSave);
    renderEditor();
    const checkbox = screen.getByRole("checkbox", { name: "Create Projects" });

    fireEvent.click(checkbox);
    const saveButton = screen.getByRole("button", { name: "Save Permissions" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(permissionEditorMocks.saveUserPermissionsAdmin)
        .toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Saving Permissions…" }))
        .toBeDisabled();
      expect(checkbox).toBeDisabled();
    });

    await act(async () => {
      resolveSave?.({ ok: true, value: { changed: true } });
      await pendingSave;
    });
  });

  it("fails closed on stale state and refetches before another save", async () => {
    permissionEditorMocks.saveUserPermissionsAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_permissions",
        message:
          "Permissions changed since you opened this page. Reload and review before saving.",
      },
    });
    const { queryClient, onSaved } = renderEditor();
    const refetchQueries = vi.spyOn(queryClient, "refetchQueries");

    fireEvent.click(screen.getByRole("checkbox", { name: "Create Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permissions changed since you opened this page. Reload and review before saving.",
    );
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: ["users", "permissions", adminProfileId, userId],
      exact: true,
    });
    expect(screen.getByRole("button", { name: "Save Permissions" }))
      .toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps Admin targets read-only without a Save action", () => {
    renderEditor(true);

    expect(screen.getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled")))
      .toBe(true);
    expect(screen.queryByRole("button", { name: /save permissions/i }))
      .not.toBeInTheDocument();
  });
});
