import { generateWorkOrderPdf } from "../_shared/work-order-pdf/generator";
import {
  parseWorkOrderPdfSnapshot,
  type WorkOrderPdfSnapshot,
} from "../_shared/work-order-pdf/model";

const workOrderPdfBucket = "work-order-pdfs";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export const finishWorkOrderCorsHeaders = {
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

export interface FinishWorkOrderActorClient {
  auth: {
    getUser: (accessToken: string) => PromiseLike<ActorUserResult>;
  };
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
}

interface StorageResult {
  error: ProviderError | null;
}

export interface FinishWorkOrderStorageBucket {
  upload: (
    path: string,
    bytes: Uint8Array,
    options: {
      cacheControl: string;
      contentType: "application/pdf";
      upsert: false;
    },
  ) => PromiseLike<StorageResult>;
  remove: (paths: string[]) => PromiseLike<StorageResult>;
}

export interface FinishWorkOrderStorageClient {
  storage: {
    from: (bucket: string) => FinishWorkOrderStorageBucket;
  };
}

export interface FinishWorkOrderDependencies {
  createActorClient: (accessToken: string) => FinishWorkOrderActorClient;
  createStorageClient: () => FinishWorkOrderStorageClient;
  generatePdf?: (snapshot: WorkOrderPdfSnapshot) => Promise<Uint8Array>;
  randomUuid?: () => string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

interface FinalizationRequest {
  workOrderId: string;
  expectedUpdatedAt: string;
}

interface FinishResult {
  workOrderId: string;
  workOrderNumber: string;
  finishedAt: string;
  projectId: string;
  projectCompleted: boolean;
  workOrderPdfId: string;
  storageReference: string;
}

interface SafeError {
  status: number;
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(error: SafeError): Response {
  return Response.json(
    { code: error.code, message: error.message },
    { status: error.status, headers: finishWorkOrderCorsHeaders },
  );
}

function readBearerToken(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? null;
}

function parseRequest(value: unknown): FinalizationRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("workOrderId") ||
    !keys.includes("expectedUpdatedAt") ||
    typeof value.workOrderId !== "string" ||
    !uuidPattern.test(value.workOrderId) ||
    typeof value.expectedUpdatedAt !== "string" ||
    !timestampPattern.test(value.expectedUpdatedAt) ||
    !Number.isFinite(Date.parse(value.expectedUpdatedAt))
  ) {
    return null;
  }

  return {
    workOrderId: value.workOrderId,
    expectedUpdatedAt: value.expectedUpdatedAt,
  };
}

function providerErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function domainError(error: unknown, stage: "snapshot" | "finish"): SafeError {
  const code = providerErrorCode(error);
  const known: Record<string, SafeError> = {
    "42501": {
      status: 403,
      code: "access_denied",
      message: "You do not have permission to finish this Work Order.",
    },
    WOR02: {
      status: 409,
      code: "work_order_already_finished",
      message: "This Work Order is already Finished.",
    },
    WOR05: {
      status: 409,
      code: "stale_work_order",
      message: "This Work Order changed. Reload it before finishing.",
    },
    WOR06: {
      status: 409,
      code: "project_requirement_exceeded",
      message:
        "These materials exceed the remaining requirement for the selected Project. Reduce the quantities or review the Project plan.",
    },
    WOR07: {
      status: 422,
      code: "work_order_incomplete",
      message: "Complete the Work Order before finishing it.",
    },
    WOR08: {
      status: 409,
      code: "project_unavailable",
      message: "The selected Project is no longer available for this Work Order.",
    },
    PRD05: {
      status: 409,
      code: "product_unavailable",
      message: "A Work Order material Product is no longer available.",
    },
    IVB01: {
      status: 409,
      code: "inventory_balance_unavailable",
      message: "Inventory is unavailable for a Work Order material.",
    },
    IVB02: {
      status: 409,
      code: "insufficient_inventory",
      message: "There is not enough physical Inventory to finish this Work Order.",
    },
    P0002: {
      status: 404,
      code: "work_order_not_found",
      message: "The Work Order could not be found.",
    },
  };
  if (code && known[code]) return known[code];
  if (stage === "finish" && code === "22023") {
    return {
      status: 409,
      code: "pdf_candidate_invalid",
      message: "The Work Order PDF candidate could not be finalized.",
    };
  }
  return stage === "snapshot"
    ? {
      status: 500,
      code: "snapshot_unavailable",
      message: "The trusted Work Order snapshot could not be loaded.",
    }
    : {
      status: 500,
      code: "finish_failed",
      message: "The Work Order could not be finished.",
    };
}

function parseFinishResult(value: unknown, finalPath: string): FinishResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  if (
    typeof row.work_order_id !== "string" ||
    !uuidPattern.test(row.work_order_id) ||
    typeof row.work_order_number !== "string" ||
    !/^RN-[0-9]{4}-[0-9]{4}$/.test(row.work_order_number) ||
    typeof row.finished_at !== "string" ||
    !timestampPattern.test(row.finished_at) ||
    !Number.isFinite(Date.parse(row.finished_at)) ||
    typeof row.project_id !== "string" ||
    !uuidPattern.test(row.project_id) ||
    typeof row.project_completed !== "boolean" ||
    typeof row.work_order_pdf_id !== "string" ||
    !uuidPattern.test(row.work_order_pdf_id)
  ) {
    return null;
  }

  return {
    workOrderId: row.work_order_id,
    workOrderNumber: row.work_order_number,
    finishedAt: row.finished_at,
    projectId: row.project_id,
    projectCompleted: row.project_completed,
    workOrderPdfId: row.work_order_pdf_id,
    storageReference: finalPath,
  };
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function removeObject(
  storage: FinishWorkOrderStorageBucket,
  path: string,
): Promise<boolean> {
  try {
    const { error } = await storage.remove([path]);
    return error === null;
  } catch {
    return false;
  }
}

async function cleanupFailureObjects(
  storage: FinishWorkOrderStorageBucket,
  finalPath: string | null,
  temporaryPath: string | null,
): Promise<void> {
  if (finalPath) await removeObject(storage, finalPath);
  if (temporaryPath) await removeObject(storage, temporaryPath);
}

export async function handleFinishWorkOrderRequest(
  request: Request,
  dependencies: FinishWorkOrderDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: finishWorkOrderCorsHeaders,
    });
  }
  if (request.method !== "POST") {
    return jsonError({
      status: 405,
      code: "method_not_allowed",
      message: "Only POST is supported.",
    });
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) {
    return jsonError({
      status: 401,
      code: "unauthenticated",
      message: "Authentication is required.",
    });
  }

  let actor: FinishWorkOrderActorClient;
  try {
    actor = dependencies.createActorClient(accessToken);
    const { data, error } = await actor.auth.getUser(accessToken);
    if (error || !data.user) {
      return jsonError({
        status: 401,
        code: "unauthenticated",
        message: "Authentication is required.",
      });
    }
  } catch {
    return jsonError({
      status: 401,
      code: "unauthenticated",
      message: "Authentication is required.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError({
      status: 400,
      code: "invalid_request",
      message: "A valid Work Order ID and expected update timestamp are required.",
    });
  }
  const input = parseRequest(body);
  if (!input) {
    return jsonError({
      status: 400,
      code: "invalid_request",
      message: "A valid Work Order ID and expected update timestamp are required.",
    });
  }

  let rawSnapshot: unknown;
  try {
    const { data, error } = await actor.rpc("get_work_order_pdf_snapshot", {
      p_work_order_id: input.workOrderId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) return jsonError(domainError(error, "snapshot"));
    rawSnapshot = data;
  } catch (error) {
    return jsonError(domainError(error, "snapshot"));
  }

  let snapshot: WorkOrderPdfSnapshot;
  try {
    snapshot = parseWorkOrderPdfSnapshot(rawSnapshot);
    if (snapshot.workOrderId !== input.workOrderId) throw new Error();
  } catch {
    return jsonError({
      status: 500,
      code: "snapshot_unavailable",
      message: "The trusted Work Order snapshot could not be loaded.",
    });
  }

  let pdfBytes: Uint8Array;
  let contentHash: string;
  try {
    pdfBytes = await (dependencies.generatePdf ?? generateWorkOrderPdf)(snapshot);
    if (!isPdf(pdfBytes)) throw new Error();
    contentHash = await (dependencies.sha256 ?? sha256Hex)(pdfBytes);
    if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error();
  } catch {
    return jsonError({
      status: 500,
      code: "pdf_generation_failed",
      message: "The canonical Work Order PDF could not be generated.",
    });
  }

  let storage: FinishWorkOrderStorageBucket;
  let temporaryPath: string;
  let finalPath: string;
  try {
    const randomUuid = dependencies.randomUuid ?? crypto.randomUUID.bind(crypto);
    const temporaryId = randomUuid();
    const finalId = randomUuid();
    if (!uuidPattern.test(temporaryId) || !uuidPattern.test(finalId)) {
      throw new Error();
    }
    temporaryPath = `_tmp/${input.workOrderId}/${temporaryId}.pdf`;
    finalPath = `final/${input.workOrderId}/${finalId}.pdf`;
    storage = dependencies.createStorageClient().storage.from(workOrderPdfBucket);
  } catch {
    return jsonError({
      status: 500,
      code: "storage_preparation_failed",
      message: "The Work Order PDF could not be prepared.",
    });
  }

  let temporaryCreated = false;
  let finalCreated = false;
  const uploadOptions = {
    cacheControl: "0",
    contentType: "application/pdf" as const,
    upsert: false as const,
  };

  try {
    const { error } = await storage.upload(
      temporaryPath,
      pdfBytes,
      uploadOptions,
    );
    if (error) throw new Error();
    temporaryCreated = true;

    const finalUpload = await storage.upload(finalPath, pdfBytes, uploadOptions);
    if (finalUpload.error) throw new Error();
    finalCreated = true;
  } catch {
    await cleanupFailureObjects(
      storage,
      finalCreated ? finalPath : null,
      temporaryCreated ? temporaryPath : null,
    );
    return jsonError({
      status: 503,
      code: "storage_preparation_failed",
      message: "The Work Order PDF could not be prepared.",
    });
  }

  let finishData: unknown;
  try {
    const { data, error } = await actor.rpc("finish_work_order", {
      p_work_order_id: input.workOrderId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_pdf_storage_reference: finalPath,
      p_pdf_content_hash: contentHash,
    });
    if (error) {
      await cleanupFailureObjects(storage, finalPath, temporaryPath);
      return jsonError(domainError(error, "finish"));
    }
    finishData = data;
  } catch {
    // A transport exception has an indeterminate commit outcome. Keep the final
    // candidate: it may already be the immutable referenced document. It stays
    // private if the database transaction did not commit.
    await removeObject(storage, temporaryPath);
    return jsonError({
      status: 503,
      code: "finish_outcome_unknown",
      message:
        "The Work Order finalization result could not be confirmed. Reload before trying again.",
    });
  }

  const result = parseFinishResult(finishData, finalPath);
  if (!result || result.workOrderId !== input.workOrderId) {
    // A committed Finish must retain its referenced final object. Temporary
    // cleanup is best-effort; returning a mutation failure could cause retry.
    await removeObject(storage, temporaryPath);
    return jsonError({
      status: 500,
      code: "finish_response_invalid",
      message: "The Work Order was finalized but its result could not be read.",
    });
  }

  // The database has committed the exact final reference. A private temporary
  // orphan is safer than removing that reference or reporting a false failure.
  await removeObject(storage, temporaryPath);
  return Response.json(result, {
    status: 200,
    headers: finishWorkOrderCorsHeaders,
  });
}
