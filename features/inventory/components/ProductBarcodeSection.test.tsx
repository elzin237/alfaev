import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeProductSerialCode128 } from "../../../shared/utils/code128";
import ProductBarcodeSection from "./ProductBarcodeSection";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

let createdBlobs: Blob[];
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createdBlobs = [];
  createObjectUrl = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return `blob:barcode-${createdBlobs.length}`;
  });
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
});

describe("ProductBarcodeSection", () => {
  it("renders the Task 065 module pattern, quiet zones, and readable Serial", () => {
    const encoded = encodeProductSerialCode128("0000001");
    const { container } = render(
      <ProductBarcodeSection serialNumber="0000001" />,
    );
    const barcode = screen.getByRole("img", {
      name: "Barcode for Product Serial Number 0000001",
    });

    expect(barcode).toHaveAttribute(
      "data-module-pattern",
      encoded.modulePattern,
    );
    expect(barcode).toHaveAttribute("data-quiet-zone-modules", "10");
    expect(barcode).toHaveAttribute("shape-rendering", "crispEdges");
    expect(container.querySelectorAll('rect[fill="#000"]')).not.toHaveLength(0);
    expect(screen.getAllByText("0000001")).toHaveLength(2);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("opens the exact SVG through a temporary image/svg+xml Blob URL", async () => {
    vi.useFakeTimers();
    const openWindow = vi.spyOn(window, "open").mockReturnValue(window);
    render(<ProductBarcodeSection serialNumber="1234567" />);

    fireEvent.click(screen.getByRole("button", { name: "Open / View" }));

    expect(openWindow).toHaveBeenCalledWith(
      "blob:barcode-1",
      "_blank",
      "noopener,noreferrer",
    );
    expect(createdBlobs[0]?.type).toBe("image/svg+xml");
    expect(await createdBlobs[0]?.text()).toContain(">1234567</text>");
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:barcode-1");
  });

  it("fails safely and revokes the URL when the browser blocks the popup", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<ProductBarcodeSection serialNumber="0000001" />);

    fireEvent.click(screen.getByRole("button", { name: "Open / View" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The barcode could not be opened. Allow pop-ups and try again.",
    );
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:barcode-1");
  });

  it("downloads the same SVG with a deterministic filename and revokes its URL", async () => {
    vi.useFakeTimers();
    let downloadedFilename = "";
    let downloadedUrl = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureDownload(this: HTMLAnchorElement) {
        downloadedFilename = this.download;
        downloadedUrl = this.href;
      },
    );
    render(<ProductBarcodeSection serialNumber="0000001" />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadedFilename).toBe("alfaev-0000001-barcode.svg");
    expect(downloadedUrl).toBe("blob:barcode-1");
    expect(createdBlobs[0]?.type).toBe("image/svg+xml");
    expect(await createdBlobs[0]?.text()).toContain(">0000001</text>");

    vi.runOnlyPendingTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:barcode-1");
  });

  it("revokes an outstanding Open URL when unmounted", () => {
    vi.spyOn(window, "open").mockReturnValue(window);
    const rendered = render(
      <ProductBarcodeSection serialNumber="0000001" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open / View" }));
    rendered.unmount();

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:barcode-1");
  });

  it("shows a safe failure without actions for an invalid Serial", () => {
    render(<ProductBarcodeSection serialNumber="invalid" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Barcode unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A barcode cannot be generated for this Product Serial Number.",
    );
    expect(screen.queryByRole("button", { name: "Open / View" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" }))
      .not.toBeInTheDocument();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
