import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createUserDialogMocks = vi.hoisted(() => ({
  inviteUserAdmin: vi.fn(),
}));

vi.mock("../services/userInviteService", () => ({
  inviteUserAdmin: createUserDialogMocks.inviteUserAdmin,
}));

import CreateUserDialog from "./CreateUserDialog";
import type { UserInviteResult } from "../services/userInviteService";

function fillValidForm(isAdmin = false) {
  fireEvent.change(screen.getByLabelText("Full Name"), {
    target: { value: "  Ada   Admin  " },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: " ADA@EXAMPLE.COM " },
  });
  fireEvent.change(screen.getByLabelText("Birthday"), {
    target: { value: "1990-01-02" },
  });

  if (isAdmin) {
    fireEvent.click(screen.getByRole("checkbox", { name: "Admin account" }));
  }
}

beforeEach(() => {
  createUserDialogMocks.inviteUserAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: "00000000-0000-0000-0000-000000000101" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("CreateUserDialog", () => {
  it("focuses the first field and shows associated validation errors", async () => {
    render(
      <CreateUserDialog open onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "invalid-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));

    expect(await screen.findByText("Full name is required.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Birthday is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-describedby",
    );
    expect(createUserDialogMocks.inviteUserAdmin).not.toHaveBeenCalled();
  });

  it("submits normalized values with the selected Admin status", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateUserDialog
        open
        onClose={onClose}
        onCreated={onCreated}
      />,
    );
    fillValidForm(true);
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));

    await waitFor(() => {
      expect(createUserDialogMocks.inviteUserAdmin).toHaveBeenCalledWith({
        fullName: "Ada Admin",
        email: "ada@example.com",
        birthday: "1990-01-02",
        isAdmin: true,
      });
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks duplicate submission while the invitation is pending", async () => {
    let resolveInvitation: ((result: UserInviteResult) => void) | undefined;
    const pendingInvitation = new Promise<UserInviteResult>((resolve) => {
      resolveInvitation = resolve;
    });
    createUserDialogMocks.inviteUserAdmin.mockReturnValue(pendingInvitation);

    render(
      <CreateUserDialog open onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fillValidForm();

    const submitButton = screen.getByRole("button", { name: "Send Invitation" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(createUserDialogMocks.inviteUserAdmin).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Sending invitation…" }))
        .toBeDisabled();
    });

    await act(async () => {
      resolveInvitation?.({
        ok: true,
        value: { profileId: "00000000-0000-0000-0000-000000000101" },
      });
      await pendingInvitation;
    });
  });

  it("keeps safe backend errors visible and leaves the dialog open", async () => {
    createUserDialogMocks.inviteUserAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "duplicate_user",
        message: "An AlfaEV user with this email already exists.",
      },
    });

    render(
      <CreateUserDialog open onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An AlfaEV user with this email already exists.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes and resets after success, and supports Escape when idle", async () => {
    const onCreated = vi.fn();

    function DialogHarness() {
      const [open, setOpen] = useState(true);

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <CreateUserDialog
            open={open}
            onClose={() => setOpen(false)}
            onCreated={onCreated}
          />
        </>
      );
    }

    render(<DialogHarness />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onCreated).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByLabelText("Full Name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Birthday")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Admin account" }))
      .not.toBeChecked();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
