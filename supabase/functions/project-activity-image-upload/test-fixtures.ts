function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.byteLength);
  new DataView(result.buffer).setUint32(0, data.byteLength);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  new DataView(result.buffer).setUint32(
    8 + data.byteLength,
    crc32(result.subarray(4, 8 + data.byteLength)),
  );
  return result;
}

export function validProjectActivityPng(paddingBytes = 0): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 1);
  headerView.setUint32(4, 1);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    signature,
    chunk("IHDR", header),
    ...(paddingBytes > 0
      ? [chunk("raNd", new Uint8Array(paddingBytes))]
      : []),
    chunk(
      "IDAT",
      new Uint8Array([120, 156, 99, 96, 96, 96, 0, 0, 0, 5, 0, 1]),
    ),
    chunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function validProjectActivityJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00,
    0xff, 0xd9,
  ]);
}

export function validProjectActivityWebp(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
      "base64",
    ),
  );
}

export function projectActivityPngChunk(
  type: string,
  data: Uint8Array,
): Uint8Array {
  return chunk(type, data);
}
