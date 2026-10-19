import { supabase } from "../../../lib/supabase/client";

export const PROJECT_ACTIVITY_PAGE_SIZE = 20;
export const PROJECT_ACTIVITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROJECT_ACTIVITY_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ProjectActivityItem {
  activityId: string;
  projectId: string;
  authorUserId: string;
  authorFullName: string;
  title: string;
  description: string;
  createdAt: string;
  alertSent: boolean;
  attachment: null | {
    attachmentId: string;
    mimeType: (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number];
    byteSize: number;
    altText: string | null;
  };
}

export interface ProjectActivityCursor {
  createdAt: string;
  activityId: string;
}

export interface ProjectActivityPage {
  items: ProjectActivityItem[];
  hasMore: boolean;
}

export interface ProjectActivityPostInput {
  projectId: string;
  requestId: string;
  title: string;
  description: string;
  sendAlert: boolean;
}

export interface ProjectActivityPostSuccess {
  activityId: string;
  projectId: string;
  requestId: string;
  title: string;
  description: string;
  createdAt: string;
  authorUserId: string;
  alertSent: boolean;
  alertId: string | null;
  recipientCount: string;
}

export type ProjectActivityPostErrorCode =
  | "invalid_content"
  | "conflicting_request"
  | "project_closed"
  | "no_alert_recipients"
  | "project_unavailable"
  | "access_denied"
  | "post_outcome_unknown"
  | "post_failed";

export interface ProjectActivityError<Code extends string = string> {
  code: Code;
  message: string;
}

export type ProjectActivityPostResult =
  | { ok: true; value: ProjectActivityPostSuccess }
  | { ok: false; error: ProjectActivityError<ProjectActivityPostErrorCode> };

export type ProjectActivityPageResult =
  | { ok: true; value: ProjectActivityPage }
  | { ok: false; error: ProjectActivityError<"activity_load_failed"> };

export type ProjectActivityItemResult =
  | { ok: true; value: ProjectActivityItem }
  | { ok: false; error: ProjectActivityError<"activity_load_failed"> };

export interface ProjectActivityImageUploadInput {
  projectId: string;
  activityId: string;
  requestId: string;
  file: File;
  altText: string | null;
}

export interface ProjectActivityImageMetadata {
  attachmentId: string;
  mimeType: (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number];
  byteSize: number;
  altText: string | null;
}

export type ProjectActivityImageUploadErrorCode =
  | "attachment_conflict"
  | "attachment_outcome_unknown"
  | "invalid_image"
  | "access_denied"
  | "project_activity_unavailable"
  | "image_upload_failed";

export type ProjectActivityImageUploadResult =
  | { ok: true; value: ProjectActivityImageMetadata }
  | {
      ok: false;
      error: ProjectActivityError<ProjectActivityImageUploadErrorCode>;
    };

export interface ProjectActivityImageAccess {
  signedUrl: string;
  expiresIn: 300;
  mimeType: (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number];
  byteSize: number;
  altText: string | null;
}

export type ProjectActivityImageAccessResult =
  | { ok: true; value: ProjectActivityImageAccess }
  | {
      ok: false;
      error: ProjectActivityError<"image_access_failed">;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isTrimmedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && value.trim() === value;
}

function parseSafeByteSize(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) &&
      parsed >= 1 && parsed <= PROJECT_ACTIVITY_IMAGE_MAX_BYTES
    ? parsed
    : null;
}

function isImageMimeType(
  value: unknown,
): value is (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number] {
  return typeof value === "string" &&
    PROJECT_ACTIVITY_IMAGE_TYPES.includes(
      value as (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number],
    );
}

function parseActivityRow(
  value: unknown,
  includesHasMore: boolean,
): ProjectActivityItem | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "activity_id",
    "project_id",
    "author_user_id",
    "author_full_name",
    "title",
    "description",
    "created_at",
    "alert_sent",
    "attachment_id",
    "attachment_mime_type",
    "attachment_byte_size",
    "attachment_alt_text",
    ...(includesHasMore ? ["has_more"] : []),
  ])) return null;

  if (
    !isUuid(value.activity_id) || !isUuid(value.project_id) ||
    !isUuid(value.author_user_id) ||
    !isTrimmedText(value.author_full_name, 500) ||
    !isTrimmedText(value.title, 120) ||
    !isTrimmedText(value.description, 5000) ||
    !isTimestamp(value.created_at) || typeof value.alert_sent !== "boolean" ||
    (includesHasMore && typeof value.has_more !== "boolean")
  ) return null;

  const noAttachment = value.attachment_id === null &&
    value.attachment_mime_type === null && value.attachment_byte_size === null &&
    value.attachment_alt_text === null;
  let attachment: ProjectActivityItem["attachment"] = null;
  if (!noAttachment) {
    const byteSize = parseSafeByteSize(value.attachment_byte_size);
    if (
      !isUuid(value.attachment_id) ||
      !isImageMimeType(value.attachment_mime_type) || byteSize === null ||
      !(value.attachment_alt_text === null ||
        isTrimmedText(value.attachment_alt_text, 500))
    ) return null;
    attachment = {
      attachmentId: value.attachment_id,
      mimeType: value.attachment_mime_type,
      byteSize,
      altText: value.attachment_alt_text,
    };
  }

  return {
    activityId: value.activity_id,
    projectId: value.project_id,
    authorUserId: value.author_user_id,
    authorFullName: value.author_full_name,
    title: value.title,
    description: value.description,
    createdAt: value.created_at,
    alertSent: value.alert_sent,
    attachment,
  };
}

function postFailure(
  code: ProjectActivityPostErrorCode,
  message: string,
): ProjectActivityPostResult {
  return { ok: false, error: { code, message } };
}

function mapPostError(code: string | null): ProjectActivityPostResult {
  switch (code) {
    case "22023":
      return postFailure("invalid_content", "Enter a valid title and description.");
    case "PAC01":
      return postFailure(
        "conflicting_request",
        "This update request conflicts with an earlier submission.",
      );
    case "PAC02":
      return postFailure(
        "project_closed",
        "This Project no longer accepts updates.",
      );
    case "PAC03":
      return postFailure(
        "no_alert_recipients",
        "No active users are assigned to receive Project alerts.",
      );
    case "P0002":
      return postFailure(
        "project_unavailable",
        "The Project is no longer available.",
      );
    case "42501":
      return postFailure(
        "access_denied",
        "You do not have permission to post this Project update.",
      );
    default:
      return postFailure(
        "post_failed",
        "The Project update could not be posted. Please try again.",
      );
  }
}

function parsePostSuccess(value: unknown): ProjectActivityPostSuccess | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  if (!hasExactKeys(row, [
    "activity_id",
    "project_id",
    "request_id",
    "title",
    "description",
    "created_at",
    "author_user_id",
    "alert_sent",
    "alert_id",
    "recipient_count",
  ])) return null;
  const recipientCount = typeof row.recipient_count === "number" &&
      Number.isSafeInteger(row.recipient_count) && row.recipient_count >= 0
    ? String(row.recipient_count)
    : row.recipient_count;
  if (
    !isUuid(row.activity_id) || !isUuid(row.project_id) ||
    !isUuid(row.request_id) || !isTrimmedText(row.title, 120) ||
    !isTrimmedText(row.description, 5000) || !isTimestamp(row.created_at) ||
    !isUuid(row.author_user_id) || typeof row.alert_sent !== "boolean" ||
    !(row.alert_id === null || isUuid(row.alert_id)) ||
    typeof recipientCount !== "string" || !/^\d+$/.test(recipientCount) ||
    ((row.alert_id !== null) !== row.alert_sent)
  ) return null;
  return {
    activityId: row.activity_id,
    projectId: row.project_id,
    requestId: row.request_id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    authorUserId: row.author_user_id,
    alertSent: row.alert_sent,
    alertId: row.alert_id,
    recipientCount,
  };
}

export async function listProjectActivity(
  projectId: string,
  cursor: ProjectActivityCursor | null = null,
  limit = PROJECT_ACTIVITY_PAGE_SIZE,
): Promise<ProjectActivityPageResult> {
  try {
    const { data, error } = await supabase.rpc("list_project_activity", {
      p_project_id: projectId,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.activityId ?? null,
    });
    if (error || !Array.isArray(data)) throw new Error();
    const items = data.map((row) => parseActivityRow(row, true));
    if (items.some((item) => item === null)) throw new Error();
    const rows = items as ProjectActivityItem[];
    return {
      ok: true,
      value: { items: rows, hasMore: data[0]?.has_more === true },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "activity_load_failed",
        message: "Project Activity could not be loaded.",
      },
    };
  }
}

export async function getProjectActivity(
  projectId: string,
  activityId: string,
): Promise<ProjectActivityItemResult> {
  try {
    const { data, error } = await supabase.rpc("get_project_activity", {
      p_project_id: projectId,
      p_activity_id: activityId,
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    const item = parseActivityRow(data[0], false);
    if (!item) throw new Error();
    return { ok: true, value: item };
  } catch {
    return {
      ok: false,
      error: {
        code: "activity_load_failed",
        message: "The posted Project Activity could not be loaded.",
      },
    };
  }
}

export async function postProjectActivity(
  input: ProjectActivityPostInput,
): Promise<ProjectActivityPostResult> {
  try {
    const { data, error } = await supabase.rpc("post_project_activity", {
      p_project_id: input.projectId,
      p_request_id: input.requestId,
      p_title: input.title,
      p_description: input.description,
      p_send_alert: input.sendAlert,
    });
    if (error) return mapPostError(error.code ?? null);
    const parsed = parsePostSuccess(data);
    return parsed
      ? { ok: true, value: parsed }
      : postFailure(
          "post_failed",
          "The Project update could not be confirmed. Please try again.",
        );
  } catch {
    return postFailure(
      "post_outcome_unknown",
      "The posting result could not be confirmed. Retry this same update.",
    );
  }
}

async function readFunctionErrorCode(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) return null;
  try {
    const body: unknown = await error.context.json();
    return isRecord(body) && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

function imageUploadFailure(
  code: ProjectActivityImageUploadErrorCode,
  message: string,
): ProjectActivityImageUploadResult {
  return { ok: false, error: { code, message } };
}

function mapImageUploadError(code: string | null): ProjectActivityImageUploadResult {
  switch (code) {
    case "attachment_conflict":
      return imageUploadFailure(
        "attachment_conflict",
        "This update already has a different image attachment.",
      );
    case "attachment_outcome_unknown":
      return imageUploadFailure(
        "attachment_outcome_unknown",
        "The image upload result could not be confirmed. Retry the same image.",
      );
    case "invalid_image":
    case "invalid_attachment":
    case "invalid_request":
      return imageUploadFailure(
        "invalid_image",
        "Select a valid JPEG, PNG, or WebP image up to 5 MiB.",
      );
    case "access_denied":
      return imageUploadFailure(
        "access_denied",
        "You do not have permission to attach this image.",
      );
    case "project_activity_not_found":
    case "project_unavailable":
      return imageUploadFailure(
        "project_activity_unavailable",
        "The Project update is no longer available for an image attachment.",
      );
    default:
      return imageUploadFailure(
        "image_upload_failed",
        "The image could not be attached. Please try again.",
      );
  }
}

function parseImageMetadata(value: unknown): ProjectActivityImageMetadata | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "attachmentId",
    "mimeType",
    "byteSize",
    "altText",
  ])) return null;
  const byteSize = parseSafeByteSize(value.byteSize);
  if (
    !isUuid(value.attachmentId) || !isImageMimeType(value.mimeType) ||
    byteSize === null ||
    !(value.altText === null || isTrimmedText(value.altText, 500))
  ) return null;
  return {
    attachmentId: value.attachmentId,
    mimeType: value.mimeType,
    byteSize,
    altText: value.altText,
  };
}

export async function uploadProjectActivityImage(
  input: ProjectActivityImageUploadInput,
): Promise<ProjectActivityImageUploadResult> {
  const body = new FormData();
  body.set("projectId", input.projectId);
  body.set("activityId", input.activityId);
  body.set("requestId", input.requestId);
  body.set("file", input.file);
  if (input.altText) body.set("altText", input.altText);
  try {
    const { data, error } = await supabase.functions.invoke(
      "project-activity-image-upload",
      { body },
    );
    if (error) return mapImageUploadError(await readFunctionErrorCode(error));
    const parsed = parseImageMetadata(data);
    return parsed ? { ok: true, value: parsed } : mapImageUploadError(null);
  } catch {
    return mapImageUploadError("attachment_outcome_unknown");
  }
}

function isSafeSignedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" &&
      url.password === "" && url.hash === "" && url.searchParams.has("token");
  } catch {
    return false;
  }
}

export async function getProjectActivityImageAccess(
  projectId: string,
  activityId: string,
): Promise<ProjectActivityImageAccessResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "project-activity-image-access",
      { body: { projectId, activityId } },
    );
    if (error || !isRecord(data) || !hasExactKeys(data, [
      "signedUrl",
      "expiresIn",
      "mimeType",
      "byteSize",
      "altText",
    ])) throw new Error();
    const byteSize = parseSafeByteSize(data.byteSize);
    if (
      !isImageMimeType(data.mimeType) || byteSize === null ||
      !(data.altText === null || isTrimmedText(data.altText, 500)) ||
      !isSafeSignedUrl(data.signedUrl) || data.expiresIn !== 300
    ) {
      throw new Error();
    }
    return {
      ok: true,
      value: {
        signedUrl: data.signedUrl,
        expiresIn: 300,
        mimeType: data.mimeType,
        byteSize,
        altText: data.altText,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "image_access_failed",
        message: "The Project Activity image could not be opened.",
      },
    };
  }
}
