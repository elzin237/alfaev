import {
  encodeProductSerialCode128,
  type ProductSerialBarcode,
} from "./code128";

export const BARCODE_QUIET_ZONE_MODULES = 10;

const BARCODE_BAR_TOP = 6;
const BARCODE_BAR_HEIGHT = 60;
const BARCODE_TEXT_BASELINE = 84;
const BARCODE_HEIGHT = 92;
const BARCODE_RENDER_WIDTH_PER_MODULE = 4;
const BARCODE_RENDER_HEIGHT = 240;

export interface ProductBarcodeSvg {
  readonly barcode: ProductSerialBarcode;
  readonly height: number;
  readonly quietZoneModules: number;
  readonly svg: string;
  readonly width: number;
}

interface BarRun {
  readonly start: number;
  readonly width: number;
}

function findBarRuns(modulePattern: string): BarRun[] {
  const runs: BarRun[] = [];
  let index = 0;

  while (index < modulePattern.length) {
    if (modulePattern[index] === "0") {
      index += 1;
      continue;
    }

    const start = index;
    while (modulePattern[index] === "1") index += 1;
    runs.push({ start, width: index - start });
  }

  return runs;
}

export function createProductBarcodeSvg(
  serialNumber: string,
): ProductBarcodeSvg {
  const barcode = encodeProductSerialCode128(serialNumber);
  const width = barcode.modulePattern.length + BARCODE_QUIET_ZONE_MODULES * 2;
  const bars = findBarRuns(barcode.modulePattern)
    .map(({ start, width: barWidth }) =>
      `<rect x="${start + BARCODE_QUIET_ZONE_MODULES}" y="${BARCODE_BAR_TOP}" width="${barWidth}" height="${BARCODE_BAR_HEIGHT}" fill="#000"/>`
    )
    .join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="barcode-title-${serialNumber}" viewBox="0 0 ${width} ${BARCODE_HEIGHT}" width="${width * BARCODE_RENDER_WIDTH_PER_MODULE}" height="${BARCODE_RENDER_HEIGHT}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" data-module-pattern="${barcode.modulePattern}" data-quiet-zone-modules="${BARCODE_QUIET_ZONE_MODULES}">`,
    `<title id="barcode-title-${serialNumber}">Barcode for Product Serial Number ${serialNumber}</title>`,
    `<rect width="${width}" height="${BARCODE_HEIGHT}" fill="#fff"/>`,
    bars,
    `<text x="${width / 2}" y="${BARCODE_TEXT_BASELINE}" text-anchor="middle" fill="#000" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12" letter-spacing="1.5">${serialNumber}</text>`,
    "</svg>",
  ].join("");

  return Object.freeze({
    barcode,
    width,
    height: BARCODE_HEIGHT,
    quietZoneModules: BARCODE_QUIET_ZONE_MODULES,
    svg,
  });
}
