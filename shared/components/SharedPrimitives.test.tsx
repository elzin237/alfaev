import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog from "./ConfirmDialog";
import PageHeader from "./PageHeader";
import StatusBadge from "./StatusBadge";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders its title and configured optional content", () => {
    const { rerender } = render(<PageHeader title="Projects" />);

    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Manage active projects.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <PageHeader
        title="Projects"
        description="Manage active projects."
        actions={<button type="button">New project</button>}
      />,
    );

    expect(screen.getByText("Manage active projects.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders a readable label with the requested tone", () => {
    render(<StatusBadge label="Complete" tone="success" />);

    expect(screen.getByText("Complete")).toHaveClass("bg-emerald-50");
  });
});

describe("ConfirmDialog", () => {
  const defaultProps = {
    open: true,
    title: "Delete record?",
    description: "This action cannot be undone.",
    confirmLabel: "Delete record",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders no dialog while closed", () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders accessible content, actions, and contained keyboard focus", async () => {
    render(<ConfirmDialog {...defaultProps} />);

    const dialog = screen.getByRole("dialog", { name: "Delete record?" });
    const dialogQueries = within(dialog);
    const cancelButton = dialogQueries.getByRole("button", { name: "Cancel" });
    const confirmButton = dialogQueries.getByRole("button", {
      name: "Delete record",
    });

    expect(
      dialogQueries.getByText("This action cannot be undone."),
    ).toBeInTheDocument();
    await waitFor(() => expect(cancelButton).toHaveFocus());

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancelButton).toHaveFocus();
  });

  it("invokes onCancel from the Cancel action", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    const dialog = screen.getByRole("dialog", { name: "Delete record?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("invokes onConfirm from the named confirmation action", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    const dialog = screen.getByRole("dialog", { name: "Delete record?" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete record" }),
    );

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels with Escape when not submitting", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables actions and blocks Escape while submitting", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...defaultProps}
        title="Finish operation?"
        confirmLabel="Finish operation"
        onCancel={onCancel}
        onConfirm={onConfirm}
        isSubmitting
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Finish operation?" });
    const dialogQueries = within(dialog);
    const cancelButton = dialogQueries.getByRole("button", { name: "Cancel" });
    const confirmButton = dialogQueries.getByRole("button", {
      name: "Finish operation…",
    });

    expect(cancelButton).toBeDisabled();
    expect(confirmButton).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(confirmButton);

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
