import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  handleFinishWorkOrderRequest,
  sha256Hex,
  type FinishWorkOrderActorClient,
  type FinishWorkOrderDependencies,
  type FinishWorkOrderStorageBucket,
} from "./handler";

const workOrderId = "11000000-0000-4000-8000-000000000001";
const projectId = "22000000-0000-4000-8000-000000000001";
const productId = "33000000-0000-4000-8000-000000000001";
const pdfId = "44000000-0000-4000-8000-000000000001";
const temporaryId = "55000000-0000-4000-8000-000000000001";
const finalId = "66000000-0000-4000-8000-000000000001";
const expectedUpdatedAt = "2026-09-30T10:11:12.123456+00:00";
const finishedAt = "2026-09-30T10:12:13.654321+00:00";
const expectedHash = "a".repeat(64);
const pdfBytes = new TextEncoder().encode("%PDF-1.7 trusted bytes");

function snapshotRows() {
  return [{
    work_order_id: workOrderId,
    work_order_number: "RN-2026-0042",
    project_name: "Project Alpha",
    customer_name_snapshot: "Customer One",
    description: "Install the control cabinet.",
    work_order_created_at: "2026-09-29T22:30:00.123456+00:00",
    snapshot_updated_at: expectedUpdatedAt,
    material_position: "1",
    product_id: productId,
    serial_number: "0000123",
    product_name: "Control relay",
    quantity: "9007199254740993",
  }];
}

function finishRows() {
  return [{
    work_order_id: workOrderId,
    work_order_number: "RN-2026-0042",
    finished_at: finishedAt,
    project_id: projectId,
    project_completed: true,
    work_order_pdf_id: pdfId,
  }];
}

function request(
  body: unknown = { workOrderId, expectedUpdatedAt },
  authorization = "Bearer actor-jwt",
) {
  return new Request("http://localhost/functions/v1/finish-work-order", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

interface HarnessOptions {
  authenticated?: boolean;
  cleanupErrors?: boolean;
  finalUploadError?: boolean;
  finishErrorCode?: string;
  finishThrows?: boolean;
  generatorError?: boolean;
  snapshotErrorCode?: string;
}

function harness(options: HarnessOptions = {}) {
  const rpcCalls: Array<{
    name: string;
    parameters: Record<string, unknown>;
  }> = [];
  const uploads: Array<{
    bytes: Uint8Array;
    options: unknown;
    path: string;
  }> = [];
  const removals: string[][] = [];
  let storageClientCreations = 0;
  const render = vi.fn(async () => {
    if (options.generatorError) throw new Error("renderer details");
    return pdfBytes;
  });
  const hash = vi.fn(async () => expectedHash);
  const actor: FinishWorkOrderActorClient = {
    auth: {
      getUser: vi.fn(async () => options.authenticated === false
        ? { data: { user: null }, error: { code: "bad_jwt" } }
        : { data: { user: { id: "auth-user" } }, error: null }),
    },
    rpc: vi.fn(async (name, parameters) => {
      rpcCalls.push({ name, parameters });
      if (name === "get_work_order_pdf_snapshot") {
        return options.snapshotErrorCode
          ? { data: null, error: { code: options.snapshotErrorCode } }
          : { data: snapshotRows(), error: null };
      }
      if (name === "finish_work_order") {
        if (options.finishThrows) throw new Error("network details");
        return options.finishErrorCode
          ? { data: null, error: { code: options.finishErrorCode } }
          : { data: finishRows(), error: null };
      }
      throw new Error("Unexpected actor RPC");
    }),
  };
  const storage: FinishWorkOrderStorageBucket = {
    upload: vi.fn(async (path, bytes, uploadOptions) => {
      uploads.push({ path, bytes, options: uploadOptions });
      return {
        error: options.finalUploadError && path.startsWith("final/")
          ? { code: "storage_failed" }
          : null,
      };
    }),
    remove: vi.fn(async (paths) => {
      removals.push(paths);
      return { error: options.cleanupErrors ? { code: "cleanup_failed" } : null };
    }),
  };
  const uuidValues = [temporaryId, finalId];
  const dependencies: FinishWorkOrderDependencies = {
    createActorClient: vi.fn(() => actor),
    createStorageClient: vi.fn(() => {
      storageClientCreations += 1;
      return { storage: { from: vi.fn(() => storage) } };
    }),
    generatePdf: render,
    randomUuid: vi.fn(() => uuidValues.shift() ?? finalId),
    sha256: hash,
  };
  return {
    actor,
    dependencies,
    hash,
    removals,
    render,
    rpcCalls,
    storage,
    storageClientCreations: () => storageClientCreations,
    uploads,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("Task 122 safe Work Order finalization Edge orchestrator", () => {
  it("rejects missing or invalid authentication before any Storage operation", async () => {
    const missing = harness();
    const missingResponse = await handleFinishWorkOrderRequest(
      request(undefined, ""),
      missing.dependencies,
    );
    expect(missingResponse.status).toBe(401);
    expect(missing.storageClientCreations()).toBe(0);

    const invalid = harness({ authenticated: false });
    const invalidResponse = await handleFinishWorkOrderRequest(
      request(),
      invalid.dependencies,
    );
    expect(invalidResponse.status).toBe(401);
    expect(invalid.storageClientCreations()).toBe(0);
    expect(invalid.rpcCalls).toHaveLength(0);
  });

  it("strictly rejects malformed or client-expanded request bodies", async () => {
    for (const body of [
      null,
      {},
      { workOrderId: "bad", expectedUpdatedAt },
      { workOrderId, expectedUpdatedAt: "yesterday" },
      { workOrderId, expectedUpdatedAt, pdfBytes: "client data" },
    ]) {
      const testHarness = harness();
      const response = await handleFinishWorkOrderRequest(
        request(body),
        testHarness.dependencies,
      );
      expect(response.status).toBe(400);
      expect((await json(response)).code).toBe("invalid_request");
      expect(testHarness.rpcCalls).toHaveLength(0);
      expect(testHarness.storageClientCreations()).toBe(0);
    }
  });

  it("maps snapshot failure safely and creates no Storage objects", async () => {
    const testHarness = harness({ snapshotErrorCode: "WOR07" });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({
      code: "work_order_incomplete",
      message: "Complete the Work Order before finishing it.",
    });
    expect(testHarness.uploads).toHaveLength(0);
    expect(testHarness.storageClientCreations()).toBe(0);
  });

  it("feeds only the parsed trusted snapshot to the canonical renderer", async () => {
    const testHarness = harness();
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(200);
    expect(testHarness.render).toHaveBeenCalledOnce();
    expect(testHarness.render).toHaveBeenCalledWith(expect.objectContaining({
      workOrderId,
      workOrderNumber: "RN-2026-0042",
      materials: [expect.objectContaining({
        productId,
        quantity: "9007199254740993",
      })],
    }));
  });

  it("hashes the exact generated bytes and passes lowercase SHA-256 to Finish", async () => {
    const testHarness = harness();
    await handleFinishWorkOrderRequest(request(), testHarness.dependencies);
    expect(testHarness.hash).toHaveBeenCalledWith(pdfBytes);
    expect(testHarness.rpcCalls[1]).toEqual({
      name: "finish_work_order",
      parameters: expect.objectContaining({ p_pdf_content_hash: expectedHash }),
    });
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("uses server UUID paths, exact bytes, application/pdf, and no overwrite", async () => {
    const testHarness = harness();
    await handleFinishWorkOrderRequest(request(), testHarness.dependencies);
    expect(testHarness.uploads).toEqual([
      {
        path: `_tmp/${workOrderId}/${temporaryId}.pdf`,
        bytes: pdfBytes,
        options: {
          cacheControl: "0",
          contentType: "application/pdf",
          upsert: false,
        },
      },
      {
        path: `final/${workOrderId}/${finalId}.pdf`,
        bytes: pdfBytes,
        options: {
          cacheControl: "0",
          contentType: "application/pdf",
          upsert: false,
        },
      },
    ]);
  });

  it("uses the same actor client for snapshot and Finish, never service authority", async () => {
    const testHarness = harness();
    await handleFinishWorkOrderRequest(request(), testHarness.dependencies);
    expect(testHarness.rpcCalls.map((call) => call.name)).toEqual([
      "get_work_order_pdf_snapshot",
      "finish_work_order",
    ]);
    expect(testHarness.actor.rpc).toHaveBeenCalledTimes(2);
    expect(testHarness.storageClientCreations()).toBe(1);
  });

  it("on success removes only temp, keeps final, and returns a narrow result", async () => {
    const testHarness = harness();
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(200);
    expect(testHarness.removals).toEqual([
      [`_tmp/${workOrderId}/${temporaryId}.pdf`],
    ]);
    expect(await json(response)).toEqual({
      workOrderId,
      workOrderNumber: "RN-2026-0042",
      finishedAt,
      projectId,
      projectCompleted: true,
      workOrderPdfId: pdfId,
      storageReference: `final/${workOrderId}/${finalId}.pdf`,
    });
  });

  it("passes the original timestamp once and cleans both objects after WOR05", async () => {
    const testHarness = harness({ finishErrorCode: "WOR05" });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(409);
    expect((await json(response)).code).toBe("stale_work_order");
    expect(testHarness.rpcCalls.filter((call) => call.name === "finish_work_order"))
      .toEqual([{
        name: "finish_work_order",
        parameters: {
          p_work_order_id: workOrderId,
          p_expected_updated_at: expectedUpdatedAt,
          p_pdf_storage_reference: `final/${workOrderId}/${finalId}.pdf`,
          p_pdf_content_hash: expectedHash,
        },
      }]);
    expect(testHarness.removals).toEqual([
      [`final/${workOrderId}/${finalId}.pdf`],
      [`_tmp/${workOrderId}/${temporaryId}.pdf`],
    ]);
  });

  it.each([
    ["42501", 403, "access_denied"],
    ["WOR02", 409, "work_order_already_finished"],
    ["WOR06", 409, "project_requirement_exceeded"],
    ["WOR07", 422, "work_order_incomplete"],
    ["WOR08", 409, "project_unavailable"],
    ["PRD05", 409, "product_unavailable"],
    ["IVB01", 409, "inventory_balance_unavailable"],
    ["IVB02", 409, "insufficient_inventory"],
    ["22023", 409, "pdf_candidate_invalid"],
  ])("safely maps Finish domain error %s and cleans both objects", async (
    errorCode,
    status,
    safeCode,
  ) => {
    const testHarness = harness({ finishErrorCode: errorCode });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(status);
    expect((await json(response)).code).toBe(safeCode);
    expect(testHarness.removals).toHaveLength(2);
  });

  it("cleans temp and never calls Finish when final preparation fails", async () => {
    const testHarness = harness({ finalUploadError: true });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(503);
    expect((await json(response)).code).toBe("storage_preparation_failed");
    expect(testHarness.removals).toEqual([
      [`_tmp/${workOrderId}/${temporaryId}.pdf`],
    ]);
    expect(testHarness.rpcCalls.map((call) => call.name)).toEqual([
      "get_work_order_pdf_snapshot",
    ]);
  });

  it("never converts a business failure into success when cleanup also fails", async () => {
    const testHarness = harness({
      cleanupErrors: true,
      finishErrorCode: "WOR06",
    });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({
      code: "project_requirement_exceeded",
      message:
        "These materials exceed the remaining requirement for the selected Project. Reduce the quantities or review the Project plan.",
    });
    expect(testHarness.removals).toHaveLength(2);
  });

  it("keeps the final candidate when a transport failure makes commit outcome unknown", async () => {
    const testHarness = harness({ finishThrows: true });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(503);
    expect((await json(response)).code).toBe("finish_outcome_unknown");
    expect(testHarness.removals).toEqual([
      [`_tmp/${workOrderId}/${temporaryId}.pdf`],
    ]);
  });

  it("performs no Storage or Finish operation when PDF generation fails", async () => {
    const testHarness = harness({ generatorError: true });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(response.status).toBe(500);
    expect((await json(response)).code).toBe("pdf_generation_failed");
    expect(testHarness.storageClientCreations()).toBe(0);
    expect(testHarness.rpcCalls.map((call) => call.name)).toEqual([
      "get_work_order_pdf_snapshot",
    ]);
  });

  it("never exposes a service secret or implements domain mutations in Edge code", async () => {
    const testHarness = harness({ finishErrorCode: "provider_internal" });
    const response = await handleFinishWorkOrderRequest(
      request(),
      testHarness.dependencies,
    );
    expect(JSON.stringify(await json(response))).not.toContain("service-secret");

    const handlerSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/finish-work-order/handler.ts"),
      "utf8",
    );
    expect(handlerSource).not.toMatch(
      /from\(["'](?:inventory_balances|inventory_movements|projects|work_orders)["']\)/,
    );
    expect(handlerSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(handlerSource).not.toMatch(/signedUrl|createSignedUrl|publicUrl/);

    const edgeSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/finish-work-order/index.ts"),
      "utf8",
    );
    const configSource = readFileSync(
      resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );
    expect(edgeSource).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edgeSource).not.toMatch(/console\.(?:log|error|warn)/);
    expect(configSource).toContain(
      "[functions.finish-work-order]\nenabled = true\nverify_jwt = true",
    );
  });
});
