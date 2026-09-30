import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleWorkOrderPdfAccessRequest,
  type WorkOrderPdfAccessActorClient,
  type WorkOrderPdfAccessDependencies,
} from "./handler";

const workOrderId = "11000000-0000-4000-8000-000000000001";
const otherWorkOrderId = "11000000-0000-4000-8000-000000000002";
const pdfId = "22000000-0000-4000-8000-000000000001";
const objectId = "33000000-0000-4000-8000-000000000001";
const storageReference = `final/${workOrderId}/${objectId}.pdf`;
const signedUrl =
  `https://example.supabase.co/storage/v1/object/sign/work-order-pdfs/${storageReference}?token=signed-token`;

function detailRows() {
  return [{
    work_order_id: workOrderId,
    work_order_number: "RN-2026-0042",
    project_id: "44000000-0000-4000-8000-000000000001",
    project_name: "Project Alpha",
    customer_name_snapshot: "Customer One",
    description: "Finished work",
    created_at: "2026-09-29T09:00:00.123456+00:00",
    finished_at: "2026-09-30T10:00:00.123456+00:00",
    finished_by_user_id: "55000000-0000-4000-8000-000000000001",
    finished_by_full_name: "Ada Lovelace",
    pdf_id: pdfId,
    document_version: 1,
    generated_at: "2026-09-30T10:00:00.123456+00:00",
  }];
}

function metadataRow() {
  return {
    id: pdfId,
    work_order_id: workOrderId,
    storage_reference: storageReference,
  };
}

function request(
  body: unknown = { workOrderId },
  authorization = "Bearer actor-jwt",
) {
  return new Request("http://localhost/functions/v1/work-order-pdf-access", {
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
  detail?: unknown;
  metadata?: unknown;
  metadataErrorCode?: string;
  readErrorCode?: string;
  signedUrl?: string;
  signingError?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user: options.authenticated === false ? null : { id: "actor-id" },
    },
    error: options.authenticated === false ? { code: "invalid_jwt" } : null,
  }));
  const rpc = vi.fn(async () => ({
    data: options.readErrorCode ? null : options.detail ?? detailRows(),
    error: options.readErrorCode ? { code: options.readErrorCode } : null,
  }));
  const maybeSingle = vi.fn(async () => ({
    data: options.metadataErrorCode
      ? null
      : "metadata" in options
      ? options.metadata
      : metadataRow(),
    error: options.metadataErrorCode ? { code: options.metadataErrorCode } : null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const createSignedUrl = vi.fn(async () => ({
    data: options.signingError
      ? null
      : { signedUrl: options.signedUrl ?? signedUrl },
    error: options.signingError ? { code: "storage_error" } : null,
  }));
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  const createActorClient = vi.fn(() => ({
    auth: { getUser },
    from,
    rpc,
  }) as WorkOrderPdfAccessActorClient);
  const createStorageClient = vi.fn(() => ({
    storage: { from: storageFrom },
  }));
  const dependencies: WorkOrderPdfAccessDependencies = {
    createActorClient,
    createStorageClient,
  };
  return {
    createActorClient,
    createSignedUrl,
    createStorageClient,
    dependencies,
    eq,
    from,
    getUser,
    maybeSingle,
    rpc,
    select,
    storageFrom,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("work-order-pdf-access Edge handler", () => {
  it("denies anonymous requests before creating either client", async () => {
    const setup = harness();
    const response = await handleWorkOrderPdfAccessRequest(
      request(undefined, ""),
      setup.dependencies,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthenticated",
      message: "Authentication is required.",
    });
    expect(setup.createActorClient).not.toHaveBeenCalled();
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it("denies invalid JWTs without creating privileged Storage authority", async () => {
    const setup = harness({ authenticated: false });
    const response = await handleWorkOrderPdfAccessRequest(
      request(),
      setup.dependencies,
    );

    expect(response.status).toBe(401);
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [{}],
    [{ workOrderId: "not-a-uuid" }],
    [{ workOrderId, storageReference }],
    [{ workOrderId, path: storageReference }],
  ])("rejects malformed or client-supplied path input %#", async (body) => {
    const setup = harness();
    const response = await handleWorkOrderPdfAccessRequest(
      request(body),
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(setup.rpc).not.toHaveBeenCalled();
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, "access_denied"],
    ["P0002", 404, "work_order_not_found"],
    ["WOR10", 409, "work_order_not_finished"],
  ])("maps trusted read %s safely", async (code, status, safeCode) => {
    const setup = harness({ readErrorCode: code });
    const response = await handleWorkOrderPdfAccessRequest(
      request(),
      setup.dependencies,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code: safeCode });
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it.each(["inactive user", "finish-only user", "unrelated permission user"])(
    "does not create privileged Storage authority for a denied %s",
    async () => {
      const setup = harness({ readErrorCode: "42501" });
      const response = await handleWorkOrderPdfAccessRequest(
        request(),
        setup.dependencies,
      );
      expect(response.status).toBe(403);
      expect(setup.createStorageClient).not.toHaveBeenCalled();
      expect(setup.createSignedUrl).not.toHaveBeenCalled();
    },
  );

  it("uses the actor client for authorization and exact metadata before signing", async () => {
    const setup = harness();
    const response = await handleWorkOrderPdfAccessRequest(
      request(),
      setup.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      signedUrl,
      expiresIn: 300,
    });
    expect(setup.createActorClient).toHaveBeenCalledExactlyOnceWith("actor-jwt");
    expect(setup.getUser).toHaveBeenCalledExactlyOnceWith("actor-jwt");
    expect(setup.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_finished_work_order_detail",
      { p_work_order_id: workOrderId },
    );
    expect(setup.from).toHaveBeenCalledExactlyOnceWith("work_order_pdfs");
    expect(setup.select).toHaveBeenCalledExactlyOnceWith(
      "id,work_order_id,storage_reference",
    );
    expect(setup.eq).toHaveBeenCalledExactlyOnceWith(
      "work_order_id",
      workOrderId,
    );
    expect(setup.storageFrom).toHaveBeenCalledExactlyOnceWith(
      "work-order-pdfs",
    );
    expect(setup.createSignedUrl).toHaveBeenCalledExactlyOnceWith(
      storageReference,
      300,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["missing PDF identity", [{ ...detailRows()[0], pdf_id: null }]],
    ["wrong detail Work Order", [{
      ...detailRows()[0],
      work_order_id: otherWorkOrderId,
    }]],
  ])("does not sign for %s", async (_label, detail) => {
    const setup = harness({ detail });
    const response = await handleWorkOrderPdfAccessRequest(
      request(),
      setup.dependencies,
    );

    expect(response.status).toBe(404);
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it.each([
    ["unreferenced metadata", null],
    ["another Work Order", {
      ...metadataRow(),
      work_order_id: otherWorkOrderId,
    }],
    ["another PDF identity", {
      ...metadataRow(),
      id: "22000000-0000-4000-8000-000000000002",
    }],
    ["temporary object", {
      ...metadataRow(),
      storage_reference: `_tmp/${workOrderId}/${objectId}.pdf`,
    }],
    ["wrong Work Order namespace", {
      ...metadataRow(),
      storage_reference: `final/${otherWorkOrderId}/${objectId}.pdf`,
    }],
  ])("refuses to sign %s", async (_label, metadata) => {
    const setup = harness({ metadata });
    const response = await handleWorkOrderPdfAccessRequest(
      request(),
      setup.dependencies,
    );

    expect(response.status).toBe(404);
    expect(setup.createStorageClient).not.toHaveBeenCalled();
  });

  it("maps signing failures and malformed signed URLs without leaking provider details", async () => {
    const signingFailure = harness({ signingError: true });
    const failureResponse = await handleWorkOrderPdfAccessRequest(
      request(),
      signingFailure.dependencies,
    );
    expect(failureResponse.status).toBe(500);
    await expect(failureResponse.json()).resolves.toEqual({
      code: "pdf_access_failed",
      message: "The official Work Order PDF could not be opened.",
    });

    const malformed = harness({ signedUrl: "javascript:alert(1)" });
    const malformedResponse = await handleWorkOrderPdfAccessRequest(
      request(),
      malformed.dependencies,
    );
    expect(malformedResponse.status).toBe(500);
  });

  it("contains no Storage write, public URL, secret response, or sensitive logging path", () => {
    const handlerSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/work-order-pdf-access/handler.ts"),
      "utf8",
    );
    const indexSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/work-order-pdf-access/index.ts"),
      "utf8",
    );
    expect(handlerSource).not.toMatch(/\.upload\(|\.remove\(|\.update\(|getPublicUrl/);
    expect(handlerSource).not.toMatch(/console\.|Authorization.*log|signedUrl.*log/);
    expect(indexSource).not.toMatch(/console\.|Response\.json\([^)]*SERVICE_ROLE/is);
    expect(indexSource).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(handlerSource).toContain("createSignedUrl");
  });
});
