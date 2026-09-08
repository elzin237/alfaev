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

const activeStateControlMocks = vi.hoisted(() => ({
  setUserActiveStateAdmin: vi.fn(),
}));

vi.mock("../services/userActiveStateService", () => ({
  setUserActiveStateAdmin: activeStateControlMocks.setUserActiveStateAdmin,
}));

import UserActiveStateControl from "./UserActiveStateControl";
import type { AdminUserDetail } from "../services/userDetailService";
import type { SetUserActiveStateResult } from "../services/userActiveStateService";

const currentProfileId = "00000000-0000-0000-0000-000000000101";
const activeUser: AdminUserDetail = {
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
  activeStateControlMocks.setUserActiveStateAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: activeUser.id, isActive: false, changed: true },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("UserActiveStateControl", () => {
  it("shows Deactivate for an active target with clear confirmation", () => {
    render(
      <UserActiveStateControl
        user={activeUser}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deactivate User" }));

    expect(screen.getByRole("dialog", { name: "Deactivate user?" }))
      .toBeInTheDocument();
    expect(screen.getByText(/blocked from future sign-in and all AlfaEV access/i))
      .toBeInTheDocument();
  });

  it("shows Reactivate for an inactive target", () => {
    render(
      <UserActiveStateControl
        user={{ ...activeUser, isActive: false }}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Reactivate User" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate User" }))
      .not.toBeInTheDocument();
  });

  it("does not offer self-deactivation", () => {
    render(
      <UserActiveStateControl
        user={{ ...activeUser, id: currentProfileId, isAdmin: true }}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("You cannot deactivate your own account."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate|deactivate/i }))
      .not.toBeInTheDocument();
  });

  it("submits once and reports a successful transition", async () => {
    const onChanged = vi.fn();

    render(
      <UserActiveStateControl
        user={activeUser}
        currentProfileId={currentProfileId}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deactivate User" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Deactivate User",
      }),
    );

    await waitFor(() => {
      expect(activeStateControlMocks.setUserActiveStateAdmin).toHaveBeenCalledWith({
        userId: activeUser.id,
        isActive: false,
      });
    });
    expect(onChanged).toHaveBeenCalledWith("User deactivated.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps safe service failures visible without faking success", async () => {
    const onChanged = vi.fn();
    activeStateControlMocks.setUserActiveStateAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "last_active_admin",
        message: "The last active administrator cannot be deactivated.",
      },
    });

    render(
      <UserActiveStateControl
        user={activeUser}
        currentProfileId={currentProfileId}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deactivate User" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Deactivate User",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The last active administrator cannot be deactivated.",
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks duplicate confirmation while the mutation is pending", async () => {
    let resolveMutation: ((value: SetUserActiveStateResult) => void) | undefined;
    const pendingMutation = new Promise<SetUserActiveStateResult>((resolve) => {
      resolveMutation = resolve;
    });
    activeStateControlMocks.setUserActiveStateAdmin.mockReturnValue(
      pendingMutation,
    );

    render(
      <UserActiveStateControl
        user={activeUser}
        currentProfileId={currentProfileId}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deactivate User" }));
    const confirmButton = within(screen.getByRole("dialog")).getByRole(
      "button",
      { name: "Deactivate User" },
    );

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(activeStateControlMocks.setUserActiveStateAdmin).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Deactivate User…" }))
        .toBeDisabled();
    });

    await act(async () => {
      resolveMutation?.({
        ok: true,
        value: { profileId: activeUser.id, isActive: false, changed: true },
      });
      await pendingMutation;
    });
  });
});
