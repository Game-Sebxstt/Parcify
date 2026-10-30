import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import svelte from '@astrojs/svelte';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import type { AstroIntegration } from 'astro';
import type { Plugin as VitePlugin } from 'vite';
import { SIDEBAR_BOOT_HASH } from './src/layouts/sidebar-boot.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = {
  apiOrigin: process.env.PUBLIC_API_ORIGIN || 'http://localhost:3000',
  collabOrigin: process.env.PUBLIC_COLLAB_ORIGIN || 'http://localhost:3001',
  siteOrigin: process.env.PUBLIC_SITE_ORIGIN || 'http://localhost:4321',
  storageOrigin: process.env.PUBLIC_STORAGE_ORIGIN || process.env.PUBLIC_API_ORIGIN || 'http://localhost:3000',
  // Sentry recibe los errores en el origen de su DSN; sin DSN no entra en la CSP.
  sentryOrigin: process.env.PUBLIC_SENTRY_DSN ? new URL(process.env.PUBLIC_SENTRY_DSN).origin : '',
};
process.env.PUBLIC_API_ORIGIN = env.apiOrigin;
process.env.PUBLIC_COLLAB_ORIGIN = env.collabOrigin;
process.env.PUBLIC_SITE_ORIGIN = env.siteOrigin;
process.env.PUBLIC_STORAGE_ORIGIN = env.storageOrigin;

const collabSocketOrigin = env.collabOrigin.replace(/^http/, 'ws');

// Misma reescritura que el Caddyfile: las rutas dinámicas son un único HTML estático.
const DYNAMIC_ROUTES: Array<[RegExp, string]> = [
  [/^\/p\/[0-9a-f-]{36}\/?$/, '/p/'],
  [/^\/app\/e\/[a-z0-9-]{1,48}\/?$/, '/app/e/'],
];

// Solo en `astro dev`: `astro preview` no carga los plugins de Vite; para un build se usa scripts/serve.ts.
function rewriteDynamicRoutes(): NonNullable<VitePlugin['configureServer']> {
  return (server) => {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? '/').split('?', 2);
      const target = DYNAMIC_ROUTES.find(([pattern]) => pattern.test(path ?? ''))?.[1];
      if (target) req.url = query === undefined ? target : `${target}?${query}`;
      next();
    });
  };
}

// Los archivos con «_» de src/pages no generan ruta por sí solos: la página solo existe si se inyecta.
const benchPage = fileURLToPath(new URL('./src/pages/_bench.astro', import.meta.url));

// La página del benchmark solo existe en los builds con PARCIFY_BENCH=1.
const benchRoute: AstroIntegration = {
  name: 'parcify-bench',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      if (process.env.PARCIFY_BENCH === '1' && existsSync(benchPage)) {
        injectRoute({ pattern: '/_bench', entrypoint: benchPage, prerender: true });
      }
    },
  },
};

// Un worker toma la CSP de su propia respuesta, no la del <meta> de la página. Se genera aquí, con los mismos
// orígenes que la de la página, para Caddy (dist-meta/worker-csp.caddy) y scripts/serve.ts (worker-csp.txt).
// dist-meta/ queda fuera de dist/: no se sirve.
const workerCsp = `default-src 'none'; connect-src 'self' ${env.apiOrigin} ${collabSocketOrigin} ${env.storageOrigin}`;
const workerCspFiles: AstroIntegration = {
  name: 'parcify-worker-csp',
  hooks: {
    'astro:build:done': ({ logger }) => {
      const dir = fileURLToPath(new URL('./dist-meta/', import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}worker-csp.txt`, `${workerCsp}\n`);
      writeFileSync(`${dir}worker-csp.caddy`, `header @worker Content-Security-Policy "${workerCsp}"\n`);
      logger.info('CSP de los workers en dist-meta/');
    },
  },
};

export default defineConfig({
  output: 'static',
  site: env.siteOrigin,
  trailingSlash: 'ignore',
  // Shiki usa estilos en línea incompatibles con la CSP; no hay Markdown con código.
  markdown: { syntaxHighlight: false },
  integrations: [svelte(), benchRoute, workerCspFiles],
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        `img-src 'self' blob: data: ${env.storageOrigin}`,
        `connect-src 'self' ${env.apiOrigin} ${collabSocketOrigin} ${env.storageOrigin}${env.sentryOrigin ? ` ${env.sentryOrigin}` : ''}`,
        "worker-src 'self' blob:",
        "font-src 'self'",
        "base-uri 'none'",
        `form-action 'self' ${env.apiOrigin}`,
        "object-src 'none'",
      ],
      // Los scripts en línea que Astro no procesa (is:inline) no llevan hash automático: se añade el suyo.
      scriptDirective: { resources: ["'self'"], hashes: [SIDEBAR_BOOT_HASH] },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
    },
  },
  vite: {
    plugins: [
      tailwindcss(),
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        strategy: ['url', 'baseLocale'],
      }),
      { name: 'parcify-dynamic-routes', configureServer: rewriteDynamicRoutes() },
    ],
    resolve: { dedupe: ['yjs', 'y-protocols', 'lib0'] },
    // Nada en data: URI: la CSP solo admite fuentes e imágenes de 'self'.
    build: { assetsInlineLimit: 0 },
    // Zod compila sus esquemas con new Function() si puede; la CSP no admite eval y cada intento cuenta como violación.
    define: { 'globalThis.__zod_globalConfig': JSON.stringify({ jitless: true }) },
  },
});
