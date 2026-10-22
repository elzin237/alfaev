const PRODUCT_SERIAL_PATTERN = /^(?:[0-9]{3}|[0-9]{7})$/;

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_CODE_B = 104;
const STOP_CODE = 106;
const CHECKSUM_MODULUS = 103;
const CODE128_B_ASCII_OFFSET = 32;

export interface ProductSerialBarcode {
  readonly serialNumber: string;
  readonly checksum: number;
  readonly symbolValues: readonly number[];
  readonly modulePattern: string;
}

function getPattern(symbolValue: number): string {
  const pattern = CODE128_PATTERNS[symbolValue];

  if (pattern === undefined) {
    throw new Error("Invalid Code 128 symbol value.");
  }

  return pattern;
}

function patternToModules(pattern: string): string {
  let modules = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const width = Number(pattern[index]);
    modules += (index % 2 === 0 ? "1" : "0").repeat(width);
  }

  return modules;
}

export function encodeProductSerialCode128(
  serialNumber: string,
): ProductSerialBarcode {
  if (
    typeof serialNumber !== "string" ||
    !PRODUCT_SERIAL_PATTERN.test(serialNumber)
  ) {
    throw new RangeError(
      "Product Serial Number must contain exactly 3 or 7 ASCII digits.",
    );
  }

  const dataSymbols = Array.from(
    serialNumber,
    (character) => character.charCodeAt(0) - CODE128_B_ASCII_OFFSET,
  );

  let weightedChecksum = START_CODE_B;
  for (const [index, symbolValue] of dataSymbols.entries()) {
    weightedChecksum += symbolValue * (index + 1);
  }

  const checksum = weightedChecksum % CHECKSUM_MODULUS;
  const symbolValues = Object.freeze([
    START_CODE_B,
    ...dataSymbols,
    checksum,
    STOP_CODE,
  ]);
  const modulePattern = symbolValues
    .map((symbolValue) => patternToModules(getPattern(symbolValue)))
    .join("");

  return Object.freeze({
    serialNumber,
    checksum,
    symbolValues,
    modulePattern,
  });
}
