import { exportFileName } from '../engine/export/raster.ts';
import { ARCHIVE_PATHS, buildManifest, type DocumentJson } from '../shared/document/to-json.js';

// Copia local sin conexión (§10.4): un .parcify con manifest.json y document.json, sin assets. Las imágenes se
// quedan como referencias; al importarlo, el servidor copia las que quien importa puede ver.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fecha y hora en formato MS-DOS (resolución de 2 s, desde 1980).
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// ZIP sin compresión (método 0): pocas entradas pequeñas, sin ZIP64 ni cifrado, que el lector del servidor acepta.
export function storedZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>, now = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, file.data);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// El nombre del manifest tiene que validar como nombre de proyecto (1–80 caracteres).
function manifestName(name: string): string {
  const trimmed = name.trim().slice(0, 80).trim();
  return trimmed || 'Parcify';
}

export function buildLocalCopy(name: string, data: DocumentJson, now = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const manifest = buildManifest({ name: manifestName(name), schemaVersion: data.meta.schemaVersion, exportedAt: now });
  return storedZip(
    [
      { name: ARCHIVE_PATHS.manifest, data: encoder.encode(JSON.stringify(manifest)) },
      { name: ARCHIVE_PATHS.document, data: encoder.encode(JSON.stringify(data)) },
    ],
    now,
  );
}

export function downloadLocalCopy(name: string, data: DocumentJson): void {
  const blob = new Blob([buildLocalCopy(name, data)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(name, 'parcify');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
