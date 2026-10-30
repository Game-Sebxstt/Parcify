import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, createVerifiedAccount } from './helpers/account.ts';
import { joinWorkspace } from './helpers/invite.ts';
import { setOrgAccess, setProjectMember } from './helpers/seed.ts';
import { touchDrag } from './helpers/touch.ts';

async function openEditor(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected' && window.__parcifyTest.synced());
}

const chatWindow = (page: Page) => page.getByTestId('conversation-window');
const pill = (page: Page) => page.getByTestId('conversation-window-pill');
const panel = (page: Page) => page.getByTestId('chat-panel');
const input = (page: Page) => panel(page).getByRole('combobox', { name: 'Mensaje' });
const messageWith = (page: Page, text: string) => panel(page).getByTestId('chat-message').filter({ hasText: text });

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('sin caja');
  return box;
}

// La ventana queda dentro de la vista con 8 px de margen por cada lado (CA-8.1).
function expectInside(box: Box, page: Page) {
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(8 - 0.5);
  expect(box.y).toBeGreaterThanOrEqual(8 - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width - 8 + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height - 8 + 0.5);
}

async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('dos personas chatean en vivo: escribiendo…, respuesta, mención, no leídos en la píldora y recarga con el historial', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `chat-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Chat');
  const otherContext = await browser.newContext();
  const bea = await otherContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Chat');
  await joinWorkspace(page.request, ana.workspaceSlug, bea.request, beaAccount.email);
  const projectId = await createProject(page.request, ana.workspaceSlug, 'Chat compartido');
  await setProjectMember(page.request, projectId, beaAccount.userId, 'viewer');
  await setOrgAccess(page.request, projectId, 'none');

  await openEditor(page, projectId);
  await openEditor(bea, projectId);

  await page.getByTestId('chat-toggle').click();
  await expect(page.getByRole('dialog', { name: 'Chat' })).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(panel(page).getByText('Todavía no hay mensajes')).toBeVisible();

  // Con la ventana cerrada, Bea ve el mensaje como no leído.
  await input(page).fill('Primero, antes de que abras');
  await input(page).press('Enter');
  await expect(messageWith(page, 'Primero, antes de que abras')).toBeVisible();
  await expect(bea.getByRole('button', { name: 'Chat, 1 sin leer' })).toBeVisible();

  await bea.getByTestId('chat-toggle').click();
  await expect(messageWith(bea, 'Primero, antes de que abras')).toBeVisible();
  await expect(bea.getByTestId('chat-unread')).toHaveCount(0);

  // «Escribiendo…» llega por la presencia y se apaga al enviar.
  await input(page).pressSequentially('Hola, Bea');
  await expect(panel(bea).getByTestId('chat-typing')).toHaveText('Ana Chat está escribiendo…');
  await input(page).press('Enter');
  await expect(messageWith(bea, 'Hola, Bea')).toBeVisible();
  await expect(panel(bea).getByTestId('chat-typing')).toHaveText('');

  // Bea (lectora) responde citando y menciona a Ana con el autocompletado, que va en portal encima del campo.
  await messageWith(bea, 'Hola, Bea').hover();
  await messageWith(bea, 'Hola, Bea').getByRole('button', { name: 'Responder a Ana Chat' }).click();
  await expect(panel(bea).getByTestId('chat-replying')).toContainText('Hola, Bea');
  await input(bea).pressSequentially('@an');
  const mentions = bea.getByTestId('chat-mentions');
  await mentions.getByRole('option', { name: 'Ana Chat' }).waitFor();
  const listBox = await boxOf(mentions);
  const fieldBox = await boxOf(input(bea));
  // Por encima de la línea del caret: no tapa lo que se escribe (el campo tiene 8 px de relleno arriba).
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(fieldBox.y + 8);
  expectInside(listBox, bea);
  await input(bea).press('Enter');
  await expect(input(bea)).toHaveValue('@Ana Chat ');
  await input(bea).pressSequentially('mira https://parcify.app');
  await input(bea).press('Enter');

  const reply = messageWith(page, 'mira');
  await expect(reply).toBeVisible();
  await expect(reply.getByTestId('chat-quote')).toContainText('Hola, Bea');
  await expect(reply.getByText('Te menciona.')).toHaveCount(1);
  const link = reply.getByRole('link', { name: 'https://parcify.app' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(link).toHaveAttribute('target', '_blank');

  // Minimizada, la píldora cuenta lo que llega (CA-8.2); al restaurarla queda leído.
  await chatWindow(bea).getByTestId('conversation-window-minimize').click();
  await expect(chatWindow(bea)).toBeHidden();
  await expect(pill(bea)).toBeVisible();
  await input(page).fill('¿Lo ves en la píldora?');
  await input(page).press('Enter');
  await expect(pill(bea).getByTestId('chat-unread')).toHaveText('1');
  await pill(bea).click();
  await expect(messageWith(bea, '¿Lo ves en la píldora?')).toBeVisible();
  await expect(bea.getByTestId('chat-unread')).toHaveCount(0);

  // Al recargar, la ventana sigue abierta y el historial sigue ahí con la cita.
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await expect(chatWindow(page)).toBeVisible();
  await expect(messageWith(page, 'Primero, antes de que abras')).toBeVisible();
  // La respuesta también contiene el texto citado: el original es el primero.
  await expect(messageWith(page, 'Hola, Bea').first()).not.toContainText('mira');
  await expect(messageWith(page, 'mira').getByTestId('chat-quote')).toContainText('Hola, Bea');

  await otherContext.close();
});

test('la ventana del chat no sale de la vista, recuerda su sitio, cabe en 320 px y Esc la minimiza', async ({ page }) => {
  test.setTimeout(90_000);
  const account = await createVerifiedAccount(page.request, `chat-ventana-${test.info().project.name}`, 'Ana Ventana');
  const projectId = await createProject(page.request, account.workspaceSlug, 'Ventana del chat');
  await openEditor(page, projectId);

  const toggle = page.getByTestId('chat-toggle');
  await toggle.click();
  const win = chatWindow(page);
  await expect(win).toBeVisible();
  await expect(win).toHaveAttribute('role', 'dialog');
  await expect(win).toHaveAttribute('aria-modal', 'false');
  const view = page.viewportSize()!;
  const start = await boxOf(win);
  expect(start.width).toBe(380);
  expect(Math.round(view.height - (start.y + start.height))).toBe(72);
  expectInside(start, page);

  // CA-8.1: arrastrada por la cabecera más allá de cada esquina, se queda dentro con 8 px.
  const header = page.getByTestId('conversation-window-header');
  let grip = await boxOf(header);
  await mouseDrag(page, { x: grip.x + 24, y: grip.y + 20 }, { x: view.width + 400, y: view.height + 400 });
  let box = await boxOf(win);
  expectInside(box, page);
  expect(Math.round(box.x + box.width)).toBe(view.width - 8);
  expect(Math.round(box.y + box.height)).toBe(view.height - 8);
  grip = await boxOf(header);
  await mouseDrag(page, { x: grip.x + 24, y: grip.y + 20 }, { x: -400, y: -400 });
  box = await boxOf(win);
  expect(Math.round(box.x)).toBe(8);
  expect(Math.round(box.y)).toBe(8);

  // Redimensionar por la esquina superior izquierda deja quieto el borde opuesto (antes se separa de la esquina).
  await mouseDrag(page, { x: box.x + 24, y: box.y + 20 }, { x: box.x + 224, y: box.y + 170 });
  box = await boxOf(win);
  expectInside(box, page);
  const corner = page.getByTestId('conversation-window-resize-corner');
  const handle = await boxOf(corner);
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  await mouseDrag(page, { x: handle.x + 6, y: handle.y + 6 }, { x: handle.x + 6 - 60, y: handle.y + 6 - 30 });
  const grown = await boxOf(win);
  expect(Math.round(grown.width - box.width)).toBe(60);
  expect(Math.round(grown.height - box.height)).toBe(30);
  expect(Math.round(grown.x + grown.width)).toBe(Math.round(right));
  expect(Math.round(grown.y + grown.height)).toBe(Math.round(bottom));

  // CA-8.4: a 320 px (el mínimo) nada desborda en horizontal, ni con una palabra larga ni con una cita.
  const left = await boxOf(page.getByTestId('conversation-window-resize-left'));
  await mouseDrag(page, { x: left.x + 3, y: left.y + left.height / 2 }, { x: left.x + 600, y: left.y + left.height / 2 });
  await expect.poll(async () => Math.round((await boxOf(win)).width)).toBe(320);
  await input(page).fill(`${'Parcify'.repeat(40)} y una frase normal para ver cómo se reparte en varias líneas`);
  await input(page).press('Enter');
  const long = messageWith(page, 'ParcifyParcify');
  await expect(long).toBeVisible();
  await long.hover();
  await long.getByRole('button', { name: 'Responder a Ana Ventana' }).click();
  await expect(panel(page).getByTestId('chat-replying')).toBeVisible();
  await input(page).fill('Respuesta con cita larga');
  await input(page).press('Enter');
  await expect(messageWith(page, 'Respuesta con cita larga').getByTestId('chat-quote')).toBeVisible();
  const overflow = await win.evaluate((root) => {
    const edge = root.getBoundingClientRect().right;
    const wide = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > edge + 0.5)
      .map((el) => el.dataset.testid ?? el.tagName);
    const scrolling = [root, ...root.querySelectorAll<HTMLElement>('[data-testid="chat-panel"], [data-testid="chat-scroller"]')]
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => el.dataset.testid);
    return { wide, scrolling };
  });
  expect(overflow).toEqual({ wide: [], scrolling: [] });

  // CA-8.3: tras recargar vuelve a su sitio y tamaño; con una vista más pequeña, ajustada a ella.
  const saved = await boxOf(win);
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await expect(win).toBeVisible();
  expect(await boxOf(win)).toEqual(saved);
  grip = await boxOf(header);
  await mouseDrag(page, { x: grip.x + 24, y: grip.y + 20 }, { x: view.width + 400, y: view.height + 400 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.reload();
  await page.waitForFunction(() => window.__parcifyTest?.status() === 'connected');
  await expect(win).toBeVisible();
  expectInside(await boxOf(win), page);

  // CA-8.5: Esc con el foco dentro minimiza y devuelve el foco al botón del chat; la píldora la restaura.
  await input(page).focus();
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
  await expect(pill(page)).toBeVisible();
  await expect(toggle).toBeFocused();
  await pill(page).click();
  await expect(win).toBeVisible();
  await expect(input(page)).toBeFocused();
});

test.describe('@touch chat con el dedo', () => {
  test('en tablet, las asas se agarran desde fuera y las acciones del mensaje se ven y se pulsan sin hover', async ({ page }) => {
    test.skip(test.info().project.name !== 'tablet', 'CA-8.6 en tablet; la hoja móvil llega con T8.3');
    test.setTimeout(90_000);
    const account = await createVerifiedAccount(page.request, `chat-tactil-${test.info().project.name}`, 'Ana Táctil');
    const projectId = await createProject(page.request, account.workspaceSlug, 'Chat táctil');
    await openEditor(page, projectId);

    await page.getByTestId('chat-toggle').tap();
    const win = chatWindow(page);
    await expect(win).toBeVisible();
    await input(page).fill('Mensaje para responder');
    await input(page).press('Enter');
    const message = messageWith(page, 'Mensaje para responder');
    await expect(message).toBeVisible();

    // Las acciones van en una fila bajo la burbuja, visibles sin hover, y se pulsan con un toque.
    const actions = message.getByTestId('chat-actions');
    await expect(actions).toBeVisible();
    expect(await actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const bubble = await boxOf(message.getByTestId('chat-bubble'));
    const row = await boxOf(actions);
    expect(row.y).toBeGreaterThanOrEqual(bubble.y + bubble.height - 0.5);
    const replyButton = actions.getByRole('button', { name: 'Responder a Ana Táctil' });
    expect(Math.round((await boxOf(replyButton)).width)).toBe(32);
    await replyButton.tap();
    await expect(panel(page).getByTestId('chat-replying')).toContainText('Mensaje para responder');

    // Con el dedo, el borde izquierdo se agarra desde 10 px por fuera de la línea.
    const before = await boxOf(win);
    const at = { x: before.x - 10, y: before.y + before.height / 2 };
    await touchDrag(page, at, { x: at.x - 80, y: at.y });
    await expect.poll(async () => Math.round((await boxOf(win)).width - before.width)).toBe(80);
    const after = await boxOf(win);
    expect(Math.round(after.x + after.width)).toBe(Math.round(before.x + before.width));

    // Y la cabecera arrastra la ventana.
    const header = await boxOf(page.getByTestId('conversation-window-header'));
    await touchDrag(page, { x: header.x + 24, y: header.y + 20 }, { x: header.x - 100, y: header.y - 100 });
    await expect.poll(async () => Math.round((await boxOf(win)).x)).toBe(Math.max(8, Math.round(after.x - 124)));
  });
});
