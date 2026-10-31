import { readFileSync } from 'node:fs';
import { COLLAB_COLORS } from '../src/shared/collab-colors.ts';

const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const tokens = new Map<string, string>();
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
  tokens.set(match[1]!, match[2]!.toLowerCase());
}

function color(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Falta el token --color-${name} en src/styles/app.css`);
  return value;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Luminosidad perceptual OKLab (L de OKLCH).
export function oklchLightness(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617813 * m - 0.0040720468 * s;
}

type Check = { label: string; ratio: number; min: number };
const checks: Check[] = [];
const TEXT = 4.5;
const UI = 3;

function pair(fg: string, bg: string, min: number) {
  checks.push({ label: `${fg} sobre ${bg}`, ratio: contrast(color(fg), color(bg)), min });
}

const surfaces = ['ground', 'surface-1', 'surface-2'];
for (const bg of [...surfaces, 'petrol']) pair('ink', bg, TEXT);
for (const fg of ['ink-muted', 'coral', 'sage', 'danger']) for (const bg of surfaces) pair(fg, bg, TEXT);
for (const bg of ['coral', 'coral-hover', 'danger', 'sage']) pair('coral-ink', bg, TEXT);
for (const fg of ['coral', 'edge']) for (const bg of surfaces) pair(fg, bg, UI);
// Filas seleccionadas y estados en petrol: texto apagado (enviar deshabilitado) y foco coral encima.
pair('ink-muted', 'petrol', TEXT);
pair('coral', 'petrol', UI);
// Píldora de giro imantada: texto ground sobre salvia.
pair('ground', 'sage', TEXT);

const ground = color('ground');
for (const hex of COLLAB_COLORS) {
  checks.push({ label: `colaborador ${hex} sobre ground`, ratio: contrast(hex, ground), min: UI });
}

let failed = 0;
for (const check of checks) {
  const ok = check.ratio >= check.min;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${check.label}: ${check.ratio.toFixed(2)}:1 (mínimo ${check.min}:1)`);
}

for (const hex of COLLAB_COLORS) {
  const lightness = oklchLightness(hex);
  const ok = Math.abs(lightness - 0.72) <= 0.02;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} colaborador ${hex}: L OKLCH ${lightness.toFixed(3)} (0,72 ± 0,02)`);
}

if (failed > 0) {
  console.error(`${failed} comprobaciones de contraste fallan.`);
  process.exit(1);
}
console.log(`${checks.length + COLLAB_COLORS.length} comprobaciones de contraste en verde.`);
