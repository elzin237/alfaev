import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));

import {
  getProjectActivityImageAccess,
  getProjectIssueResolutionImageAccess,
  getProjectActivity,
  listProjectActivity,
  postProjectActivity,
  resolveProjectIssue,
  uploadProjectActivityImage,
  uploadProjectIssueResolutionImage,
} from "./projectActivityService";

const projectId = "00000000-0000-4000-8000-000000000001";
const activityId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const attachmentId = "00000000-0000-4000-8000-000000000005";
const createdAt = "2026-10-19T10:00:00.123456+00:00";

const activityRow = {
  activity_id: activityId,
  project_id: projectId,
  author_user_id: actorId,
  author_full_name: "Inactive Historical Actor",
  title: "Site update",
  description: "Line one\nLine two",
  activity_kind: "general",
  created_at: createdAt,
  alert_sent: true,
  attachment_id: attachmentId,
  attachment_mime_type: "image/png",
  attachment_byte_size: "512",
  attachment_alt_text: null,
  issue_resolved: false,
  resolution_id: null,
  resolved_by_user_id: null,
  resolver_full_name: null,
  resolution_description: null,
  resolved_at: null,
  resolution_attachment_id: null,
  resolution_attachment_mime_type: null,
  resolution_attachment_byte_size: null,
  resolution_attachment_alt_text: null,
  has_more: true,
};

function edgeError(code: string) {
  return {
    context: new Response(JSON.stringify({ code, message: "raw detail" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  };
}

beforeEach(() => vi.resetAllMocks());

describe("projectActivityService", () => {
  it("uses trusted RPC/Edge boundaries without browser Storage APIs or path input", () => {
    const source = readFileSync(
      resolve(process.cwd(), "features/projects/services/projectActivityService.ts"),
      "utf8",
    );
    expect(source).toContain('"list_project_activity_with_issue_resolution"');
    expect(source).toContain('supabase.rpc("post_project_activity"');
    expect(source).toContain('"project-activity-image-upload"');
    expect(source).toContain('"project-activity-image-access"');
    expect(source).not.toContain("supabase.storage");
    expect(source).not.toContain('body.set("storage');
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });

  it("lists the exact narrow Activity projection with keyset cursor and bigint-safe image size", async () => {
    mocks.rpc.mockResolvedValue({ data: [activityRow], error: null });
    await expect(listProjectActivity(projectId, {
      createdAt,
      activityId,
    })).resolves.toEqual({
      ok: true,
      value: {
        hasMore: true,
        items: [{
          activityId,
          projectId,
          authorUserId: actorId,
          authorFullName: "Inactive Historical Actor",
          title: "Site update",
          description: "Line one\nLine two",
          activityKind: "general",
          createdAt,
          alertSent: true,
          attachment: {
            attachmentId,
            mimeType: "image/png",
            byteSize: 512,
            altText: null,
          },
          resolution: null,
        }],
      },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_project_activity_with_issue_resolution",
      {
      p_project_id: projectId,
      p_limit: 20,
      p_before_created_at: createdAt,
      p_before_id: activityId,
      },
    );
  });

  it("supports empty pages and rejects extra or malformed fields safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(listProjectActivity(projectId)).resolves.toEqual({
      ok: true,
      value: { items: [], hasMore: false },
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [{ ...activityRow, storage_path: "secret/path" }],
      error: null,
    });
    await expect(listProjectActivity(projectId)).resolves.toMatchObject({
      ok: false,
      error: { code: "activity_load_failed" },
    });
  });

  it("parses an Issue and its exact authoritative resolution projection", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        ...activityRow,
        activity_kind: "issue",
        issue_resolved: true,
        resolution_id: "00000000-0000-4000-8000-000000000021",
        resolved_by_user_id: "00000000-0000-4000-8000-000000000022",
        resolver_full_name: "Issue Resolver",
        resolution_description: "Replaced the damaged contactor.",
        resolved_at: "2026-10-20T12:00:00.000Z",
        resolution_attachment_id: "00000000-0000-4000-8000-000000000024",
        resolution_attachment_mime_type: "image/jpeg",
        resolution_attachment_byte_size: "2048",
        resolution_attachment_alt_text: "Resolved contactor",
      }],
      error: null,
    });

    await expect(listProjectActivity(projectId)).resolves.toMatchObject({
      ok: true,
      value: {
        items: [{
          activityKind: "issue",
          resolution: {
            resolutionId: "00000000-0000-4000-8000-000000000021",
            resolverFullName: "Issue Resolver",
            description: "Replaced the damaged contactor.",
            attachment: {
              attachmentId: "00000000-0000-4000-8000-000000000024",
              mimeType: "image/jpeg",
              byteSize: 2048,
              altText: "Resolved contactor",
            },
          },
        }],
      },
    });
  });

  it("reads the exact authoritative posted Activity for immediate cache reconciliation", async () => {
    const { has_more: _hasMore, ...exactRow } = activityRow;
    mocks.rpc.mockResolvedValue({ data: [exactRow], error: null });
    await expect(getProjectActivity(projectId, activityId)).resolves.toMatchObject({
      ok: true,
      value: {
        activityId,
        projectId,
        authorFullName: "Inactive Historical Actor",
        createdAt,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_project_activity_with_issue_resolution",
      {
      p_project_id: projectId,
      p_activity_id: activityId,
      },
    );
  });

  it("maps unavailable, access-denied, and transient target failures safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002" } });
    await expect(getProjectActivity(projectId, activityId)).resolves.toEqual({
      ok: false,
      error: {
        code: "activity_unavailable",
        message: "This Project Activity is unavailable.",
      },
    });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(getProjectActivity(projectId, activityId)).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to this Project Activity.",
      },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("private transport details"));
    await expect(getProjectActivity(projectId, activityId)).resolves.toEqual({
      ok: false,
      error: {
        code: "activity_load_failed",
        message: "Couldn't load the linked Activity.",
      },
    });
  });

  it("rejects a mismatched target identity without exposing the response", async () => {
    const { has_more: _hasMore, ...exactRow } = activityRow;
    mocks.rpc.mockResolvedValue({
      data: [{
        ...exactRow,
        project_id: "00000000-0000-4000-8000-000000000099",
      }],
      error: null,
    });
    await expect(getProjectActivity(projectId, activityId)).resolves.toMatchObject({
      ok: false,
      error: { code: "activity_load_failed" },
    });
  });

  it("posts the normalized logical submission and preserves exact authoritative identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        activity_id: activityId,
        project_id: projectId,
        request_id: requestId,
        title: "Site update",
        description: "Line one\nLine two",
        created_at: createdAt,
        author_user_id: actorId,
        alert_sent: false,
        alert_id: null,
        recipient_count: "0",
      }],
      error: null,
    });
    const input = {
      projectId,
      requestId,
      title: "Site update",
      description: "Line one\nLine two",
      sendAlert: false,
      activityKind: "general" as const,
    };
    await expect(postProjectActivity(input)).resolves.toMatchObject({
      ok: true,
      value: { activityId, requestId, alertSent: false, recipientCount: "0" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("post_project_activity", {
      p_project_id: projectId,
      p_request_id: requestId,
      p_title: "Site update",
      p_description: "Line one\nLine two",
      p_send_alert: false,
      p_activity_kind: "general",
    });
  });

  it.each([
    ["22023", "invalid_content"],
    ["PAC01", "conflicting_request"],
    ["PAC02", "project_closed"],
    ["PAC03", "no_alert_recipients"],
    ["P0002", "project_unavailable"],
    ["42501", "access_denied"],
  ])("maps post error %s without raw backend detail", async (backend, frontend) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: backend, message: "secret" } });
    const result = await postProjectActivity({
      projectId, requestId, title: "Title", description: "Description", sendAlert: true,
      activityKind: "issue",
    });
    expect(result).toMatchObject({ ok: false, error: { code: frontend } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("distinguishes an ambiguous thrown post outcome for same-request reconciliation", async () => {
    mocks.rpc.mockRejectedValue(new Error("network timeout secret"));
    await expect(postProjectActivity({
      projectId, requestId, title: "Title", description: "Description", sendAlert: false,
      activityKind: "general",
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "post_outcome_unknown",
        message: "The posting result could not be confirmed. Retry this same update.",
      },
    });
  });

  it("resolves an Issue with exact trusted arguments and parses its narrow result", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        resolution_id: "00000000-0000-4000-8000-000000000021",
        project_activity_id: activityId,
        project_id: projectId,
        request_id: requestId,
        resolved_by_user_id: actorId,
        resolver_full_name: "Issue Resolver",
        description: "Replaced the damaged contactor.",
        resolved_at: "2026-10-20T12:00:00.000Z",
        notification_id: "00000000-0000-4000-8000-000000000023",
        recipient_count: "4",
      }],
      error: null,
    });

    await expect(resolveProjectIssue({
      activityId,
      requestId,
      description: "Replaced the damaged contactor.",
    })).resolves.toMatchObject({
      ok: true,
      value: {
        projectActivityId: activityId,
        requestId,
        resolverFullName: "Issue Resolver",
        recipientCount: "4",
      },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("resolve_project_issue", {
      p_project_activity_id: activityId,
      p_request_id: requestId,
      p_description: "Replaced the damaged contactor.",
    });
  });

  it.each([
    ["22023", "invalid_description"],
    ["PIR01", "conflicting_request"],
    ["PIR02", "not_an_issue"],
    ["PIR03", "already_resolved"],
    ["P0002", "issue_unavailable"],
    ["42501", "access_denied"],
  ])("maps Issue resolution error %s without raw detail", async (backend, frontend) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backend, message: "private SQL detail" },
    });
    const result = await resolveProjectIssue({
      activityId,
      requestId,
      description: "Resolution",
    });
    expect(result).toMatchObject({ ok: false, error: { code: frontend } });
    expect(JSON.stringify(result)).not.toContain("private SQL detail");
  });

  it("keeps an indeterminate resolution outcome retryable with the same caller identity", async () => {
    mocks.rpc.mockRejectedValue(new Error("transport secret"));
    await expect(resolveProjectIssue({
      activityId,
      requestId,
      description: "Resolution",
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "resolution_outcome_unknown",
        message: "The resolution result could not be confirmed. Retry this same resolution.",
      },
    });
  });

  it("uploads only the trusted multipart identity and no Storage path", async () => {
    mocks.invoke.mockResolvedValue({
      data: { attachmentId, mimeType: "image/png", byteSize: 4, altText: "Panel" },
      error: null,
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "panel.png", {
      type: "image/png",
    });
    await expect(uploadProjectActivityImage({
      projectId, activityId, requestId, file, altText: "Panel",
    })).resolves.toMatchObject({ ok: true, value: { attachmentId } });
    const [, options] = mocks.invoke.mock.calls[0] as [string, { body: FormData }];
    expect(mocks.invoke.mock.calls[0]?.[0]).toBe("project-activity-image-upload");
    expect([...options.body.keys()].sort()).toEqual([
      "activityId", "altText", "file", "projectId", "requestId",
    ]);
    expect(options.body.get("projectId")).toBe(projectId);
    expect(options.body.get("activityId")).toBe(activityId);
    expect(options.body.get("requestId")).toBe(requestId);
    expect(options.body.has("storagePath")).toBe(false);
  });

  it.each([
    ["attachment_conflict", "attachment_conflict"],
    ["attachment_outcome_unknown", "attachment_outcome_unknown"],
    ["invalid_image", "invalid_image"],
  ])("maps image error %s safely", async (backend, frontend) => {
    mocks.invoke.mockResolvedValue({ data: null, error: edgeError(backend) });
    const file = new File(["x"], "x.png", { type: "image/png" });
    await expect(uploadProjectActivityImage({
      projectId, activityId, requestId, file, altText: null,
    })).resolves.toMatchObject({ ok: false, error: { code: frontend } });
  });

  it("requests exact image access and validates the 300-second private contract", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        signedUrl: "https://storage.example/object?token=signed",
        expiresIn: 300,
        mimeType: "image/webp",
        byteSize: 42,
        altText: null,
      },
      error: null,
    });
    await expect(getProjectActivityImageAccess(projectId, activityId)).resolves.toEqual({
      ok: true,
      value: {
        signedUrl: "https://storage.example/object?token=signed",
        expiresIn: 300,
        mimeType: "image/webp",
        byteSize: 42,
        altText: null,
      },
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "project-activity-image-access",
      { body: { projectId, activityId } },
    );
  });

  it("uploads resolution evidence with exact immutable resolution/request identity", async () => {
    mocks.invoke.mockResolvedValue({
      data: { attachmentId, mimeType: "image/png", byteSize: 4, altText: null },
      error: null,
    });
    const resolutionId = "00000000-0000-4000-8000-000000000021";
    const file = new File([new Uint8Array([1, 2, 3, 4])], "evidence.png", {
      type: "image/png",
    });
    await expect(uploadProjectIssueResolutionImage({
      projectId, activityId, resolutionId, requestId, file, altText: null,
    })).resolves.toMatchObject({ ok: true, value: { attachmentId } });
    const [name, options] = mocks.invoke.mock.calls[0] as [string, { body: FormData }];
    expect(name).toBe("project-issue-resolution-image-upload");
    expect([...options.body.keys()].sort()).toEqual([
      "activityId", "file", "projectId", "requestId", "resolutionId",
    ]);
    expect(options.body.has("storagePath")).toBe(false);
  });

  it("requests exact resolution image access through the trusted signer", async () => {
    mocks.invoke.mockResolvedValue({ data: {
      signedUrl: "https://storage.example/object?token=signed",
      expiresIn: 300,
      mimeType: "image/png",
      byteSize: 42,
      altText: "Evidence",
    }, error: null });
    const resolutionId = "00000000-0000-4000-8000-000000000021";
    await expect(getProjectIssueResolutionImageAccess(
      projectId, activityId, resolutionId,
    )).resolves.toMatchObject({ ok: true, value: { expiresIn: 300 } });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "project-issue-resolution-image-access",
      { body: { projectId, activityId, resolutionId } },
    );
  });
});
