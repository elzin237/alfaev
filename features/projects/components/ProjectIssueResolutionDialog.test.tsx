import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectActivityItem } from "../services/projectActivityService";
import * as projectActivityService from "../services/projectActivityService";
import ProjectIssueResolutionDialog from "./ProjectIssueResolutionDialog";

const issue: ProjectActivityItem = {
  activityId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  authorUserId: "00000000-0000-4000-8000-000000000003",
  authorFullName: "Issue Author",
  title: "Damaged contactor",
  description: "The main contactor failed during commissioning.",
  activityKind: "issue",
  createdAt: "2026-10-20T10:00:00.000Z",
  alertSent: true,
  attachment: null,
  resolution: null,
};
const requestId = "00000000-0000-4000-8000-000000000004";

function success() {
  return {
    ok: true as const,
    value: {
      resolutionId: "00000000-0000-4000-8000-000000000005",
      projectActivityId: issue.activityId,
      projectId: issue.projectId,
      requestId,
      resolvedByUserId: "00000000-0000-4000-8000-000000000006",
      resolverFullName: "Issue Resolver",
      description: "Replaced the contactor.",
      resolvedAt: "2026-10-20T12:00:00.000Z",
      notificationId: "00000000-0000-4000-8000-000000000007",
      recipientCount: "3",
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => requestId) });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:resolution-preview"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("ProjectIssueResolutionDialog", () => {
  it("shows Issue context, validates trimmed text, and submits exact trusted arguments", async () => {
    const onResolve = vi.fn().mockResolvedValue(success());
    const onCancel = vi.fn();
    render(
      <ProjectIssueResolutionDialog
        issue={issue}
        open
        onCancel={onCancel}
        onResolve={onResolve}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Resolve issue" })).toBeInTheDocument();
    expect(screen.getByText("Damaged contactor")).toBeInTheDocument();
    expect(screen.getByLabelText("Resolution description")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a resolution description between 1 and 5000 characters.",
    );
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Resolution description"), {
      target: { value: "  Replaced the contactor.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledExactlyOnceWith({
      activityId: issue.activityId,
      requestId,
      description: "Replaced the contactor.",
    }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("retains text and the request UUID across an indeterminate retry", async () => {
    const onResolve = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "resolution_outcome_unknown",
          message: "The resolution result could not be confirmed. Retry this same resolution.",
        },
      })
      .mockResolvedValueOnce(success());
    render(
      <ProjectIssueResolutionDialog
        issue={issue}
        open
        onCancel={vi.fn()}
        onResolve={onResolve}
      />,
    );
    fireEvent.change(screen.getByLabelText("Resolution description"), {
      target: { value: "Replaced the contactor." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry this same resolution");
    expect(screen.getByLabelText("Resolution description"))
      .toHaveValue("Replaced the contactor.");
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(2));
    expect(onResolve.mock.calls[1]).toEqual(onResolve.mock.calls[0]);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("contains keyboard focus, closes with Escape, and returns focus", () => {
    const onCancel = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const rendered = render(
      <ProjectIssueResolutionDialog
        issue={issue}
        open
        onCancel={onCancel}
        onResolve={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("Resolution description");
    const confirm = screen.getByRole("button", { name: "Resolve issue" });
    expect(textarea).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(textarea).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    rendered.rerender(
      <ProjectIssueResolutionDialog
        issue={issue}
        open={false}
        onCancel={onCancel}
        onResolve={vi.fn()}
      />,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("commits text first, uploads optional evidence, and safely retries only the image", async () => {
    const onResolve = vi.fn().mockResolvedValue(success());
    const onImageAttached = vi.fn();
    const upload = vi.spyOn(
      projectActivityService,
      "uploadProjectIssueResolutionImage",
    ).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "image_upload_failed",
        message: "The image could not be attached. Please try again.",
      },
    }).mockResolvedValueOnce({
      ok: true,
      value: {
        attachmentId: "00000000-0000-4000-8000-000000000008",
        mimeType: "image/png",
        byteSize: 4,
        altText: "Resolution evidence for Damaged contactor",
      },
    });
    const onCancel = vi.fn();
    render(
      <ProjectIssueResolutionDialog
        issue={issue}
        open
        onCancel={onCancel}
        onResolve={onResolve}
        onImageAttached={onImageAttached}
      />,
    );
    fireEvent.change(screen.getByLabelText("Resolution description"), {
      target: { value: "Replaced the contactor." },
    });
    fireEvent.change(screen.getByLabelText(/Resolution image/), {
      target: { files: [new File([new Uint8Array([1, 2, 3, 4])], "evidence.png", {
        type: "image/png",
      })] },
    });
    expect(screen.getByAltText("Resolution evidence preview")).toHaveAttribute(
      "src",
      "blob:resolution-preview",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Issue is resolved, but its image was not attached.",
    );
    expect(onResolve).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      projectId: issue.projectId,
      activityId: issue.activityId,
      resolutionId: success().value.resolutionId,
      requestId,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Try image again" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onResolve).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(onImageAttached).toHaveBeenCalledExactlyOnceWith(issue.activityId);
  });

  it("rejects invalid image type/size before resolving", () => {
    const onResolve = vi.fn();
    render(
      <ProjectIssueResolutionDialog
        issue={issue}
        open
        onCancel={vi.fn()}
        onResolve={onResolve}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Resolution image/), {
      target: { files: [new File(["pdf"], "evidence.pdf", {
        type: "application/pdf",
      })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select one JPEG, PNG, or WebP image up to 5 MiB.",
    );
    expect(onResolve).not.toHaveBeenCalled();
  });
});
