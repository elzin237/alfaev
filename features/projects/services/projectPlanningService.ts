import { supabase } from "../../../lib/supabase/client";
import { isProjectId } from "./projectService";

export type PlanningProductKind = "component" | "pcb_finished_good";

export interface ProjectRequirementInventoryContext {
  category: string;
  brandName: string | null;
  physicalQuantity: bigint;
  committedToProjects: bigint;
  availableAfterCommitments: bigint;
}

export interface ProjectRequirement {
  id: string;
  productId: string;
  serialNumber: string;
  productName: string;
  productKind: PlanningProductKind;
  requiredQuantity: bigint;
  inventoryContext: ProjectRequirementInventoryContext | null;
}

export interface ProjectPlanningGroup {
  id: string;
  projectId: string;
  name: string;
  requirements: ProjectRequirement[];
}

export interface PlanningProductChoice {
  productId: string;
  serialNumber: string;
  name: string;
  productKind: PlanningProductKind;
}

export interface PlanningError {
  code:
    | "access_denied"
    | "project_closed"
    | "duplicate_requirement"
    | "children_present"
    | "product_unavailable"
    | "not_found"
    | "invalid_input"
    | "load_failed"
    | "mutation_failed";
  message: string;
}

export type PlanningResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: PlanningError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isSerial(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{7}$/.test(value);
}

function isProductKind(value: unknown): value is PlanningProductKind {
  return value === "component" || value === "pcb_finished_good";
}

function whole(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }
  return typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value)
    ? BigInt(value)
    : null;
}

function parseInventoryContext(
  row: Record<string, unknown>,
): ProjectRequirementInventoryContext | null | undefined {
  const contextValues = [
    row.category,
    row.brand_name,
    row.physical_quantity,
    row.committed_to_projects,
    row.available_after_commitments,
  ];
  if (contextValues.every((value) => value === null)) return null;
  if (!isName(row.category) ||
    !(row.brand_name === null || isName(row.brand_name))) return undefined;
  const physicalQuantity = whole(row.physical_quantity);
  const committedToProjects = whole(row.committed_to_projects);
  const availableAfterCommitments = whole(row.available_after_commitments);
  if (physicalQuantity === null || committedToProjects === null ||
    availableAfterCommitments === null || physicalQuantity < 0n ||
    committedToProjects < 0n ||
    availableAfterCommitments !== physicalQuantity - committedToProjects) {
    return undefined;
  }
  return {
    category: row.category,
    brandName: row.brand_name,
    physicalQuantity,
    committedToProjects,
    availableAfterCommitments,
  };
}

function failure(code: PlanningError["code"]): PlanningError {
  const messages: Record<PlanningError["code"], string> = {
    access_denied: "You do not have permission to change this Project plan.",
    project_closed: "Completed or Cancelled Projects cannot be changed.",
    duplicate_requirement: "This Product is already required by this Project Product.",
    children_present: "Remove all component requirements before removing this Project Product.",
    product_unavailable: "The selected Product is no longer available.",
    not_found: "The planning record could not be found.",
    invalid_input: "Enter valid planning details.",
    load_failed: "The Project plan could not be loaded. Please try again.",
    mutation_failed: "The Project plan could not be changed. Please try again.",
  };
  return { code, message: messages[code] };
}

function mutationError(code: string | undefined): PlanningError {
  switch (code) {
    case "42501": return failure("access_denied");
    case "PPL01": return failure("project_closed");
    case "PPL02":
    case "23505": return failure("duplicate_requirement");
    case "PPL03": return failure("children_present");
    case "PPL04": return failure("product_unavailable");
    case "P0002": return failure("not_found");
    case "22023":
    case "23514": return failure("invalid_input");
    default: return failure("mutation_failed");
  }
}

export async function getProjectPlanning(
  projectId: string,
): Promise<PlanningResult<ProjectPlanningGroup[]>> {
  if (!isProjectId(projectId)) return { ok: false, error: failure("invalid_input") };
  let data: unknown;
  let error: { code?: string } | null;
  try {
    ({ data, error } = await supabase.rpc("get_project_planning", {
      p_project_id: projectId,
    }));
  } catch {
    return { ok: false, error: failure("load_failed") };
  }
  if (error || !Array.isArray(data)) {
    return { ok: false, error: failure("load_failed") };
  }
  const groups = new Map<string, ProjectPlanningGroup>();
  const requirementIds = new Set<string>();
  for (const row of data as unknown[]) {
    if (!isRecord(row) ||
      !isProjectId(String(row.project_product_id)) ||
      !isName(row.project_product_name)) {
      return { ok: false, error: failure("load_failed") };
    }
    const groupId = row.project_product_id as string;
    const existing = groups.get(groupId);
    if (existing && existing.name !== row.project_product_name) {
      return { ok: false, error: failure("load_failed") };
    }
    const group = existing ?? {
      id: groupId,
      projectId,
      name: row.project_product_name,
      requirements: [],
    };
    if (row.component_id === null) {
      if (row.product_id !== null || row.serial_number !== null ||
        row.product_name !== null || row.product_kind !== null ||
        row.required_quantity !== null || row.category !== null ||
        row.brand_name !== null || row.physical_quantity !== null ||
        row.committed_to_projects !== null ||
        row.available_after_commitments !== null) {
        return { ok: false, error: failure("load_failed") };
      }
    } else {
      const inventoryContext = parseInventoryContext(row);
      const requiredQuantity = whole(row.required_quantity);
      if (!isProjectId(String(row.component_id)) ||
        !isProjectId(String(row.product_id)) ||
        !isSerial(row.serial_number) ||
        !isName(row.product_name) ||
        !isProductKind(row.product_kind) ||
        requiredQuantity === null || requiredQuantity <= 0n ||
        inventoryContext === undefined ||
        requirementIds.has(row.component_id as string)) {
        return { ok: false, error: failure("load_failed") };
      }
      requirementIds.add(row.component_id as string);
      group.requirements.push({
        id: row.component_id as string,
        productId: row.product_id as string,
        serialNumber: row.serial_number,
        productName: row.product_name,
        productKind: row.product_kind,
        requiredQuantity,
        inventoryContext,
      });
    }
    groups.set(groupId, group);
  }
  return { ok: true, value: [...groups.values()] };
}

export async function searchPlanningProductChoices(
  search: string,
): Promise<PlanningResult<PlanningProductChoice[]>> {
  let data: unknown;
  let error: { code?: string } | null;
  try {
    ({ data, error } = await supabase.rpc(
      "search_project_component_product_choices",
      { p_search: search.trim() || null },
    ));
  } catch {
    return { ok: false, error: failure("load_failed") };
  }
  if (error || !Array.isArray(data)) {
    return { ok: false, error: failure("load_failed") };
  }
  const choices: PlanningProductChoice[] = [];
  for (const row of data as unknown[]) {
    if (!isRecord(row) || !isProjectId(String(row.product_id)) ||
      !isSerial(row.serial_number) || !isName(row.name) ||
      !isProductKind(row.product_kind)) {
      return { ok: false, error: failure("load_failed") };
    }
    choices.push({
      productId: row.product_id as string,
      serialNumber: row.serial_number,
      name: row.name,
      productKind: row.product_kind,
    });
  }
  return { ok: true, value: choices };
}

async function mutate(
  rpc: string,
  args: Record<string, unknown>,
): Promise<PlanningResult<{ id: string }>> {
  let data: unknown;
  let error: { code?: string } | null;
  try {
    ({ data, error } = await supabase.rpc(rpc, args));
  } catch {
    return { ok: false, error: failure("mutation_failed") };
  }
  if (error) return { ok: false, error: mutationError(error.code) };
  if (!isProjectId(String(data))) {
    return { ok: false, error: failure("mutation_failed") };
  }
  return { ok: true, value: { id: data as string } };
}

export function createProjectProduct(projectId: string, name: string) {
  return mutate("create_project_product", {
    p_project_id: projectId, p_name: name.trim(),
  });
}

export function updateProjectProduct(id: string, name: string) {
  return mutate("update_project_product", {
    p_project_product_id: id, p_name: name.trim(),
  });
}

export function removeProjectProduct(id: string) {
  return mutate("remove_project_product", { p_project_product_id: id });
}

export function createProjectRequirement(
  groupId: string, productId: string, quantity: number,
) {
  return mutate("create_project_product_component", {
    p_project_product_id: groupId,
    p_product_id: productId,
    p_required_quantity: quantity,
  });
}

export function updateProjectRequirement(
  id: string, productId: string, quantity: number | string,
) {
  return mutate("update_project_product_component", {
    p_component_id: id,
    p_product_id: productId,
    p_required_quantity: quantity,
  });
}

export function removeProjectRequirement(id: string) {
  return mutate("remove_project_product_component", { p_component_id: id });
}
