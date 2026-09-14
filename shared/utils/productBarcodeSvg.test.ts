import { describe, expect, it } from "vitest";

import { encodeProductSerialCode128 } from "./code128";
import {
  BARCODE_QUIET_ZONE_MODULES,
  createProductBarcodeSvg,
} from "./productBarcodeSvg";

describe("createProductBarcodeSvg", () => {
  it("renders the exact encoded modules with print-safe quiet zones and text", () => {
    const encoded = encodeProductSerialCode128("0000001");
    const rendered = createProductBarcodeSvg("0000001");

    expect(rendered.barcode).toEqual(encoded);
    expect(rendered.width).toBe(
      encoded.modulePattern.length + BARCODE_QUIET_ZONE_MODULES * 2,
    );
    expect(rendered.quietZoneModules).toBe(10);
    expect(rendered.svg).toContain(
      `data-module-pattern="${encoded.modulePattern}"`,
    );
    expect(rendered.svg).toContain('data-quiet-zone-modules="10"');
    expect(rendered.svg).toContain('shape-rendering="crispEdges"');
    expect(rendered.svg).toContain('fill="#fff"');
    expect(rendered.svg).toContain('fill="#000"');
    expect(rendered.svg).toContain(">0000001</text>");

    const firstBarX = Number(
      rendered.svg.match(/<rect x="([0-9]+)"/)?.[1],
    );
    expect(firstBarX).toBe(10);
    expect(rendered.width - (10 + encoded.modulePattern.length)).toBe(10);
  });

  it("does not repair an invalid Product Serial", () => {
    expect(() => createProductBarcodeSvg(" 0000001")).toThrowError(
      "Product Serial Number must contain exactly 7 ASCII digits.",
    );
  });
});
