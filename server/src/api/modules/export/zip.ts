import { crc32, inflateRawSync } from 'node:zlib';

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

export const ARCHIVE_LIMITS = {
  maxArchiveBytes: 200 * MiB,
  maxEntries: 2_100,
  maxDeclaredBytes: 1 * GiB,
} as const;

export type ArchiveLimits = { maxEntries: number; maxDeclaredBytes: number };

export type ArchiveErrorReason =
  | 'not_zip'
  | 'zip64'
  | 'multi_disk'
  | 'too_many_entries'
  | 'unsafe_path'
  | 'duplicate_entry'
  | 'encrypted'
  | 'declared_too_large'
  | 'corrupt'
  | 'unsupported_method'
  | 'entry_too_large'
  | 'bomb';

export class ArchiveError extends Error {
  constructor(readonly reason: ArchiveErrorReason) {
    super(`ZIP no válido: ${reason}`);
    this.name = 'ArchiveError';
  }
}

export interface ArchiveEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;

// Rutas relativas con «/»: sin «..», sin raíz, sin unidad de Windows, sin «\» ni caracteres de control.
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 512) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part, index, parts) => part !== '..' && part !== '.' && (part !== '' || index === parts.length - 1));
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_SIZE; offset >= lowest; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE && offset + EOCD_SIZE + buffer.readUInt16LE(offset + 20) === buffer.length) {
      return offset;
    }
  }
  return -1;
}

// Lee el directorio central antes de descomprimir nada y cuenta los bytes reales de cada entrada que se extrae.
export class ZipArchive {
  private extracted = 0;

  private constructor(
    private readonly buffer: Buffer,
    readonly entries: ReadonlyMap<string, ArchiveEntry>,
    private readonly centralOffset: number,
    private readonly limits: ArchiveLimits,
  ) {}

  static open(buffer: Buffer, limits: ArchiveLimits = ARCHIVE_LIMITS): ZipArchive {
    if (buffer.length < EOCD_SIZE) throw new ArchiveError('not_zip');
    const eocd = findEndOfCentralDirectory(buffer);
    if (eocd < 0) throw new ArchiveError('not_zip');
    const disk = buffer.readUInt16LE(eocd + 4);
    const centralDisk = buffer.readUInt16LE(eocd + 6);
    const diskEntries = buffer.readUInt16LE(eocd + 8);
    const total = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (total === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ArchiveError('zip64');
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== total) throw new ArchiveError('multi_disk');
    if (total > limits.maxEntries) throw new ArchiveError('too_many_entries');
    if (centralOffset + centralSize > eocd) throw new ArchiveError('corrupt');

    const entries = new Map<string, ArchiveEntry>();
    let declared = 0;
    let offset = centralOffset;
    const end = centralOffset + centralSize;
    let count = 0;
    while (offset < end) {
      if (++count > limits.maxEntries) throw new ArchiveError('too_many_entries');
      if (offset + CENTRAL_SIZE > end || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new ArchiveError('corrupt');
      const flags = buffer.readUInt16LE(offset + 8);
      const method = buffer.readUInt16LE(offset + 10);
      const crc = buffer.readUInt32LE(offset + 16);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const size = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const next = offset + CENTRAL_SIZE + nameLength + extraLength + commentLength;
      if (next > end) throw new ArchiveError('corrupt');
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ArchiveError('zip64');
      if (flags & 0x1) throw new ArchiveError('encrypted');
      const name = buffer.toString('utf8', offset + CENTRAL_SIZE, offset + CENTRAL_SIZE + nameLength);
      if (!isSafeEntryName(name)) throw new ArchiveError('unsafe_path');
      if (entries.has(name)) throw new ArchiveError('duplicate_entry');
      declared += size;
      if (declared > limits.maxDeclaredBytes) throw new ArchiveError('declared_too_large');
      entries.set(name, { name, method, crc, compressedSize, size, localOffset });
      offset = next;
    }
    if (count !== total) throw new ArchiveError('corrupt');
    return new ZipArchive(buffer, entries, centralOffset, limits);
  }

  // Contenido de una entrada; null si no existe. Aborta si pasa de `maxBytes`, del tamaño declarado o del total.
  read(name: string, maxBytes: number): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const remaining = this.limits.maxDeclaredBytes - this.extracted;
    if (entry.size > maxBytes) throw new ArchiveError('entry_too_large');
    if (entry.size > remaining) throw new ArchiveError('bomb');

    const local = entry.localOffset;
    if (local + LOCAL_SIZE > this.centralOffset || this.buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
      throw new ArchiveError('corrupt');
    }
    const start = local + LOCAL_SIZE + this.buffer.readUInt16LE(local + 26) + this.buffer.readUInt16LE(local + 28);
    const stop = start + entry.compressedSize;
    if (stop > this.centralOffset) throw new ArchiveError('corrupt');
    const raw = this.buffer.subarray(start, stop);

    let data: Buffer;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) throw new ArchiveError('corrupt');
      data = Buffer.from(raw);
    } else if (entry.method === 8) {
      try {
        // Un byte por encima de lo declarado basta para saber que la entrada miente sobre su tamaño.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size + 1) });
      } catch (error) {
        throw new ArchiveError((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? 'bomb' : 'corrupt');
      }
      if (data.length > entry.size) throw new ArchiveError('bomb');
    } else {
      throw new ArchiveError('unsupported_method');
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ArchiveError('corrupt');
    this.extracted += data.length;
    return data;
  }
}
