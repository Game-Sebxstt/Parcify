import { describe, expect, it } from 'vitest';
import { patchDeclaredSize, zip } from '../../../../test/fixtures/zip.js';
import { ArchiveError, isSafeEntryName, ZipArchive } from './zip.js';

function reason(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof ArchiveError ? error.reason : `otro: ${(error as Error).message}`;
  }
}

describe('ZipArchive', () => {
  it('lee entradas guardadas y comprimidas', () => {
    const archive = ZipArchive.open(zip({ 'manifest.json': '{"a":1}', 'assets/x.png': new Uint8Array([1, 2, 3]) }));
    expect(archive.read('manifest.json', 1024)?.toString()).toBe('{"a":1}');
    expect([...archive.read('assets/x.png', 1024)!]).toEqual([1, 2, 3]);
    expect(archive.read('falta.json', 1024)).toBeNull();
  });

  it('rechaza rutas con .., absolutas, con unidad o con barras invertidas', () => {
    for (const name of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', './x']) {
      expect(isSafeEntryName(name), name).toBe(false);
    }
    expect(isSafeEntryName('assets/')).toBe(true);
    expect(isSafeEntryName('assets/a.png')).toBe(true);
    expect(reason(() => ZipArchive.open(zip({ '../x': 'malo' })))).toBe('unsafe_path');
  });

  it('rechaza más de 2.100 entradas antes de leer ninguna', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 3_000; i++) files[`assets/${i}.txt`] = 'x';
    expect(reason(() => ZipArchive.open(zip(files, 0)))).toBe('too_many_entries');
  });

  it('rechaza más de 1 GiB declarado', () => {
    const archive = patchDeclaredSize(zip({ 'a.bin': 'x', 'b.bin': 'y' }), 'b.bin', 0x40000001);
    expect(reason(() => ZipArchive.open(archive))).toBe('declared_too_large');
  });

  it('cuenta los bytes reales: una entrada que miente sobre su tamaño es una bomba', () => {
    const archive = patchDeclaredSize(zip({ 'document.json': new Uint8Array(8 * 1024 * 1024) }, 9), 'document.json', 100);
    const opened = ZipArchive.open(archive);
    expect(reason(() => opened.read('document.json', 64 * 1024 * 1024))).toBe('bomb');
  });

  it('aplica el límite por entrada y el total extraído', () => {
    const opened = ZipArchive.open(zip({ 'a.bin': new Uint8Array(2000), 'b.bin': new Uint8Array(2000) }), {
      maxEntries: 10,
      maxDeclaredBytes: 4000,
    });
    expect(reason(() => opened.read('a.bin', 1000))).toBe('entry_too_large');
    opened.read('a.bin', 4000);
    opened.read('b.bin', 4000);
    expect(reason(() => opened.read('a.bin', 4000))).toBe('bomb');
  });

  it('rechaza lo que no es un ZIP, nombres duplicados y entradas cifradas', () => {
    expect(reason(() => ZipArchive.open(Buffer.from('no soy un zip, solo texto con más de 22 bytes')))).toBe('not_zip');
    const twice = zip({ 'a.json': '1', 'b.json': '2' });
    const index = twice.lastIndexOf(Buffer.from('b.json'));
    twice.write('a', index);
    expect(reason(() => ZipArchive.open(twice))).toBe('duplicate_entry');
    const encrypted = zip({ 'a.json': '1' });
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    expect(reason(() => ZipArchive.open(encrypted))).toBe('encrypted');
  });
});
