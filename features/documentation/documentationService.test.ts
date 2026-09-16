import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), order: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({
  supabase: { from: () => ({ select: mocks.select }), rpc: mocks.rpc },
}));

import {
  archiveDocumentationRecord, createDocumentationRecord, listDocumentationRecords,
  normalizeAmount, updateDocumentationRecord,
} from "./documentationService";

const id = "00000000-0000-0000-0000-000000000001";
const row = { id, name: "Invoice", category: "uvoz", document_date: "2026-09-16",
  amount: "12345678901234567890.123456789", pdf_storage_path: null, is_active: true,
  created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z", archived_at: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ order: () => ({ order: mocks.order }) });
  mocks.order.mockResolvedValue({ data: [row], error: null });
});

describe("Documentation decimal/service boundary", () => {
  it("normalizes exact decimal text without floating-point conversion", () => {
    expect(normalizeAmount(" 00012345678901234567890.12345678900 ")).toBe("12345678901234567890.123456789");
    expect(normalizeAmount("0")).toBe("0");
    expect(normalizeAmount(".50")).toBe("0.5");
    for (const invalid of ["-1", "1e3", "NaN", "1,23", "", "  "]) expect(normalizeAmount(invalid)).toBeNull();
  });

  it("reads numeric via PostgREST text cast and maps approved fields", async () => {
    expect(await listDocumentationRecords()).toEqual({ ok: true, value: [{
      id, name: "Invoice", category: "uvoz", documentDate: "2026-09-16",
      amount: row.amount, pdfStoragePath: null, isActive: true,
      createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: null,
    }] });
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining("amount::text"));
  });

  it("fails safely on malformed amount or provider error", async () => {
    mocks.order.mockResolvedValueOnce({ data: [{ ...row, amount: 12.5 }], error: null });
    expect((await listDocumentationRecords()).ok).toBe(false);
    mocks.order.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret SQL" } });
    expect(await listDocumentationRecords()).toEqual({ ok: false, error: "Unable to load the document. Please try again." });
  });

  it("sends exact amount text and only approved RPC inputs", async () => {
    mocks.rpc.mockResolvedValue({ data: id, error: null });
    const input = { name: " Invoice ", category: "uvoz" as const, documentDate: "2026-09-16", amount: "000000000123.4500" };
    await createDocumentationRecord(input);
    expect(mocks.rpc).toHaveBeenCalledWith("create_documentation_record", {
      p_name: "Invoice", p_category: "uvoz", p_document_date: "2026-09-16", p_amount: "123.45",
    });
    await updateDocumentationRecord(id, input);
    expect(mocks.rpc).toHaveBeenCalledWith("update_documentation_record", expect.objectContaining({ p_record_id: id, p_amount: "123.45" }));
    await archiveDocumentationRecord(id);
    expect(mocks.rpc).toHaveBeenCalledWith("archive_documentation_record", { p_record_id: id });
  });
});
