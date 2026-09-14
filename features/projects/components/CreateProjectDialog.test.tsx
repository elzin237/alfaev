import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectCreateResult } from "../services/projectService";
import CreateProjectDialog from "./CreateProjectDialog";

function renderDialog(
  onSubmit: (
    input: {
      name: string;
      customerName: string;
      startDate: string;
      deliveryDate: string;
    },
  ) => Promise<ProjectCreateResult> = vi.fn().mockResolvedValue({
    ok: true,
    value: { projectId: "00000000-0000-4000-8000-000000000010" },
  }),
) {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  render(
    <CreateProjectDialog
      open
      onClose={onClose}
      onSubmit={onSubmit}
      onCreated={onCreated}
    />,
  );

  return { onClose, onCreated, onSubmit };
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Project Name"), {
    target: { value: "  Control Cabinet  " },
  });
  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: "  Alfa Customer  " },
  });
  fireEvent.change(screen.getByLabelText("Start Date"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText("Delivery Date"), {
    target: { value: "2026-09-30" },
  });
}

afterEach(cleanup);

describe("CreateProjectDialog", () => {
  it("validates required fields without exposing lifecycle controls", async () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    expect(await screen.findByText("Project Name is required."))
      .toBeInTheDocument();
    expect(screen.getByText("Customer is required.")).toBeInTheDocument();
    expect(screen.getByText("Start Date is required.")).toBeInTheDocument();
    expect(screen.getByText("Delivery Date is required.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Status$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/completed|cancelled/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects delivery before start", async () => {
    const { onSubmit } = renderDialog();
    fillValidForm();
    fireEvent.change(screen.getByLabelText("Delivery Date"), {
      target: { value: "2026-08-31" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    expect(await screen.findByText(
      "Delivery Date cannot be before Start Date.",
    )).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits normalized values, then resets and closes on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      value: { projectId: "00000000-0000-4000-8000-000000000010" },
    });
    const { onClose, onCreated } = renderDialog(onSubmit);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      name: "Control Cabinet",
      customerName: "Alfa Customer",
      startDate: "2026-09-01",
      deliveryDate: "2026-09-30",
    }));
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Project Name")).toHaveValue("");
    expect(screen.getByLabelText("Customer")).toHaveValue("");
    expect(screen.getByLabelText("Start Date")).toHaveValue("");
    expect(screen.getByLabelText("Delivery Date")).toHaveValue("");
  });

  it("blocks duplicate submission while creation is pending", async () => {
    let resolveSubmission: ((result: ProjectCreateResult) => void) | undefined;
    const pendingSubmission = new Promise<ProjectCreateResult>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    renderDialog(onSubmit);
    fillValidForm();
    const submit = screen.getByRole("button", { name: "Create Project" });

    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(submit).toBeDisabled();

    resolveSubmission?.({
      ok: true,
      value: { projectId: "00000000-0000-4000-8000-000000000010" },
    });
    await pendingSubmission;
  });

  it("keeps a safe backend error visible and remains open", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "project_create_failed",
        message: "The Project could not be created. Please try again.",
      },
    });
    const { onClose, onCreated } = renderDialog(onSubmit);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Project could not be created. Please try again.",
    );
    expect(screen.getByRole("dialog", { name: "Create Project" }))
      .toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
