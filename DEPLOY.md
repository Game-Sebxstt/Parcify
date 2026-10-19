# Despliegue de Parcify

Tres formas de ponerlo en marcha:

1. [Desarrollo en local](#1-desarrollo-en-local): Node en tu equipo, Postgres y Redis en Docker.
2. [Local tipo producción](#2-local-tipo-producción): las imágenes de producción en tu equipo, con HTTPS, S3 y correo de prueba.
3. [Producción en un VPS](#3-producción-en-un-vps) (la vía recomendada) o, como alternativa, [en Railway](#4-producción-en-railway).

Todos los comandos se ejecutan desde la raíz del monorepo salvo que se indique otra carpeta.

## 1. Desarrollo en local

Requisitos: Node.js 24.11 o posterior y Docker con Docker Compose.

Servidor (una terminal):

```powershell
cd server
npm ci
Copy-Item .env.example .env   # rellena BETTER_AUTH_SECRET y COLLAB_TOKEN_SECRET (32+ caracteres, distintos)
npm run stack:dev:up          # Postgres en 127.0.0.1:55432 y Redis en 127.0.0.1:56379
npx prisma migrate dev        # aplica las migraciones
npm run dev                   # api en http://localhost:3000 y collab en http://localhost:3001
```

Cliente (otra terminal):

```powershell
cd client
npm ci
Copy-Item .env.example .env
npm run dev                   # http://localhost:4321
```

Con `MAIL_DRIVER=console` los códigos de verificación salen en la consola del servidor. Para parar los contenedores sin perder datos: `npm run stack:dev:down` en `server/`.

Si cambias algo en `server/src/shared/`, ejecuta `npm run shared:hash` en `server/` y después `npm run shared:sync` en `client/`.

Comprobaciones habituales antes de subir cambios:

| Carpeta | Comandos |
|---|---|
| `server/` | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| `client/` | `npm run check`, `npm run lint`, `npm test`, `npm run build` |

Las pruebas de integración y e2e están descritas en los README de [server](server/README.md) y [client](client/README.md).

## 2. Local tipo producción

`server/compose.local.yml` levanta Parcify con las imágenes de producción, Caddy con certificados internos, SeaweedFS como S3 y Mailpit para el correo:

```powershell
cd server
powershell -ExecutionPolicy Bypass -File local-deploy\new-secrets.ps1   # crea .env.local-deploy (una sola vez)
docker compose -f compose.local.yml up -d --build --wait
Import-Certificate -FilePath .\local-deploy\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Reinicia el navegador después de importar el certificado (Firefox: activa `security.enterprise_roots.enabled` en `about:config`).

- Web: https://parcify.localhost
- API y colaboración: https://api.parcify.localhost y https://collab.parcify.localhost
- Correo (Mailpit): http://localhost:8025

Necesita libres los puertos 443 y 8025. El proyecto de compose se llama `parcify-local`: si ya lo tenías levantado desde otra carpeta, copia ese `.env.local-deploy` a `server/` antes de arrancar, o Postgres no aceptará la contraseña nueva. Los detalles (parar, resetear, limitaciones) están en «Despliegue local con Docker» de [server/README.md](server/README.md#despliegue-local-con-docker).

## 3. Producción en un VPS

Todo corre en un solo servidor con Docker Compose (`deploy/compose.prod.yml`):

| Servicio | Qué hace |
|---|---|
| `proxy` | Caddy 2.10: único servicio con puertos abiertos (80 y 443), certificados de Let's Encrypt automáticos |
| `web` | La web estática, construida en el propio VPS con los orígenes de tu dominio |
| `api`, `collab` | API REST y colaboración en tiempo real; `migrate` aplica las migraciones antes de que arranquen |
| `postgres`, `redis` | Base de datos y Redis con contraseña, en volúmenes con nombre |
| `s3`, `bucket-init` | SeaweedFS como S3 privado y la creación del bucket con su regla CORS (se pueden sustituir por R2 o S3) |

Con `DOMAIN=parcify.midominio.com` quedan:

- `https://parcify.midominio.com`: la web.
- `https://api.parcify.midominio.com`: la API.
- `https://collab.parcify.midominio.com`: la colaboración (WebSocket).
- `https://s3.parcify.midominio.com`: el bucket (solo con el S3 incluido).

Los cuatro comparten dominio registrable, que es lo que exige la cookie de sesión.

### 3.1. Requisitos

- Un VPS Linux (Ubuntu 24.04 o Debian 12 van bien) con al menos 2 vCPU y 4 GB de RAM. Con 2 GB, añade swap: la web se compila en el propio servidor.
- Docker Engine y el plugin de Docker Compose. En un servidor recién creado:

  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # cierra la sesión SSH y vuelve a entrar
  docker compose version
  ```

- Los puertos 80 y 443 abiertos hacia Internet (también en el panel de tu proveedor, si tiene firewall propio).
- Un dominio en el que puedas crear registros DNS.
- Una cuenta de correo transaccional: [Resend](https://resend.com) o cualquier SMTP.

### 3.2. DNS

Crea registros A (y AAAA si el VPS tiene IPv6) que apunten a la IP del VPS:

| Nombre | Tipo | Valor |
|---|---|---|
| `parcify.midominio.com` | A | IP del VPS |
| `api.parcify.midominio.com` | A | IP del VPS |
| `collab.parcify.midominio.com` | A | IP del VPS |
| `s3.parcify.midominio.com` | A | IP del VPS (solo con el S3 incluido) |

Vale también un registro `parcify.midominio.com` más un comodín `*.parcify.midominio.com`. Si usas Cloudflare, deja los registros en «DNS only» (nube gris): Caddy necesita recibir las peticiones directamente para obtener los certificados.

Comprueba que resuelven antes de seguir: `dig +short api.parcify.midominio.com`.

### 3.3. Clonar y generar la configuración

```bash
git clone https://github.com/Parcify-Oficial/Parcify.git parcify
cd parcify
bash deploy/scripts/new-env.sh parcify.midominio.com tu@correo.com
```

El script crea `deploy/.env` (permisos 600) a partir de `deploy/.env.example`, con el dominio, el correo de Let's Encrypt y contraseñas y secretos aleatorios para Postgres, Redis, Better Auth, la colaboración, el S3 incluido y `/metrics`. Si `deploy/.env` ya existe, no lo toca. Desde Windows hay un equivalente: `deploy\scripts\new-env.ps1 -Domain ... -AcmeEmail ...`.

Abre `deploy/.env` (`nano deploy/.env`) para completar lo que falta. Cada variable está explicada en el propio archivo.

### 3.4. Correo

El correo es obligatorio: sin él no llegan los códigos de verificación.

- Resend: verifica tu dominio en Resend, crea una clave con permiso de envío y pon:

  ```
  MAIL_DRIVER=resend
  RESEND_API_KEY=re_...
  MAIL_FROM=Parcify <no-reply@midominio.com>
  ```

- SMTP: `MAIL_DRIVER=smtp` y `SMTP_URL=smtps://usuario:contraseña@smtp.proveedor.com:465` (codifica en la URL los caracteres especiales de la contraseña).

`MAIL_FROM` tiene que ser de un dominio verificado en el proveedor. Configura SPF y DKIM para que los códigos no acaben en spam.

### 3.5. Google OAuth (opcional)

En Google Cloud Console, crea un cliente OAuth de tipo «Aplicación web» con esta URI de redirección autorizada, exactamente:

```
https://api.parcify.midominio.com/api/auth/callback/google
```

Copia el id y el secreto en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Sin ellos, el botón de Google no aparece. Si la pantalla de consentimiento está en modo de pruebas, solo entran los usuarios que añadas allí.

### 3.6. IA (opcional)

Pon la clave del proveedor y el modelo de cada función con el formato `proveedor:modelo`, por ejemplo:

```
OPENAI_API_KEY=sk-...
AI_MODEL_ASSISTANT=openai:<modelo>
AI_MODEL_CHAT=openai:<modelo>
AI_MODEL_IMAGE=openai:<modelo de imagen>
```

Una función sin modelo queda desactivada y la interfaz no la muestra. Si un `AI_MODEL_*` apunta a un proveedor sin clave, la API no arranca y lo dice en el log. Proveedores, ids de ejemplo y cuotas: sección «IA» de [server/README.md](server/README.md#ia).

### 3.7. Storage: S3 incluido o externo

Por defecto se usa el S3 incluido (`COMPOSE_PROFILES=s3` y `S3_ENDPOINT` vacío): los ficheros viven en el volumen `s3data` del VPS y se sirven desde `s3.<dominio>` con URLs firmadas.

Para usar Cloudflare R2 u otro S3:

1. Crea un bucket privado y un token con lectura y escritura limitado a ese bucket.
2. Añade al bucket una regla CORS que permita `GET`, `HEAD` y `PUT` desde `https://parcify.midominio.com` con la cabecera `content-type`.
3. En `deploy/.env`:

   ```
   COMPOSE_PROFILES=
   S3_ENDPOINT=https://<id de cuenta>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=<tu bucket>
   S3_ACCESS_KEY_ID=<del token>
   S3_SECRET_ACCESS_KEY=<del token>
   ```

Con `COMPOSE_PROFILES` vacío no arrancan ni SeaweedFS ni `bucket-init`, y Caddy deja de publicar `s3.<dominio>`. Activa el versionado del bucket si tu proveedor lo ofrece.

### 3.8. Arrancar

```bash
docker compose -f deploy/compose.prod.yml up -d --build
```

La primera vez tarda unos minutos: construye las imágenes, aplica las migraciones y Caddy pide los certificados. Para ver el estado:

```bash
docker compose -f deploy/compose.prod.yml ps
curl https://api.parcify.midominio.com/ready      # {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}
curl https://collab.parcify.midominio.com/ready
```

Si falta una variable obligatoria, `docker compose` se detiene antes de crear nada y dice cuál. Si un valor no es válido, `api` o `collab` escriben la lista de problemas en su log y no arrancan.

### 3.9. Primer usuario

Abre `https://parcify.midominio.com`, regístrate con tu email y escribe el código que llega por correo. Al entrar se crea tu espacio personal. Para trabajar en equipo, crea un espacio e invita a los demás desde sus ajustes. Comprueba la colaboración abriendo un proyecto en dos navegadores.

### 3.10. Actualizar a una versión nueva

```bash
cd parcify
git pull
docker compose -f deploy/compose.prod.yml up -d --build
```

`migrate` aplica las migraciones nuevas antes de que `api` y `collab` vuelvan a arrancar. Durante la recreación de los contenedores hay unos segundos sin servicio; los editores abiertos reconectan solos. Haz una copia antes de cada actualización (siguiente apartado).

Las imágenes antiguas se pueden limpiar de vez en cuando con `docker image prune`.

### 3.11. Copias de seguridad y restauración

```bash
bash deploy/scripts/backup.sh backup                         # deploy/backups/<fecha UTC>/
bash deploy/scripts/backup.sh backup /ruta/a/otra/carpeta
```

Cada copia tiene `postgres.dump` (formato de `pg_dump -Fc`) y `bucket/` con todos los objetos (con `rclone`, también con R2 o S3 externo). Redis no hace falta copiarlo: lo que guarda caduca solo o se reconstruye desde Postgres (caché de sesiones, contadores de cuota, bloqueos y trabajos en curso).

Copia diaria a las 03:30 con cron (`crontab -e`):

```
30 3 * * * cd /home/<usuario>/parcify && bash deploy/scripts/backup.sh backup >> /home/<usuario>/parcify-backup.log 2>&1
```

Guarda las copias también fuera del VPS (otro servidor, un bucket aparte o tu equipo con `rsync`/`scp`): si el disco se pierde, se pierden con él. Para borrar las de más de 14 días: `find deploy/backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +`.

Restaurar detiene `api` y `collab`, sustituye la base de datos, deja el bucket igual que en la copia y vuelve a arrancarlos. Pide confirmación antes de tocar nada:

```bash
bash deploy/scripts/backup.sh restore deploy/backups/20261019-033000
```

### 3.12. Logs

```bash
docker compose -f deploy/compose.prod.yml logs -f api collab   # API y colaboración
docker compose -f deploy/compose.prod.yml logs -f proxy        # Caddy y certificados
docker compose -f deploy/compose.prod.yml logs --tail 200 migrate
```

Los logs de cada contenedor rotan solos (5 archivos de 10 MB). Para parar todo sin perder datos: `docker compose -f deploy/compose.prod.yml stop`; para volver a arrancar: `... up -d`. No uses `down -v`: borra los volúmenes con la base de datos y los ficheros.

### 3.13. Firewall básico

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Docker abre sus puertos publicados por su cuenta, sin pasar por `ufw`; por eso en `compose.prod.yml` solo Caddy publica puertos y Postgres, Redis y el S3 quedan dentro de la red de Docker. Desactiva el acceso SSH con contraseña y usa claves.

### 3.14. Problemas frecuentes

- El certificado no sale (el navegador avisa o `curl` falla con TLS). Mira `docker compose -f deploy/compose.prod.yml logs proxy`. Casi siempre es el DNS (el registro no existe, apunta a otra IP o aún no se ha propagado) o los puertos 80 y 443 cerrados en el firewall del proveedor. Con Cloudflare, el registro tiene que estar en «DNS only». Let's Encrypt limita los intentos fallidos: corrige el DNS y espera unos minutos antes de reiniciar el proxy (`docker compose -f deploy/compose.prod.yml restart proxy`).
- Entras, pero al recargar vuelves a la landing o la API responde 401. La cookie de sesión vive en `api.<dominio>` y el navegador solo la envía si la web y la API son el mismo sitio. Abre la web exactamente en `https://<DOMAIN>` (no en la IP ni en `www.` sin configurarlo). Si cambias `DOMAIN`, reconstruye con `up -d --build`: la web lleva los orígenes incrustados al compilar.
- El editor se queda «Conectando…». Comprueba `https://collab.<dominio>/ready` y que nada entre el navegador y Caddy corte los WebSocket (un proxy de Cloudflare naranja, un balanceador del proveedor). Caddy los reenvía sin configuración extra y sin límite de tiempo.
- Las imágenes no suben o no se ven. Con el S3 incluido, comprueba que `s3.<dominio>` tiene registro DNS y certificado. Con R2 o S3 externo, revisa la regla CORS del bucket y que `S3_ENDPOINT` sea el origen correcto (la web se construye con ese mismo origen en su CSP).
- `api` o `collab` se reinician sin parar. `docker compose -f deploy/compose.prod.yml logs api` muestra qué variable falta o no vale (sin enseñar los secretos).
- Has regenerado `deploy/.env` y Postgres rechaza la contraseña. El volumen conserva la contraseña con la que se creó. Vuelve a poner la anterior o cámbiala dentro de Postgres (`docker compose -f deploy/compose.prod.yml exec postgres psql -U parcify -c "ALTER USER parcify PASSWORD '<nueva>'"`).

## 4. Producción en Railway

Railway es la alternativa gestionada: cinco servicios (`Postgres`, `Redis`, `api`, `collab` y `web`) desde este mismo repo, con TLS y copias de Postgres a cargo de Railway. En el monorepo cada servicio necesita su *Root Directory* y la ruta de su archivo de configuración desde la raíz del repo:

| Servicio | *Root Directory* | Config-as-code |
|---|---|---|
| `api` | `/server` | `/server/railway.api.json` |
| `collab` | `/server` | `/server/railway.collab.json` |
| `web` | `/client` | `/client/railway.json` |

Esos archivos fijan el `Dockerfile`, las rutas que disparan cada despliegue (`/server/**` o `/client/**`), el *pre-deploy* `npx prisma migrate deploy`, el *healthcheck* y las réplicas. Usa dominios propios bajo el mismo dominio registrable (nunca `*.up.railway.app`), storage `s3` con R2 y las variables de la tabla del README del servidor. La guía completa, paso a paso, está en [«Producción en Railway» de server/README.md](server/README.md#producción-en-railway), y lo propio del servicio `web` en [client/README.md](client/README.md#producción-en-railway).

## 5. Seguridad

- No subas nunca ningún `.env` real (`deploy/.env`, `server/.env`, `client/.env`, `server/.env.local-deploy`). El `.gitignore` de la raíz los excluye; solo se versionan los `.env.example`. Tampoco subas `deploy/backups/`.
- El workflow «Secretos» pasa `gitleaks` en cada push y pull request. Si alguna vez se cuela un secreto, rótalo: borrarlo del repo no basta.
- Rotar secretos: cambia el valor en `deploy/.env` y recrea con `up -d`. Cambiar `BETTER_AUTH_SECRET` cierra todas las sesiones; `COLLAB_TOKEN_SECRET` solo obliga a reconectar a los editores. Las contraseñas de Postgres y Redis también hay que cambiarlas dentro del servicio (Postgres) o reiniciarlo (Redis lee la suya al arrancar). Las claves de Resend, Google, IA y R2 se rotan en el panel de cada proveedor.
- El historial antiguo del repositorio `Parcify-Oficial/Parcify` contenía credenciales del Parcify anterior. Dalas por comprometidas: revócalas o cámbialas en cada servicio (base de datos, correo, claves de API) aunque ya no estén en la rama actual. Subir Parcify v2 encima no las borra del historial; si quieres que desaparezcan, hay que reescribirlo (por ejemplo con `git filter-repo`) o empezar un repositorio nuevo, y aun así deben rotarse.
