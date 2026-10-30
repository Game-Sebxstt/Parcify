import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { canvasGap } from './helpers/canvas.ts';

type Node = { id: string; type: string; name: string; x: number; y: number; w: number; h: number; parentId: string | null };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

// Contenido comparable entre proyectos: sin ids, con el padre por tipo y nombre.
function content(list: Node[]) {
  const byId = new Map(list.map((node) => [node.id, node]));
  return list
    .map((node) => {
      const parent = node.parentId ? byId.get(node.parentId) : null;
      return JSON.stringify({ type: node.type, name: node.name, x: node.x, y: node.y, w: node.w, h: node.h, parent: parent ? `${parent.type}:${parent.name}` : null });
    })
    .sort();
}

function pngSize(file: Buffer) {
  expect(file.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

// Ancho y alto del primer marcador SOF del JPG.
function jpegSize(file: Buffer) {
  expect(file[0]).toBe(0xff);
  expect(file[1]).toBe(0xd8);
  for (let i = 2; i + 9 < file.length; ) {
    if (file[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = file[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: file.readUInt16BE(i + 7), height: file.readUInt16BE(i + 5) };
    }
    i += 2 + file.readUInt16BE(i + 2);
  }
  throw new Error('JPG sin marcador SOF');
}

const sizeIn = (status: string) => {
  const match = /(\d+) × (\d+) px/.exec(status);
  if (!match) throw new Error(`Sin tamaño en «${status}»`);
  return { width: Number(match[1]), height: Number(match[2]) };
};

async function exportSelection(page: Page, canvas: Locator, format: string, scale?: number) {
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu', { name: 'Acciones del lienzo' }).getByRole('menuitem', { name: 'Exportar selección' }).click();
  const dialog = page.getByRole('dialog', { name: 'Exportar imagen' });
  await dialog.getByRole('radio', { name: format, exact: true }).check();
  if (scale) await dialog.getByRole('radio', { name: `${scale}×`, exact: true }).check();
  const status = (await dialog.getByRole('status').textContent()) ?? '';
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportar', exact: true }).click()]);
  const file = await readFile((await download.path())!);
  await expect(dialog).toHaveCount(0);
  return { file, status, name: download.suggestedFilename() };
}

test('PNG, JPG, SVG, PDF y .parcify; vista previa en el dashboard y reimportación con el mismo contenido', async ({ page }) => {
  test.setTimeout(180_000);
  const ana = await createVerifiedAccount(page.request, `export-${test.info().project.name}`, 'Ana Exporta');
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel exportable');
  await openEditor(page, projectId);

  // Dos frames de 240 × 160 y un rectángulo dentro del primero.
  const canvas = page.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = await canvasGap(page);
  const origin = { x: box.x + 60, y: box.y + 60 };
  for (const dx of [0, 300]) {
    await canvas.focus();
    await page.keyboard.press('f');
    await drag(page, { x: origin.x + dx, y: origin.y }, { x: origin.x + dx + 240, y: origin.y + 160 });
  }
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === 'frame').length).toBe(2);
  await page.getByRole('button', { name: 'Rectángulo (R)' }).click();
  await drag(page, { x: origin.x + 40, y: origin.y + 40 }, { x: origin.x + 140, y: origin.y + 100 });
  await expect.poll(async () => (await nodes(page)).length).toBe(3);
  const original = await nodes(page);
  const frames = original.filter((node) => node.type === 'frame').sort((a, b) => a.x - b.x);
  expect(original.find((node) => node.type === 'rect')!.parentId).toBe(frames[0]!.id);

  // Los dos frames seleccionados.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await expect.poll(async () => [...(await page.evaluate(() => window.__parcifyTest!.selection()))].sort()).toEqual(frames.map((frame) => frame.id).sort());
  const unionW = frames[1]!.x + frames[1]!.w - frames[0]!.x;
  const unionH = Math.max(...frames.map((frame) => frame.y + frame.h)) - Math.min(...frames.map((frame) => frame.y));

  // PNG a 2×: las dimensiones del archivo son las que anuncia el diálogo y el doble de la selección.
  const png = await exportSelection(page, canvas, 'PNG', 2);
  expect(png.name).toBe('Cartel exportable.png');
  const pngDims = pngSize(png.file);
  expect(pngDims).toEqual(sizeIn(png.status));
  expect(pngDims.width).toBeGreaterThanOrEqual(unionW * 2);
  expect(pngDims.width).toBeLessThanOrEqual(unionW * 2 + 8);
  expect(pngDims.height).toBeGreaterThanOrEqual(unionH * 2);
  expect(pngDims.height).toBeLessThanOrEqual(unionH * 2 + 8);

  // JPG a 1×.
  const jpg = await exportSelection(page, canvas, 'JPG', 1);
  expect(jpg.name).toBe('Cartel exportable.jpg');
  expect(jpegSize(jpg.file)).toEqual(sizeIn(jpg.status));
  expect(jpegSize(jpg.file).width * 2).toBeCloseTo(pngDims.width, -1);

  // SVG con el tamaño de la selección y los dos frames recortados.
  const svg = await exportSelection(page, canvas, 'SVG');
  expect(svg.name).toBe('Cartel exportable.svg');
  const markup = svg.file.toString('utf8');
  expect(markup.startsWith('<?xml')).toBe(true);
  expect(markup).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(markup).toContain('</svg>');
  const svgDims = sizeIn(svg.status);
  expect(markup).toMatch(new RegExp(`<svg [^>]*width="${svgDims.width}(\\.\\d+)?" height="${svgDims.height}(\\.\\d+)?"`));
  // Solo el frame con hijos lleva recorte.
  expect(markup.match(/<clipPath/g)?.length ?? 0).toBe(1);

  // PDF: una página por frame, del tamaño del frame en puntos.
  const pdf = await exportSelection(page, canvas, 'PDF');
  expect(pdf.status).toContain('Páginas del PDF: 2');
  expect(pdf.name).toBe('Cartel exportable.pdf');
  const pdfDocument = await PDFDocument.load(pdf.file);
  expect(pdfDocument.getPageCount()).toBe(2);
  for (const pdfPage of pdfDocument.getPages()) {
    const { width, height } = pdfPage.getSize();
    expect(width).toBeGreaterThanOrEqual(240);
    expect(width).toBeLessThanOrEqual(244);
    expect(height).toBeGreaterThanOrEqual(160);
    expect(height).toBeLessThanOrEqual(164);
  }

  // .parcify desde el servidor (estado vivo por RPC).
  const archive = await exportSelection(page, canvas, 'Proyecto (.parcify)');
  expect(archive.name).toBe('Cartel exportable.parcify');
  expect(archive.file.subarray(0, 2).toString('ascii')).toBe('PK');

  // Al volver al dashboard se sube la miniatura y la tarjeta la muestra.
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: 'Volver al inicio' }).click();
  await expect(page).toHaveURL('/app');
  const card = page
    .getByRole('list', { name: 'Vistos recientemente' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Cartel exportable', exact: true }) });
  await expect(async () => {
    await page.reload();
    const width = await card.locator('img').evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0), undefined, { timeout: 3_000 });
    expect(width).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });

  // Reimportar el .parcify abre un proyecto nuevo con el mismo contenido.
  await page.getByRole('button', { name: 'Importar .parcify' }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar un proyecto' });
  await dialog.getByTestId('import-file').setInputFiles({ name: archive.name, mimeType: 'application/zip', buffer: archive.file });
  await dialog.getByRole('button', { name: 'Importar y abrir' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  const importedId = new URL(page.url()).pathname.split('/').pop()!;
  expect(importedId).not.toBe(projectId);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await expect.poll(async () => content(await nodes(page))).toEqual(content(original));
});
