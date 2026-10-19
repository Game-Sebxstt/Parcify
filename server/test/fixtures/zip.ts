import { zipSync } from 'fflate';

export function zip(files: Record<string, Uint8Array | string>, level: 0 | 6 | 9 = 6): Buffer {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, body]) => [name, typeof body === 'string' ? new TextEncoder().encode(body) : body]),
  );
  return Buffer.from(zipSync(entries, { level }));
}

// Reescribe el tamaño descomprimido declarado de una entrada en el directorio central.
export function patchDeclaredSize(buffer: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(buffer);
  for (let offset = 0; offset < out.length - 46; offset++) {
    if (out.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = out.readUInt16LE(offset + 28);
    if (out.toString('utf8', offset + 46, offset + 46 + length) === name) {
      out.writeUInt32LE(size, offset + 24);
      return out;
    }
  }
  throw new Error(`sin entrada ${name}`);
}
