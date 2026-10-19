const imageBucket = "project-activity-images";
const signedUrlTtlSeconds = 300;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const projectActivityImageAccessCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

interface ProviderError {
  code?: string;
}

interface ActorUserResult {
  data: { user: { id: string } | null };
  error: ProviderError | null;
}

interface RpcResult {
  data: unknown;
  error: ProviderError | null;
}

export interface ProjectActivityImageAccessActorClient {
  auth: {
    getUser: (accessToken: string) => PromiseLike<ActorUserResult>;
  };
}

interface SignedUrlResult {
  data: { signedUrl: string } | null;
  error: ProviderError | null;
}

interface ProjectActivityImageAccessStorageBucket {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => PromiseLike<SignedUrlResult>;
}

export interface ProjectActivityImageAccessPrivilegedClient {
  rpc: (
    functionName: "get_project_activity_image_access_context",
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  storage: {
    from: (
      bucket: "project-activity-images",
    ) => ProjectActivityImageAccessStorageBucket;
  };
}

export interface ProjectActivityImageAccessDependencies {
  createActorClient: (
    accessToken: string,
  ) => ProjectActivityImageAccessActorClient;
  createPrivilegedClient: () => ProjectActivityImageAccessPrivilegedClient;
}

interface AccessInput {
  activityId: string;
  projectId: string;
}

interface AccessContext {
  altText: string | null;
  attachmentId: string;
  byteSize: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  storagePath: string;
}

interface SafeError {
  code: string;
  message: string;
  status: number;
}

function jsonError(error: SafeError): Response {
  return Response.json(
    { code: error.code, message: error.message },
    { status: error.status, headers: projectActivityImageAccessCorsHeaders },
  );
}

function readBearerToken(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(value: unknown): AccessInput | null {
  if (
    !isRecord(value) || Object.keys(value).length !== 2 ||
    typeof value.activityId !== "string" ||
    !uuidPattern.test(value.activityId) ||
    typeof value.projectId !== "string" ||
    !uuidPattern.test(value.projectId)
  ) return null;
  return { activityId: value.activityId, projectId: value.projectId };
}

function expectedPathPattern(input: AccessInput, mimeType: string): RegExp | null {
  const extension = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
    ? "webp"
    : null;
  return extension
    ? new RegExp(
      `^final/${input.projectId}/${input.activityId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
      "i",
    )
    : null;
}

function parseAccessContext(value: unknown, input: AccessInput): AccessContext | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  const byteSize = typeof row.byte_size === "string" && /^[0-9]+$/.test(row.byte_size)
    ? Number(row.byte_size)
    : row.byte_size;
  const pathPattern = typeof row.mime_type === "string"
    ? expectedPathPattern(input, row.mime_type)
    : null;
  if (
    typeof row.attachment_id !== "string" ||
    !uuidPattern.test(row.attachment_id) ||
    typeof row.storage_path !== "string" ||
    !pathPattern?.test(row.storage_path) ||
    !["image/jpeg", "image/png", "image/webp"].includes(
      String(row.mime_type),
    ) ||
    typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) ||
    byteSize < 1 || byteSize > 5 * 1024 * 1024 ||
    !(row.alt_text === null || typeof row.alt_text === "string")
  ) return null;
  return {
    altText: row.alt_text,
    attachmentId: row.attachment_id,
    byteSize,
    mimeType: row.mime_type as AccessContext["mimeType"],
    storagePath: row.storage_path,
  };
}

function isSignedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" &&
      url.password === "" && url.hash === "" && url.searchParams.has("token");
  } catch {
    return false;
  }
}

function mapReadError(error: ProviderError | null): SafeError {
  if (error?.code === "42501") return {
    code: "access_denied",
    message: "You do not have permission to view this Project Activity image.",
    status: 403,
  };
  if (error?.code === "P0002") return {
    code: "image_not_found",
    message: "The Project Activity image could not be found.",
    status: 404,
  };
  return {
    code: "image_access_failed",
    message: "The Project Activity image could not be opened.",
    status: 500,
  };
}

export async function handleProjectActivityImageAccessRequest(
  request: Request,
  dependencies: ProjectActivityImageAccessDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: projectActivityImageAccessCorsHeaders,
    });
  }
  if (request.method !== "POST") {
    return jsonError({
      code: "method_not_allowed",
      message: "Only POST is supported.",
      status: 405,
    });
  }

  const token = readBearerToken(request);
  if (!token) {
    return jsonError({
      code: "unauthenticated",
      message: "Authentication is required.",
      status: 401,
    });
  }

  let actorId: string;
  try {
    const actor = dependencies.createActorClient(token);
    const { data, error } = await actor.auth.getUser(token);
    if (error || !data.user || !uuidPattern.test(data.user.id)) throw new Error();
    actorId = data.user.id;
  } catch {
    return jsonError({
      code: "unauthenticated",
      message: "Authentication is required.",
      status: 401,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const input = parseRequest(body);
  if (!input) {
    return jsonError({
      code: "invalid_request",
      message: "A valid Project and Project Activity are required.",
      status: 400,
    });
  }

  let privileged: ProjectActivityImageAccessPrivilegedClient;
  let context: AccessContext | null;
  try {
    privileged = dependencies.createPrivilegedClient();
    const { data, error } = await privileged.rpc(
      "get_project_activity_image_access_context",
      {
        p_project_id: input.projectId,
        p_activity_id: input.activityId,
        p_actor_auth_user_id: actorId,
      },
    );
    if (error) return jsonError(mapReadError(error));
    context = parseAccessContext(data, input);
  } catch {
    return jsonError(mapReadError(null));
  }
  if (!context) return jsonError(mapReadError({ code: "P0002" }));

  try {
    const { data, error } = await privileged.storage.from(imageBucket)
      .createSignedUrl(context.storagePath, signedUrlTtlSeconds);
    if (error || !isSignedUrl(data?.signedUrl)) {
      return jsonError(mapReadError(null));
    }
    return Response.json(
      {
        signedUrl: data.signedUrl,
        expiresIn: signedUrlTtlSeconds,
        mimeType: context.mimeType,
        byteSize: context.byteSize,
        altText: context.altText,
      },
      {
        status: 200,
        headers: {
          ...projectActivityImageAccessCorsHeaders,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return jsonError(mapReadError(null));
  }
}
