import { describe, expect, it } from 'vitest';
import { ManifestSchema, type DocumentJson } from '../shared/document/to-json.js';
import { buildLocalCopy, crc32 } from './local-copy.ts';

// Lee un ZIP sin compresión como lo hace el servidor: directorio central, cabecera local y CRC.
function readStored(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (let i = 0; i < total; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 10, true)).toBe(0);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));
    offset += 46 + nameLength;
  }
  return files;
}

describe('copia local .parcify', () => {
  it('crc32 coincide con el valor de referencia', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('lleva manifest.json válido y el document.json tal cual, con las imágenes como referencias', () => {
    const data: DocumentJson = {
      meta: { schemaVersion: 1 },
      pages: { p1: { name: 'Página 1', index: 'a0' } },
      nodes: { n1: { type: 'image', pageId: 'p1', assetId: '0190a1b2-0000-7000-8000-000000000001' } },
      texts: { t1: 'Hola «mundo» 👋' },
      animations: {},
    };
    const files = readStored(buildLocalCopy('  Mi proyecto  ', data, new Date('2026-10-20T10:00:00Z')));
    expect([...files.keys()]).toEqual(['manifest.json', 'document.json']);
    const manifest = ManifestSchema.parse(JSON.parse(files.get('manifest.json')!));
    expect(manifest).toMatchObject({ format: 'parcify', formatVersion: 1, schemaVersion: 1, name: 'Mi proyecto' });
    expect(JSON.parse(files.get('document.json')!)).toEqual(data);
  });
});
