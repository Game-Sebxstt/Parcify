import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Capturas del producto para la landing. Necesita el entorno de los e2e recién levantado
// (stack de pruebas, `npm run start:e2e` en el servidor y el build servido en 4321 con PUBLIC_TEST_HOOKS=1).
const SITE = 'http://localhost:4321';
const API = 'http://localhost:3000';
const ORIGIN = { origin: SITE };
const OUT = resolve('public/landing');
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

let lastIp = 0;
const clientHeaders = () => ({ ...ORIGIN, 'x-forwarded-for': `10.20.${Math.floor(++lastIp / 250)}.${(lastIp % 250) + 1}` });

async function ok<T extends { ok(): boolean; text(): Promise<string> }>(response: T): Promise<T> {
  if (!response.ok()) throw new Error(await response.text());
  return response;
}

async function account(request: APIRequestContext, name: string, email: string) {
  const headers = clientHeaders();
  // La cuenta puede existir de una ejecución anterior con el mismo stack.
  const signIn = await request.post(`${API}/api/auth/sign-in/email`, { headers, data: { email, password: 'clave-de-prueba-1' } });
  if (signIn.ok()) return me(request, email);
  await ok(await request.post(`${API}/api/auth/sign-up/email`, { headers, data: { name, email, password: 'clave-de-prueba-1' } }));
  let code: string | null = null;
  for (let i = 0; i < 60 && !code; i++) {
    const response = await request.get(`${API}/v1/__test/mail`, { params: { to: email } });
    const { messages } = (await response.json()) as { messages: Array<{ subject: string; text: string }> };
    code = messages.filter((mail) => /es tu código de Parcify/.test(mail.subject)).at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
    if (!code) await sleep(250);
  }
  await ok(await request.post(`${API}/api/auth/email-otp/verify-email`, { headers, data: { email, otp: code } }));
  return me(request, email);
}

async function me(request: APIRequestContext, email: string) {
  const body = (await (await request.get(`${API}/v1/me`)).json()) as { user: { id: string }; workspaces: Array<{ slug: string; personal: boolean }> };
  return { email, userId: body.user.id, slug: body.workspaces.find((workspace) => workspace.personal)!.slug };
}

// Invitar a quien ya es miembro devuelve conflicto: en una segunda ejecución se sigue adelante.
async function joinIfNeeded(owner: APIRequestContext, slug: string, invitee: APIRequestContext, email: string, role: 'admin' | 'member') {
  try {
    await joinWorkspace(owner, slug, invitee, email, role);
  } catch (error) {
    if (!String(error).includes('CONFLICT')) throw error;
  }
}

async function joinWorkspace(owner: APIRequestContext, slug: string, invitee: APIRequestContext, email: string, role: 'admin' | 'member') {
  const created = await ok(await owner.post(`${API}/v1/workspaces/${slug}/invitations`, { headers: ORIGIN, data: { email, role } }));
  const { id } = (await created.json()) as { id: string };
  await ok(await invitee.post(`${API}/v1/workspace-invitations/${id}/accept`, { headers: clientHeaders() }));
}

async function openEditor(page: Page, projectId: string) {
  await page.goto(`${SITE}/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
  await sleep(400);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function shape(page: Page, tool: string, from: { x: number; y: number }, to: { x: number; y: number }, color: string) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  await drag(page, from, to);
  await sleep(150);
  await page.locator('input[type=color][aria-label="Relleno"]').first().fill(color);
  await sleep(150);
}

// Recorte de la unión de varios elementos, con margen.
async function shot(page: Page, name: string, targets: Locator[], pad = 12) {
  const boxes = await Promise.all(targets.map(async (target) => (await target.boundingBox())!));
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + pad;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x, y, width: right - x, height: bottom - y }, animations: 'disabled' });
  console.log(`${name}.png`);
}

// Recorte de la zona del lienzo que ocupan los nodos, en coordenadas de la página.
async function canvasShot(page: Page, name: string, pad = 0) {
  const area = await page.evaluate(() => {
    const hooks = window.__parcifyTest!;
    const nodes = hooks.nodes();
    const corners = nodes.flatMap((node) => [hooks.toPage(node.x, node.y), hooks.toPage(node.x + node.w, node.y + node.h)]);
    return {
      x: Math.min(...corners.map((point) => point.x)),
      y: Math.min(...corners.map((point) => point.y)),
      right: Math.max(...corners.map((point) => point.x)),
      bottom: Math.max(...corners.map((point) => point.y)),
    };
  });
  const clip = { x: area.x - pad, y: area.y - pad, width: area.right - area.x + pad * 2, height: area.bottom - area.y + pad * 2 };
  await page.screenshot({ path: `${OUT}/${name}.png`, clip, animations: 'disabled' });
  console.log(`${name}.png`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const options = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' } as const;
  const [anaContext, beaContext, carlaContext] = await Promise.all([browser.newContext(options), browser.newContext(options), browser.newContext(options)]);
  const ana = await anaContext.newPage();
  const bea = await beaContext.newPage();
  const carla = await carlaContext.newPage();
  const anaAccount = await account(ana.request, 'Ana Ruiz', 'ana@example.com');
  const beaAccount = await account(bea.request, 'Bea Marín', 'bea@example.com');
  const carlaAccount = await account(carla.request, 'Carla Soto', 'carla@example.com');
  await joinIfNeeded(ana.request, anaAccount.slug, bea.request, beaAccount.email, 'admin');
  await joinIfNeeded(ana.request, anaAccount.slug, carla.request, carlaAccount.email, 'member');
  const created = await ok(await ana.request.post(`${API}/v1/workspaces/${anaAccount.slug}/projects`, { headers: ORIGIN, data: { name: 'Cartel de otoño' } }));
  const { id: projectId } = (await created.json()) as { id: string };
  await ok(await ana.request.put(`${API}/v1/projects/${projectId}/members/${beaAccount.userId}`, { headers: ORIGIN, data: { role: 'editor' } }));
  await ok(await ana.request.put(`${API}/v1/projects/${projectId}/members/${carlaAccount.userId}`, { headers: ORIGIN, data: { role: 'viewer' } }));
  // Sin acceso por el espacio, Carla se queda con su rol de lectura.
  await ok(await ana.request.patch(`${API}/v1/projects/${projectId}`, { headers: ORIGIN, data: { orgAccess: 'none' } }));

  // Ana dibuja un cartel con las piezas del logo.
  await openEditor(ana, projectId);
  const canvas = ana.getByRole('application', { name: 'Lienzo del proyecto' });
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await shape(ana, 'Rectángulo (R)', { x: cx - 260, y: cy - 170 }, { x: cx + 260, y: cy + 170 }, '#122136');
  await shape(ana, 'Elipse (O)', { x: cx - 220, y: cy - 130 }, { x: cx, y: cy + 90 }, '#fb8f5a');
  await shape(ana, 'Elipse (O)', { x: cx - 170, y: cy - 80 }, { x: cx - 50, y: cy + 40 }, '#000b1d');
  await shape(ana, 'Estrella', { x: cx - 128, y: cy - 38 }, { x: cx - 92, y: cy - 2 }, '#aad696');
  await shape(ana, 'Rectángulo (R)', { x: cx + 40, y: cy - 110 }, { x: cx + 220, y: cy - 70 }, '#eef2f6');
  await shape(ana, 'Rectángulo (R)', { x: cx + 40, y: cy - 40 }, { x: cx + 190, y: cy - 24 }, '#244355');
  await shape(ana, 'Rectángulo (R)', { x: cx + 40, y: cy - 8 }, { x: cx + 160, y: cy + 8 }, '#244355');
  await shape(ana, 'Rectángulo (R)', { x: cx + 40, y: cy + 70 }, { x: cx + 170, y: cy + 110 }, '#aad696');

  // Propiedades de la elipse coral con la opacidad al 72 %.
  await ana.mouse.click(cx - 200, cy - 10);
  await sleep(200);
  const opacity = ana.getByRole('slider', { name: /Opacidad/ });
  await opacity.fill('72');
  await opacity.dispatchEvent('change');
  await sleep(300);
  await shot(ana, 'detalle-opacidad', [ana.getByText('Opacidad', { exact: true }), opacity], 14);
  await opacity.fill('100');
  await opacity.dispatchEvent('change');
  await canvas.focus();
  await ana.keyboard.press('Escape');

  await shot(ana, 'detalle-herramientas', [
    ana.getByRole('button', { name: 'Seleccionar (V)', exact: true }),
    ana.getByRole('button', { name: 'Elipse (O)', exact: true }),
  ]);

  // Bea entra, selecciona la estrella y se acerca al título; Carla entra solo a mirar.
  await openEditor(bea, projectId);
  await openEditor(carla, projectId);
  const beaBox = (await bea.getByRole('application', { name: 'Lienzo del proyecto' }).boundingBox())!;
  const bx = beaBox.x + beaBox.width / 2;
  const by = beaBox.y + beaBox.height / 2;
  await bea.mouse.click(bx - 110, by - 20);
  await bea.mouse.move(bx + 30, by + 50, { steps: 8 });
  await sleep(1_000);
  await canvasShot(ana, 'en-vivo-cursores');
  const presence = ana.getByRole('list', { name: 'Personas en el proyecto' });
  await shot(ana, 'en-vivo-presencia', [ana.getByTestId('connection-status'), presence, ana.getByTestId('share')]);
  await shot(ana, 'detalle-presencia', [presence], 10);
  await shot(ana, 'en-vivo-deshacer', [ana.getByRole('button', { name: 'Deshacer (Ctrl+Z)' }), ana.getByRole('button', { name: 'Rehacer (Ctrl+Shift+Z)' })], 2);
  await shot(ana, 'detalle-zoom', [ana.getByRole('button', { name: 'Alejar' }), ana.getByRole('button', { name: 'Encajar todo (Shift+1)' })], 2);
  await shot(carla, 'detalle-solo-lectura', [carla.getByRole('link', { name: 'Volver a tus proyectos' }), carla.getByText('Solo lectura', { exact: true })], 10);

  await beaContext.setOffline(true);
  await bea.getByTestId('connection-status').getByText(/Sin conexión/).waitFor({ timeout: 30_000 });
  await shot(bea, 'detalle-sin-conexion', [bea.getByTestId('connection-status')], 12);
  await beaContext.setOffline(false);

  // Asistente: la petición, la vista previa y el cambio aplicado.
  await ana.getByTestId('ai-toggle').click();
  const panel = ana.getByTestId('ai-panel');
  await panel.getByTestId('ai-prompt').fill('Añade un rectángulo naranja');
  await sleep(300);
  await shot(ana, 'ia-pedir', [panel.getByText('¿Qué cambio quieres en el lienzo?'), panel.getByTestId('ai-submit')], 16);
  await panel.getByTestId('ai-submit').click();
  const preview = panel.getByTestId('ai-preview');
  await preview.waitFor();
  await sleep(400);
  await shot(ana, 'ia-vista-previa', [preview], 12);
  await preview.getByTestId('ai-apply').click();
  await ana.getByTestId('ai-toggle').click();
  await sleep(800);
  await canvasShot(ana, 'ia-hecho');
  await canvas.focus();
  await ana.keyboard.press('Control+z');

  // Timeline con la animación propuesta para el botón verde.
  // Con el foco en el lienzo, Shift+Tab selecciona el nodo de arriba del todo: el botón verde.
  await ana.waitForFunction(() => window.__parcifyTest!.nodes().length === 9);
  await canvas.focus();
  await ana.keyboard.press('Escape');
  await ana.keyboard.press('Shift+Tab');
  await ana.waitForFunction(() => window.__parcifyTest!.selection().length === 1);
  await ana.getByRole('button', { name: 'Mostrar la línea de tiempo' }).click();
  const timeline = ana.getByTestId('timeline');
  await timeline.getByTestId('timeline-ai').click();
  const animate = timeline.getByTestId('ai-animate');
  await animate.getByTestId('ai-animate-prompt').fill('Que entre desde la izquierda');
  await animate.getByTestId('ai-animate-submit').click();
  await animate.getByTestId('ai-animate-apply').click({ timeout: 8_000 }).catch(async (error: unknown) => {
    await ana.screenshot({ path: '.taste-skill/fallo.png' });
    throw error;
  });
  const close = timeline.getByRole('button', { name: 'Cerrar «Animar con IA»' });
  if (await close.isVisible()) await close.click();
  // Los avisos de «aplicado» tapan el panel: se espera a que caduquen.
  await sleep(6_500);
  await shot(ana, 'detalle-timeline', [timeline], 0);

  // Miembros del espacio.
  await ana.setViewportSize({ width: 800, height: 900 });
  await ana.goto(`${SITE}/app/e/${anaAccount.slug}?vista=miembros`);
  const members = ana.getByRole('list', { name: 'Miembros' });
  await members.getByRole('listitem').nth(2).waitFor();
  await sleep(400);
  await shot(ana, 'espacios-miembros', [members], 0);
} finally {
  await browser.close();
}
