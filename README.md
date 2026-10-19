# Parcify

Parcify es un lienzo colaborativo en tiempo real para equipos: varias personas editan el mismo proyecto a la vez, con cursores, chat, versiones, animaciones e IA, desde el navegador.

## Funcionalidades

- Lienzo infinito con formas, texto enriquecido, imágenes, conectores, grupos, frames y varias páginas; árbol de capas accesible, minimapa, portapapeles entre proyectos y «Seguir a» otra persona.
- Colaboración en vivo: cursores y selección de los demás, edición simultánea del mismo texto y copia local del documento en el navegador.
- Chat del proyecto con menciones, adjuntos y «escribiendo…».
- Versiones manuales y automáticas, con vista previa y restauración.
- Animador por keyframes con timeline accesible por teclado y modo Presentar.
- IA opcional (OpenAI, Anthropic, Gemini o cualquier API compatible con OpenAI): asistente del lienzo con vista previa, chat, generación de imágenes y animaciones propuestas, con cuotas por espacio y por usuario.
- Espacios de trabajo con miembros, roles, papelera y plantillas propias.
- Compartir con enlaces (caducidad, número de usos y revocación) e invitaciones por email.
- Actividad del proyecto y del espacio medida en el servidor, con gráficos accesibles.
- Exportación a PNG, JPG, SVG y PDF, e importación y exportación del formato `.parcify`.
- Cuentas con email y contraseña (verificación por código) o Google.

## Stack

| Parte | Tecnología |
|---|---|
| Cliente (`client/`) | Astro 7 estático, islas de Svelte 5, Tailwind v4 y Pixi 8 para el lienzo; el documento Yjs vive en un Web Worker. Lo sirve Caddy |
| Servidor (`server/`) | Node 24 con Fastify 5 (API REST) y Hocuspocus 4 (colaboración por WebSocket), Prisma 7 con PostgreSQL 18, Redis 8, Better Auth y el AI SDK de Vercel |
| Storage | Cualquier S3 compatible (SeaweedFS incluido, Cloudflare R2, AWS S3, MinIO) o disco local |
| Despliegue | Imágenes Docker sin root; Docker Compose con Caddy y Let's Encrypt en un VPS, o Railway |

## Estructura

```
client/            cliente web (Astro + Svelte + Pixi)
server/            api y collab (una imagen, dos procesos), migraciones de Prisma
deploy/            producción en un VPS con Docker Compose y Caddy
  compose.prod.yml
  .env.example     todas las variables de producción
  caddy/           Caddyfile con certificados automáticos
  scripts/         new-env.sh (genera deploy/.env), backup.sh (copias y restauración)
.github/workflows/ CI del servidor, del cliente y de secretos
DEPLOY.md          guía de despliegue en local y en producción
```

Los tipos y la lógica compartida viven en `server/src/shared/`; `client/src/shared/` es una copia que se actualiza con `npm run shared:sync` desde `client/`.

## Documentación

- [DEPLOY.md](DEPLOY.md): desarrollo en local, despliegue local tipo producción y producción en un VPS o en Railway.
- [server/README.md](server/README.md): API, colaboración, autenticación, IA, storage, trabajos periódicos y variables.
- [client/README.md](client/README.md): pantallas, motor del lienzo, pruebas e2e, benchmark y CSP.

## Licencia

[MIT](LICENSE).
