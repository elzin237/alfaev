import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postProjectActivity: vi.fn(),
  uploadProjectActivityImage: vi.fn(),
}));
vi.mock("../services/projectActivityService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/projectActivityService")>();
  return {
    ...original,
    postProjectActivity: mocks.postProjectActivity,
    uploadProjectActivityImage: mocks.uploadProjectActivityImage,
  };
});

import ProjectActivityComposer from "./ProjectActivityComposer";

const projectId = "00000000-0000-4000-8000-000000000001";
const activityId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const success = (sendAlert = false) => ({
  ok: true as const,
  value: {
    activityId,
    projectId,
    requestId,
    title: "Status update",
    description: "First line\nSecond line",
    createdAt: "2026-10-19T10:00:00.000Z",
    authorUserId: actorId,
    alertSent: sendAlert,
    alertId: sendAlert ? "00000000-0000-4000-8000-000000000005" : null,
    recipientCount: sendAlert ? "2" : "0",
  },
});

function renderComposer(canSendAlert = true) {
  const onActivityChanged = vi.fn().mockResolvedValue(undefined);
  const onCompleted = vi.fn();
  const onProjectUnavailable = vi.fn().mockResolvedValue(undefined);
  render(
    <StrictMode>
      <ProjectActivityComposer
        projectId={projectId}
        canSendAlert={canSendAlert}
        onActivityChanged={onActivityChanged}
        onCompleted={onCompleted}
        onProjectUnavailable={onProjectUnavailable}
      />
    </StrictMode>,
  );
  return { onActivityChanged, onCompleted, onProjectUnavailable };
}

function fillForm() {
  const entry = screen.getByRole("button", {
    name: "Share an update or report an issue...",
  });
  if (entry.getAttribute("aria-expanded") === "false") fireEvent.click(entry);
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "  Status update  " },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "  First line\nSecond line  " },
  });
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => requestId) });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
  mocks.postProjectActivity.mockResolvedValue(success(false));
  mocks.uploadProjectActivityImage.mockResolvedValue({
    ok: true,
    value: {
      attachmentId: "00000000-0000-4000-8000-000000000006",
      mimeType: "image/png",
      byteSize: 4,
      altText: null,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("ProjectActivityComposer", () => {
  it("starts collapsed and expands accessibly with focus on the compact form", () => {
    renderComposer();
    const entry = screen.getByRole("button", {
      name: "Share an update or report an issue...",
    });
    expect(entry).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    entry.focus();
    fireEvent.click(entry);
    expect(entry).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(entry.getAttribute("aria-controls")).toBeTruthy();
  });

  it("preserves a draft through manual collapse and restores it on reopen", () => {
    renderComposer();
    fillForm();
    const entry = screen.getByRole("button", {
      name: "Share an update or report an issue...",
    });
    fireEvent.click(entry);
    expect(entry).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.getByLabelText("Title")).toHaveValue("  Status update  ");
    expect(screen.getByLabelText("Description"))
      .toHaveValue("  First line\nSecond line  ");
  });

  it("renders accessible validated inputs and posts one normalized ordinary update", async () => {
    const { onActivityChanged, onCompleted } = renderComposer(false);
    fillForm();
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Description")).toHaveAttribute("maxlength", "5000");
    expect(screen.queryByRole("button", { name: "Post & send alert" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await waitFor(() => expect(mocks.postProjectActivity).toHaveBeenCalledOnce());
    expect(mocks.postProjectActivity).toHaveBeenCalledWith({
      projectId,
      requestId,
      title: "Status update",
      description: "First line\nSecond line",
      sendAlert: false,
      activityKind: "general",
    });
    expect(onActivityChanged).toHaveBeenCalledExactlyOnceWith(
      activityId,
      true,
      false,
    );
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(false);
    const entry = screen.getByRole("button", {
      name: "Share an update or report an issue...",
    });
    expect(entry).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByRole("radio", { name: /General update/ })).toBeChecked();
  });

  it("defaults to General update and posts an explicitly selected Issue", async () => {
    renderComposer();
    fillForm();
    const general = screen.getByRole("radio", { name: /General update/ });
    const issue = screen.getByRole("radio", { name: /^Issue/ });
    expect(general).toBeChecked();
    expect(issue).not.toBeChecked();
    fireEvent.click(issue);
    expect(issue).toBeChecked();
    expect(screen.getByText("Report a problem that requires resolution."))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await waitFor(() => expect(mocks.postProjectActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityKind: "issue", requestId }),
    ));
  });

  it("keeps validation errors expanded and announces them", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(screen.getAllByText(/Enter a (title|description)/)).toHaveLength(2);
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "true");
    expect(mocks.postProjectActivity).not.toHaveBeenCalled();
  });

  it("posts alert intent only through the distinctly authorized action", async () => {
    mocks.postProjectActivity.mockResolvedValue(success(true));
    const { onActivityChanged, onCompleted } = renderComposer(true);
    fillForm();
    expect(screen.getByText(
      "Sends this update to users assigned to receive Project alerts.",
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Post & send alert" }));
    await waitFor(() => expect(mocks.postProjectActivity).toHaveBeenCalledWith(
      expect.objectContaining({ sendAlert: true, requestId }),
    ));
    expect(onActivityChanged).toHaveBeenCalledExactlyOnceWith(
      activityId,
      true,
      true,
    );
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "false");
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("suppresses five rapid submissions with one request UUID while posting", async () => {
    let resolvePost!: (value: ReturnType<typeof success>) => void;
    mocks.postProjectActivity.mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve;
    }));
    const { onCompleted } = renderComposer();
    fillForm();
    const submit = screen.getByRole("button", { name: "Post update" });
    for (let click = 0; click < 5; click += 1) fireEvent.click(submit);
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Posting update...");
    resolvePost(success(false));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledExactlyOnceWith(false));
  });

  it("prevents normal and alert actions from submitting concurrently", async () => {
    mocks.postProjectActivity.mockReturnValue(new Promise(() => undefined));
    renderComposer(true);
    fillForm();
    const normal = screen.getByRole("button", { name: "Post update" });
    const alert = screen.getByRole("button", { name: "Post & send alert" });
    fireEvent.click(normal);
    fireEvent.click(alert);
    expect(mocks.postProjectActivity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sendAlert: false, requestId }),
    );
    expect(normal).toBeDisabled();
    expect(alert).toBeDisabled();
  });

  it("retains content for PAC03 and refreshes Project state for PAC02", async () => {
    const { onProjectUnavailable } = renderComposer();
    fillForm();
    mocks.postProjectActivity.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "no_alert_recipients",
        message: "No active users are assigned to receive Project alerts.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post & send alert" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No active users");
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Title")).toHaveValue("  Status update  ");

    mocks.postProjectActivity.mockResolvedValueOnce({
      ok: false,
      error: { code: "project_closed", message: "This Project no longer accepts updates." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await waitFor(() => expect(onProjectUnavailable).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Description")).toHaveValue("  First line\nSecond line  ");
  });

  it("retries an uncertain post with the same UUID, content, and alert intent", async () => {
    mocks.postProjectActivity
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "post_outcome_unknown",
          message: "The posting result could not be confirmed. Retry this same update.",
        },
      })
      .mockResolvedValueOnce(success(true));
    const { onActivityChanged } = renderComposer(true);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Post & send alert" }));
    expect(await screen.findByRole("button", { name: "Retry same update" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same update" }));
    await waitFor(() => expect(mocks.postProjectActivity).toHaveBeenCalledTimes(2));
    expect(mocks.postProjectActivity.mock.calls[1]).toEqual(
      mocks.postProjectActivity.mock.calls[0],
    );
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(onActivityChanged).toHaveBeenCalledExactlyOnceWith(
      activityId,
      true,
      true,
    );
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "false");
  });

  it("validates, previews, and removes a selected image before posting", () => {
    renderComposer();
    fillForm();
    expect(screen.getByRole("button", { name: "Add image" })).toBeInTheDocument();
    expect(screen.getByText("JPEG, PNG or WebP · Max 5 MiB")).toBeInTheDocument();
    const input = screen.getByLabelText("Activity image");
    expect(input).toHaveClass("sr-only");
    const inputClick = vi.spyOn(input as HTMLInputElement, "click");
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(inputClick).toHaveBeenCalledOnce();
    const invalid = new File(["x"], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [invalid] } });
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");

    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" },
    );
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole("alert")).toHaveTextContent("up to 5 MiB");

    const image = new File(["png"], "panel.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [image] } });
    expect(screen.getByRole("img", { name: "Selected Activity preview" }))
      .toHaveAttribute("src", "blob:preview");
    expect(screen.getByText("panel.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove selected image" }));
    expect(screen.queryByText("panel.png")).not.toBeInTheDocument();
  });

  it("shows posting then image-upload progress and claims success only after attachment", async () => {
    let resolvePost!: (value: ReturnType<typeof success>) => void;
    let resolveUpload!: (value: {
      ok: true;
      value: {
        attachmentId: string;
        mimeType: "image/png";
        byteSize: number;
        altText: null;
      };
    }) => void;
    mocks.postProjectActivity.mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve;
    }));
    mocks.uploadProjectActivityImage.mockReturnValue(new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    const { onCompleted, onActivityChanged } = renderComposer();
    fillForm();
    fireEvent.change(screen.getByLabelText("Activity image"), {
      target: { files: [new File(["png"], "panel.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(screen.getByRole("status")).toHaveTextContent("Posting update...");
    resolvePost(success(false));
    expect(await screen.findByText("Uploading image...")).toBeInTheDocument();
    expect(onActivityChanged).toHaveBeenCalledExactlyOnceWith(
      activityId,
      true,
      false,
    );
    expect(onCompleted).not.toHaveBeenCalled();

    resolveUpload({
      ok: true,
      value: {
        attachmentId: "00000000-0000-4000-8000-000000000006",
        mimeType: "image/png",
        byteSize: 3,
        altText: null,
      },
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalledExactlyOnceWith(false));
    expect(onActivityChanged).toHaveBeenNthCalledWith(
      2,
      activityId,
      false,
      false,
    );
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves committed Activity identity on image failure and retries only the image", async () => {
    mocks.uploadProjectActivityImage
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "attachment_outcome_unknown",
          message: "The image upload result could not be confirmed. Retry the same image.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          attachmentId: "00000000-0000-4000-8000-000000000006",
          mimeType: "image/png",
          byteSize: 3,
          altText: "Panel",
        },
      });
    const { onCompleted } = renderComposer();
    fillForm();
    const file = new File(["png"], "panel.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Activity image"), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText("Image alt text (optional)"), {
      target: { value: "  Panel  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
      "Update posted, but the image was not attached.",
    ));
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry image upload" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post update" }))
      .not.toBeInTheDocument();
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(mocks.uploadProjectActivityImage).toHaveBeenCalledWith({
      projectId,
      activityId,
      requestId,
      file,
      altText: "Panel",
    });

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry image upload" }));
    await waitFor(() => expect(mocks.uploadProjectActivityImage).toHaveBeenCalledTimes(2));
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(mocks.uploadProjectActivityImage.mock.calls[1])
      .toEqual(mocks.uploadProjectActivityImage.mock.calls[0]);
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(false);
    fireEvent.click(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("reports alert-plus-image partial success without exposing a resend action", async () => {
    mocks.postProjectActivity.mockResolvedValue(success(true));
    mocks.uploadProjectActivityImage
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "image_upload_failed", message: "The image could not be attached." },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          attachmentId: "00000000-0000-4000-8000-000000000006",
          mimeType: "image/png",
          byteSize: 3,
          altText: null,
        },
      });
    const { onActivityChanged, onCompleted } = renderComposer(true);
    fillForm();
    fireEvent.change(screen.getByLabelText("Activity image"), {
      target: { files: [new File(["png"], "panel.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post & send alert" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
      "Alert sent. Image attachment failed.",
    ));
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Post & send alert" }))
      .not.toBeInTheDocument();
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(onActivityChanged).toHaveBeenCalledExactlyOnceWith(
      activityId,
      true,
      true,
    );
    expect(onActivityChanged.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.uploadProjectActivityImage.mock.invocationCallOrder[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry image upload" }));
    await waitFor(() => expect(mocks.uploadProjectActivityImage).toHaveBeenCalledTimes(2));
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true);
  });
});
