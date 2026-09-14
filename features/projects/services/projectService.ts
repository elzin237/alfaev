import { supabase } from "../../../lib/supabase/client";
import { isProjectStatus, type ProjectStatus } from "../projectStatus";

interface ProjectListRow {
  id: string;
  name: string;
  customer_name: string;
  status: ProjectStatus;
  start_date: string;
  delivery_date: string;
}

interface ProjectDetailRow extends ProjectListRow {
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem {
  id: string;
  name: string;
  customerName: string;
  status: ProjectStatus;
  startDate: string;
  deliveryDate: string;
}

export interface ProjectDetail extends ProjectListItem {
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListError {
  code: "project_list_failed";
  message: string;
}

export type ProjectListResult =
  | { ok: true; value: ProjectListItem[] }
  | { ok: false; error: ProjectListError };

export interface ProjectDetailError {
  code: "project_not_found" | "project_detail_failed";
  message: string;
}

export type ProjectDetailResult =
  | { ok: true; value: ProjectDetail }
  | { ok: false; error: ProjectDetailError };

export interface ProjectCreateInput {
  name: string;
  customerName: string;
  startDate: string;
  deliveryDate: string;
}

export interface CreatedProject {
  projectId: string;
}

export interface ProjectCreateError {
  code: "access_denied" | "project_invalid" | "project_create_failed";
  message: string;
}

export type ProjectCreateResult =
  | { ok: true; value: CreatedProject }
  | { ok: false; error: ProjectCreateError };

const projectListFields =
  "id,name,customer_name,status,start_date,delivery_date";
const projectDetailFields =
  `${projectListFields},created_at,updated_at`;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isProjectId(value: string): boolean {
  return uuidPattern.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    isoTimestampPattern.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isProjectListRow(value: unknown): value is ProjectListRow {
  if (typeof value !== "object" || value === null) return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    uuidPattern.test(value.id) &&
    "name" in value &&
    isTrimmedNonblank(value.name) &&
    "customer_name" in value &&
    isTrimmedNonblank(value.customer_name) &&
    "status" in value &&
    isProjectStatus(value.status) &&
    "start_date" in value &&
    isIsoDate(value.start_date) &&
    "delivery_date" in value &&
    isIsoDate(value.delivery_date)
  );
}

function mapProject(row: ProjectListRow): ProjectListItem {
  return {
    id: row.id,
    name: row.name,
    customerName: row.customer_name,
    status: row.status,
    startDate: row.start_date,
    deliveryDate: row.delivery_date,
  };
}

function isProjectDetailRow(value: unknown): value is ProjectDetailRow {
  return isProjectListRow(value) &&
    "created_at" in value &&
    isIsoTimestamp(value.created_at) &&
    "updated_at" in value &&
    isIsoTimestamp(value.updated_at);
}

function mapProjectDetail(row: ProjectDetailRow): ProjectDetail {
  return {
    ...mapProject(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function compareProjects(
  left: ProjectListItem,
  right: ProjectListItem,
): number {
  return left.startDate.localeCompare(right.startDate) ||
    left.deliveryDate.localeCompare(right.deliveryDate) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function listFailure(): ProjectListResult {
  return {
    ok: false,
    error: {
      code: "project_list_failed",
      message: "The Project list could not be loaded.",
    },
  };
}

function detailFailure(): ProjectDetailResult {
  return {
    ok: false,
    error: {
      code: "project_detail_failed",
      message: "The Project details could not be loaded.",
    },
  };
}

function notFoundFailure(): ProjectDetailResult {
  return {
    ok: false,
    error: {
      code: "project_not_found",
      message: "The Project could not be found.",
    },
  };
}

function createFailure(code?: string): ProjectCreateResult {
  if (code === "42501") {
    return {
      ok: false,
      error: {
        code: "access_denied",
        message: "You do not have permission to create Projects.",
      },
    };
  }

  if (["22007", "22008", "22023", "23514"].includes(code ?? "")) {
    return {
      ok: false,
      error: {
        code: "project_invalid",
        message: "Enter valid Project details and dates.",
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "project_create_failed",
      message: "The Project could not be created. Please try again.",
    },
  };
}

export async function listProjects(): Promise<ProjectListResult> {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select(projectListFields);

    if (error || !Array.isArray(data) || !data.every(isProjectListRow)) {
      return listFailure();
    }

    return {
      ok: true,
      value: data.map(mapProject).sort(compareProjects),
    };
  } catch {
    return listFailure();
  }
}

export async function getProject(
  projectId: string,
): Promise<ProjectDetailResult> {
  if (!isProjectId(projectId)) return notFoundFailure();

  try {
    const { data, error } = await supabase
      .from("projects")
      .select(projectDetailFields)
      .eq("id", projectId)
      .maybeSingle();

    if (error) return detailFailure();
    if (data === null) return notFoundFailure();
    if (!isProjectDetailRow(data)) return detailFailure();

    return { ok: true, value: mapProjectDetail(data) };
  } catch {
    return detailFailure();
  }
}

export async function createProject(
  input: ProjectCreateInput,
): Promise<ProjectCreateResult> {
  try {
    const { data, error } = await supabase.rpc("create_project", {
      p_name: input.name.trim(),
      p_customer_name: input.customerName.trim(),
      p_start_date: input.startDate,
      p_delivery_date: input.deliveryDate,
    });

    if (error) return createFailure(error.code);
    if (typeof data !== "string" || !uuidPattern.test(data)) {
      return createFailure();
    }

    return { ok: true, value: { projectId: data } };
  } catch {
    return createFailure();
  }
}
