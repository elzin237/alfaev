// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validProjectActivityPng } from "../project-activity-image-upload/test-fixtures";
import {
  handleResolutionImageUploadRequest,
  type ResolutionImagePrivilegedClient,
  type ResolutionImageUploadDependencies,
} from "./handler";

const projectId = "11000000-0000-4000-8000-000000000001";
const activityId = "22000000-0000-4000-8000-000000000001";
const resolutionId = "23000000-0000-4000-8000-000000000001";
const requestId = "33000000-0000-4000-8000-000000000001";
const actorId = "44000000-0000-4000-8000-000000000001";
const attachmentId = "55000000-0000-4000-8000-000000000001";
const objectId = "66000000-0000-4000-8000-000000000001";
const path = `resolution-final/${projectId}/${activityId}/${resolutionId}/${objectId}.png`;

function request(bytes = validProjectActivityPng(), mime = "image/png") {
  const body = new FormData();
  body.set("projectId", projectId);
  body.set("activityId", activityId);
  body.set("resolutionId", resolutionId);
  body.set("requestId", requestId);
  const fileBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  body.set("file", new File([fileBytes], "evidence.png", { type: mime }));
  return new Request("http://local/upload", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body,
  });
}

function harness(options: {
  actorInvalid?: boolean;
  prepareError?: string;
  attachError?: string;
  attachThrows?: boolean;
  existing?: boolean;
  reconcile?: "candidate" | "other" | "none";
} = {}) {
  const bytes = validProjectActivityPng().byteLength;
  const rpc = vi.fn(async (name: string) => {
    if (name === "prepare_project_issue_resolution_image_upload") {
      if (options.prepareError) return { data: null, error: { code: options.prepareError } };
      return { data: options.existing ? [{
        attachment_exists: true,
        attachment_id: attachmentId,
        storage_path: path,
        mime_type: "image/png",
        byte_size: bytes,
        alt_text: null,
      }] : [{
        attachment_exists: false,
        attachment_id: null,
        storage_path: null,
        mime_type: null,
        byte_size: null,
        alt_text: null,
      }], error: null };
    }
    if (name === "attach_project_issue_resolution_image") {
      if (options.attachThrows) throw new Error("transport");
      if (options.attachError) return { data: null, error: { code: options.attachError } };
      return { data: [{
        attachment_created: true,
        attachment_id: attachmentId,
        storage_path: path,
        mime_type: "image/png",
        byte_size: bytes,
        alt_text: null,
      }], error: null };
    }
    if (name === "reconcile_project_issue_resolution_image_upload") {
      if (options.reconcile === "none") return { data: [], error: null };
      const resolvedPath = options.reconcile === "other"
        ? path.replace(objectId, "77000000-0000-4000-8000-000000000001") : path;
      return { data: [{
        metadata_matches: true,
        candidate_referenced: resolvedPath === path,
        attachment_id: attachmentId,
        storage_path: resolvedPath,
        mime_type: "image/png",
        byte_size: bytes,
        alt_text: null,
      }], error: null };
    }
    throw new Error("unexpected RPC");
  });
  const upload = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const privileged = { rpc, storage: { from: vi.fn(() => ({ upload, remove })) } } as ResolutionImagePrivilegedClient;
  const dependencies: ResolutionImageUploadDependencies = {
    createActorClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () =>
      options.actorInvalid
        ? { data: { user: null }, error: { code: "bad" } }
        : { data: { user: { id: actorId } }, error: null }) } })),
    createPrivilegedClient: vi.fn(() => privileged),
    randomUuid: () => objectId,
    sha256: async () => "a".repeat(64),
  };
  return { dependencies, rpc, upload, remove };
}

describe("project-issue-resolution-image-upload", () => {
  it("is JWT protected, keeps service authority server-side, and never uses public URLs", () => {
    const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
    const index = readFileSync(resolve(process.cwd(), "supabase/functions/project-issue-resolution-image-upload/index.ts"), "utf8");
    const handler = readFileSync(resolve(process.cwd(), "supabase/functions/project-issue-resolution-image-upload/handler.ts"), "utf8");
    expect(config).toMatch(/\[functions\.project-issue-resolution-image-upload\][\s\S]*?verify_jwt = true/);
    expect(index).toContain('requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")');
    expect(handler).not.toContain("getPublicUrl");
    expect(index + handler).not.toMatch(/console\./);
  });

  it("rejects anonymous/invalid callers and malformed image bytes before privileged access", async () => {
    const missing = harness();
    const anonymous = request();
    anonymous.headers.delete("authorization");
    expect((await handleResolutionImageUploadRequest(anonymous, missing.dependencies)).status).toBe(401);
    expect(missing.dependencies.createPrivilegedClient).not.toHaveBeenCalled();
    const invalid = harness({ actorInvalid: true });
    expect((await handleResolutionImageUploadRequest(request(), invalid.dependencies)).status).toBe(401);
    const spoofed = harness();
    expect((await handleResolutionImageUploadRequest(
      request(new TextEncoder().encode("not-an-image")), spoofed.dependencies,
    )).status).toBe(400);
    expect(spoofed.rpc).not.toHaveBeenCalled();
  });

  it("binds the exact resolver request and uploads only a server-derived private path", async () => {
    const setup = harness();
    const response = await handleResolutionImageUploadRequest(request(), setup.dependencies);
    expect(response.status).toBe(200);
    expect(setup.rpc).toHaveBeenNthCalledWith(1,
      "prepare_project_issue_resolution_image_upload",
      expect.objectContaining({
        p_project_id: projectId,
        p_activity_id: activityId,
        p_resolution_id: resolutionId,
        p_request_id: requestId,
        p_actor_auth_user_id: actorId,
      }),
    );
    expect(setup.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), {
      cacheControl: "0", contentType: "image/png", upsert: false,
    });
  });

  it("returns an identical existing attachment without another Storage write", async () => {
    const setup = harness({ existing: true });
    expect((await handleResolutionImageUploadRequest(request(), setup.dependencies)).status).toBe(200);
    expect(setup.upload).not.toHaveBeenCalled();
  });

  it("removes a candidate after a definite attach failure", async () => {
    const setup = harness({ attachError: "42501" });
    expect((await handleResolutionImageUploadRequest(request(), setup.dependencies)).status).toBe(403);
    expect(setup.remove).toHaveBeenCalledWith([path]);
  });

  it("reconciles an uncertain attach without replacing immutable evidence", async () => {
    const referenced = harness({ attachThrows: true, reconcile: "candidate" });
    expect((await handleResolutionImageUploadRequest(request(), referenced.dependencies)).status).toBe(200);
    expect(referenced.remove).not.toHaveBeenCalled();
    const existing = harness({ attachThrows: true, reconcile: "other" });
    expect((await handleResolutionImageUploadRequest(request(), existing.dependencies)).status).toBe(200);
    expect(existing.remove).toHaveBeenCalledWith([path]);
    const unknown = harness({ attachThrows: true, reconcile: "none" });
    const response = await handleResolutionImageUploadRequest(request(), unknown.dependencies);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "attachment_outcome_unknown" });
  });
});
