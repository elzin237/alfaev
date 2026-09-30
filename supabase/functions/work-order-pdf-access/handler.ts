const workOrderPdfBucket = "work-order-pdfs";
const signedUrlTtlSeconds = 300;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export const workOrderPdfAccessCorsHeaders = {
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

interface WorkOrderPdfMetadataResult {
  data: unknown;
  error: ProviderError | null;
}

interface WorkOrderPdfMetadataFilter {
  maybeSingle: () => PromiseLike<WorkOrderPdfMetadataResult>;
}

interface WorkOrderPdfMetadataQuery {
  eq: (column: "work_order_id", value: string) => WorkOrderPdfMetadataFilter;
}

interface WorkOrderPdfMetadataTable {
  select: (
    columns: "id,work_order_id,storage_reference",
  ) => WorkOrderPdfMetadataQuery;
}

export interface WorkOrderPdfAccessActorClient {
  auth: {
    getUser: (accessToken: string) => PromiseLike<ActorUserResult>;
  };
  from: (table: "work_order_pdfs") => WorkOrderPdfMetadataTable;
  rpc: (
    functionName: "get_finished_work_order_detail",
    parameters: { p_work_order_id: string },
  ) => PromiseLike<RpcResult>;
}

interface SignedUrlResult {
  data: { signedUrl: string } | null;
  error: ProviderError | null;
}

export interface WorkOrderPdfAccessStorageBucket {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => PromiseLike<SignedUrlResult>;
}

export interface WorkOrderPdfAccessStorageClient {
  storage: {
    from: (bucket: "work-order-pdfs") => WorkOrderPdfAccessStorageBucket;
  };
}

export interface WorkOrderPdfAccessDependencies {
  createActorClient: (accessToken: string) => WorkOrderPdfAccessActorClient;
  createStorageClient: () => WorkOrderPdfAccessStorageClient;
}

interface FinishedPdfIdentity {
  pdfId: string;
}

interface WorkOrderPdfMetadata {
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
    { status: error.status, headers: workOrderPdfAccessCorsHeaders },
  );
}

function readBearerToken(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? null;
}

function parseRequest(value: unknown): { workOrderId: string } | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.workOrderId !== "string" ||
    !uuidPattern.test(value.workOrderId)
  ) return null;
  return { workOrderId: value.workOrderId };
}

function parseFinishedPdfIdentity(
  value: unknown,
  workOrderId: string,
): FinishedPdfIdentity | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  if (
    row.work_order_id !== workOrderId ||
    typeof row.pdf_id !== "string" ||
    !uuidPattern.test(row.pdf_id) ||
    row.document_version !== 1 ||
    typeof row.generated_at !== "string" ||
    !timestampPattern.test(row.generated_at) ||
    !Number.isFinite(Date.parse(row.generated_at))
  ) return null;
  return { pdfId: row.pdf_id };
}

function finalPdfPathPattern(workOrderId: string): RegExp {
  return new RegExp(
    `^final/${workOrderId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.pdf$`,
    "i",
  );
}

function parsePdfMetadata(
  value: unknown,
  workOrderId: string,
  expectedPdfId: string,
): WorkOrderPdfMetadata | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.id !== expectedPdfId ||
    value.work_order_id !== workOrderId ||
    typeof value.storage_reference !== "string" ||
    !finalPdfPathPattern(workOrderId).test(value.storage_reference)
  ) return null;
  return { storageReference: value.storage_reference };
}

function isSignedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" && url.password === "" && url.hash === "" &&
      url.searchParams.has("token");
  } catch {
    return false;
  }
}

function mapReadError(error: ProviderError | null): SafeError {
  if (error?.code === "42501") return {
    status: 403,
    code: "access_denied",
    message: "You do not have permission to view this Work Order PDF.",
  };
  if (error?.code === "P0002") return {
    status: 404,
    code: "work_order_not_found",
    message: "The Work Order could not be found.",
  };
  if (error?.code === "WOR10") return {
    status: 409,
    code: "work_order_not_finished",
    message: "The Work Order is not Finished.",
  };
  return {
    status: 500,
    code: "pdf_access_failed",
    message: "The official Work Order PDF could not be opened.",
  };
}

export async function handleWorkOrderPdfAccessRequest(
  request: Request,
  dependencies: WorkOrderPdfAccessDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: workOrderPdfAccessCorsHeaders,
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

  let actor: WorkOrderPdfAccessActorClient;
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
    body = null;
  }
  const input = parseRequest(body);
  if (!input) {
    return jsonError({
      status: 400,
      code: "invalid_request",
      message: "A valid Work Order ID is required.",
    });
  }

  let identity: FinishedPdfIdentity | null;
  try {
    const { data, error } = await actor.rpc("get_finished_work_order_detail", {
      p_work_order_id: input.workOrderId,
    });
    if (error) return jsonError(mapReadError(error));
    identity = parseFinishedPdfIdentity(data, input.workOrderId);
  } catch {
    return jsonError(mapReadError(null));
  }
  if (!identity) {
    return jsonError({
      status: 404,
      code: "pdf_not_found",
      message: "The official Work Order PDF could not be found.",
    });
  }

  let metadata: WorkOrderPdfMetadata | null;
  try {
    const { data, error } = await actor
      .from("work_order_pdfs")
      .select("id,work_order_id,storage_reference")
      .eq("work_order_id", input.workOrderId)
      .maybeSingle();
    if (error) return jsonError(mapReadError(error));
    metadata = parsePdfMetadata(data, input.workOrderId, identity.pdfId);
  } catch {
    return jsonError(mapReadError(null));
  }
  if (!metadata) {
    return jsonError({
      status: 404,
      code: "pdf_not_found",
      message: "The official Work Order PDF could not be found.",
    });
  }

  try {
    const storage = dependencies.createStorageClient().storage.from(
      workOrderPdfBucket,
    );
    const { data, error } = await storage.createSignedUrl(
      metadata.storageReference,
      signedUrlTtlSeconds,
    );
    if (error || !isSignedUrl(data?.signedUrl)) {
      return jsonError(mapReadError(null));
    }
    return Response.json(
      { signedUrl: data.signedUrl, expiresIn: signedUrlTtlSeconds },
      {
        status: 200,
        headers: {
          ...workOrderPdfAccessCorsHeaders,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return jsonError(mapReadError(null));
  }
}
