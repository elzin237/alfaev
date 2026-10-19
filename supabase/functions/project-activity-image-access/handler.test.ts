import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  handleProjectActivityImageAccessRequest,
  type ProjectActivityImageAccessDependencies,
  type ProjectActivityImageAccessPrivilegedClient,
} from "./handler";

const projectId = "11000000-0000-4000-8000-000000000001";
const activityId = "22000000-0000-4000-8000-000000000001";
const actorId = "33000000-0000-4000-8000-000000000001";
const attachmentId = "44000000-0000-4000-8000-000000000001";
const objectId = "55000000-0000-4000-8000-000000000001";
const storagePath = `final/${projectId}/${activityId}/${objectId}.png`;
const signedUrl =
  `https://example.supabase.co/storage/v1/object/sign/project-activity-images/${storagePath}?token=secret-signed-token`;

function request(
  body: unknown = { projectId, activityId },
  authorization = "Bearer actor-jwt",
): Request {
  return new Request(
    "http://localhost/functions/v1/project-activity-image-access",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

interface HarnessOptions {
  authenticated?: boolean;
  context?: unknown;
  readError?: string;
  signError?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const rpc = vi.fn(async () => ({
    data: options.readError
      ? null
      : options.context ?? [{
        attachment_id: attachmentId,
        storage_path: storagePath,
        mime_type: "image/png",
        byte_size: 68,
        alt_text: "Site progress",
      }],
    error: options.readError ? { code: options.readError } : null,
  }));
  const createSignedUrl = vi.fn(async () => ({
    data: options.signError ? null : { signedUrl },
    error: options.signError ? { code: "storage_error" } : null,
  }));
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  const privileged = {
    rpc,
    storage: { from: storageFrom },
  } as ProjectActivityImageAccessPrivilegedClient;
  const dependencies: ProjectActivityImageAccessDependencies = {
    createActorClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn(async () => options.authenticated === false
          ? { data: { user: null }, error: { code: "bad_jwt" } }
          : { data: { user: { id: actorId } }, error: null }),
      },
    })),
    createPrivilegedClient: vi.fn(() => privileged),
  };
  return { createSignedUrl, dependencies, rpc, storageFrom };
}

describe("project-activity-image-access Edge handler", () => {
  it("keeps signing privileged, JWT-verified, and free of public URL/logging paths", () => {
    const indexSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/project-activity-image-access/index.ts"),
      "utf8",
    );
    const handlerSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/project-activity-image-access/handler.ts"),
      "utf8",
    );
    const configSource = readFileSync(
      resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );
    expect(indexSource).toContain('requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")');
    expect(indexSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(handlerSource).not.toContain("getPublicUrl");
    expect(handlerSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(configSource).toMatch(
      /\[functions\.project-activity-image-access\][\s\S]*?verify_jwt = true/,
    );
  });

  it("denies anonymous and invalid callers before privileged authority", async () => {
    const missing = harness();
    expect((await handleProjectActivityImageAccessRequest(
      request(undefined, ""),
      missing.dependencies,
    )).status).toBe(401);
    expect(missing.dependencies.createPrivilegedClient).not.toHaveBeenCalled();

    const invalid = harness({ authenticated: false });
    expect((await handleProjectActivityImageAccessRequest(
      request(),
      invalid.dependencies,
    )).status).toBe(401);
    expect(invalid.dependencies.createPrivilegedClient).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ projectId, activityId, storagePath }],
    [{ projectId, activityId, path: storagePath }],
    [{ projectId: "bad", activityId }],
    [{ projectId, activityId: "bad" }],
  ])("rejects malformed or caller-selected paths %#", async (body) => {
    const setup = harness();
    const response = await handleProjectActivityImageAccessRequest(
      request(body),
      setup.dependencies,
    );
    expect(response.status).toBe(400);
    expect(setup.rpc).not.toHaveBeenCalled();
    expect(setup.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, "access_denied"],
    ["P0002", 404, "image_not_found"],
  ])("maps trusted read %s safely", async (code, status, safeCode) => {
    const setup = harness({ readError: code });
    const response = await handleProjectActivityImageAccessRequest(
      request(),
      setup.dependencies,
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code: safeCode });
    expect(setup.createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs only the exact trusted reference for five minutes", async () => {
    const setup = harness();
    const response = await handleProjectActivityImageAccessRequest(
      request(),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signedUrl,
      expiresIn: 300,
      mimeType: "image/png",
      byteSize: 68,
      altText: "Site progress",
    });
    expect(setup.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_project_activity_image_access_context",
      {
        p_project_id: projectId,
        p_activity_id: activityId,
        p_actor_auth_user_id: actorId,
      },
    );
    expect(setup.storageFrom).toHaveBeenCalledExactlyOnceWith(
      "project-activity-images",
    );
    expect(setup.createSignedUrl).toHaveBeenCalledExactlyOnceWith(
      storagePath,
      300,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not return Storage path or content hash", async () => {
    const setup = harness();
    const response = await handleProjectActivityImageAccessRequest(
      request(),
      setup.dependencies,
    );
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("storagePath");
    expect(body).not.toHaveProperty("storage_path");
    expect(body).not.toHaveProperty("contentHash");
    expect(body).not.toHaveProperty("content_hash");
  });

  it.each([
    ["another Project path", `final/99000000-0000-4000-8000-000000000001/${activityId}/${objectId}.png`],
    ["another Activity path", `final/${projectId}/99000000-0000-4000-8000-000000000001/${objectId}.png`],
    ["temporary path", `_tmp/${projectId}/${activityId}/${objectId}.png`],
  ])("refuses to sign %s", async (_label, path) => {
    const setup = harness({
      context: [{
        attachment_id: attachmentId,
        storage_path: path,
        mime_type: "image/png",
        byte_size: 68,
        alt_text: null,
      }],
    });
    const response = await handleProjectActivityImageAccessRequest(
      request(),
      setup.dependencies,
    );
    expect(response.status).toBe(404);
    expect(setup.createSignedUrl).not.toHaveBeenCalled();
  });
});
