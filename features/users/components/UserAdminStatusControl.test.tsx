import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminStatusControlMocks = vi.hoisted(() => ({
  setUserAdminStatus: vi.fn(),
}));

vi.mock("../services/userAdminStatusService", () => ({
  setUserAdminStatus: adminStatusControlMocks.setUserAdminStatus,
}));

import UserAdminStatusControl from "./UserAdminStatusControl";
import type { AdminUserDetail } from "../services/userDetailService";
import type { SetUserAdminStatusResult } from "../services/userAdminStatusService";

const currentProfileId = "00000000-0000-0000-0000-000000000101";
const activeNonAdmin: AdminUserDetail = {
  id: "00000000-0000-0000-0000-000000000201",
  fullName: "Ina Worker",
  email: "ina@example.com",
  birthday: "1994-06-07",
  isActive: true,
  isAdmin: false,
  createdAt: "2026-09-01T08:00:00.000Z",
  lastLoginAt: null,
};

beforeEach(() => {
  adminStatusControlMocks.setUserAdminStatus.mockResolvedValue({
    ok: true,
    value: { profileId: activeNonAdmin.id, isAdmin: true },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("UserAdminStatusControl", () => {
  it("offers promotion for a non-admin target with clear confirmation", () => {
    render(
      <UserAdminStatusControl
        user={activeNonAdmin}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Promote to Admin" }));

    expect(screen.getByRole("dialog", { name: "Promote user to Admin?" }))
      .toBeInTheDocument();
    expect(screen.getByText(/grants full Admin access/i)).toBeInTheDocument();
  });

  it("offers demotion for another Admin target", () => {
    render(
      <UserAdminStatusControl
        user={{ ...activeNonAdmin, isAdmin: true }}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Demote from Admin" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Promote to Admin" }))
      .not.toBeInTheDocument();
  });

  it("does not offer an Admin-status action for the current profile", () => {
    render(
      <UserAdminStatusControl
        user={{ ...activeNonAdmin, id: currentProfileId, isAdmin: true }}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("You cannot change your own Admin status."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /promote|demote/i }))
      .not.toBeInTheDocument();
  });

  it("states that promotion does not reactivate an inactive target", () => {
    render(
      <UserAdminStatusControl
        user={{ ...activeNonAdmin, isActive: false }}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Promote to Admin" }));

    expect(screen.getByText(/account will remain inactive/i))
      .toBeInTheDocument();
    expect(screen.getByText(/until it is explicitly reactivated/i))
      .toBeInTheDocument();
  });

  it("submits once and reports a successful promotion", async () => {
    const onChanged = vi.fn();

    render(
      <UserAdminStatusControl
        user={activeNonAdmin}
        currentProfileId={currentProfileId}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Promote to Admin" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Promote to Admin",
      }),
    );

    await waitFor(() => {
      expect(adminStatusControlMocks.setUserAdminStatus).toHaveBeenCalledWith(
        activeNonAdmin.id,
        true,
      );
    });
    expect(onChanged).toHaveBeenCalledWith("User promoted to Admin.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps safe failures visible without faking success", async () => {
    const onChanged = vi.fn();
    adminStatusControlMocks.setUserAdminStatus.mockResolvedValue({
      ok: false,
      error: {
        code: "last_active_admin",
        message: "The last active administrator cannot be demoted.",
      },
    });

    render(
      <UserAdminStatusControl
        user={{ ...activeNonAdmin, isAdmin: true }}
        currentProfileId={currentProfileId}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Demote from Admin" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Demote from Admin",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The last active administrator cannot be demoted.",
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks duplicate confirmation while the mutation is pending", async () => {
    let resolveMutation: ((value: SetUserAdminStatusResult) => void) | undefined;
    const pendingMutation = new Promise<SetUserAdminStatusResult>((resolve) => {
      resolveMutation = resolve;
    });
    adminStatusControlMocks.setUserAdminStatus.mockReturnValue(pendingMutation);

    render(
      <UserAdminStatusControl
        user={activeNonAdmin}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Promote to Admin" }));
    const confirmButton = within(screen.getByRole("dialog")).getByRole(
      "button",
      { name: "Promote to Admin" },
    );

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(adminStatusControlMocks.setUserAdminStatus).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Promote to Admin…" }))
        .toBeDisabled();
    });

    await act(async () => {
      resolveMutation?.({
        ok: true,
        value: { profileId: activeNonAdmin.id, isAdmin: true },
      });
      await pendingMutation;
    });
  });
});
