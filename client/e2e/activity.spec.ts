import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import type { ProjectActivityResponse } from '../src/shared/api/activity.ts';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';
import { pickTool } from './helpers/tools.ts';

const API = 'http://localhost:3000';

type Node = { id: string };

const nodes = (page: Page) => page.evaluate(() => window.__parcifyTest!.nodes() as unknown as Node[]);

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await page.waitForTimeout(100);
}

// `tool` es el nombre de una forma del grupo Formas de la barra de herramientas.
async function draw(page: Page, tool: string, dx: number) {
  const box = (await page.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  const from = { x: box.x + box.width / 2 - 200 + dx, y: box.y + box.height / 2 - 100 };
  await pickTool(page, 'Formas', tool);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });
  await page.mouse.move(from.x + 120, from.y + 80, { steps: 4 });
  await page.mouse.up();
}

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5) }));
}

// Cualquier envío del navegador que parezca una métrica: la actividad solo se lee (GET) y la calcula el servidor.
const METRIC = /activ|metric|telemetr|analytic|track|beacon|stats/i;

test('la pestaña de actividad muestra las ediciones que contó el servidor, sin duplicar pestañas', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const label = `activity-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Mide');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Mide');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Cartel medido');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'editor');
  await setOrgAccess(page.request, projectId, 'none');

  const sent: string[] = [];
  const record = (request: Request) => {
    if (request.method() !== 'GET' || request.resourceType() === 'ping') sent.push(`${request.method()} ${request.url()}`);
  };
  const anaTab2 = await page.context().newPage();
  for (const tab of [page, anaTab2, bea]) tab.on('request', record);

  // Ana con dos pestañas del mismo proyecto; crea en una y la otra solo recibe el cambio.
  await openEditor(page, projectId);
  await openEditor(anaTab2, projectId);
  await openEditor(bea, projectId);
  await draw(page, 'Rectángulo', 0);
  await expect.poll(async () => (await nodes(anaTab2)).length).toBe(1);
  await draw(bea, 'Elipse', 220);
  await expect.poll(async () => (await nodes(page)).length).toBe(2);
  await expect.poll(async () => (await nodes(anaTab2)).length).toBe(2);
  // Cursor de la segunda pestaña: no abre otro minuto si cae en el mismo.
  await anaTab2.mouse.move(300, 300, { steps: 3 });
  await anaTab2.waitForTimeout(300);

  // Al cerrar todo, el documento se descarga y el servidor vuelca los contadores.
  await anaTab2.close();
  await otherContext.close();
  await page.goto('/app');
  let report: ProjectActivityResponse | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${API}/v1/projects/${projectId}/activity`);
        report = (await response.json()) as ProjectActivityResponse;
        return report.byUser.map((row) => [row.userId, row.nodesCreated]).sort();
      },
      { timeout: 45_000 },
    )
    .toEqual([[ana.userId, 1], [beaAccount.userId, 1]].sort());
  const anaRow = report!.byUser.find((row) => row.userId === ana.userId)!;
  const beaRow = report!.byUser.find((row) => row.userId === beaAccount.userId)!;
  // Dos pestañas de Ana: un solo nodo creado y como mucho un minuto por minuto de reloj transcurrido.
  expect(anaRow.editOps).toBeGreaterThan(0);
  expect(anaRow.activeMinutes).toBeGreaterThanOrEqual(1);
  expect(anaRow.activeMinutes).toBeLessThanOrEqual(3);
  expect(beaRow.editOps).toBeGreaterThan(0);
  expect(report!.totals.editOps).toBe(anaRow.editOps + beaRow.editOps);
  expect(report!.nodeCountByType).toMatchObject({ rect: 1, ellipse: 1 });

  // La pestaña del espacio y la del proyecto enseñan esos números.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/app/e/${ana.workspaceSlug}?vista=actividad`);
  await expect(page.getByRole('tab', { name: 'Actividad' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Resumen del periodo' })).toBeVisible();
  const projects = page.getByRole('table', { name: 'Por proyecto' });
  await expect(projects.getByRole('row', { name: /Cartel medido/ })).toBeVisible();
  await projects.getByRole('button', { name: 'Ver la actividad de Cartel medido' }).click();
  await expect(page).toHaveURL(new RegExp(`proyecto=${projectId}`));
  await expect(page.getByRole('heading', { level: 2, name: 'Cartel medido' })).toBeVisible();

  const people = page.getByRole('table', { name: 'Por colaborador' });
  for (const [name, row] of [['Ana Mide', anaRow], ['Bea Mide', beaRow]] as const) {
    const cells = people.getByRole('row', { name: new RegExp(name) }).getByRole('cell');
    // Columnas: ediciones, minutos, sesiones, creados.
    await expect(cells.nth(0)).toHaveText(String(row.editOps));
    await expect(cells.nth(1)).toHaveText(String(row.activeMinutes));
    await expect(cells.nth(3)).toHaveText('1');
  }
  const totals = page.getByRole('region', { name: 'Resumen del periodo' });
  await expect(totals.getByText(String(report!.totals.editOps), { exact: true }).first()).toBeVisible();

  // Cada gráfico tiene nombre accesible y su tabla equivalente.
  await expect(page.getByRole('img', { name: 'Ediciones por día y colaborador' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Minutos con actividad por día' })).toBeVisible();
  for (const summary of await page.getByText('Ver los datos en una tabla').all()) await summary.click();
  const editsTable = page.getByRole('table', { name: /^Ediciones por día y colaborador/ });
  await expect(editsTable.getByRole('columnheader', { name: 'Ana Mide' })).toBeVisible();
  await expect(editsTable.getByRole('columnheader', { name: 'Bea Mide' })).toBeVisible();
  await expect(page.getByRole('table', { name: /^Minutos con actividad por día/ }).getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Historial' }).getByText('Ana Mide creó el proyecto')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  // Ningún envío del navegador fue una métrica.
  expect(sent.filter((line) => METRIC.test(line))).toEqual([]);
});
