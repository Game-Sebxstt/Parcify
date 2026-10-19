import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { BenchInfo, ScenarioResult } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CI_MODE = process.env.PARCIFY_BENCH_MODE === 'ci';
const SCENARIOS = ['open', 'drag-100', 'pan-zoom', 'drag-all', 'remote-burst', 'anim-500'] as const;
const GESTURES = ['drag-100', 'pan-zoom'] as const;
// Arrastre de los 1.200 nodos: 40 fps.
const DRAG_ALL_BUDGET_MS = 25;
const THUMB_BUDGET_MS = 2_000;
const BENCH_NODES = 1200;

// Objetivos de §4.12 para la máquina de referencia.
const FRAME_BUDGET_MS = 16.7;
const VSYNC_JITTER_MS = 0.5;
const WORK_BUDGET_MS = 6;
const CI_WORK_BUDGET_MS = WORK_BUDGET_MS * 1.5;
const CI_REGRESSION = 1.2;
const DRAW_CALLS_MAX = 120;
const REMOTE_BURST_BUDGET_MS = 4;
const OPEN_BUDGET_MS = 800;
// Escenarios con regresión en bench:ci: trabajo JS de los gestos y coste del update remoto.
const CI_TRACKED = [...GESTURES, 'drag-all', 'remote-burst'] as const;
const REFERENCE = join(here, 'reference', 'ci.json');

type Report = { date: string; host: string; mode: 'local' | 'ci'; info: BenchInfo; results: ScenarioResult[] };

test('benchmark del lienzo con 1.000 formas y 200 imágenes', async ({ page }) => {
  if (CI_MODE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  // PARCIFY_BENCH_RENDERER=webgpu mide el otro backend (§4.2).
  await page.goto(`/_bench${process.env.PARCIFY_BENCH_RENDERER === 'webgpu' ? '?renderer=webgpu' : ''}`);
  await page.waitForFunction(() => window.__bench !== undefined);
  await page.evaluate(() => window.__bench!.ready);

  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    results.push(await page.evaluate((name) => window.__bench!.run(name), scenario));
  }
  results.push(await page.evaluate(() => window.__bench!.run('baseline', { warmupMs: 500, durationMs: 4_000 })));
  // Referencia del coste de GPU: la misma vista que drag-100 redibujada en cada frame sin trabajo del motor.
  results.push(await page.evaluate(() => window.__bench!.run('redraw')));
  const info = await page.evaluate(() => window.__bench!.info());

  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const report: Report = { date, host: hostname(), mode: CI_MODE ? 'ci' : 'local', info, results };
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', `${date}-${report.host}${CI_MODE ? '-ci' : ''}.json`), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nRenderer ${info.renderer}, ${info.nodes} nodos, ${info.width}×${info.height} a dpr ${info.dpr}`);
  for (const cause of info.idleCauses) console.log(`Frame con el lienzo quieto pedido desde: ${cause}`);
  for (const r of results) {
    const phases = Object.entries(r.phases ?? {}).map(([name, value]) => `${name} ${value}`).join(', ');
    const extra = Object.entries(r.extra ?? {}).map(([name, value]) => `${name} ${value}`).join(', ');
    console.log(
      `${r.scenario.padEnd(13)} frame p50 ${r.frame.p50} p95 ${r.frame.p95} max ${r.frame.max} | js p95 ${r.work.p95} max ${r.work.max} | render p95 ${r.render.p95} | entrada p95 ${r.input?.p95 ?? 0} max ${r.input?.max ?? 0} | draw calls ${r.drawCallsMax} | perdidos ${r.droppedPct ?? 0} % | long tasks ${r.longTasks} | renders quieto ${r.idleRenders} | frames quieto ${r.idleFrames}${phases ? ` | fases p95: ${phases}` : ''}${extra ? ` | ${extra}` : ''}`,
    );
  }

  const byName = new Map(results.map((r) => [r.scenario, r]));
  expect(info.nodes).toBe(BENCH_NODES);
  for (const result of results) {
    expect(result.idleRenders, `${result.scenario}: renders con el lienzo quieto`).toBe(0);
    expect(result.idleFrames, `${result.scenario}: frames del planificador con el lienzo quieto`).toBe(0);
    // No depende de la GPU: una regresión de batching falla aquí y no como «GPU ocupada».
    expect(result.drawCallsMax, `${result.scenario}: draw calls por frame`).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  }
  const burstP95 = byName.get('remote-burst')!.extra!.burstP95!;

  if (!CI_MODE) {
    // Si la escena quieta redibujada en cada frame ya pierde frames, la GPU está ocupada por otra cosa
    // y la medición de los gestos no dice nada del motor.
    // Antes, el trabajo JS de redraw: una regresión del motor en la ruta de cámara no debe pasar por GPU ocupada.
    const redraw = byName.get('redraw')!;
    expect(redraw.work.p95, 'redraw: p95 de trabajo JS').toBeLessThanOrEqual(WORK_BUDGET_MS);
    expect(redraw.droppedPct ?? 0, 'redraw pierde frames sin trabajo del motor: la GPU está ocupada, repite la medición').toBeLessThanOrEqual(5);
    // El delta entre rAF de una pantalla de 60 Hz fluctúa unas décimas sobre 16,7 ms aunque no haya trabajo.
    // El límite es el mayor entre 16,7 ms y el p95 del lienzo quieto, más 0,5 ms de esa fluctuación; un frame
    // perdido mide ~33 ms, así que el margen no oculta ninguno.
    const budget = Math.max(FRAME_BUDGET_MS, byName.get('baseline')!.frame.p95) + VSYNC_JITTER_MS;
    console.log(`Límite de frame p95: ${budget} ms (p95 del lienzo quieto ${byName.get('baseline')!.frame.p95} ms)`);
    for (const name of GESTURES) {
      const result = byName.get(name)!;
      expect(result.frame.p95, `${name}: p95 de frame`).toBeLessThanOrEqual(budget);
      expect(result.frame.max, `${name}: ningún frame de más de 50 ms`).toBeLessThanOrEqual(50);
      expect(result.work.p95, `${name}: p95 de trabajo JS`).toBeLessThanOrEqual(WORK_BUDGET_MS);
    }
    // 500 nodos animados a 60 fps.
    expect(byName.get('anim-500')!.frame.p95, 'anim-500: p95 de frame').toBeLessThanOrEqual(budget);
    const dragAll = byName.get('drag-all')!;
    expect(dragAll.frame.p95, 'drag-all: p95 de frame').toBeLessThanOrEqual(DRAG_ALL_BUDGET_MS);
    expect(burstP95, 'remote-burst: p95 de aplicar el update más el frame que lo pinta').toBeLessThanOrEqual(REMOTE_BURST_BUDGET_MS);
    expect(byName.get('open')!.extra!.openMs!, 'open: abrir el documento').toBeLessThanOrEqual(OPEN_BUDGET_MS);
    expect(byName.get('open')!.extra!.thumbMs!, 'open: todas las imágenes en miniatura').toBeLessThanOrEqual(THUMB_BUDGET_MS);
    return;
  }

  const current: Record<string, number> = Object.fromEntries([...GESTURES, 'drag-all'].map((name) => [name, byName.get(name)!.work.p95]));
  for (const name of GESTURES) expect(current[name]!, `${name}: trabajo JS con CPU ×4`).toBeLessThanOrEqual(CI_WORK_BUDGET_MS);
  current['remote-burst'] = burstP95;
  if (existsSync(REFERENCE) && process.env.PARCIFY_BENCH_UPDATE !== '1') {
    const reference = JSON.parse(readFileSync(REFERENCE, 'utf8')) as { work: Record<string, number> };
    for (const name of CI_TRACKED) {
      const previous = reference.work[name];
      expect(previous, `${name}: falta en la referencia, regenérala con PARCIFY_BENCH_UPDATE=1`).toBeGreaterThan(0);
      expect(current[name]!, `${name}: regresión frente a la referencia (${previous} ms)`).toBeLessThanOrEqual(previous! * CI_REGRESSION);
    }
  } else {
    mkdirSync(dirname(REFERENCE), { recursive: true });
    writeFileSync(REFERENCE, `${JSON.stringify({ date, host: report.host, work: current }, null, 2)}\n`);
  }
});
