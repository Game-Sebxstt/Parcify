# Parcify: cliente (`client/`)

Cliente web de Parcify: una web estática hecha con Astro 7, islas de Svelte 5 y Tailwind v4. En producción la sirve Caddy (`Caddyfile`). Habla con el servidor (`../server`) por REST (cookie de sesión) y por WebSocket (colaboración).

## Requisitos

- Node.js 24.11 o posterior.
- El servidor en `../server` (la carpeta hermana dentro del monorepo, o la ruta de `PARCIFY_SERVER_DIR`) para sincronizar los tipos compartidos y para las pruebas e2e.

## Puesta en marcha

```powershell
npm ci
Copy-Item .env.example .env
npm run dev          # http://localhost:4321, con la API en :3000
```

La API tiene que estar arrancada (`npm run dev` en `server/`) y su `CLIENT_ORIGINS` tiene que incluir `http://localhost:4321`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo de Astro en 4321 |
| `npm run check` | Compila los mensajes, `astro check` y `svelte-check` |
| `npm run lint` | ESLint con `eslint-plugin-svelte` |
| `npm test` | Vitest: lógica en Node y componentes con jsdom y Testing Library |
| `npm run build` | `shared:check` y `astro build` a `dist/` |
| `npm run preview` | Sirve `dist/` (la CSP solo se aplica aquí, no en `dev`) |
| `npm run shared:sync` | Copia `src/shared` del servidor |
| `npm run shared:check` | Falla si la copia se editó a mano o si el servidor tiene otro `SHARED_HASH` |
| `npm run budget` | Tras un build, JS en gzip que descarga cada página antes de cualquier `import()`: landing ≤ 60 KB, app ≤ 120 KB, editor ≤ 600 KB |
| `npm run contrast` | Comprueba el contraste AA de los tokens y los 12 colores de colaborador |
| `npm run e2e` | Playwright en Chromium y Firefox (ver abajo) |
| `npm run bench` | Benchmark del lienzo con 1.000 formas y 200 imágenes en Chromium con ventana y GPU real (ver abajo) |
| `npm run bench:ci` | El mismo benchmark sin GPU (SwiftShader) y con la CPU limitada ×4; solo compara el trabajo JS |
| `npm run i18n` | Compila `messages/*.json` a `src/paraglide/` |

## Tipos compartidos

`src/shared/` es una copia de `server/src/shared/`. No se edita a mano: después de cambiar algo en el servidor (y de ejecutar allí `npm run shared:hash`), aquí se ejecuta `npm run shared:sync`. `npm run build` corre `shared:check` antes de compilar.

## Pruebas e2e

```powershell
cd ..\server
npm run build
npm run stack:test:up
cd ..\client
npm run e2e -- auth.spec.ts
cd ..\server
npm run stack:test:down
```

Playwright aplica las migraciones al Postgres de pruebas, arranca `api` y `collab` con `npm run start:e2e` (correo en memoria, que se lee en `/v1/__test/mail`) y sirve un build del cliente (con `PUBLIC_TEST_HOOKS=1`) con `scripts/serve.ts`. Ese servidor reproduce las reescrituras y cabeceras del `Caddyfile`; `astro preview` no sirve porque no aplica los plugins de Vite y no reescribe `/p/:id` ni `/app/e/:slug`.

Con `PUBLIC_TEST_HOOKS=1` el editor expone `window.__parcifyTest` (estado de la conexión, nodos del documento y conversión de coordenadas del lienzo a la página). En un build normal ese módulo no se incluye. Para comprobar el botón de Google se pasan a la API unas credenciales de Google ficticias, solo en ese entorno: bastan para que genere la URL de autorización, y la prueba intercepta `accounts.google.com` sin salir a la red. Los navegadores se instalan una vez con `npx playwright install chromium firefox`.

`/sign-in/email` admite 5 intentos por minuto y por IP. La API de los e2e arranca con `TRUST_PROXY_HOPS=1` y las cuentas que crean las pruebas por la API (`e2e/helpers/account.ts`) llegan cada una con un `X-Forwarded-For` distinto, así que no comparten ese límite; las pruebas del overlay sí usan la IP real, y si repites `auth.spec.ts` muchas veces seguidas conviene esperar un minuto.

Pruebas del cierre de la Fase 1: `dashboard.spec.ts`, `settings.spec.ts`, `collab.spec.ts` (dos contextos y dos usuarios), `csp.spec.ts` (cabeceras del Caddyfile y ninguna `securitypolicyviolation`) y `a11y.spec.ts` (axe en la landing, el overlay, el inicio, el espacio y los ajustes).

Las pruebas que necesitan a una segunda persona la unen con invitaciones reales (`e2e/helpers/invite.ts`): una invitación al espacio aceptada por la API o un enlace de proyecto de un solo uso. `share.spec.ts` y `workspace-invite.spec.ts` recorren esos mismos flujos desde la interfaz, incluida la página `/invitacion`. `e2e/helpers/seed.ts` solo guarda atajos por la API para preparar datos.

## Benchmark del lienzo

`npm run bench` compila con `PARCIFY_BENCH=1` (solo así existe la página `/_bench`), lo sirve con `scripts/serve.ts` en el puerto 4322 y abre Chromium con ventana a 1920×1080 y dpr 1,25. No necesita el servidor: el documento lo genera `bench/fixtures/generate.ts` con semilla fija: 1.000 formas (60 conectores y 50 textos cortos entre ellas) y 200 imágenes de 200 assets distintos. Las imágenes (1600×1200, con sus variantes `thumb`, `medium` y `full`) están versionadas en `bench/fixtures/images/`; si hubiera que rehacerlas, `node bench/fixtures/make-images.ts` las genera con la misma semilla. Escenarios:

- `open`: aplicar el estado completo y llegar al primer frame con formas (`openMs`), y hasta que todas las imágenes pintan su miniatura (`thumbMs`).
- `drag-100`: arrastrar 100 nodos con snapping, con eventos de puntero sintéticos a 120 Hz.
- `pan-zoom`: rueda y Ctrl+rueda continuos con todo visible.
- `drag-all`: arrastrar los 1.200 nodos a la vez (objetivo: p95 de frame ≤ 25 ms).
- `remote-burst`: otro `Y.Doc` mueve 100 nodos 30 veces por segundo. Como en el editor, el documento vive en un worker (`bench/bench.worker.ts`) y el par remoto está en ese mismo worker; `burstP95` es el trabajo del hilo principal del frame que aplica el lote, y `workerApplyP95` el coste de `Y.applyUpdate` en el worker (dato, sin umbral).
- `baseline` y `redraw`: el lienzo quieto, y la misma vista redibujada en cada frame sin trabajo del motor. Sirven de referencia para separar la fluctuación de la pantalla y el coste de GPU del trabajo del motor.

Cada escenario mide 10 s tras 2 s de calentamiento: delta entre frames, trabajo JS del motor por fase, tiempo de la llamada a Pixi, llamadas de dibujo, frames perdidos, long tasks y renders con el lienzo quieto. El JSON queda en `bench/results/` y la consola muestra una línea por escenario.

Objetivos: p95 de frame ≤ 16,7 ms en `drag-100` y `pan-zoom` (el límite es el mayor entre 16,7 ms y el p95 del lienzo quieto, más 0,5 ms de fluctuación del vsync), ningún frame de más de 50 ms, trabajo JS ≤ 6 ms y 0 renders con el lienzo quieto. Si `redraw` pierde más del 5 % de frames, la GPU del equipo está ocupada por otra aplicación y el benchmark falla con ese motivo: hay que repetirlo con el equipo libre. `PARCIFY_BENCH_RENDERER=webgpu` mide con WebGPU.

`npm run bench:ci` comprueba el trabajo JS (≤ 9 ms con la CPU ×4) y lo compara con `bench/reference/ci.json`: falla si sube más de un 20 %. Si no hay referencia, o con `PARCIFY_BENCH_UPDATE=1`, la guarda.

## Pantallas

- `/`: la landing. El hero monta el motor real con un documento pequeño (`src/landing/`) y un segundo `Y.Doc` con su Awareness que hace de «Ana». El motor se descarga con `client:visible` y `requestIdleCallback`; antes, y sin JS, se ve `public/landing/lienzo.png`. Para regenerar esa captura: `npm run build`, `node scripts/serve.ts` y `node scripts/landing-capture.ts`. El overlay de acceso también se descarga al primer uso (`AuthLauncher`).
- `/app`, `/app/e/:slug` y `/app/ajustes`: `AppShell` (barra lateral con espacios y papelera), `Dashboard`, `Workspace` y `Settings`. La búsqueda, el filtro y el orden del espacio viven en la URL (`?q=`, `?filtro=`, `?orden=`) y la pestaña en `?vista=`.
- `/legal/privacidad` y `/legal/terminos`: texto provisional hasta que el propietario lo redacte.
- Chat del editor (`src/islands/editor/chat/`, `src/lib/chat.ts`): el panel se monta al abrir el proyecto aunque esté cerrado, para contar los no leídos (el último id leído se guarda en `localStorage`) y recibir los mensajes que llegan como `chat.message` por la conexión de colaboración. Los mensajes propios aparecen al momento y se sustituyen por la respuesta del servidor o quedan como «No enviado · Reintentar». «Escribiendo…» viaja en la Awareness (`chatTyping`). El texto se pinta con nodos `Text` y `<a>` creados a mano: solo se enlaza `http:` y `https:`.
- Versiones del editor (`src/islands/editor/VersionsPanel.svelte`, `src/lib/versions.ts`): el panel comparte el hueco de la derecha con el chat y recarga la lista cada vez que se abre. Ctrl+S guarda una versión sin nombre (también en solo lectura evita el «Guardar como» del navegador, sin crear nada) y el botón del panel crea una con nombre. La vista previa (`version-preview.ts`, cargado con `import()`) aplica el estado binario a un `Y.Doc` propio en el hilo principal y lo pinta con un motor de solo lectura que no se conecta a nadie; por eso ese archivo está exento de la regla de ESLint que reserva Yjs al host del documento. Restaurar pide confirmación y el cambio llega a todos por la colaboración.
- Aviso de tamaño del editor: a un admin del proyecto le muestra «Optimizar el proyecto», que llama a `POST /v1/projects/:id/compact`. El servidor lo compacta cuando nadie tiene el proyecto abierto; al volver a entrar, el cliente recibe el `epoch` nuevo y abre un `Y.Doc` limpio.

Los informes de diseño y accesibilidad de cada pantalla están en `docs/ui-checks/`.

## Documento en un worker

El editor abre cada proyecto en un worker propio (`src/lib/collab.worker.ts`). Allí viven el `Y.Doc`, el proveedor de Hocuspocus con su Awareness, la copia local en IndexedDB, el historial de deshacer y la validación con zod de lo que llega (`src/engine/doc/host/`). El hilo principal no carga Yjs: guarda un espejo de registros planos (`DocumentStore`) que se pone al día con un lote por frame, y escribe con `DocWriter`, que muestra cada cambio en el acto y lo manda al worker. Las ediciones de texto también se ven en el acto; el worker coloca las que coinciden con las de otra persona. El protocolo entre los dos hilos está en `src/engine/doc/protocol.ts`.

Si el navegador no tiene `Worker`, o el worker no arranca en 10 s, el mismo código corre en el hilo principal y se avisa una vez en la consola. La landing y las pruebas usan siempre ese modo (`DirectBackend`). Si el worker se cae con el editor abierto, se muestra «El editor dejó de responder» con un botón para recargar. ESLint impide importar Yjs o el host fuera de `src/engine/doc/host/`, `src/lib/collab-host.ts`, `src/lib/collab.worker.ts`, la landing y las pruebas.

Un worker toma la CSP de su propia respuesta, no la del `<meta>` de la página. El build escribe en `dist-meta/` la de los workers (`default-src 'none'` y el `connect-src` de la página, con `'self'`), y la sirven Caddy (`worker-csp.caddy`, que copia el `Dockerfile`) y `scripts/serve.ts` (`worker-csp.txt`) a las rutas `/_astro/*.worker-*.js`.

## CSP y Zod

La CSP no admite `eval`. Zod 4 intenta compilar sus esquemas con `new Function()` y, aunque captura el error, cada intento cuenta como violación. `astro.config.ts` define `globalThis.__zod_globalConfig` como `{ jitless: true }` en el build y `build.assetsInlineLimit` a 0 para que ninguna fuente acabe en una URL `data:`, que `font-src 'self'` bloquea. En el worker del documento, `src/lib/zod-jitless.ts` llama a `config({ jitless: true })` antes de construir ningún esquema. `e2e/csp.spec.ts` lo comprueba.
## Variables

Todas están en `.env.example`. Las `PUBLIC_*` se incrustan al compilar y entran en la CSP que genera Astro, así que cambiar un dominio exige reconstruir.

`PUBLIC_SENTRY_DSN` es opcional. Con ella, cada página carga `@sentry/browser` con un `import()` (sin ella no se descarga) y el origen del DSN entra en `connect-src`. Los eventos salen sin datos personales: en el SDK 11, `dataCollection` sustituye a `sendDefaultPii` y aquí desactiva usuario, cookies, cabeceras, cuerpos, query y variables locales; además, `beforeSend` quita cookies, cabeceras salvo `User-Agent`, cuerpos y la query y el fragmento de las URLs (el token de una invitación va en el fragmento), también en las migas de navegación y de `fetch`. En Docker se pasa como `--build-arg`.

El workflow «Secretos» de la raíz del monorepo (`.github/workflows/secrets.yml`) pasa `gitleaks` con el `.gitleaks.toml` de la raíz (reglas por defecto; se excluyen `.env.example`, las pruebas y las fixtures del benchmark).

## Docker

El `Dockerfile` compila con Node 24.11 y sirve `dist/` con Caddy 2.10 (`Caddyfile`). La imagen final corre con un usuario sin privilegios (uid 10001), escucha en `PORT` (8080 si no está) y trae un `HEALTHCHECK` que pide `/`.

Las cuatro `PUBLIC_*` de origen se pasan como `--build-arg` y son obligatorias: `scripts/public-env-check.ts` corta el build si falta alguna, si no es un origen sin ruta o si usa un dominio `*.up.railway.app`. Sin esa comprobación, la imagen saldría apuntando a `localhost`.

```powershell
docker build -t parcify-client `
  --build-arg PUBLIC_API_ORIGIN=https://api.parcify.app `
  --build-arg PUBLIC_COLLAB_ORIGIN=https://collab.parcify.app `
  --build-arg PUBLIC_SITE_ORIGIN=https://parcify.app `
  --build-arg PUBLIC_STORAGE_ORIGIN=https://<id de cuenta>.r2.cloudflarestorage.com `
  .
docker run -p 8080:8080 parcify-client
```

`server/compose.verify.yml` construye esta imagen junto con la del servidor para comprobarlas en local (ver el README del servidor).

Para usar Parcify en tu equipo como si fuera producción (`https://parcify.localhost`, storage S3 y correo en Mailpit), `server/compose.local.yml` construye esta imagen con los orígenes `*.parcify.localhost`; los pasos están en la sección «Despliegue local con Docker» del README del servidor.

## Producción en Railway

La guía completa (servicios, dominios, cookies, variables del servidor, Google, correo, IA y storage) está en el README de `server/` y en [`DEPLOY.md`](../DEPLOY.md). Para el servicio `web`:

1. Crea un servicio desde el repo del monorepo con *Root Directory* `/client` y, en *Settings → Config-as-code*, la ruta `/client/railway.json` (Railway no la resuelve relativa al *Root Directory*). Ese archivo fija: build con el `Dockerfile`, *healthcheck* en `/`, una réplica (es estático; puedes subirla sin más) y solo redespliega cuando cambia algo en `client/`.
2. Añade como variables del servicio:

   | Variable | Qué espera |
   |---|---|
   | `PUBLIC_SITE_ORIGIN` | Origen de la web, por ejemplo `https://parcify.app`. Tiene que estar en `CLIENT_ORIGINS` del servidor |
   | `PUBLIC_API_ORIGIN` | El mismo valor que `API_ORIGIN` del servidor |
   | `PUBLIC_COLLAB_ORIGIN` | El mismo valor que `COLLAB_ORIGIN` del servidor, con `https://`. Entra en la CSP como `wss://`; la URL del WebSocket la devuelve la API |
   | `PUBLIC_STORAGE_ORIGIN` | Con `s3` y estilo de ruta, el origen de `S3_ENDPOINT`; con `local`, el de la API. Entra en la CSP de imágenes y conexiones |
   | `PUBLIC_SENTRY_DSN` | Opcional |

   Railway pasa las variables del servicio al build como argumentos porque el `Dockerfile` las declara con `ARG`.
3. Asigna el dominio `parcify.app` (o el que uses) al servicio. Tiene que compartir dominio registrable con la API: no sirve `*.up.railway.app`.
4. Cada cambio de dominio, de bucket o de DSN exige un despliegue nuevo, porque Astro incrusta los valores al compilar y la CSP se genera con ellos.

## Dependencias añadidas fuera del diseño

Fijadas con `npm view <paquete> version`:

- `@inlang/plugin-message-format@4.5.4`: plugin de Paraglide para leer `messages/*.json` desde `node_modules`, sin cargarlo de un CDN.
- `@sveltejs/vite-plugin-svelte@7.3.1`: la misma versión que usa `@astrojs/svelte`; Vitest la usa directamente para no cargar toda la integración de Astro.
- `vite@8.3.4`: la que trae Astro 7.4; se declara para los tipos del middleware de reescritura en `astro.config.ts`.

## Notas de implementación

- La CSP se declara en `astro.config.ts` con `security.csp` (`directives`, `scriptDirective.resources`, `styleDirective.resources`), contrastada con los tipos de Astro 7.4. Con `'unsafe-inline'` en `style-src`, Astro no emite hashes de estilos. `frame-ancestors` y el resto de cabeceras van en el `Caddyfile`.
- Shiki está desactivado (`markdown.syntaxHighlight: false`) porque sus estilos en línea chocan con la CSP.
- jsdom no implementa `<dialog>` modal; `test/setup.ts` emula `showModal` y `close` para las pruebas de componentes.
- Motor del lienzo (`src/engine/`), contrastado con los tipos de Pixi 8.22: `Application.init` admite `eventFeatures` y `gcMaxUnusedTime` tal cual. El motor importa `pixi.js/unsafe-eval` porque la CSP no permite `'unsafe-eval'`. Las formas usan `GraphicsContext.batchMode = 'batch'`: en `auto` Pixi saca del batch las de más de 200 vértices y cada una costaba una llamada de dibujo.
- Imágenes: en Pixi 8.22 la textura se crea con `new ImageSource({ resource: bitmap, autoGenerateMipmaps: true, scaleMode: 'linear', mipmapFilter: 'linear', alphaMode: 'premultiplied-alpha' })` a partir de `createImageBitmap(blob, { premultiplyAlpha: 'premultiply' })`, y se pinta como relleno de textura de un `Graphics` (`fill({ texture, matrix, textureSpace: 'local' })`) para tener recorte, `fit` y esquinas redondeadas sin máscaras. Pixi cambia a `repeat` las texturas de un relleno en `clamp-to-edge`; se crean en `mirror-repeat` para que el borde no tome color del lado contrario. La subida previa a la GPU usa `renderer.prepare.upload()` de `pixi.js/prepare`.
- Redibujar un `Graphics` agrupado obliga a Pixi a rehacer las instrucciones de todo su render group: los conectores que cambian de recorrido pasan 2 s a un render group propio.
- Al arrastrar, los nodos que se mueven sin redibujarse pasan a un render group por tramo consecutivo en orden z con la matriz del gesto: el resto del contenido no vuelve a subir vértices y el orden z se conserva.
- Grupos y frames: cada uno es un `Container` con las vistas de sus hijos dentro (con sus matrices de mundo), así un gesto que mueve el contenedor lleva a sus hijos con una sola matriz. Pixi 8.22 exporta `ScissorMask` pero no registra ningún pipe que lo use, así que el recorte de un frame es una máscara de stencil con un rectángulo (`Graphics`), la más barata disponible. `cacheAsTexture` se aplica al cuerpo del contenedor (no a la vista con la máscara) cuando tiene más de 200 descendientes, nada dentro se está editando, lleva 2 s quieto y la textura resultante no pasa de 4096 px por lado; se quita al primer cambio dentro y al cambiar el zoom más de 1,5 veces.
- El canvas solo se redimensiona si cambia el tamaño del contenedor: reasignar el mismo tamaño recrea el búfer de dibujo y costaba frames perdidos durante los gestos.
- Fuentes del texto: las 8 familias (Manrope, Inter, Source Serif 4, JetBrains Mono, Caveat, Montserrat, Lora y Space Grotesk) están en `public/fonts/<familia>/` como woff2 variables de los paquetes `@fontsource-variable/*` (5.3.0; Source Serif 4 en 5.3.1), solo los subconjuntos `latin` y `latin-ext`, cada una con su `OFL.txt`. No son dependencias de npm: se copiaron una vez. `src/engine/text/fonts.ts` las registra con `FontFace.load()` con el nombre `Parcify <familia>` antes de pintar el primer texto que las usa. Manrope, Caveat y Space Grotesk no tienen cursiva y el navegador la simula.
- Updates remotos: el worker los aplica al llegar y junta lo cambiado en un lote; como mucho hay uno en camino, y el motor lo aplica al principio de su frame. Si el frame no llega (pestaña en segundo plano), se aplica a los 100 ms. Sin worker, los mensajes del WebSocket esperan en `RemoteInbox` hasta ese frame. El `DocumentStore` parchea en sitio los registros cuando solo cambian posición, giro, opacidad, visibilidad o bloqueo; con cualquier otra clave el registro se sustituye.
- Copia local: `y-indexeddb` con la base `parcify:{userId}:{projectId}:{epoch}` para editores, desactivable con la clave `parcify:localCopy = 0` de `localStorage` (el ajuste de cuenta llega con la página de ajustes). Al cerrar sesión se borran todas las bases del usuario.
