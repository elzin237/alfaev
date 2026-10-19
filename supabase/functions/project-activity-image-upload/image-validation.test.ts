import { describe, expect, it } from "vitest";

import {
  projectActivityImageMaxBytes,
  sha256Hex,
  verifyProjectActivityImage,
} from "./image-validation";
import {
  projectActivityPngChunk as chunk,
  validProjectActivityJpeg as jpeg,
  validProjectActivityPng as png,
  validProjectActivityWebp as webp,
} from "./test-fixtures";

describe("Project Activity image byte validation", () => {
  it.each([
    ["PNG", png(), "image/png"],
    ["JPEG", jpeg(), "image/jpeg"],
    ["WebP", webp(), "image/webp"],
  ])("accepts structurally valid %s bytes", (_label, bytes, mimeType) => {
    expect(verifyProjectActivityImage(bytes)).toMatchObject({
      height: 1,
      mimeType,
      width: 1,
    });
  });

  it("accepts an exactly 5 MiB structurally valid PNG", () => {
    const baseline = png();
    const exact = png(projectActivityImageMaxBytes - baseline.byteLength - 12);
    expect(exact.byteLength).toBe(projectActivityImageMaxBytes);
    expect(verifyProjectActivityImage(exact)?.mimeType).toBe("image/png");
  });

  it.each([
    ["zero bytes", new Uint8Array()],
    ["over 5 MiB", new Uint8Array(projectActivityImageMaxBytes + 1)],
    ["SVG", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ["GIF", new TextEncoder().encode("GIF89a random")],
    ["PDF", new TextEncoder().encode("%PDF-1.7")],
    ["random", new Uint8Array(64).fill(7)],
    ["truncated PNG", png().slice(0, -3)],
    ["truncated JPEG", jpeg().slice(0, -2)],
    ["truncated WebP", webp().slice(0, -2)],
  ])("rejects %s", (_label, bytes) => {
    expect(verifyProjectActivityImage(bytes)).toBeNull();
  });

  it("rejects animated PNG and WebP declarations", () => {
    const base = png();
    const animated = new Uint8Array(base.byteLength + 20);
    animated.set(base.subarray(0, 33), 0);
    animated.set(chunk("acTL", new Uint8Array(8)), 33);
    animated.set(base.subarray(33), 53);
    expect(verifyProjectActivityImage(animated)).toBeNull();

    const animatedWebp = webp();
    animatedWebp.set(new TextEncoder().encode("ANIM"), 12);
    expect(verifyProjectActivityImage(animatedWebp)).toBeNull();
  });

  it("computes an authoritative lowercase SHA-256 digest", async () => {
    await expect(sha256Hex(new TextEncoder().encode("AlfaEV"))).resolves.toBe(
      "c656b18467938614342d96e3478eddfec6162191d2c59c25d3e8e0ccea1c589a",
    );
  });
});
