import { supabase } from "../../../lib/supabase/client";

export interface InventoryCommitment {
  productId: string;
  physicalQuantity: bigint;
  committedToProjects: bigint;
  availableAfterCommitments: bigint;
}

export interface ProjectCommitment {
  projectId: string;
  projectName: string;
  plannedRequirement: bigint;
  actualProjectConsumption: bigint;
  outstandingCommitment: bigint;
}

export type CommitmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "load_failed"; message: string } };

const loadError = { code: "load_failed" as const, message: "Project commitments could not be loaded. Please try again." };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }
  return typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value)
    ? BigInt(value)
    : null;
}

function parseInventoryCommitment(value: unknown): InventoryCommitment | null {
  if (!record(value) || typeof value.product_id !== "string" || !uuidPattern.test(value.product_id)) return null;
  const physicalQuantity = whole(value.physical_quantity);
  const committedToProjects = whole(value.committed_to_projects);
  const availableAfterCommitments = whole(value.available_after_commitments);
  if (physicalQuantity === null || committedToProjects === null || availableAfterCommitments === null ||
    physicalQuantity < 0n || committedToProjects < 0n ||
    availableAfterCommitments !== physicalQuantity - committedToProjects) return null;
  return { productId: value.product_id, physicalQuantity, committedToProjects, availableAfterCommitments };
}

function parseProjectCommitment(value: unknown): ProjectCommitment | null {
  if (!record(value) || typeof value.project_id !== "string" || !uuidPattern.test(value.project_id) ||
    typeof value.project_name !== "string" || !value.project_name.trim() || value.project_name !== value.project_name.trim()) return null;
  const plannedRequirement = whole(value.planned_requirement);
  const actualProjectConsumption = whole(value.actual_project_consumption);
  const outstandingCommitment = whole(value.outstanding_commitment);
  if (plannedRequirement === null || actualProjectConsumption === null || outstandingCommitment === null ||
    plannedRequirement < 0n || actualProjectConsumption < 0n || outstandingCommitment <= 0n ||
    outstandingCommitment !== (plannedRequirement > actualProjectConsumption ? plannedRequirement - actualProjectConsumption : 0n)) return null;
  return { projectId: value.project_id, projectName: value.project_name, plannedRequirement, actualProjectConsumption, outstandingCommitment };
}

export async function getInventoryCommitments(): Promise<CommitmentResult<InventoryCommitment[]>> {
  try {
    const { data, error } = await supabase.rpc("get_inventory_project_commitments");
    if (error || !Array.isArray(data)) return { ok: false, error: loadError };
    const values = data.map(parseInventoryCommitment);
    if (values.some((value) => value === null)) return { ok: false, error: loadError };
    const parsed = values as InventoryCommitment[];
    if (new Set(parsed.map((value) => value.productId)).size !== parsed.length) return { ok: false, error: loadError };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: loadError };
  }
}

export async function getProductProjectCommitments(productId: string): Promise<CommitmentResult<ProjectCommitment[]>> {
  if (!uuidPattern.test(productId)) return { ok: false, error: loadError };
  try {
    const { data, error } = await supabase.rpc("get_product_project_commitments", { p_product_id: productId });
    if (error || !Array.isArray(data)) return { ok: false, error: loadError };
    const values = data.map(parseProjectCommitment);
    if (values.some((value) => value === null)) return { ok: false, error: loadError };
    const parsed = values as ProjectCommitment[];
    if (new Set(parsed.map((value) => value.projectId)).size !== parsed.length) return { ok: false, error: loadError };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: loadError };
  }
}
