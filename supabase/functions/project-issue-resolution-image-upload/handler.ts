import {
  projectActivityImageMaxBytes,
  sha256Hex,
  verifyProjectActivityImage,
  type VerifiedImageMimeType,
  // @ts-expect-error Supabase Edge Deno requires an explicit TypeScript extension.
} from "../project-activity-image-upload/image-validation.ts";

const imageBucket = "project-activity-images";
const transportLimit = projectActivityImageMaxBytes + 64 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const resolutionImageUploadCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

interface ProviderError { code?: string }
interface RpcResult { data: unknown; error: ProviderError | null }
interface StorageResult { error: ProviderError | null }

export interface ResolutionImageActorClient {
  auth: { getUser: (token: string) => PromiseLike<{
    data: { user: { id: string } | null };
    error: ProviderError | null;
  }> };
}

export interface ResolutionImageStorageBucket {
  remove: (paths: string[]) => PromiseLike<StorageResult>;
  upload: (
    path: string,
    bytes: Uint8Array,
    options: { cacheControl: "0"; contentType: VerifiedImageMimeType; upsert: false },
  ) => PromiseLike<StorageResult>;
}

export interface ResolutionImagePrivilegedClient {
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: { from: (bucket: "project-activity-images") => ResolutionImageStorageBucket };
}

export interface ResolutionImageUploadDependencies {
  createActorClient: (token: string) => ResolutionImageActorClient;
  createPrivilegedClient: () => ResolutionImagePrivilegedClient;
  randomUuid?: () => string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

interface UploadInput {
  projectId: string;
  activityId: string;
  resolutionId: string;
  requestId: string;
  altText: string | null;
  file: {
    arrayBuffer: () => Promise<ArrayBuffer>;
    size: number;
    type: string;
  };
}

interface AttachmentResult {
  attachmentExists?: boolean;
  attachmentCreated?: boolean;
  attachmentId: string | null;
  storagePath: string | null;
  mimeType: VerifiedImageMimeType | null;
  byteSize: number | null;
  altText: string | null;
}

interface ReconciliationResult extends AttachmentResult {
  metadataMatches: boolean;
  candidateReferenced: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { code, message },
    { status, headers: resolutionImageUploadCorsHeaders },
  );
}

function bearer(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

function parseForm(form: FormData): UploadInput | null {
  const allowed = new Set([
    "projectId", "activityId", "resolutionId", "requestId", "altText", "file",
  ]);
  if ([...form.keys()].some((key) => !allowed.has(key)) ||
    ["projectId", "activityId", "resolutionId", "requestId", "file"].some(
      (key) => form.getAll(key).length !== 1,
    ) || form.getAll("altText").length > 1) return null;
  const projectId = form.get("projectId");
  const activityId = form.get("activityId");
  const resolutionId = form.get("resolutionId");
  const requestId = form.get("requestId");
  const file = form.get("file");
  const rawAlt = form.get("altText");
  const altText = typeof rawAlt === "string" && rawAlt.trim().length > 0
    ? rawAlt.trim()
    : rawAlt === null || rawAlt === "" ? null : false;
  const validFile = typeof file === "object" && file !== null &&
    "arrayBuffer" in file && typeof file.arrayBuffer === "function" &&
    "size" in file && typeof file.size === "number" &&
    "type" in file && typeof file.type === "string";
  if (typeof projectId !== "string" || !uuidPattern.test(projectId) ||
    typeof activityId !== "string" || !uuidPattern.test(activityId) ||
    typeof resolutionId !== "string" || !uuidPattern.test(resolutionId) ||
    typeof requestId !== "string" || !uuidPattern.test(requestId) ||
    !validFile || altText === false || (altText !== null && altText.length > 500)) {
    return null;
  }
  return {
    projectId,
    activityId,
    resolutionId,
    requestId,
    altText,
    file: file as UploadInput["file"],
  };
}

function parseByteSize(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) &&
      parsed >= 1 && parsed <= projectActivityImageMaxBytes
    ? parsed
    : null;
}

function parseAttachment(value: unknown, mode: "prepare" | "attach"): AttachmentResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return null;
  const row = value[0];
  const state = mode === "prepare" ? "attachment_exists" : "attachment_created";
  if (typeof row[state] !== "boolean") return null;
  if (mode === "prepare" && row.attachment_exists === false) {
    return row.attachment_id === null && row.storage_path === null &&
        row.mime_type === null && row.byte_size === null && row.alt_text === null
      ? {
          attachmentExists: false,
          attachmentId: null,
          storagePath: null,
          mimeType: null,
          byteSize: null,
          altText: null,
        }
      : null;
  }
  const byteSize = parseByteSize(row.byte_size);
  if (typeof row.attachment_id !== "string" || !uuidPattern.test(row.attachment_id) ||
    typeof row.storage_path !== "string" || !row.storage_path.startsWith("resolution-final/") ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(row.mime_type)) ||
    byteSize === null || !(row.alt_text === null || typeof row.alt_text === "string")) return null;
  return {
    ...(mode === "prepare"
      ? { attachmentExists: true }
      : { attachmentCreated: row.attachment_created as boolean }),
    attachmentId: row.attachment_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type as VerifiedImageMimeType,
    byteSize,
    altText: row.alt_text,
  };
}

function parseReconciliation(value: unknown): ReconciliationResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return null;
  const row = value[0];
  const attachment = parseAttachment([{
    attachment_created: false,
    attachment_id: row.attachment_id,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    alt_text: row.alt_text,
  }], "attach");
  return attachment && typeof row.metadata_matches === "boolean" &&
      typeof row.candidate_referenced === "boolean"
    ? {
        ...attachment,
        metadataMatches: row.metadata_matches,
        candidateReferenced: row.candidate_referenced,
      }
    : null;
}

function success(result: AttachmentResult): Response {
  return Response.json({
    attachmentId: result.attachmentId,
    mimeType: result.mimeType,
    byteSize: result.byteSize,
    altText: result.altText,
  }, { status: 200, headers: resolutionImageUploadCorsHeaders });
}

function databaseError(error: ProviderError | null): Response {
  if (error?.code === "42501") return jsonError(
    "access_denied", "You do not have permission to attach this resolution image.", 403,
  );
  if (error?.code === "P0002") return jsonError(
    "resolution_not_found", "The Project Issue resolution could not be found.", 404,
  );
  if (error?.code === "PIR04" || error?.code === "23505") return jsonError(
    "attachment_conflict", "This resolution already has a different image.", 409,
  );
  if (error?.code === "22023") return jsonError(
    "invalid_attachment", "The resolution image could not be attached.", 400,
  );
  return jsonError("attachment_failed", "The resolution image could not be attached.", 500);
}

async function removeObject(storage: ResolutionImageStorageBucket, path: string) {
  try { return (await storage.remove([path])).error === null; } catch { return false; }
}

export async function handleResolutionImageUploadRequest(
  request: Request,
  dependencies: ResolutionImageUploadDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: resolutionImageUploadCorsHeaders });
  }
  if (request.method !== "POST") return jsonError("method_not_allowed", "Only POST is supported.", 405);
  const token = bearer(request);
  if (!token) return jsonError("unauthenticated", "Authentication is required.", 401);
  let actorId: string;
  try {
    const { data, error } = await dependencies.createActorClient(token).auth.getUser(token);
    if (error || !data.user || !uuidPattern.test(data.user.id)) throw new Error();
    actorId = data.user.id;
  } catch {
    return jsonError("unauthenticated", "Authentication is required.", 401);
  }
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length"));
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") ||
    (Number.isFinite(contentLength) && contentLength > transportLimit)) {
    return jsonError("invalid_request", "A valid resolution image request is required.", 400);
  }
  let input: UploadInput | null;
  try { input = parseForm(await request.formData()); } catch { input = null; }
  if (!input) return jsonError("invalid_request", "A valid resolution image request is required.", 400);
  if (input.file.size < 1 || input.file.size > projectActivityImageMaxBytes) {
    return jsonError("invalid_image", "Select a valid JPEG, PNG, or WebP image up to 5 MiB.", 400);
  }
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await input.file.arrayBuffer()); } catch {
    return jsonError("invalid_image", "Select a valid JPEG, PNG, or WebP image up to 5 MiB.", 400);
  }
  const verified = verifyProjectActivityImage(bytes);
  if (!verified || (input.file.type !== "" && input.file.type !== verified.mimeType)) {
    return jsonError("invalid_image", "Select a valid JPEG, PNG, or WebP image up to 5 MiB.", 400);
  }
  let contentHash: string;
  try {
    contentHash = await (dependencies.sha256 ?? sha256Hex)(bytes);
    if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error();
  } catch {
    return jsonError("image_validation_failed", "The resolution image could not be validated.", 500);
  }
  let privileged: ResolutionImagePrivilegedClient;
  try { privileged = dependencies.createPrivilegedClient(); } catch {
    return jsonError("attachment_failed", "The resolution image could not be attached.", 500);
  }
  const common = {
    p_project_id: input.projectId,
    p_activity_id: input.activityId,
    p_resolution_id: input.resolutionId,
    p_request_id: input.requestId,
    p_actor_auth_user_id: actorId,
    p_mime_type: verified.mimeType,
    p_byte_size: bytes.byteLength,
    p_content_hash: contentHash,
    p_alt_text: input.altText,
  };
  try {
    const { data, error } = await privileged.rpc(
      "prepare_project_issue_resolution_image_upload", common,
    );
    if (error) return databaseError(error);
    const prepared = parseAttachment(data, "prepare");
    if (!prepared) throw new Error();
    if (prepared.attachmentExists) return success(prepared);
  } catch {
    return jsonError("attachment_failed", "The resolution image could not be attached.", 500);
  }
  let objectId: string;
  try {
    objectId = (dependencies.randomUuid ?? crypto.randomUUID.bind(crypto))();
    if (!uuidPattern.test(objectId)) throw new Error();
  } catch {
    return jsonError("storage_preparation_failed", "The resolution image could not be prepared.", 500);
  }
  const candidatePath = `resolution-final/${input.projectId}/${input.activityId}/${input.resolutionId}/${objectId}.${verified.extension}`;
  const storage = privileged.storage.from(imageBucket);
  try {
    const { error } = await storage.upload(candidatePath, bytes, {
      cacheControl: "0", contentType: verified.mimeType, upsert: false,
    });
    if (error) throw new Error();
  } catch {
    return jsonError("upload_failed", "The resolution image could not be uploaded.", 503);
  }
  const attach = { ...common, p_storage_path: candidatePath };
  let attached: AttachmentResult | null = null;
  try {
    const { data, error } = await privileged.rpc(
      "attach_project_issue_resolution_image", attach,
    );
    if (error) {
      await removeObject(storage, candidatePath);
      return databaseError(error);
    }
    attached = parseAttachment(data, "attach");
  } catch {
    // Reconcile the exact immutable resolution/request/file identity below.
  }
  if (!attached) {
    try {
      const { data, error } = await privileged.rpc(
        "reconcile_project_issue_resolution_image_upload", attach,
      );
      if (!error) {
        const reconciled = parseReconciliation(data);
        if (reconciled?.metadataMatches && reconciled.candidateReferenced) {
          return success(reconciled);
        }
        if (reconciled?.metadataMatches && !reconciled.candidateReferenced) {
          await removeObject(storage, candidatePath);
          return success(reconciled);
        }
        if (reconciled && !reconciled.candidateReferenced) {
          await removeObject(storage, candidatePath);
          return databaseError({ code: "PIR04" });
        }
      }
    } catch {
      // The unreferenced candidate remains private while the outcome is unknown.
    }
    return jsonError(
      "attachment_outcome_unknown",
      "The image upload result could not be confirmed. Reload before trying again.",
      503,
    );
  }
  if (attached.storagePath !== candidatePath) await removeObject(storage, candidatePath);
  return success(attached);
}
