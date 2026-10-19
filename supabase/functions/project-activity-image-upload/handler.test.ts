// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  handleProjectActivityImageUploadRequest,
  type ProjectActivityImagePrivilegedClient,
  type ProjectActivityImageUploadDependencies,
} from "./handler";
import { validProjectActivityPng } from "./test-fixtures";

const projectId = "11000000-0000-4000-8000-000000000001";
const activityId = "22000000-0000-4000-8000-000000000001";
const requestId = "33000000-0000-4000-8000-000000000001";
const actorId = "44000000-0000-4000-8000-000000000001";
const attachmentId = "55000000-0000-4000-8000-000000000001";
const objectId = "66000000-0000-4000-8000-000000000001";
const contentHash = "a".repeat(64);
const candidatePath = `final/${projectId}/${activityId}/${objectId}.png`;

function uploadRequest(
  bytes = validProjectActivityPng(),
  mimeType = "image/png",
  authorization = "Bearer actor-jwt",
): Request {
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("activityId", activityId);
  form.set("requestId", requestId);
  form.set("altText", "  Site progress  ");
  const fileBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.set(
    "file",
    new File([fileBytes], "ignored-name.anything", { type: mimeType }),
  );
  return new Request(
    "http://localhost/functions/v1/project-activity-image-upload",
    { method: "POST", headers: { authorization }, body: form },
  );
}

function attachmentRow(path = candidatePath, created = true) {
  return [{
    attachment_created: created,
    attachment_id: attachmentId,
    storage_path: path,
    mime_type: "image/png",
    byte_size: validProjectActivityPng().byteLength,
    alt_text: "Site progress",
  }];
}

interface HarnessOptions {
  attachError?: string;
  attachThrows?: boolean;
  existing?: boolean;
  invalidActor?: boolean;
  prepareError?: string;
  reconcile?: "candidate" | "existing" | "none" | "throws";
  uploadFails?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "prepare_project_activity_image_upload") {
      if (options.prepareError) {
        return { data: null, error: { code: options.prepareError } };
      }
      return options.existing
        ? {
          data: [{
            attachment_exists: true,
            attachment_id: attachmentId,
            storage_path: candidatePath,
            mime_type: "image/png",
            byte_size: validProjectActivityPng().byteLength,
            alt_text: "Site progress",
          }],
          error: null,
        }
        : {
          data: [{
            attachment_exists: false,
            attachment_id: null,
            storage_path: null,
            mime_type: null,
            byte_size: null,
            alt_text: null,
          }],
          error: null,
        };
    }
    if (name === "attach_project_activity_image") {
      if (options.attachThrows) throw new Error("transport detail");
      if (options.attachError) {
        return { data: null, error: { code: options.attachError } };
      }
      return { data: attachmentRow(), error: null };
    }
    if (name === "reconcile_project_activity_image_upload") {
      if (options.reconcile === "throws") throw new Error("transport detail");
      if (options.reconcile === "none") return { data: [], error: null };
      const path = options.reconcile === "existing"
        ? `final/${projectId}/${activityId}/77000000-0000-4000-8000-000000000001.png`
        : candidatePath;
      return {
        data: [{
          metadata_matches: true,
          candidate_referenced: path === candidatePath,
          attachment_id: attachmentId,
          storage_path: path,
          mime_type: "image/png",
          byte_size: validProjectActivityPng().byteLength,
          alt_text: "Site progress",
        }],
        error: null,
      };
    }
    throw new Error("unexpected RPC");
  });
  const upload = vi.fn(async () => ({
    error: options.uploadFails ? { code: "storage_error" } : null,
  }));
  const remove = vi.fn(async () => ({ error: null }));
  const storageFrom = vi.fn(() => ({ remove, upload }));
  const privileged = {
    rpc,
    storage: { from: storageFrom },
  } as ProjectActivityImagePrivilegedClient;
  const dependencies: ProjectActivityImageUploadDependencies = {
    createActorClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn(async () => options.invalidActor
          ? { data: { user: null }, error: { code: "bad_jwt" } }
          : { data: { user: { id: actorId } }, error: null }),
      },
    })),
    createPrivilegedClient: vi.fn(() => privileged),
    randomUuid: vi.fn(() => objectId),
    sha256: vi.fn(async () => contentHash),
  };
  return { dependencies, privileged, remove, rpc, storageFrom, upload };
}

describe("project-activity-image-upload Edge handler", () => {
  it("keeps the service credential server-only and configures JWT verification", () => {
    const indexSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/project-activity-image-upload/index.ts"),
      "utf8",
    );
    const handlerSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/project-activity-image-upload/handler.ts"),
      "utf8",
    );
    const configSource = readFileSync(
      resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );
    expect(indexSource).toContain('requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")');
    expect(indexSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(handlerSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(handlerSource).not.toContain("getPublicUrl");
    expect(configSource).toMatch(
      /\[functions\.project-activity-image-upload\][\s\S]*?verify_jwt = true/,
    );
  });

  it("denies anonymous and invalid callers before privileged authority", async () => {
    const missing = harness();
    expect((await handleProjectActivityImageUploadRequest(
      uploadRequest(undefined, undefined, ""),
      missing.dependencies,
    )).status).toBe(401);
    expect(missing.dependencies.createPrivilegedClient).not.toHaveBeenCalled();

    const invalid = harness({ invalidActor: true });
    expect((await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      invalid.dependencies,
    )).status).toBe(401);
    expect(invalid.dependencies.createPrivilegedClient).not.toHaveBeenCalled();
  });

  it("validates actual bytes and rejects caller MIME spoofing before DB or Storage", async () => {
    const setup = harness();
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(new TextEncoder().encode("%PDF-1.7"), "image/png"),
      setup.dependencies,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_image" });
    expect(setup.rpc).not.toHaveBeenCalled();
    expect(setup.upload).not.toHaveBeenCalled();

    const mismatch = harness();
    expect((await handleProjectActivityImageUploadRequest(
      uploadRequest(validProjectActivityPng(), "image/jpeg"),
      mismatch.dependencies,
    )).status).toBe(400);
    expect(mismatch.upload).not.toHaveBeenCalled();
  });

  it("rejects caller-selected path, hash, size, and actor fields", async () => {
    for (const field of ["storagePath", "contentHash", "byteSize", "actorId"]) {
      const form = new FormData();
      const image = validProjectActivityPng();
      const imageBuffer = image.buffer.slice(
        image.byteOffset,
        image.byteOffset + image.byteLength,
      ) as ArrayBuffer;
      form.set("projectId", projectId);
      form.set("activityId", activityId);
      form.set("requestId", requestId);
      form.set("file", new File([imageBuffer], "image.png", {
        type: "image/png",
      }));
      form.set(field, "caller-controlled");
      const setup = harness();
      const response = await handleProjectActivityImageUploadRequest(
        new Request("http://localhost/functions/v1/project-activity-image-upload", {
          method: "POST",
          headers: { authorization: "Bearer actor-jwt" },
          body: form,
        }),
        setup.dependencies,
      );
      expect(response.status).toBe(400);
      expect(setup.rpc).not.toHaveBeenCalled();
      expect(setup.upload).not.toHaveBeenCalled();
    }
  });

  it("uploads one verified object then attaches only server-derived metadata", async () => {
    const setup = harness();
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attachmentId,
      mimeType: "image/png",
      byteSize: validProjectActivityPng().byteLength,
      altText: "Site progress",
    });
    expect(setup.storageFrom).toHaveBeenCalledExactlyOnceWith(
      "project-activity-images",
    );
    expect(setup.upload).toHaveBeenCalledWith(
      candidatePath,
      expect.any(Uint8Array),
      { cacheControl: "0", contentType: "image/png", upsert: false },
    );
    expect(setup.rpc).toHaveBeenNthCalledWith(
      2,
      "attach_project_activity_image",
      expect.objectContaining({
        p_actor_auth_user_id: actorId,
        p_alt_text: "Site progress",
        p_content_hash: contentHash,
        p_storage_path: candidatePath,
      }),
    );
    expect(setup.remove).not.toHaveBeenCalled();
  });

  it("reconciles an identical retry before creating a second object", async () => {
    const setup = harness({ existing: true });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    expect(setup.upload).not.toHaveBeenCalled();
    expect(setup.storageFrom).not.toHaveBeenCalled();
    expect(setup.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["42501", 403, "access_denied"],
    ["P0002", 404, "project_activity_not_found"],
    ["PAC02", 409, "project_unavailable"],
    ["PAC04", 409, "attachment_conflict"],
  ])("maps preflight %s safely without Storage", async (code, status, safeCode) => {
    const setup = harness({ prepareError: code });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code: safeCode });
    expect(setup.upload).not.toHaveBeenCalled();
  });

  it("removes a definite orphan after a structured DB rejection", async () => {
    const setup = harness({ attachError: "PAC04" });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(409);
    expect(setup.remove).toHaveBeenCalledExactlyOnceWith([candidatePath]);
  });

  it("reconciles an indeterminate committed result without deleting its object", async () => {
    const setup = harness({ attachThrows: true, reconcile: "candidate" });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    expect(setup.remove).not.toHaveBeenCalled();
  });

  it("does not blindly delete when an indeterminate result cannot be reconciled", async () => {
    const setup = harness({ attachThrows: true, reconcile: "none" });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "attachment_outcome_unknown",
    });
    expect(setup.remove).not.toHaveBeenCalled();
  });

  it("cleans a raced candidate and returns the existing identical attachment", async () => {
    const setup = harness({ attachThrows: true, reconcile: "existing" });
    const response = await handleProjectActivityImageUploadRequest(
      uploadRequest(),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    expect(setup.remove).toHaveBeenCalledExactlyOnceWith([candidatePath]);
  });
});
