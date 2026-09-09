import { beforeEach, describe, expect, it, vi } from "vitest";

const supplierServiceMocks = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    from: supplierServiceMocks.from,
    rpc: supplierServiceMocks.rpc,
  },
}));

import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "./supplierService";

beforeEach(() => {
  vi.resetAllMocks();
  supplierServiceMocks.from.mockReturnValue({
    select: supplierServiceMocks.select,
  });
});

describe("supplierService", () => {
  it("strictly maps Supplier rows and deterministically orders active before archived", async () => {
    supplierServiceMocks.select.mockResolvedValue({
      data: [
        {
          id: "supplier-4",
          name: "Zeta",
          country: "Germany",
          contact_person_name: null,
          contact_phone: null,
          contact_email: null,
          is_active: false,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z",
          archived_at: "2026-09-02T00:00:00.000Z",
        },
        {
          id: "supplier-2",
          name: "bosch",
          country: "Germany",
          contact_person_name: "Mira Marić",
          contact_phone: "+387 61 111 222",
          contact_email: "mira@bosch.example",
          is_active: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          archived_at: null,
        },
        {
          id: "supplier-1",
          name: "ABB",
          country: "Switzerland",
          contact_person_name: null,
          contact_phone: null,
          contact_email: null,
          is_active: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          archived_at: null,
        },
        {
          id: "supplier-3",
          name: "Alpha Archived",
          country: "Austria",
          contact_person_name: null,
          contact_phone: null,
          contact_email: null,
          is_active: false,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z",
          archived_at: "2026-09-02T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await listSuppliers();

    expect(supplierServiceMocks.from).toHaveBeenCalledWith("suppliers");
    expect(supplierServiceMocks.select).toHaveBeenCalledWith(
      "id,name,country,contact_person_name,contact_phone,contact_email,is_active,created_at,updated_at,archived_at",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: "supplier-1", name: "ABB", isActive: true }),
        expect.objectContaining({
          id: "supplier-2",
          name: "bosch",
          contactPersonName: "Mira Marić",
          contactPhone: "+387 61 111 222",
          contactEmail: "mira@bosch.example",
          isActive: true,
        }),
        expect.objectContaining({ id: "supplier-3", name: "Alpha Archived", isActive: false }),
        expect.objectContaining({ id: "supplier-4", name: "Zeta", isActive: false }),
      ],
    });
  });

  it("fails safely for malformed or failed list responses", async () => {
    supplierServiceMocks.select.mockResolvedValue({
      data: [{ id: "supplier-1", name: "Incomplete" }],
      error: null,
    });

    await expect(listSuppliers()).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_list_failed",
        message: "The Supplier list could not be loaded.",
      },
    });

    supplierServiceMocks.select.mockResolvedValue({
      data: null,
      error: { message: "raw database details" },
    });
    await expect(listSuppliers()).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_list_failed",
        message: "The Supplier list could not be loaded.",
      },
    });
  });

  it("reads and maps one Supplier detail through the RLS-protected table", async () => {
    supplierServiceMocks.select.mockReturnValue({ eq: supplierServiceMocks.eq });
    supplierServiceMocks.eq.mockReturnValue({
      maybeSingle: supplierServiceMocks.maybeSingle,
    });
    supplierServiceMocks.maybeSingle.mockResolvedValue({
      data: {
        id: "supplier-1",
        name: "Bosch",
        country: "Germany",
        contact_person_name: "Mira Marić",
        contact_phone: "+387 61 111 222",
        contact_email: "mira@bosch.example",
        is_active: true,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z",
        archived_at: null,
      },
      error: null,
    });

    await expect(getSupplier("supplier-1")).resolves.toEqual({
      ok: true,
      value: {
        id: "supplier-1",
        name: "Bosch",
        country: "Germany",
        contactPersonName: "Mira Marić",
        contactPhone: "+387 61 111 222",
        contactEmail: "mira@bosch.example",
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
        archivedAt: null,
      },
    });
    expect(supplierServiceMocks.eq).toHaveBeenCalledWith("id", "supplier-1");
    expect(supplierServiceMocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("distinguishes missing Supplier details from safe read failures", async () => {
    supplierServiceMocks.select.mockReturnValue({ eq: supplierServiceMocks.eq });
    supplierServiceMocks.eq.mockReturnValue({
      maybeSingle: supplierServiceMocks.maybeSingle,
    });
    supplierServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await expect(getSupplier("missing")).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_not_found",
        message: "The Supplier could not be found.",
      },
    });

    supplierServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "raw provider details" },
    });
    await expect(getSupplier("supplier-1")).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_detail_failed",
        message: "The Supplier details could not be loaded.",
      },
    });

    supplierServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: { id: "supplier-1", name: "Malformed" },
      error: null,
    });
    await expect(getSupplier("supplier-1")).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_detail_failed",
        message: "The Supplier details could not be loaded.",
      },
    });
  });

  it("calls only the trusted create RPC with normalized named inputs", async () => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: "supplier-created",
      error: null,
    });

    await expect(
      createSupplier({
        name: "  Bosch  ",
        country: "  Germany ",
        contactPersonName: "  Mira Marić  ",
        contactPhone: "  +387 61 111 222 ",
        contactEmail: "  CONTACT@BOSCH.EXAMPLE ",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { supplierId: "supplier-created" },
    });

    expect(supplierServiceMocks.rpc).toHaveBeenCalledWith("create_supplier", {
      p_name: "Bosch",
      p_country: "Germany",
      p_contact_person_name: "Mira Marić",
      p_contact_phone: "+387 61 111 222",
      p_contact_email: "contact@bosch.example",
    });
    expect(supplierServiceMocks.from).not.toHaveBeenCalled();
  });

  it("normalizes optional blank create inputs to null", async () => {
    supplierServiceMocks.rpc.mockResolvedValue({ data: "supplier-created", error: null });

    await createSupplier({
      name: "ABB",
      country: "Switzerland",
      contactPersonName: "   ",
      contactPhone: null,
      contactEmail: "",
    });

    expect(supplierServiceMocks.rpc).toHaveBeenCalledWith("create_supplier", {
      p_name: "ABB",
      p_country: "Switzerland",
      p_contact_person_name: null,
      p_contact_phone: null,
      p_contact_email: null,
    });
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to create Suppliers."],
    ["SUP02", "supplier_duplicate", "A Supplier with this name already exists."],
    ["SUP03", "supplier_email_invalid", "Enter a valid Supplier email address."],
    ["22023", "supplier_invalid", "Enter valid required Supplier details."],
    ["XX000", "supplier_create_failed", "The Supplier could not be created. Please try again."],
  ])("maps %s create failures without exposing raw backend details", async (backendCode, code, message) => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw SQL details" },
    });

    await expect(
      createSupplier({
        name: "Bosch",
        country: "Germany",
        contactPersonName: null,
        contactPhone: null,
        contactEmail: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("updates only through the trusted RPC with normalized named inputs", async () => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: "supplier-1",
      error: null,
    });

    await expect(updateSupplier("supplier-1", {
      name: "  Bosch Rexroth  ",
      country: "  Germany  ",
      contactPersonName: "  Mira Marić ",
      contactPhone: "   ",
      contactEmail: "  MIRA@BOSCH.EXAMPLE  ",
    })).resolves.toEqual({
      ok: true,
      value: { supplierId: "supplier-1" },
    });

    expect(supplierServiceMocks.rpc).toHaveBeenCalledWith("update_supplier", {
      p_supplier_id: "supplier-1",
      p_name: "Bosch Rexroth",
      p_country: "Germany",
      p_contact_person_name: "Mira Marić",
      p_contact_phone: null,
      p_contact_email: "mira@bosch.example",
    });
    expect(supplierServiceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to update Suppliers."],
    ["SUP01", "supplier_archived", "Archived Suppliers cannot be edited."],
    ["SUP02", "supplier_duplicate", "A Supplier with this name already exists."],
    ["SUP03", "supplier_email_invalid", "Enter a valid Supplier email address."],
    ["22023", "supplier_invalid", "Enter valid required Supplier details."],
    ["P0002", "supplier_not_found", "The Supplier could not be found."],
    ["XX000", "supplier_update_failed", "The Supplier could not be updated. Please try again."],
  ])("maps %s update failures without exposing raw backend details", async (backendCode, code, message) => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw SQL details" },
    });

    await expect(updateSupplier("supplier-1", {
      name: "Bosch",
      country: "Germany",
      contactPersonName: null,
      contactPhone: null,
      contactEmail: null,
    })).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("archives only through the trusted archive_supplier RPC", async () => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: "supplier-1",
      error: null,
    });

    await expect(archiveSupplier("supplier-1")).resolves.toEqual({
      ok: true,
      value: { supplierId: "supplier-1" },
    });
    expect(supplierServiceMocks.rpc).toHaveBeenCalledWith("archive_supplier", {
      p_supplier_id: "supplier-1",
    });
    expect(supplierServiceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to archive Suppliers."],
    ["SUP01", "supplier_archived", "This Supplier is already archived and cannot be archived again."],
    ["P0002", "supplier_not_found", "The Supplier could not be found."],
    ["XX000", "supplier_archive_failed", "The Supplier could not be archived. Please try again."],
  ])("maps %s archive failures without exposing raw backend details", async (backendCode, code, message) => {
    supplierServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw SQL details" },
    });

    await expect(archiveSupplier("supplier-1")).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });
});
