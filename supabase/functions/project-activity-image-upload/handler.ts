import {
  projectActivityImageMaxBytes,
  sha256Hex,
  verifyProjectActivityImage,
  type VerifiedImageMimeType,
} from "./image-validation";

const imageBucket = "project-activity-images";
const multipartTransportLimit = projectActivityImageMaxBytes + 64 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const projectActivityImageUploadCorsHeaders = {
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

export interface ProjectActivityImageActorClient {
  auth: {
    getUser: (accessToken: string) => PromiseLike<ActorUserResult>;
  };
}

export interface ProjectActivityImagePrivilegedClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  storage: {
    from: (
      bucket: "project-activity-images",
    ) => ProjectActivityImageStorageBucket;
  };
}

interface StorageResult {
  error: ProviderError | null;
}

export interface ProjectActivityImageStorageBucket {
  remove: (paths: string[]) => PromiseLike<StorageResult>;
  upload: (
    path: string,
    bytes: Uint8Array,
    options: {
      cacheControl: "0";
      contentType: VerifiedImageMimeType;
      upsert: false;
    },
  ) => PromiseLike<StorageResult>;
}

export interface ProjectActivityImageUploadDependencies {
  createActorClient: (accessToken: string) => ProjectActivityImageActorClient;
  createPrivilegedClient: () => ProjectActivityImagePrivilegedClient;
  randomUuid?: () => string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

interface UploadInput {
  activityId: string;
  altText: string | null;
  file: {
    arrayBuffer: () => Promise<ArrayBuffer>;
    size: number;
    type: string;
  };
  projectId: string;
  requestId: string;
}

interface AttachmentResult {
  attachmentCreated?: boolean;
  attachmentExists?: boolean;
  attachmentId: string | null;
  altText: string | null;
  byteSize: number | null;
  mimeType: VerifiedImageMimeType | null;
  storagePath: string | null;
}

interface ReconciliationResult extends AttachmentResult {
  candidateReferenced: boolean;
  metadataMatches: boolean;
}

interface SafeError {
  code: string;
  message: string;
  status: number;
}

function jsonError(error: SafeError): Response {
  return Response.json(
    { code: error.code, message: error.message },
    { status: error.status, headers: projectActivityImageUploadCorsHeaders },
  );
}

function readBearerToken(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? null;
}

function normalizeAltText(value: FormDataEntryValue | null): string | null | false {
  if (value === null) return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.length <= 500 ? normalized : false;
}

function parseMultipart(form: FormData): UploadInput | null {
  const allowedKeys = new Set([
    "activityId",
    "altText",
    "file",
    "projectId",
    "requestId",
  ]);
  const keys = [...form.keys()];
  if (
    keys.some((key) => !allowedKeys.has(key)) ||
    ["activityId", "file", "projectId", "requestId"].some(
      (key) => form.getAll(key).length !== 1,
    ) ||
    form.getAll("altText").length > 1
  ) return null;

  const activityId = form.get("activityId");
  const file = form.get("file");
  const projectId = form.get("projectId");
  const requestId = form.get("requestId");
  const altText = normalizeAltText(form.get("altText"));
  const fileIsValid = typeof file === "object" && file !== null &&
    "arrayBuffer" in file && typeof file.arrayBuffer === "function" &&
    "size" in file && typeof file.size === "number" &&
    "type" in file && typeof file.type === "string";
  if (
    typeof activityId !== "string" || !uuidPattern.test(activityId) ||
    !fileIsValid ||
    typeof projectId !== "string" || !uuidPattern.test(projectId) ||
    typeof requestId !== "string" || !uuidPattern.test(requestId) ||
    altText === false
  ) return null;
  return {
    activityId,
    altText,
    file: file as UploadInput["file"],
    projectId,
    requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseByteSize(value: unknown): number | null {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) &&
      parsed >= 1 && parsed <= projectActivityImageMaxBytes
    ? parsed
    : null;
}

function parseAttachmentRow(
  value: unknown,
  mode: "prepare" | "attach",
): AttachmentResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  const stateKey = mode === "prepare"
    ? "attachment_exists"
    : "attachment_created";
  if (typeof row[stateKey] !== "boolean") return null;
  const present = mode === "prepare"
    ? row.attachment_exists === true
    : true;
  if (!present) {
    if (
      row.attachment_id !== null || row.storage_path !== null ||
      row.mime_type !== null || row.byte_size !== null || row.alt_text !== null
    ) return null;
    return {
      attachmentExists: false,
      attachmentId: null,
      altText: null,
      byteSize: null,
      mimeType: null,
      storagePath: null,
    };
  }

  const byteSize = parseByteSize(row.byte_size);
  if (
    typeof row.attachment_id !== "string" ||
    !uuidPattern.test(row.attachment_id) ||
    typeof row.storage_path !== "string" ||
    !row.storage_path.startsWith("final/") ||
    !["image/jpeg", "image/png", "image/webp"].includes(
      String(row.mime_type),
    ) ||
    byteSize === null ||
    !(row.alt_text === null || typeof row.alt_text === "string")
  ) return null;

  return {
    ...(mode === "prepare"
      ? { attachmentExists: true }
      : { attachmentCreated: row.attachment_created as boolean }),
    attachmentId: row.attachment_id,
    altText: row.alt_text,
    byteSize,
    mimeType: row.mime_type as VerifiedImageMimeType,
    storagePath: row.storage_path,
  };
}

function parseReconciliationRow(value: unknown): ReconciliationResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  const attachment = parseAttachmentRow([{
    attachment_created: false,
    attachment_id: row.attachment_id,
    alt_text: row.alt_text,
    byte_size: row.byte_size,
    mime_type: row.mime_type,
    storage_path: row.storage_path,
  }], "attach");
  if (
    !attachment || typeof row.metadata_matches !== "boolean" ||
    typeof row.candidate_referenced !== "boolean"
  ) return null;
  return {
    ...attachment,
    candidateReferenced: row.candidate_referenced,
    metadataMatches: row.metadata_matches,
  };
}

function attachmentResponse(result: AttachmentResult): Response {
  return Response.json(
    {
      attachmentId: result.attachmentId,
      mimeType: result.mimeType,
      byteSize: result.byteSize,
      altText: result.altText,
    },
    { status: 200, headers: projectActivityImageUploadCorsHeaders },
  );
}

function mapDatabaseError(error: ProviderError | null): SafeError {
  if (error?.code === "42501") return {
    code: "access_denied",
    message: "You do not have permission to attach this Project Activity image.",
    status: 403,
  };
  if (error?.code === "P0002") return {
    code: "project_activity_not_found",
    message: "The Project Activity could not be found.",
    status: 404,
  };
  if (error?.code === "PAC02") return {
    code: "project_unavailable",
    message: "Images cannot be attached to this Project now.",
    status: 409,
  };
  if (error?.code === "PAC04" || error?.code === "23505") return {
    code: "attachment_conflict",
    message: "This Project Activity already has a different attachment.",
    status: 409,
  };
  if (error?.code === "22023") return {
    code: "invalid_attachment",
    message: "The Project Activity image could not be attached.",
    status: 400,
  };
  return {
    code: "attachment_failed",
    message: "The Project Activity image could not be attached.",
    status: 500,
  };
}

async function removeObject(
  storage: ProjectActivityImageStorageBucket,
  path: string,
): Promise<boolean> {
  try {
    const { error } = await storage.remove([path]);
    return error === null;
  } catch {
    return false;
  }
}

export async function handleProjectActivityImageUploadRequest(
  request: Request,
  dependencies: ProjectActivityImageUploadDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: projectActivityImageUploadCorsHeaders,
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

  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length"));
  if (
    !contentType.toLowerCase().startsWith("multipart/form-data;") ||
    (Number.isFinite(contentLength) && contentLength > multipartTransportLimit)
  ) {
    return jsonError({
      code: "invalid_request",
      message: "A valid Project Activity image request is required.",
      status: 400,
    });
  }

  let input: UploadInput | null;
  try {
    input = parseMultipart(await request.formData());
  } catch {
    input = null;
  }
  if (!input) {
    return jsonError({
      code: "invalid_request",
      message: "A valid Project Activity image request is required.",
      status: 400,
    });
  }

  if (
    input.file.size < 1 || input.file.size > projectActivityImageMaxBytes
  ) {
    return jsonError({
      code: "invalid_image",
      message: "Select a valid JPEG, PNG, or WebP image up to 5 MiB.",
      status: 400,
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await input.file.arrayBuffer());
  } catch {
    return jsonError({
      code: "invalid_image",
      message: "Select a valid JPEG, PNG, or WebP image up to 5 MiB.",
      status: 400,
    });
  }
  const verified = verifyProjectActivityImage(bytes);
  if (
    !verified ||
    (input.file.type !== "" && input.file.type !== verified.mimeType)
  ) {
    return jsonError({
      code: "invalid_image",
      message: "Select a valid JPEG, PNG, or WebP image up to 5 MiB.",
      status: 400,
    });
  }

  let contentHash: string;
  try {
    contentHash = await (dependencies.sha256 ?? sha256Hex)(bytes);
    if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error();
  } catch {
    return jsonError({
      code: "image_validation_failed",
      message: "The Project Activity image could not be validated.",
      status: 500,
    });
  }

  let privileged: ProjectActivityImagePrivilegedClient;
  try {
    privileged = dependencies.createPrivilegedClient();
  } catch {
    return jsonError({
      code: "attachment_failed",
      message: "The Project Activity image could not be attached.",
      status: 500,
    });
  }
  const commonParameters = {
    p_project_id: input.projectId,
    p_activity_id: input.activityId,
    p_request_id: input.requestId,
    p_actor_auth_user_id: actorId,
    p_mime_type: verified.mimeType,
    p_byte_size: bytes.byteLength,
    p_content_hash: contentHash,
    p_alt_text: input.altText,
  };

  try {
    const { data, error } = await privileged.rpc(
      "prepare_project_activity_image_upload",
      commonParameters,
    );
    if (error) return jsonError(mapDatabaseError(error));
    const prepared = parseAttachmentRow(data, "prepare");
    if (!prepared) throw new Error();
    if (prepared.attachmentExists) return attachmentResponse(prepared);
  } catch {
    return jsonError({
      code: "attachment_failed",
      message: "The Project Activity image could not be attached.",
      status: 500,
    });
  }

  let objectId: string;
  try {
    objectId = (dependencies.randomUuid ?? crypto.randomUUID.bind(crypto))();
    if (!uuidPattern.test(objectId)) throw new Error();
  } catch {
    return jsonError({
      code: "storage_preparation_failed",
      message: "The Project Activity image could not be prepared.",
      status: 500,
    });
  }
  const candidatePath =
    `final/${input.projectId}/${input.activityId}/${objectId}.${verified.extension}`;
  let storage: ProjectActivityImageStorageBucket;
  try {
    storage = privileged.storage.from(imageBucket);
    const { error } = await storage.upload(candidatePath, bytes, {
      cacheControl: "0",
      contentType: verified.mimeType,
      upsert: false,
    });
    if (error) throw new Error();
  } catch {
    return jsonError({
      code: "upload_failed",
      message: "The Project Activity image could not be uploaded.",
      status: 503,
    });
  }

  const attachParameters = {
    ...commonParameters,
    p_storage_path: candidatePath,
  };
  let attached: AttachmentResult | null = null;
  try {
    const { data, error } = await privileged.rpc(
      "attach_project_activity_image",
      attachParameters,
    );
    if (error) {
      await removeObject(storage, candidatePath);
      return jsonError(mapDatabaseError(error));
    }
    attached = parseAttachmentRow(data, "attach");
  } catch {
    // A transport exception has an indeterminate commit outcome. Reconcile using
    // the exact Activity/request/file identity; never delete without proving the
    // candidate is not the committed immutable reference.
  }

  if (!attached) {
    try {
      const { data, error } = await privileged.rpc(
        "reconcile_project_activity_image_upload",
        attachParameters,
      );
      if (!error) {
        const reconciled = parseReconciliationRow(data);
        if (reconciled?.metadataMatches && reconciled.candidateReferenced) {
          return attachmentResponse(reconciled);
        }
        if (reconciled?.metadataMatches && !reconciled.candidateReferenced) {
          await removeObject(storage, candidatePath);
          return attachmentResponse(reconciled);
        }
        if (reconciled && !reconciled.candidateReferenced) {
          await removeObject(storage, candidatePath);
          return jsonError(mapDatabaseError({ code: "PAC04" }));
        }
      }
    } catch {
      // The candidate remains private because its database outcome is unknown.
    }
    return jsonError({
      code: "attachment_outcome_unknown",
      message:
        "The image upload result could not be confirmed. Reload before trying again.",
      status: 503,
    });
  }

  if (attached.storagePath !== candidatePath) {
    await removeObject(storage, candidatePath);
  }
  return attachmentResponse(attached);
}
