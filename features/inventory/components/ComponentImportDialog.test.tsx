import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialogMocks = vi.hoisted(() => ({
  parseWorkbook: vi.fn(),
  createTemplate: vi.fn(),
}));

vi.mock("../import/componentImportWorkbook", () => ({
  parseComponentImportWorkbook: dialogMocks.parseWorkbook,
}));
vi.mock("../import/componentImportTemplate", () => ({
  createComponentImportTemplate: dialogMocks.createTemplate,
}));

import type { ComponentImportPreview } from "../import/componentImportTypes";
import type { Brand } from "../services/brandService";
import type { ComponentImportResult } from "../services/componentImportService";
import ComponentImportDialog from "./ComponentImportDialog";

const brands: Brand[] = [
  {
    id: "brand-1", name: "Omron", isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null,
  },
  {
    id: "brand-2", name: "Archived Bosch", isActive: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    archivedAt: "2026-01-02T00:00:00.000Z",
  },
];

const validPreview: ComponentImportPreview = {
  rows: [
    { rowNumber: 2, name: "Resistor", category: "Passive", brand: null, status: "ready", errors: [] },
    { rowNumber: 1501, name: "Relay", category: "Control", brand: "Omron", status: "ready", errors: [] },
  ],
  totalRows: 2,
  readyRows: 2,
  invalidRows: 0,
  canImport: true,
  submissionRows: [
    { name: "Resistor", category: "Passive", brand: null },
    { name: "Relay", category: "Control", brand: "Omron" },
  ],
};

const invalidPreview: ComponentImportPreview = {
  rows: [{
    rowNumber: 9,
    name: "Relay",
    category: "Control",
    brand: "Archived Bosch",
    status: "invalid",
    errors: [{
      code: "brand_archived",
      field: "brand",
      message: "Brand is archived and cannot be selected.",
    }],
  }],
  totalRows: 1,
  readyRows: 0,
  invalidRows: 1,
  canImport: false,
  submissionRows: null,
};

function file(name = "components.xlsx") {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function renderDialog(options: {
  open?: boolean;
  isBrandsLoading?: boolean;
  brandLoadError?: string | null;
  onSubmit?: (rows: typeof validPreview.submissionRows) => Promise<ComponentImportResult>;
} = {}) {
  const onClose = vi.fn();
  const onRetryBrands = vi.fn();
  const onSucceeded = vi.fn();
  const onSubmit = options.onSubmit ?? vi.fn().mockResolvedValue({
    ok: true,
    value: {
      createdCount: 2,
      products: [
        { inputIndex: 1, productId: "product-1", serialNumber: "0000001" },
        { inputIndex: 2, productId: "product-2", serialNumber: "0000002" },
      ],
    },
  });
  const rendered = render(
    <ComponentImportDialog
      open={options.open ?? true}
      brands={brands}
      isBrandsLoading={options.isBrandsLoading ?? false}
      brandLoadError={options.brandLoadError ?? null}
      onRetryBrands={onRetryBrands}
      onClose={onClose}
      onSubmit={onSubmit as never}
      onSucceeded={onSucceeded}
    />,
  );
  return { ...rendered, onClose, onRetryBrands, onSubmit, onSucceeded };
}

async function chooseWorkbook(selected = file()) {
  fireEvent.change(screen.getByLabelText("Excel workbook"), {
    target: { files: [selected] },
  });
  await waitFor(() => expect(dialogMocks.parseWorkbook).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetAllMocks();
  dialogMocks.createTemplate.mockReturnValue(new Uint8Array([1, 2, 3]));
  dialogMocks.parseWorkbook.mockResolvedValue({ ok: true, preview: validPreview });
});

afterEach(cleanup);

describe("ComponentImportDialog", () => {
  it("does not render while closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("portals a bounded viewport overlay under document.body and closes normally", () => {
    const rendered = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Import Components from Excel" });
    const overlay = dialog.parentElement?.parentElement;

    expect(rendered.container).not.toContainElement(dialog);
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[60]", "overflow-y-auto");
    expect(dialog).toHaveClass("max-w-5xl", "overflow-hidden", "flex-col");
    expect(dialog.className).toContain("max-h-[calc(100dvh-1.5rem)]");

    fireEvent.click(screen.getByRole("button", { name: "Close Component import" }));
    expect(rendered.onClose).toHaveBeenCalledOnce();
  });

  it("downloads the canonical template through a temporary XLSX object URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:template");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderDialog({ isBrandsLoading: true });

    fireEvent.click(screen.getByRole("button", { name: "Download Template" }));
    expect(dialogMocks.createTemplate).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:template");
    click.mockRestore();
  });

  it("shows Brand loading/error states, blocks selection, and retries safely", () => {
    const loading = renderDialog({ isBrandsLoading: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading Brands");
    expect(screen.getByLabelText("Excel workbook")).toBeDisabled();
    loading.unmount();

    const failed = renderDialog({ brandLoadError: "Brands could not be loaded." });
    expect(screen.getByRole("alert")).toHaveTextContent("Brands could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failed.onRetryBrands).toHaveBeenCalledOnce();
  });

  it("renders a valid preview with counts, physical rows, blank Brand, and requires confirmation", async () => {
    const { onSubmit } = renderDialog();
    await chooseWorkbook();

    expect(screen.getByLabelText("Import summary")).toHaveTextContent("Total2Ready2Invalid0");
    expect(screen.getByRole("cell", { name: "1501" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "No Brand" })).toBeInTheDocument();
    expect(screen.getAllByText("Ready")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Import 2 Components" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("dialog", { name: "Import Components" });
    expect(confirmation).toHaveTextContent(
      "entire batch succeeds or fails together",
    );
    expect(confirmation.parentElement).toHaveClass("z-[70]");
  });

  it("renders all invalid-row errors and cannot reach confirmation", async () => {
    dialogMocks.parseWorkbook.mockResolvedValue({ ok: true, preview: invalidPreview });
    const { onSubmit } = renderDialog();
    await chooseWorkbook();
    expect(screen.getByText("Brand is archived and cannot be selected.")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 Component" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a safe file-level parsing error", async () => {
    dialogMocks.parseWorkbook.mockResolvedValue({
      ok: false,
      error: { code: "workbook_unreadable", message: "The workbook could not be read." },
    });
    const { onSubmit } = renderDialog();
    await chooseWorkbook();
    expect(await screen.findByRole("alert")).toHaveTextContent("The workbook could not be read.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores stale parse results and keeps the newest selected workbook", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    dialogMocks.parseWorkbook
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        ok: true,
        preview: {
          ...validPreview,
          rows: [{ ...validPreview.rows[0], name: "Newest" }],
          totalRows: 1,
          readyRows: 1,
          submissionRows: [{ name: "Newest", category: "Passive", brand: null }],
        },
      });
    renderDialog();
    const input = screen.getByLabelText("Excel workbook");
    fireEvent.change(input, { target: { files: [file("first.xlsx")] } });
    fireEvent.change(input, { target: { files: [file("second.xlsx")] } });
    expect(await screen.findByText("Newest")).toBeInTheDocument();
    resolveFirst?.({ ok: false, error: { code: "workbook_unreadable", message: "stale" } });
    await Promise.resolve();
    expect(screen.getByText("Newest")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("submits exact validated rows only after confirmation and locks duplicate actions", async () => {
    let resolveImport: ((value: ComponentImportResult) => void) | undefined;
    const pending = new Promise<ComponentImportResult>((resolve) => { resolveImport = resolve; });
    const onSubmit = vi.fn().mockReturnValue(pending);
    const { onClose, onSucceeded } = renderDialog({ onSubmit });
    await chooseWorkbook();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 Components" }));
    const confirm = screen.getByRole("button", { name: "Import Components" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(validPreview.submissionRows);
    expect(screen.getByRole("dialog", { name: "Import Components" })).toHaveAttribute("aria-busy", "true");
    expect(within(screen.getByRole("dialog", { name: "Import Components" }))
      .getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Excel workbook")).toBeDisabled();

    resolveImport?.({
      ok: true,
      value: {
        createdCount: 2,
        products: [
          { inputIndex: 1, productId: "product-1", serialNumber: "0000001" },
          { inputIndex: 2, productId: "product-2", serialNumber: "0000002" },
        ],
      },
    });
    await waitFor(() => expect(onSucceeded).toHaveBeenCalledWith(expect.objectContaining({ createdCount: 2 })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps failures open without fake success and gives stale Brands a revalidation path", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "brand_unavailable",
        message: "A Brand in this workbook is no longer available. Refresh Brands and upload the workbook again.",
      },
    });
    const { onClose, onRetryBrands, onSucceeded } = renderDialog({ onSubmit });
    await chooseWorkbook();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 Components" }));
    fireEvent.click(screen.getByRole("button", { name: "Import Components" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
    expect(onSucceeded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Brands and upload again" }));
    expect(onRetryBrands).toHaveBeenCalledOnce();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
