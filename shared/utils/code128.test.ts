import { describe, expect, it } from "vitest";

import { encodeProductSerialCode128 } from "./code128";

describe("encodeProductSerialCode128", () => {
  it("encodes a known seven-digit Serial with exact Code 128B symbols and modules", () => {
    expect(encodeProductSerialCode128("1234567")).toEqual({
      serialNumber: "1234567",
      checksum: 74,
      symbolValues: [104, 17, 18, 19, 20, 21, 22, 23, 74, 106],
      modulePattern:
        "1101001000010011100110110011100101100101110011001001110110111001001100111010011101101110100001100101100011101011",
    });
  });

  it("encodes the first canonical Serial deterministically", () => {
    const first = encodeProductSerialCode128("0000001");
    const repeated = encodeProductSerialCode128("0000001");

    expect(first).toEqual({
      serialNumber: "0000001",
      checksum: 44,
      symbolValues: [104, 16, 16, 16, 16, 16, 16, 17, 44, 106],
      modulePattern:
        "1101001000010011101100100111011001001110110010011101100100111011001001110110010011100110100011011101100011101011",
    });
    expect(repeated).toEqual(first);
  });

  it("produces a different encoding for another valid Serial", () => {
    expect(encodeProductSerialCode128("7654321").modulePattern).not.toBe(
      encodeProductSerialCode128("1234567").modulePattern,
    );
  });

  it.each([
    ["wrong length", "123456"],
    ["too long", "12345678"],
    ["letters", "123A567"],
    ["leading whitespace", " 1234567"],
    ["trailing whitespace", "1234567 "],
    ["sign", "+123456"],
    ["decimal", "123.567"],
    ["Arabic-Indic digits", "١٢٣٤٥٦٧"],
    ["full-width digits", "１２３４５６７"],
  ])("rejects %s without trimming or repair", (_label, serialNumber) => {
    expect(() => encodeProductSerialCode128(serialNumber)).toThrowError(
      "Product Serial Number must contain exactly 7 ASCII digits.",
    );
  });
});
