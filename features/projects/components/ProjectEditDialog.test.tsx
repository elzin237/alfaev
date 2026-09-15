import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectEditDialog from "./ProjectEditDialog";

const initialValues = {
  name: "Control Cabinet",
  customerName: "Alfa Customer",
  startDate: "2026-09-01",
  deliveryDate: "2026-09-30",
  status: "planned" as const,
};

afterEach(cleanup);

describe("ProjectEditDialog", () => {
  it("prefills fields and offers exactly the four normal statuses", () => {
    render(<ProjectEditDialog open currentStatus="planned" initialValues={initialValues} onClose={vi.fn()} onSubmit={vi.fn()} onSucceeded={vi.fn()} />);
    expect(screen.getByLabelText("Project Name")).toHaveValue("Control Cabinet");
    expect(screen.getByLabelText("Customer")).toHaveValue("Alfa Customer");
    const status = screen.getByLabelText("Status");
    expect(status).toHaveValue("planned");
    expect(Array.from((status as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "planned", "in_progress", "on_hold", "completed",
    ]);
    expect(screen.queryByRole("option", { name: "Cancelled" })).not.toBeInTheDocument();
  });

  it("renders no normal edit dialog for a Completed Project", () => {
    render(<ProjectEditDialog open currentStatus="completed" initialValues={{ ...initialValues, status: "completed" }} onClose={vi.fn()} onSubmit={vi.fn()} onSucceeded={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "Edit Project" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project Name")).not.toBeInTheDocument();
  });

  it("validates required text and date ordering", async () => {
    const onSubmit = vi.fn();
    render(<ProjectEditDialog open currentStatus="planned" initialValues={initialValues} onClose={vi.fn()} onSubmit={onSubmit} onSucceeded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Project Name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Delivery Date"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("Project Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Customer is required.")).toBeInTheDocument();
    expect(screen.getByText("Delivery Date cannot be before Start Date.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits normalized values, closes, and reports success", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, value: { projectId: "id" } });
    const onClose = vi.fn();
    const onSucceeded = vi.fn();
    render(<ProjectEditDialog open currentStatus="planned" initialValues={initialValues} onClose={onClose} onSubmit={onSubmit} onSucceeded={onSucceeded} />);
    fireEvent.change(screen.getByLabelText("Project Name"), { target: { value: "  Updated Project  " } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ...initialValues, name: "Updated Project", status: "in_progress" }));
    expect(onSucceeded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks duplicate submission and keeps safe service errors visible", async () => {
    let resolveSubmission: ((value: { ok: false; error: { code: "project_update_failed"; message: string } }) => void) | undefined;
    const onSubmit = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSubmission = resolve; }));
    render(<ProjectEditDialog open currentStatus="planned" initialValues={initialValues} onClose={vi.fn()} onSubmit={onSubmit} onSucceeded={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "Save Changes" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    resolveSubmission?.({ ok: false, error: { code: "project_update_failed", message: "The Project could not be updated. Please try again." } });
    expect(await screen.findByRole("alert")).toHaveTextContent("The Project could not be updated. Please try again.");
  });
});
