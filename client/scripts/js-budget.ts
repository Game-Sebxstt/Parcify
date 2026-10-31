import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve('dist');
const KB = 1024;
// JS que descarga cada página antes de cualquier import() dinámico, siguiendo los import estáticos.
// Las páginas de /app pintan al cargar controles de bits-ui con Floating UI (Select, menús, tooltips, pestañas y
// casillas) en la barra lateral, el orden y las tarjetas: unos 40 KB gzip que van en el JS inicial.
const APP_LIMIT = 175 * KB;
const BUDGETS: Array<{ page: string; label: string; limit: number }> = [
  { page: 'index.html', label: '/', limit: 60 * KB },
  { page: 'app/index.html', label: '/app', limit: APP_LIMIT },
  { page: 'app/e/index.html', label: '/app/e/:slug', limit: APP_LIMIT },
  { page: 'app/ajustes/index.html', label: '/app/ajustes', limit: APP_LIMIT },
  { page: 'p/index.html', label: '/p/:id', limit: 600 * KB },
];

const STATIC_IMPORT = /(?:^|[;\s}])import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+\.js)["']|(?:^|[;\s}])export\s*[\w*{}\s,$]*from\s*["']([^"']+\.js)["']/g;

function entries(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:src|component-url|renderer-url)="(\/_astro\/[^"]+\.js)"/g)) found.add(match[1]!);
  for (const match of html.matchAll(/import\s*["'](\/_astro\/[^"']+\.js)["']/g)) found.add(match[1]!);
  return [...found];
}

function collect(url: string, seen: Set<string>) {
  if (seen.has(url)) return;
  const file = join(dist, url);
  if (!existsSync(file)) return;
  seen.add(url);
  const code = readFileSync(file, 'utf8');
  for (const match of code.matchAll(STATIC_IMPORT)) {
    const target = match[1] ?? match[2];
    if (!target) continue;
    const next = target.startsWith('/') ? target : new URL(target, `https://x${url}`).pathname;
    collect(next, seen);
  }
}

let failed = false;
for (const budget of BUDGETS) {
  const htmlFile = join(dist, budget.page);
  if (!existsSync(htmlFile)) {
    console.log(`${budget.label}: sin build`);
    continue;
  }
  const seen = new Set<string>();
  for (const entry of entries(readFileSync(htmlFile, 'utf8'))) collect(entry, seen);
  const size = [...seen].reduce((total, url) => total + gzipSync(readFileSync(join(dist, url))).length, 0);
  const ok = size <= budget.limit;
  failed ||= !ok;
  if (process.argv.includes('--files')) {
    for (const url of seen) console.log(`      ${(gzipSync(readFileSync(join(dist, url))).length / KB).toFixed(1).padStart(6)} KB  ${url}`);
  }
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${budget.label.padEnd(14)} ${(size / KB).toFixed(1).padStart(6)} KB gzip de ${(budget.limit / KB).toFixed(0)} KB (${seen.size} archivos)`,
  );
}
process.exit(failed ? 1 : 0);
