import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { functions: { invoke: serviceMocks.invoke } },
}));

import { getWorkOrderPdfAccess } from "./workOrderPdfAccessService";

const workOrderId = "11000000-0000-4000-8000-000000000001";
const signedUrl =
  "https://example.supabase.co/storage/v1/object/sign/work-order-pdfs/final/id/object.pdf?token=signed-token";

function edgeError(code: string, rawMessage = "sensitive provider details") {
  return {
    context: new Response(JSON.stringify({ code, message: rawMessage }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  };
}

beforeEach(() => vi.resetAllMocks());

describe("workOrderPdfAccessService", () => {
  it("sends only the Work Order ID and strictly maps the short-lived URL", async () => {
    serviceMocks.invoke.mockResolvedValue({
      data: { signedUrl, expiresIn: 300 },
      error: null,
    });

    await expect(getWorkOrderPdfAccess(workOrderId)).resolves.toEqual({
      ok: true,
      value: { signedUrl, expiresIn: 300 },
    });
    expect(serviceMocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "work-order-pdf-access",
      { body: { workOrderId } },
    );
  });

  it.each([
    [{ signedUrl, expiresIn: 301 }],
    [{ signedUrl: "http://example.test/file.pdf?token=x", expiresIn: 300 }],
    [{ signedUrl: "javascript:alert(1)", expiresIn: 300 }],
    [{ signedUrl, expiresIn: 300, storageReference: "hidden" }],
    [{ signedUrl: signedUrl.replace("?token=", "?key="), expiresIn: 300 }],
  ])("rejects malformed or broadened success payload %#", async (data) => {
    serviceMocks.invoke.mockResolvedValue({ data, error: null });
    await expect(getWorkOrderPdfAccess(workOrderId)).resolves.toEqual({
      ok: false,
      error: {
        code: "pdf_access_failed",
        message: "The official Work Order PDF could not be opened. Please try again.",
      },
    });
  });

  it.each([
    ["unauthenticated", "access_denied"],
    ["access_denied", "access_denied"],
    ["work_order_not_found", "work_order_not_found"],
    ["work_order_not_finished", "work_order_not_finished"],
    ["pdf_not_found", "pdf_not_found"],
    ["invalid_request", "invalid_request"],
    ["provider_failure", "pdf_access_failed"],
  ])("maps %s safely without exposing raw errors", async (code, expectedCode) => {
    serviceMocks.invoke.mockResolvedValue({ data: null, error: edgeError(code) });
    const result = await getWorkOrderPdfAccess(workOrderId);
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(JSON.stringify(result)).not.toContain("sensitive provider details");
  });

  it("rejects invalid IDs without invoking the Edge Function", async () => {
    await expect(getWorkOrderPdfAccess("not-a-uuid")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(serviceMocks.invoke).not.toHaveBeenCalled();
  });

  it("contains no client Storage access, persistent URL cache, or raw object path handling", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "features/work-orders/services/workOrderPdfAccessService.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/\.storage\b|createSignedUrl|getPublicUrl/);
    expect(source).not.toMatch(/localStorage|sessionStorage|storageReference/);
    expect(source).toContain('"work-order-pdf-access"');
  });
});
