// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  handleResolutionImageAccessRequest,
  type ResolutionImageAccessDependencies,
} from "./handler";

const projectId = "11000000-0000-4000-8000-000000000001";
const activityId = "22000000-0000-4000-8000-000000000001";
const resolutionId = "23000000-0000-4000-8000-000000000001";
const actorId = "44000000-0000-4000-8000-000000000001";
const path = `resolution-final/${projectId}/${activityId}/${resolutionId}/66000000-0000-4000-8000-000000000001.png`;

function request(body: unknown = { projectId, activityId, resolutionId }, authenticated = true) {
  return new Request("http://local/access", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function harness(errorCode?: string): ResolutionImageAccessDependencies {
  return {
    createActorClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({
      data: { user: { id: actorId } }, error: null,
    })) } })),
    createPrivilegedClient: vi.fn(() => ({
      rpc: vi.fn(async () => errorCode
        ? { data: null, error: { code: errorCode } }
        : { data: [{
          attachment_id: "55000000-0000-4000-8000-000000000001",
          storage_path: path,
          mime_type: "image/png",
          byte_size: "68",
          alt_text: "Resolution evidence",
        }], error: null }),
      storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({
        data: { signedUrl: "https://storage.example/private/object?token=signed" },
        error: null,
      })) })) },
    })),
  };
}

describe("project-issue-resolution-image-access", () => {
  it("is JWT protected and has no public URL or logging path", () => {
    const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "supabase/functions/project-issue-resolution-image-access/handler.ts"), "utf8");
    expect(config).toMatch(/\[functions\.project-issue-resolution-image-access\][\s\S]*?verify_jwt = true/);
    expect(source).not.toContain("getPublicUrl");
    expect(source).not.toMatch(/console\./);
  });

  it("rejects anonymous, malformed, foreign, and unauthorized requests safely", async () => {
    expect((await handleResolutionImageAccessRequest(request(undefined, false), harness())).status).toBe(401);
    expect((await handleResolutionImageAccessRequest(request({ projectId }), harness())).status).toBe(400);
    expect((await handleResolutionImageAccessRequest(request(), harness("P0002"))).status).toBe(404);
    expect((await handleResolutionImageAccessRequest(request(), harness("42501"))).status).toBe(403);
  });

  it("signs only the trusted exact attachment for 300 seconds with no-store", async () => {
    const dependencies = harness();
    const response = await handleResolutionImageAccessRequest(request(), dependencies);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      signedUrl: "https://storage.example/private/object?token=signed",
      expiresIn: 300,
      mimeType: "image/png",
      byteSize: 68,
      altText: "Resolution evidence",
    });
    const privileged = vi.mocked(dependencies.createPrivilegedClient).mock.results[0]?.value;
    expect(privileged?.rpc).toHaveBeenCalledWith(
      "get_project_issue_resolution_image_access_context",
      expect.objectContaining({ p_resolution_id: resolutionId, p_actor_auth_user_id: actorId }),
    );
  });

  it("does not expose storage paths or attachment hashes", async () => {
    const response = await handleResolutionImageAccessRequest(request(), harness());
    const text = await response.text();
    expect(text).not.toContain("resolution-final/");
    expect(text).not.toContain("content_hash");
  });
});
