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
  activityKind: "general" | "issue";
  createdAt: string;
  alertSent: boolean;
  attachment: null | {
    attachmentId: string;
    mimeType: (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number];
    byteSize: number;
    altText: string | null;
  };
  resolution: null | {
    resolutionId: string;
    resolvedByUserId: string;
    resolverFullName: string;
    description: string;
    resolvedAt: string;
    attachment: ProjectActivityImageMetadata | null;
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
  activityKind: "general" | "issue";
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

export interface ProjectIssueResolutionInput {
  activityId: string;
  requestId: string;
  description: string;
}

export interface ProjectIssueResolutionSuccess {
  resolutionId: string;
  projectActivityId: string;
  projectId: string;
  requestId: string;
  resolvedByUserId: string;
  resolverFullName: string;
  description: string;
  resolvedAt: string;
  notificationId: string;
  recipientCount: string;
}

export type ProjectIssueResolutionErrorCode =
  | "invalid_description"
  | "conflicting_request"
  | "not_an_issue"
  | "already_resolved"
  | "issue_unavailable"
  | "access_denied"
  | "resolution_outcome_unknown"
  | "resolution_failed";

export type ProjectIssueResolutionResult =
  | { ok: true; value: ProjectIssueResolutionSuccess }
  | {
      ok: false;
      error: ProjectActivityError<ProjectIssueResolutionErrorCode>;
    };

export type ProjectActivityPageResult =
  | { ok: true; value: ProjectActivityPage }
  | { ok: false; error: ProjectActivityError<"activity_load_failed"> };

export type ProjectActivityItemErrorCode =
  | "activity_unavailable"
  | "access_denied"
  | "activity_load_failed";

export type ProjectActivityItemResult =
  | { ok: true; value: ProjectActivityItem }
  | { ok: false; error: ProjectActivityError<ProjectActivityItemErrorCode> };

export interface ProjectActivityImageUploadInput {
  projectId: string;
  activityId: string;
  requestId: string;
  file: File;
  altText: string | null;
}

export interface ProjectIssueResolutionImageUploadInput {
  projectId: string;
  activityId: string;
  resolutionId: string;
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
    "activity_kind",
    "created_at",
    "alert_sent",
    "attachment_id",
    "attachment_mime_type",
    "attachment_byte_size",
    "attachment_alt_text",
    "issue_resolved",
    "resolution_id",
    "resolved_by_user_id",
    "resolver_full_name",
    "resolution_description",
    "resolved_at",
    "resolution_attachment_id",
    "resolution_attachment_mime_type",
    "resolution_attachment_byte_size",
    "resolution_attachment_alt_text",
    ...(includesHasMore ? ["has_more"] : []),
  ])) return null;

  if (
    !isUuid(value.activity_id) || !isUuid(value.project_id) ||
    !isUuid(value.author_user_id) ||
    !isTrimmedText(value.author_full_name, 500) ||
    !isTrimmedText(value.title, 120) ||
    !isTrimmedText(value.description, 5000) ||
    !(value.activity_kind === "general" || value.activity_kind === "issue") ||
    !isTimestamp(value.created_at) || typeof value.alert_sent !== "boolean" ||
    typeof value.issue_resolved !== "boolean" ||
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

  const noResolution = value.resolution_id === null &&
    value.resolved_by_user_id === null && value.resolver_full_name === null &&
    value.resolution_description === null && value.resolved_at === null;
  let resolution: ProjectActivityItem["resolution"] = null;
  if (!noResolution) {
    if (
      value.activity_kind !== "issue" || value.issue_resolved !== true ||
      !isUuid(value.resolution_id) || !isUuid(value.resolved_by_user_id) ||
      !isTrimmedText(value.resolver_full_name, 500) ||
      !isTrimmedText(value.resolution_description, 5000) ||
      !isTimestamp(value.resolved_at)
    ) return null;
    const noResolutionAttachment = value.resolution_attachment_id === null &&
      value.resolution_attachment_mime_type === null &&
      value.resolution_attachment_byte_size === null &&
      value.resolution_attachment_alt_text === null;
    let resolutionAttachment: ProjectActivityImageMetadata | null = null;
    if (!noResolutionAttachment) {
      const byteSize = parseSafeByteSize(value.resolution_attachment_byte_size);
      if (!isUuid(value.resolution_attachment_id) ||
        !isImageMimeType(value.resolution_attachment_mime_type) || byteSize === null ||
        !(value.resolution_attachment_alt_text === null ||
          isTrimmedText(value.resolution_attachment_alt_text, 500))) return null;
      resolutionAttachment = {
        attachmentId: value.resolution_attachment_id,
        mimeType: value.resolution_attachment_mime_type,
        byteSize,
        altText: value.resolution_attachment_alt_text,
      };
    }
    resolution = {
      resolutionId: value.resolution_id,
      resolvedByUserId: value.resolved_by_user_id,
      resolverFullName: value.resolver_full_name,
      description: value.resolution_description,
      resolvedAt: value.resolved_at,
      attachment: resolutionAttachment,
    };
  } else if (value.issue_resolved !== false ||
    value.resolution_attachment_id !== null ||
    value.resolution_attachment_mime_type !== null ||
    value.resolution_attachment_byte_size !== null ||
    value.resolution_attachment_alt_text !== null) {
    return null;
  }

  return {
    activityId: value.activity_id,
    projectId: value.project_id,
    authorUserId: value.author_user_id,
    authorFullName: value.author_full_name,
    title: value.title,
    description: value.description,
    activityKind: value.activity_kind,
    createdAt: value.created_at,
    alertSent: value.alert_sent,
    attachment,
    resolution,
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
    const { data, error } = await supabase.rpc(
      "list_project_activity_with_issue_resolution",
      {
      p_project_id: projectId,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.activityId ?? null,
      },
    );
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
    const { data, error } = await supabase.rpc(
      "get_project_activity_with_issue_resolution",
      {
      p_project_id: projectId,
      p_activity_id: activityId,
      },
    );
    if (error) {
      if (error.code === "P0002") {
        return {
          ok: false,
          error: {
            code: "activity_unavailable",
            message: "This Project Activity is unavailable.",
          },
        };
      }
      if (error.code === "42501") {
        return {
          ok: false,
          error: {
            code: "access_denied",
            message: "You no longer have access to this Project Activity.",
          },
        };
      }
      throw new Error();
    }
    if (!Array.isArray(data) || data.length !== 1) throw new Error();
    const item = parseActivityRow(data[0], false);
    if (
      !item || item.projectId.toLowerCase() !== projectId.toLowerCase() ||
      item.activityId.toLowerCase() !== activityId.toLowerCase()
    ) throw new Error();
    return { ok: true, value: item };
  } catch {
    return {
      ok: false,
      error: {
        code: "activity_load_failed",
        message: "Couldn't load the linked Activity.",
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
      p_activity_kind: input.activityKind,
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

function resolutionFailure(
  code: ProjectIssueResolutionErrorCode,
  message: string,
): ProjectIssueResolutionResult {
  return { ok: false, error: { code, message } };
}

function mapResolutionError(code: string | null): ProjectIssueResolutionResult {
  switch (code) {
    case "22023":
      return resolutionFailure(
        "invalid_description",
        "Enter a resolution description between 1 and 5000 characters.",
      );
    case "PIR01":
      return resolutionFailure(
        "conflicting_request",
        "This resolution request conflicts with an earlier submission.",
      );
    case "PIR02":
      return resolutionFailure(
        "not_an_issue",
        "Only a Project Issue can be resolved.",
      );
    case "PIR03":
      return resolutionFailure(
        "already_resolved",
        "This Issue has already been resolved.",
      );
    case "P0002":
      return resolutionFailure(
        "issue_unavailable",
        "This Project Issue is no longer available.",
      );
    case "42501":
      return resolutionFailure(
        "access_denied",
        "You do not have permission to resolve this Issue.",
      );
    default:
      return resolutionFailure(
        "resolution_failed",
        "The Issue could not be resolved. Please try again.",
      );
  }
}

function parseResolutionSuccess(value: unknown): ProjectIssueResolutionSuccess | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  if (!hasExactKeys(row, [
    "resolution_id",
    "project_activity_id",
    "project_id",
    "request_id",
    "resolved_by_user_id",
    "resolver_full_name",
    "description",
    "resolved_at",
    "notification_id",
    "recipient_count",
  ])) return null;
  const recipientCount = typeof row.recipient_count === "number" &&
      Number.isSafeInteger(row.recipient_count) && row.recipient_count >= 0
    ? String(row.recipient_count)
    : row.recipient_count;
  if (
    !isUuid(row.resolution_id) || !isUuid(row.project_activity_id) ||
    !isUuid(row.project_id) || !isUuid(row.request_id) ||
    !isUuid(row.resolved_by_user_id) ||
    !isTrimmedText(row.resolver_full_name, 500) ||
    !isTrimmedText(row.description, 5000) || !isTimestamp(row.resolved_at) ||
    !isUuid(row.notification_id) || typeof recipientCount !== "string" ||
    !/^\d+$/.test(recipientCount)
  ) return null;
  return {
    resolutionId: row.resolution_id,
    projectActivityId: row.project_activity_id,
    projectId: row.project_id,
    requestId: row.request_id,
    resolvedByUserId: row.resolved_by_user_id,
    resolverFullName: row.resolver_full_name,
    description: row.description,
    resolvedAt: row.resolved_at,
    notificationId: row.notification_id,
    recipientCount,
  };
}

export async function resolveProjectIssue(
  input: ProjectIssueResolutionInput,
): Promise<ProjectIssueResolutionResult> {
  try {
    const { data, error } = await supabase.rpc("resolve_project_issue", {
      p_project_activity_id: input.activityId,
      p_request_id: input.requestId,
      p_description: input.description,
    });
    if (error) return mapResolutionError(error.code ?? null);
    const parsed = parseResolutionSuccess(data);
    return parsed
      ? { ok: true, value: parsed }
      : resolutionFailure(
          "resolution_failed",
          "The Issue resolution could not be confirmed. Please try again.",
        );
  } catch {
    return resolutionFailure(
      "resolution_outcome_unknown",
      "The resolution result could not be confirmed. Retry this same resolution.",
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

function mapResolutionImageUploadError(
  code: string | null,
): ProjectActivityImageUploadResult {
  switch (code) {
    case "attachment_conflict":
      return imageUploadFailure(
        "attachment_conflict",
        "This resolution already has a different image attachment.",
      );
    case "resolution_not_found":
      return imageUploadFailure(
        "project_activity_unavailable",
        "The Project Issue resolution is no longer available for an image attachment.",
      );
    case "access_denied":
      return imageUploadFailure(
        "access_denied",
        "You do not have permission to attach this resolution image.",
      );
    default:
      return mapImageUploadError(code);
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
    return parsed
      ? { ok: true, value: parsed }
      : mapImageUploadError(null);
  } catch {
    return mapImageUploadError("attachment_outcome_unknown");
  }
}

export async function uploadProjectIssueResolutionImage(
  input: ProjectIssueResolutionImageUploadInput,
): Promise<ProjectActivityImageUploadResult> {
  const body = new FormData();
  body.set("projectId", input.projectId);
  body.set("activityId", input.activityId);
  body.set("resolutionId", input.resolutionId);
  body.set("requestId", input.requestId);
  body.set("file", input.file);
  if (input.altText) body.set("altText", input.altText);
  try {
    const { data, error } = await supabase.functions.invoke(
      "project-issue-resolution-image-upload",
      { body },
    );
    if (error) {
      return mapResolutionImageUploadError(await readFunctionErrorCode(error));
    }
    const parsed = parseImageMetadata(data);
    return parsed
      ? { ok: true, value: parsed }
      : mapResolutionImageUploadError(null);
  } catch {
    return mapResolutionImageUploadError("attachment_outcome_unknown");
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

export async function getProjectIssueResolutionImageAccess(
  projectId: string,
  activityId: string,
  resolutionId: string,
): Promise<ProjectActivityImageAccessResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "project-issue-resolution-image-access",
      { body: { projectId, activityId, resolutionId } },
    );
    if (error || !isRecord(data) || !hasExactKeys(data, [
      "signedUrl", "expiresIn", "mimeType", "byteSize", "altText",
    ])) throw new Error();
    const byteSize = parseSafeByteSize(data.byteSize);
    if (!isImageMimeType(data.mimeType) || byteSize === null ||
      !(data.altText === null || isTrimmedText(data.altText, 500)) ||
      !isSafeSignedUrl(data.signedUrl) || data.expiresIn !== 300) throw new Error();
    return { ok: true, value: {
      signedUrl: data.signedUrl,
      expiresIn: 300,
      mimeType: data.mimeType,
      byteSize,
      altText: data.altText,
    } };
  } catch {
    return { ok: false, error: {
      code: "image_access_failed",
      message: "The resolution image could not be opened.",
    } };
  }
}
