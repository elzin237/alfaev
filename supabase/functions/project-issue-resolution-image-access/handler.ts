const imageBucket = "project-activity-images";
const signedUrlTtlSeconds = 300;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const resolutionImageAccessCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

interface ProviderError { code?: string }
interface RpcResult { data: unknown; error: ProviderError | null }
interface SignedUrlResult { data: { signedUrl: string } | null; error: ProviderError | null }

export interface ResolutionImageAccessActorClient {
  auth: { getUser: (token: string) => PromiseLike<{
    data: { user: { id: string } | null }; error: ProviderError | null;
  }> };
}

export interface ResolutionImageAccessPrivilegedClient {
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: { from: (bucket: "project-activity-images") => {
    createSignedUrl: (path: string, expiresIn: number) => PromiseLike<SignedUrlResult>;
  } };
}

export interface ResolutionImageAccessDependencies {
  createActorClient: (token: string) => ResolutionImageAccessActorClient;
  createPrivilegedClient: () => ResolutionImageAccessPrivilegedClient;
}

interface AccessInput { projectId: string; activityId: string; resolutionId: string }
interface AccessContext {
  attachmentId: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  altText: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, {
    status,
    headers: resolutionImageAccessCorsHeaders,
  });
}

function parseInput(value: unknown): AccessInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    typeof value.projectId !== "string" || !uuidPattern.test(value.projectId) ||
    typeof value.activityId !== "string" || !uuidPattern.test(value.activityId) ||
    typeof value.resolutionId !== "string" || !uuidPattern.test(value.resolutionId)) return null;
  return {
    projectId: value.projectId,
    activityId: value.activityId,
    resolutionId: value.resolutionId,
  };
}

function parseContext(value: unknown, input: AccessInput): AccessContext | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return null;
  const row = value[0];
  const byteSize = typeof row.byte_size === "string" && /^\d+$/.test(row.byte_size)
    ? Number(row.byte_size) : row.byte_size;
  const extension = row.mime_type === "image/jpeg" ? "jpg"
    : row.mime_type === "image/png" ? "png"
    : row.mime_type === "image/webp" ? "webp" : null;
  const path = typeof row.storage_path === "string" ? row.storage_path : "";
  const expected = extension
    ? new RegExp(
      `^resolution-final/${input.projectId}/${input.activityId}/${input.resolutionId}/` +
        `[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-` +
        `[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
      "i",
    )
    : null;
  if (typeof row.attachment_id !== "string" || !uuidPattern.test(row.attachment_id) ||
    !expected?.test(path) || typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) ||
    byteSize < 1 || byteSize > 5 * 1024 * 1024 ||
    !(row.alt_text === null || typeof row.alt_text === "string")) return null;
  return {
    attachmentId: row.attachment_id,
    storagePath: path,
    mimeType: row.mime_type as AccessContext["mimeType"],
    byteSize,
    altText: row.alt_text,
  };
}

function isSignedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.hash === "" && url.searchParams.has("token");
  } catch { return false; }
}

export async function handleResolutionImageAccessRequest(
  request: Request,
  dependencies: ResolutionImageAccessDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: resolutionImageAccessCorsHeaders });
  if (request.method !== "POST") return jsonError("method_not_allowed", "Only POST is supported.", 405);
  const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return jsonError("unauthenticated", "Authentication is required.", 401);
  let actorId: string;
  try {
    const { data, error } = await dependencies.createActorClient(token).auth.getUser(token);
    if (error || !data.user || !uuidPattern.test(data.user.id)) throw new Error();
    actorId = data.user.id;
  } catch { return jsonError("unauthenticated", "Authentication is required.", 401); }
  let input: AccessInput | null;
  try { input = parseInput(await request.json()); } catch { input = null; }
  if (!input) return jsonError("invalid_request", "A valid Project Issue resolution is required.", 400);
  let privileged: ResolutionImageAccessPrivilegedClient;
  let context: AccessContext | null;
  try {
    privileged = dependencies.createPrivilegedClient();
    const { data, error } = await privileged.rpc(
      "get_project_issue_resolution_image_access_context",
      {
        p_project_id: input.projectId,
        p_activity_id: input.activityId,
        p_resolution_id: input.resolutionId,
        p_actor_auth_user_id: actorId,
      },
    );
    if (error?.code === "42501") return jsonError("access_denied", "You do not have permission to view this resolution image.", 403);
    if (error?.code === "P0002") return jsonError("image_not_found", "The resolution image could not be found.", 404);
    if (error) throw new Error();
    context = parseContext(data, input);
  } catch { return jsonError("image_access_failed", "The resolution image could not be opened.", 500); }
  if (!context) return jsonError("image_not_found", "The resolution image could not be found.", 404);
  try {
    const { data, error } = await privileged.storage.from(imageBucket)
      .createSignedUrl(context.storagePath, signedUrlTtlSeconds);
    if (error || !isSignedUrl(data?.signedUrl)) throw new Error();
    return Response.json({
      signedUrl: data.signedUrl,
      expiresIn: signedUrlTtlSeconds,
      mimeType: context.mimeType,
      byteSize: context.byteSize,
      altText: context.altText,
    }, {
      headers: {
        ...resolutionImageAccessCorsHeaders,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch { return jsonError("image_access_failed", "The resolution image could not be opened.", 500); }
}
