import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWorkOrderPdfDefinition,
  generateWorkOrderPdf,
} from "./generator";
import {
  parseWorkOrderPdfSnapshot,
  toSafePdfText,
  type WorkOrderPdfSnapshot,
} from "./model";

const workOrderId = "11000000-0000-4000-8000-000000000001";
const firstProductId = "22000000-0000-4000-8000-000000000001";

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    work_order_id: workOrderId,
    work_order_number: "RN-2026-0042",
    project_name: "Project Alpha",
    customer_name_snapshot: "Customer One",
    description: "Install and commission the control cabinet.",
    work_order_created_at: "2026-09-29T22:30:00.123456+00:00",
    snapshot_updated_at: "2026-09-29T22:31:00.654321+00:00",
    allocation_fingerprint: "a".repeat(32),
    material_position: "1",
    product_id: firstProductId,
    catalog_number: "CAT-100",
    product_name: "Control relay",
    quantity: "9007199254740993",
    ...overrides,
  };
}

function snapshot(materialCount = 2): WorkOrderPdfSnapshot {
  return parseWorkOrderPdfSnapshot(Array.from(
    { length: materialCount },
    (_, index) => rawRow({
      material_position: String(index + 1),
      product_id: `22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      catalog_number: index === 1 ? "MOU-4421" : "CAT-100",
      product_name: `Industrial component ${index + 1}`,
      quantity: index === 0 ? "9007199254740993" : String(index + 1),
    }),
  ));
}

function contentNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(contentNodes);
  if (typeof value !== "object" || value === null) return [];
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(contentNodes)];
}

function materialTable(definition: ReturnType<typeof buildWorkOrderPdfDefinition>) {
  const node = contentNodes(definition.content).find((candidate) => {
    const table = candidate.table;
    if (typeof table !== "object" || table === null) return false;
    const body = (table as Record<string, unknown>).body;
    return JSON.stringify(body).includes("R.BROJ") &&
      JSON.stringify(body).includes("UKUPNA CIJENA");
  });
  if (!node) throw new Error("Material table was not found");
  return node.table as {
    body: Array<Array<{ text?: string }>>;
    headerRows?: number;
  };
}

describe("trusted Work Order PDF snapshot model", () => {
  it("maps deterministic trusted rows and preserves exact bigint quantities", () => {
    const parsed = snapshot();
    expect(parsed).toMatchObject({
      workOrderId,
      workOrderNumber: "RN-2026-0042",
      projectName: "Project Alpha",
      customerName: "Customer One",
      workOrderCreatedAt: "2026-09-29T22:30:00.123456+00:00",
      snapshotUpdatedAt: "2026-09-29T22:31:00.654321+00:00",
      allocationFingerprint: "a".repeat(32),
    });
    expect(parsed.materials[0]).toEqual({
      position: "1",
      productId: firstProductId,
      productName: "Industrial component 1",
      quantity: "9007199254740993",
      catalogNumber: "CAT-100",
    });
  });

  it("keeps markup characters literal and removes only unsafe controls", () => {
    const unsafe = '<script>alert("x")</script> & (A)\\B\r\nnext\u0000line';
    expect(toSafePdfText(unsafe)).toBe(
      '<script>alert("x")</script> & (A)\\B\nnextline',
    );
    expect(parseWorkOrderPdfSnapshot([
      rawRow({ description: unsafe }),
    ]).description).toBe(
      '<script>alert("x")</script> & (A)\\B\nnextline',
    );
  });

  it("fails safely for empty, malformed, inconsistent, or unsafe numeric rows while allowing split-source Products", () => {
    expect(() => parseWorkOrderPdfSnapshot([])).toThrow(
      "The Work Order PDF snapshot is unavailable.",
    );
    expect(() => parseWorkOrderPdfSnapshot([rawRow({ quantity: 1 })])).toThrow();
    expect(() => parseWorkOrderPdfSnapshot([rawRow({ quantity: "0" })])).toThrow();
    expect(() => parseWorkOrderPdfSnapshot([
      rawRow({ quantity: "9223372036854775808" }),
    ])).toThrow();
    expect(() => parseWorkOrderPdfSnapshot([
      rawRow(),
      rawRow({ material_position: "2", project_name: "Different" }),
    ])).toThrow();
    const split = parseWorkOrderPdfSnapshot([
      rawRow(),
      rawRow({ material_position: "2", catalog_number: "MOU-4421", quantity: "10" }),
    ]).materials;
    expect(split).toHaveLength(2);
    expect(split.map((material) => [material.productId, material.catalogNumber, material.quantity]))
      .toEqual([
        [firstProductId, "CAT-100", "9007199254740993"],
        [firstProductId, "MOU-4421", "10"],
      ]);
    expect(parseWorkOrderPdfSnapshot([
      rawRow({ catalog_number: "—" }),
    ]).materials[0]?.catalogNumber).toBe("—");
  });

  it("maps General Stock empty-BOM PCB production with exact planned and actual quantities", () => {
    const parsed = parseWorkOrderPdfSnapshot([rawRow({
      project_name: null,
      customer_name_snapshot: null,
      material_position: null,
      product_id: null,
      catalog_number: null,
      product_name: null,
      quantity: null,
      production_pcb_card_id: "33000000-0000-4000-8000-000000000001",
      production_pcb_card_name: "Controller",
      production_bom_version_number: "2",
      production_planned_quantity: "9223372036854775807",
      production_actual_good_quantity: "0",
      production_output_product_id: "44000000-0000-4000-8000-000000000001",
      production_output_serial_number: "0000999",
      production_output_product_name: "Controller",
    })]);
    expect(parsed.projectName).toBe("General Stock");
    expect(parsed.customerName).toBe("");
    expect(parsed.materials).toEqual([]);
    expect(parsed.pcbProduction).toMatchObject({
      plannedQuantity: "9223372036854775807",
      actualGoodQuantity: "0",
    });
    const serialized = JSON.stringify(buildWorkOrderPdfDefinition(parsed).content);
    expect(serialized).toContain("Actual completed");
    expect(serialized).toContain("Finished Product");
    expect(serialized).not.toContain("PCB Card");
  });
});

describe("deterministic Alfa Proteh Radni Nalog renderer", () => {
  it("maps the canonical layout, rows, exact quantities, and intentionally blank fields", () => {
    const source = snapshot();
    const definition = buildWorkOrderPdfDefinition(source);
    const serialized = JSON.stringify(definition.content);
    const table = materialTable(definition);

    expect(definition).toMatchObject({
      pageOrientation: "portrait",
      pageSize: "A4",
    });
    expect(serialized).toContain("ALFA");
    expect(serialized).toContain("PROTEH");
    expect(serialized).toContain("RADNI NALOG");
    expect(serialized).toContain("PROJEKAT");
    expect(serialized).toContain("NARUČILAC");
    expect(serialized).toContain("OPIS RADOVA");
    expect(serialized).toContain("IZVJEŠTAJ O IZVRŠENIM RADOVIMA");
    expect(serialized).toContain("UTROŠAK MATERIJALA");
    expect(serialized).toContain("Datum završetka radova");
    expect(serialized).toContain("M.P.");
    expect(serialized).toContain("30.09.2026.");
    expect(table.headerRows).toBe(1);
    expect(table.body).toHaveLength(3);
    expect(table.body[1]?.map((cell) => cell.text)).toEqual([
      "1",
      "CAT-100",
      "Industrial component 1",
      "",
      "9007199254740993",
      "",
      "",
    ]);
  });

  it("generates identical printable PDF bytes for the same trusted snapshot", async () => {
    const source = snapshot(5);
    const first = await generateWorkOrderPdf(source);
    const second = await generateWorkOrderPdf(source);
    expect(new TextDecoder().decode(first.slice(0, 8))).toMatch(/^%PDF-1\./);
    expect(first).toEqual(second);
    expect(first.byteLength).toBeGreaterThan(10_000);
  });

  it("paginates a large materials table while retaining repeatable table headers", async () => {
    const source = snapshot(120);
    const definition = buildWorkOrderPdfDefinition(source);
    expect(materialTable(definition).headerRows).toBe(1);
    const bytes = await generateWorkOrderPdf(source);
    const pdfText = new TextDecoder("latin1").decode(bytes);
    expect(pdfText.match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("contains no browser, Storage, or final-path publication behavior", () => {
    const generatorSource = readFileSync(
      resolve(
        process.cwd(),
        "supabase/functions/_shared/work-order-pdf/generator.ts",
      ),
      "utf8",
    );
    expect(generatorSource).not.toMatch(/createClient|supabase\.storage|window\.|document\.|_tmp\/|final\//);
  });
});
