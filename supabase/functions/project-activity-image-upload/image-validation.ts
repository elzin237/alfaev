export const projectActivityImageMaxBytes = 5 * 1024 * 1024;
export const projectActivityImageMaxDimension = 10_000;
export const projectActivityImageMaxPixels = 40_000_000;

export type VerifiedImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface VerifiedImage {
  extension: "jpg" | "png" | "webp";
  height: number;
  mimeType: VerifiedImageMimeType;
  width: number;
}

function dimensionsAreSafe(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 &&
    width <= projectActivityImageMaxDimension &&
    height <= projectActivityImageMaxDimension &&
    width * height <= projectActivityImageMaxPixels;
}

function byteAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? -1;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) * 0x1000000 +
    (byteAt(bytes, offset + 1) << 16) +
    (byteAt(bytes, offset + 2) << 8) +
    byteAt(bytes, offset + 3)
  ) >>> 0;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) +
    (byteAt(bytes, offset + 1) << 8) +
    (byteAt(bytes, offset + 2) << 16) +
    byteAt(bytes, offset + 3) * 0x1000000
  ) >>> 0;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= byteAt(bytes, index);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function verifyPng(bytes: Uint8Array): VerifiedImage | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 45 ||
    !signature.every((byte, index) => byteAt(bytes, index) === byte)
  ) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32BigEndian(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (dataEnd + 4 > bytes.byteLength) return null;

    const type = String.fromCharCode(
      byteAt(bytes, typeStart),
      byteAt(bytes, typeStart + 1),
      byteAt(bytes, typeStart + 2),
      byteAt(bytes, typeStart + 3),
    );
    if (crc32(bytes, typeStart, dataEnd) !== readUint32BigEndian(bytes, crcOffset)) {
      return null;
    }

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return null;
      width = readUint32BigEndian(bytes, dataStart);
      height = readUint32BigEndian(bytes, dataStart + 4);
      if (!dimensionsAreSafe(width, height)) return null;
      sawHeader = true;
    } else if (type === "IHDR") {
      return null;
    }

    if (type === "acTL") return null;
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !sawImageData) return null;
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
  }

  if (!sawHeader || !sawEnd || offset !== bytes.byteLength) return null;
  return { extension: "png", height, mimeType: "image/png", width };
}

const jpegStartOfFrameMarkers = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function verifyJpeg(bytes: Uint8Array): VerifiedImage | null {
  if (
    bytes.byteLength < 16 || byteAt(bytes, 0) !== 0xff ||
    byteAt(bytes, 1) !== 0xd8 ||
    byteAt(bytes, bytes.byteLength - 2) !== 0xff ||
    byteAt(bytes, bytes.byteLength - 1) !== 0xd9
  ) return null;

  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  while (offset < bytes.byteLength) {
    if (byteAt(bytes, offset) !== 0xff) return null;
    while (offset < bytes.byteLength && byteAt(bytes, offset) === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;
    const marker = byteAt(bytes, offset++);

    if (marker === 0xd9) {
      return sawFrame && offset === bytes.byteLength
        ? { extension: "jpg", height, mimeType: "image/jpeg", width }
        : null;
    }
    if (marker === 0x00 || marker === 0xd8) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return null;

    const segmentLength = (byteAt(bytes, offset) << 8) |
      byteAt(bytes, offset + 1);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    const segmentData = offset + 2;
    const segmentEnd = offset + segmentLength;

    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 8 || sawFrame) return null;
      height = (byteAt(bytes, segmentData + 1) << 8) |
        byteAt(bytes, segmentData + 2);
      width = (byteAt(bytes, segmentData + 3) << 8) |
        byteAt(bytes, segmentData + 4);
      if (!dimensionsAreSafe(width, height)) return null;
      sawFrame = true;
    }

    offset = segmentEnd;
    if (marker === 0xda) {
      while (offset + 1 < bytes.byteLength) {
        if (byteAt(bytes, offset) !== 0xff) {
          offset += 1;
          continue;
        }
        const next = byteAt(bytes, offset + 1);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        if (next === 0xff) {
          offset += 1;
          continue;
        }
        break;
      }
    }
  }
  return null;
}

function bytesEqualAscii(
  bytes: Uint8Array,
  offset: number,
  expected: string,
): boolean {
  return [...expected].every(
    (character, index) =>
      byteAt(bytes, offset + index) === character.charCodeAt(0),
  );
}

function verifyWebp(bytes: Uint8Array): VerifiedImage | null {
  if (
    bytes.byteLength < 30 ||
    !bytesEqualAscii(bytes, 0, "RIFF") ||
    !bytesEqualAscii(bytes, 8, "WEBP") ||
    readUint32LittleEndian(bytes, 4) + 8 !== bytes.byteLength
  ) return null;

  let offset = 12;
  let width = 0;
  let height = 0;
  let sawImage = false;
  let canvasDimensions: { width: number; height: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const type = String.fromCharCode(
      byteAt(bytes, offset),
      byteAt(bytes, offset + 1),
      byteAt(bytes, offset + 2),
      byteAt(bytes, offset + 3),
    );
    const length = readUint32LittleEndian(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.byteLength) return null;

    if (type === "ANIM" || type === "ANMF") return null;
    if (type === "VP8X") {
      if (length !== 10 || canvasDimensions) return null;
      if ((byteAt(bytes, dataStart) & 0x02) !== 0) return null;
      const canvasWidth = 1 + byteAt(bytes, dataStart + 4) +
        (byteAt(bytes, dataStart + 5) << 8) +
        (byteAt(bytes, dataStart + 6) << 16);
      const canvasHeight = 1 + byteAt(bytes, dataStart + 7) +
        (byteAt(bytes, dataStart + 8) << 8) +
        (byteAt(bytes, dataStart + 9) << 16);
      if (!dimensionsAreSafe(canvasWidth, canvasHeight)) return null;
      canvasDimensions = { width: canvasWidth, height: canvasHeight };
    } else if (type === "VP8 ") {
      if (
        sawImage || length < 10 || byteAt(bytes, dataStart + 3) !== 0x9d ||
        byteAt(bytes, dataStart + 4) !== 0x01 ||
        byteAt(bytes, dataStart + 5) !== 0x2a
      ) return null;
      width = (byteAt(bytes, dataStart + 6) |
        (byteAt(bytes, dataStart + 7) << 8)) & 0x3fff;
      height = (byteAt(bytes, dataStart + 8) |
        (byteAt(bytes, dataStart + 9) << 8)) & 0x3fff;
      if (!dimensionsAreSafe(width, height)) return null;
      sawImage = true;
    } else if (type === "VP8L") {
      if (sawImage || length < 5 || byteAt(bytes, dataStart) !== 0x2f) {
        return null;
      }
      width = 1 + byteAt(bytes, dataStart + 1) +
        ((byteAt(bytes, dataStart + 2) & 0x3f) << 8);
      height = 1 + ((byteAt(bytes, dataStart + 2) & 0xc0) >> 6) +
        (byteAt(bytes, dataStart + 3) << 2) +
        ((byteAt(bytes, dataStart + 4) & 0x0f) << 10);
      if (!dimensionsAreSafe(width, height)) return null;
      sawImage = true;
    }

    offset = dataEnd + (length % 2);
  }

  if (!sawImage || offset !== bytes.byteLength) return null;
  if (
    canvasDimensions &&
    (canvasDimensions.width !== width || canvasDimensions.height !== height)
  ) return null;
  return { extension: "webp", height, mimeType: "image/webp", width };
}

export function verifyProjectActivityImage(
  bytes: Uint8Array,
): VerifiedImage | null {
  if (
    bytes.byteLength < 1 || bytes.byteLength > projectActivityImageMaxBytes
  ) return null;
  return verifyPng(bytes) ?? verifyJpeg(bytes) ?? verifyWebp(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
