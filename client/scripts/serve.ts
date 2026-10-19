import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { parseArgs } from 'node:util';

// Sirve dist/ con las mismas reescrituras y cabeceras que el Caddyfile. Lo usan los e2e y el benchmark:
// `astro preview` no aplica los plugins de Vite, así que no reescribe /p/:id ni /app/e/:slug.
const { values } = parseArgs({ options: { port: { type: 'string', default: '4321' }, host: { type: 'string', default: 'localhost' } } });
const root = resolve('dist');
// La CSP de los workers sale del build (astro.config.ts), como en Caddy.
const workerCspFile = resolve('dist-meta', 'worker-csp.txt');
if (!existsSync(workerCspFile)) {
  console.error('Falta dist-meta/worker-csp.txt: ejecuta npm run build');
  process.exit(1);
}
const WORKER_CSP = readFileSync(workerCspFile, 'utf8').trim();
const WORKER_PATH = /^\/_astro\/[^/]+\.worker-[^/]+\.js$/;

const REWRITES: Array<[RegExp, string]> = [
  [/^\/p\/[0-9a-f-]{36}\/?$/, '/p/index.html'],
  [/^\/app\/e\/[a-z0-9-]{1,48}\/?$/, '/app/e/index.html'],
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'microphone=(self), camera=(), geolocation=(), payment=()',
};

function fileFor(pathname: string): string | null {
  const candidates = [pathname, `${pathname.replace(/\/$/, '')}/index.html`, `${pathname}.html`];
  for (const candidate of candidates) {
    const full = normalize(join(root, candidate));
    if (full !== root && !full.startsWith(root + sep)) return null;
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      // No existe: se prueba el siguiente.
    }
  }
  return null;
}

createServer((request, response) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const rewritten = REWRITES.find(([pattern]) => pattern.test(pathname))?.[1] ?? pathname;
  const file = fileFor(rewritten);
  const status = file ? 200 : 404;
  const target = file ?? join(root, '404.html');
  const hashed = pathname.startsWith('/_astro/') || pathname.startsWith('/fonts/');
  response.writeHead(status, {
    ...HEADERS,
    ...(WORKER_PATH.test(pathname) ? { 'content-security-policy': WORKER_CSP } : {}),
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  // pipeline cierra los dos extremos si el navegador corta la descarga, sin tumbar el proceso.
  pipeline(createReadStream(target), response, () => {});
})
  .on('clientError', (_error, socket) => socket.destroy())
  .listen(Number(values.port), values.host, () => {
  console.log(`dist/ en http://${values.host}:${values.port}`);
});
