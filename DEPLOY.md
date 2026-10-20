# Despliegue de Parcify

Esta guía explica cómo poner Parcify en producción en Railway guardando las imágenes en un volumen (disco local) en lugar de un bucket S3. Todo lo necesario está aquí: servicios, variables, dominios, correo, copias de seguridad y problemas frecuentes. Al final hay dos secciones más cortas para usarlo en tu equipo con Docker y en un VPS propio.

En los ejemplos el dominio es `midominio.com` y Parcify queda en `parcify.midominio.com`, `api.parcify.midominio.com` y `collab.parcify.midominio.com`. Cámbialo por el tuyo en todos los sitios.

## Índice

- [Cómo queda en Railway](#cómo-queda-en-railway)
- [Requisitos](#requisitos)
- [Cómo funciona el disco local](#cómo-funciona-el-disco-local)
- [Despliegue en Railway con disco local](#despliegue-en-railway-con-disco-local)
  - [1. Ajustar las réplicas de la API en el repo](#1-ajustar-las-réplicas-de-la-api-en-el-repo)
  - [2. Crear el proyecto, Postgres y Redis](#2-crear-el-proyecto-postgres-y-redis)
  - [3. Generar los secretos](#3-generar-los-secretos)
  - [4. Variables compartidas](#4-variables-compartidas)
  - [5. Servicio api con su volumen](#5-servicio-api-con-su-volumen)
  - [6. Servicio collab](#6-servicio-collab)
  - [7. Servicio web](#7-servicio-web)
  - [8. Dominios, CORS y cookies](#8-dominios-cors-y-cookies)
  - [9. Primer despliegue y migraciones](#9-primer-despliegue-y-migraciones)
  - [10. Comprobaciones](#10-comprobaciones)
- [Correo](#correo)
- [Google OAuth (opcional)](#google-oauth-opcional)
- [IA (opcional)](#ia-opcional)
- [Copias de seguridad](#copias-de-seguridad)
- [Actualizar](#actualizar)
- [Problemas frecuentes](#problemas-frecuentes)
- [Pasar de disco local a S3](#pasar-de-disco-local-a-s3)
- [Local con Docker](#local-con-docker)
- [VPS con Docker](#vps-con-docker)
- [Seguridad](#seguridad)

## Cómo queda en Railway

Cinco servicios en un mismo proyecto de Railway. `api` y `collab` salen de la misma imagen (`server/Dockerfile`) y solo cambia el comando de arranque; `web` sale de `client/Dockerfile`.

| Servicio | Qué hace | Origen | Root Directory | Config-as-code | Arranque | Healthcheck | Réplicas | Dominio | Volumen |
|---|---|---|---|---|---|---|---|---|---|
| `Postgres` | Base de datos | Plantilla de Railway | | | | | 1 | No | El suyo (lo gestiona Railway) |
| `Redis` | Sesiones, cuotas, bloqueos y mensajes entre `api` y `collab` | Plantilla de Railway | | | | | 1 | No | El suyo |
| `api` | API REST, autenticación, correo, IA y ficheros | Este repo | `/server` | `/server/railway.api.json` | `node dist/api/main.js` | `/ready` | 1 | `api.parcify.midominio.com` | Sí, en `/data` |
| `collab` | Edición en tiempo real (WebSocket) | Este repo | `/server` | `/server/railway.collab.json` | `node dist/collab/main.js` | `/ready` | 2 | `collab.parcify.midominio.com` | No |
| `web` | La web estática, servida por Caddy | Este repo | `/client` | `/client/railway.json` | El de la imagen (Caddy) | `/` | 1 | `parcify.midominio.com` | No |

Los tres archivos de Config-as-code ya están en el repo. Fijan el builder `DOCKERFILE` con `dockerfilePath: "Dockerfile"` (relativo al Root Directory), las rutas que disparan un despliegue (`/server/**` o `/client/**`), el comando de arranque, el pre-deploy `npx prisma migrate deploy` en `api` y `collab`, el healthcheck y las réplicas. Lo que dicen esos archivos manda sobre lo que pongas en el panel. Railway no resuelve la ruta del archivo de configuración relativa al Root Directory: se escribe siempre desde la raíz del repo, como en la tabla.

## Requisitos

- Una cuenta de Railway. El tamaño inicial del volumen depende del plan: 0,5 GB en Free y Trial, 5 GB en Hobby y 50 GB en Pro (se puede ampliar en los planes de pago, pero no reducir). Para uso real, Hobby o superior.
- Este monorepo en GitHub, conectado a Railway.
- Un dominio propio en el que puedas crear registros DNS. Los dominios `*.up.railway.app` no sirven: `up.railway.app` está en la Public Suffix List, el navegador trata cada servicio como un sitio distinto y la cookie de sesión no viaja. La API, `collab` y el build de la web se niegan a arrancar con ellos.
- Una cuenta de [Resend](https://resend.com) con tu dominio verificado. Railway bloquea el SMTP saliente en los planes Free, Trial y Hobby; solo Pro o superior pueden usar SMTP.
- Opcional: un proyecto de Google Cloud para entrar con Google y una clave de un proveedor de IA.
- Para generar los secretos: PowerShell (Windows) u `openssl` (Linux o macOS).

## Cómo funciona el disco local

Parcify admite dos formas de guardar las imágenes, elegidas con `STORAGE_DRIVER`: `s3` (un bucket) o `local` (una carpeta). Con `local`:

- La API guarda los ficheros dentro de `STORAGE_LOCAL_PATH` y los sirve ella misma. El navegador sube a `PUT https://api.parcify.midominio.com/v1/assets/uploads/{id}/content` y descarga de `GET https://api.parcify.midominio.com/v1/files/...`, siempre con URLs firmadas con `STORAGE_URL_SECRET` que caducan solas.
- El volumen se monta solo en `api`. `collab` no lee ni escribe ficheros y `web` es estática: el navegador pide las imágenes a la API. Por eso la limpieza de subidas abandonadas y el borrado definitivo de la papelera corren en la API cuando el driver es `local`.
- `collab` valida la misma configuración al arrancar, así que también necesita `STORAGE_DRIVER=local`, una `STORAGE_LOCAL_PATH` cualquiera y una `STORAGE_URL_SECRET` válida, aunque no las use. Lo más sencillo es darle la misma `STORAGE_URL_SECRET` que a la API mediante una variable compartida.
- La API tiene que ser una sola réplica. Railway no admite réplicas con volumen y un volumen no se comparte entre servicios.
- Al redesplegar `api` hay un corte breve (unos segundos): Railway no deja dos despliegues montando el mismo volumen a la vez, aunque haya healthcheck. Los editores abiertos reconectan solos.
- Railway monta el volumen como root y la imagen del servidor corre con el usuario `node`, que no podría escribir en él. Se resuelve con la variable `RAILWAY_RUN_UID=0` en `api`, que hace que Railway ejecute el contenedor como root.

Si en algún momento necesitas varias réplicas de la API, pasa a S3 ([Pasar de disco local a S3](#pasar-de-disco-local-a-s3)).

## Despliegue en Railway con disco local

### 1. Ajustar las réplicas de la API en el repo

Con volumen, Railway solo admite una réplica por servicio. `server/railway.api.json` ya viene con `"numReplicas": 1`. Si en algún momento lo subes a más réplicas (por ejemplo, al pasar a S3), vuelve a ponerlo en 1 antes de conectar un volumen. El bloque `deploy` debe quedar así:

```json
  "deploy": {
    "startCommand": "node dist/api/main.js",
    "preDeployCommand": "npx prisma migrate deploy",
    "preDeployTimeoutSeconds": 300,
    "healthcheckPath": "/ready",
    "healthcheckTimeout": 60,
    "numReplicas": 1,
    "drainingSeconds": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
```

`server/railway.collab.json` se queda como está (dos réplicas): `collab` no lleva volumen.

### 2. Crear el proyecto, Postgres y Redis

1. En Railway, crea un proyecto nuevo.
2. Añade una base de datos PostgreSQL y una Redis desde las plantillas de Railway (botón «Create» o «+ New» → Database).
3. Deja sus nombres como `Postgres` y `Redis`. Las referencias de esta guía (`${{Postgres.DATABASE_URL}}` y `${{Redis.REDIS_URL}}`) usan esos nombres; si los cambias, cambia también las referencias.

No hace falta añadirles variables ni dominio público.

### 3. Generar los secretos

Necesitas tres secretos distintos de al menos 32 caracteres. Ninguno puede repetirse: la API y `collab` no arrancan si dos coinciden.

| Secreto | Para qué | Dónde va |
|---|---|---|
| `BETTER_AUTH_SECRET` | Firma las sesiones | Solo `api` |
| `COLLAB_TOKEN_SECRET` | Firma los tokens de conexión a `collab` | `api` y `collab` (el mismo valor) |
| `STORAGE_URL_SECRET` | Firma las URLs de subida y descarga de ficheros | `api` y `collab` (el mismo valor) |
| `METRICS_TOKEN` (opcional) | Protege `/metrics` (mínimo 16 caracteres) | `api` y `collab` |

Genera cada uno por separado (ejecuta el comando una vez por secreto).

PowerShell (Windows PowerShell 5.1 o PowerShell 7):

```powershell
$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

bash (Linux, macOS o WSL):

```bash
openssl rand -base64 48
```

Cada comando imprime 64 caracteres. Guárdalos en un gestor de contraseñas; no los pegues en el repo.

### 4. Variables compartidas

Las variables que `api` y `collab` deben tener iguales se definen una sola vez como variables compartidas del proyecto, para que no diverjan. En Railway: Project Settings → Shared Variables. Crea estas cinco:

| Variable compartida | Valor de ejemplo |
|---|---|
| `API_ORIGIN` | `https://api.parcify.midominio.com` |
| `COLLAB_ORIGIN` | `https://collab.parcify.midominio.com` |
| `CLIENT_ORIGINS` | `https://parcify.midominio.com` |
| `COLLAB_TOKEN_SECRET` | El secreto generado en el paso 3 |
| `STORAGE_URL_SECRET` | El secreto generado en el paso 3 |

Desde cada servicio se referencian con `${{shared.NOMBRE}}`, por ejemplo `${{shared.API_ORIGIN}}`. Los orígenes van con `https://`, sin barra final y sin ruta. `CLIENT_ORIGINS` admite varios separados por comas (por ejemplo, si también sirves `https://www.parcify.midominio.com`).

### 5. Servicio api con su volumen

1. En el proyecto, «+ New» → GitHub Repo → este monorepo. Renombra el servicio a `api`.
2. En Settings del servicio:
   - Source → Root Directory: `/server`.
   - Config-as-code → Railway Config File: `/server/railway.api.json`.
3. Crea un volumen y conéctalo a `api` (desde el menú del servicio en el lienzo del proyecto, o con Ctrl/⌘ + K → Volume). Ruta de montaje: `/data`.
4. En Variables, añade las de la tabla. Puedes pegarlas todas a la vez con el Raw Editor.

Variables de `api`:

| Variable | Obligatoria | Valor de ejemplo | De dónde sale |
|---|---|---|---|
| `NODE_ENV` | Sí | `production` | Fijo. La imagen ya lo trae, pero conviene declararlo |
| `API_ORIGIN` | Sí | `${{shared.API_ORIGIN}}` | Variable compartida (paso 4) |
| `COLLAB_ORIGIN` | Sí | `${{shared.COLLAB_ORIGIN}}` | Variable compartida |
| `CLIENT_ORIGINS` | Sí | `${{shared.CLIENT_ORIGINS}}` | Variable compartida |
| `TRUST_PROXY_HOPS` | Recomendada | `1` | Fijo: hay un proxy de Railway delante. Sin ella todas las peticiones parecen venir de la misma IP y los límites por IP se comparten (la API avisa en el log) |
| `DATABASE_URL` | Sí | `${{Postgres.DATABASE_URL}}` | Referencia al servicio `Postgres` (red privada) |
| `REDIS_URL` | Sí | `${{Redis.REDIS_URL}}` | Referencia al servicio `Redis` (red privada) |
| `BETTER_AUTH_SECRET` | Sí | `<secreto>` | Paso 3 |
| `COLLAB_TOKEN_SECRET` | Sí | `${{shared.COLLAB_TOKEN_SECRET}}` | Variable compartida |
| `STORAGE_DRIVER` | Sí | `local` | Fijo |
| `STORAGE_LOCAL_PATH` | Sí | `/data` | La ruta de montaje del volumen. Tienen que coincidir exactamente |
| `STORAGE_URL_SECRET` | Sí | `${{shared.STORAGE_URL_SECRET}}` | Variable compartida |
| `RAILWAY_RUN_UID` | Sí (por el volumen) | `0` | Variable de Railway, no la lee Parcify. Sin ella la API no puede escribir en `/data` |
| `MAIL_DRIVER` | Sí | `resend` | Ver [Correo](#correo). `smtp` solo en el plan Pro; `console` no se admite en producción |
| `MAIL_FROM` | Sí | `Parcify <no-reply@midominio.com>` | Una dirección de un dominio verificado en Resend |
| `RESEND_API_KEY` | Sí con `resend` | `re_...` | Panel de Resend → API Keys |
| `SMTP_URL` | Sí con `smtp` | `smtps://usuario:contraseña@smtp.proveedor.com:465` | Tu proveedor de SMTP |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No (las dos o ninguna) | | [Google OAuth](#google-oauth-opcional) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | No | | [IA](#ia-opcional) |
| `OPENAI_BASE_URL` | No | `https://openrouter.ai/api/v1` | Solo con una API compatible con OpenAI. No la crees vacía |
| `AI_MODEL_ASSISTANT`, `AI_MODEL_ANIMATION`, `AI_MODEL_CHAT`, `AI_MODEL_IMAGE`, `AI_MODEL_VISION` | No | `openai:<modelo>` | [IA](#ia-opcional) |
| `AI_QUOTA_WORKSPACE_MONTHLY_UNITS` | No | `2000` (por defecto) | Unidades de IA al mes por espacio |
| `AI_QUOTA_USER_DAILY_UNITS` | No | `100` (por defecto) | Unidades de IA al día por usuario |
| `AI_IMAGE_DOWNLOAD_HOSTS` | No | vacío (por defecto) | Hosts desde los que la API puede descargar imágenes generadas, si un proveedor devuelve URLs en lugar de bytes |
| `DATABASE_POOL_MAX` | No | `10` (por defecto en `api`) | Conexiones a Postgres por proceso |
| `METRICS_TOKEN` | No | `<secreto de 16+ caracteres>` | Paso 3. Sin él, `/metrics` responde 401 |
| `SENTRY_DSN` | No | `https://...@....ingest.sentry.io/...` | Tu proyecto de Sentry |
| `LOG_LEVEL` | No | `info` (por defecto) | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `INSTANCE_ID` | No | | Por defecto usa `RAILWAY_REPLICA_ID`, que pone Railway |

No definas `PORT`: la pone Railway y la API escucha en ella. Tampoco hacen falta las `S3_*` con disco local.

Bloque para el Raw Editor de `api` (sustituye lo que va entre `<>` y quita las líneas que no uses):

```
NODE_ENV=production
API_ORIGIN=${{shared.API_ORIGIN}}
COLLAB_ORIGIN=${{shared.COLLAB_ORIGIN}}
CLIENT_ORIGINS=${{shared.CLIENT_ORIGINS}}
TRUST_PROXY_HOPS=1
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
BETTER_AUTH_SECRET=<secreto>
COLLAB_TOKEN_SECRET=${{shared.COLLAB_TOKEN_SECRET}}
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data
STORAGE_URL_SECRET=${{shared.STORAGE_URL_SECRET}}
RAILWAY_RUN_UID=0
MAIL_DRIVER=resend
MAIL_FROM=Parcify <no-reply@midominio.com>
RESEND_API_KEY=<clave de Resend>
```

Notas:

- Railway puede sugerir variables leyendo `server/.env.example`. No las aceptes: son de desarrollo (`NODE_ENV=development`, `MAIL_DRIVER=console`, orígenes `localhost`) y la API no arrancaría.
- `REDIS_URL` no necesita `?family=0`. La red privada de Railway puede resolver solo a IPv6 y el cliente de Redis del servidor ya se crea con `family: 0` (IPv4 e IPv6).
- Marca como selladas (sealed) las variables con secretos, para que no se vuelvan a mostrar en el panel.

### 6. Servicio collab

1. «+ New» → GitHub Repo → el mismo monorepo. Renombra el servicio a `collab`.
2. Settings → Root Directory: `/server`. Config-as-code: `/server/railway.collab.json`.
3. Sin volumen.
4. Variables:

| Variable | Obligatoria | Valor de ejemplo | De dónde sale |
|---|---|---|---|
| `NODE_ENV` | Sí | `production` | Fijo |
| `API_ORIGIN` | Sí | `${{shared.API_ORIGIN}}` | Variable compartida |
| `COLLAB_ORIGIN` | Sí | `${{shared.COLLAB_ORIGIN}}` | Variable compartida |
| `CLIENT_ORIGINS` | Sí | `${{shared.CLIENT_ORIGINS}}` | Variable compartida |
| `DATABASE_URL` | Sí | `${{Postgres.DATABASE_URL}}` | Referencia a `Postgres` |
| `REDIS_URL` | Sí | `${{Redis.REDIS_URL}}` | Referencia a `Redis` |
| `COLLAB_TOKEN_SECRET` | Sí | `${{shared.COLLAB_TOKEN_SECRET}}` | Variable compartida (igual que en `api`) |
| `STORAGE_DRIVER` | Sí | `local` | Fijo, igual que en `api` |
| `STORAGE_LOCAL_PATH` | Sí | `/data` | Lo exige la validación; `collab` no escribe nada ahí |
| `STORAGE_URL_SECRET` | Sí | `${{shared.STORAGE_URL_SECRET}}` | Variable compartida |
| `COLLAB_MAX_CONN_PER_DOC` | No | `100` (por defecto) | Conexiones por documento y réplica |
| `DATABASE_POOL_MAX` | No | `5` (por defecto en `collab`) | Conexiones a Postgres por proceso |
| `TRUST_PROXY_HOPS` | No | `1` | `collab` no la usa; ponerla solo quita el aviso del log |
| `METRICS_TOKEN`, `SENTRY_DSN`, `LOG_LEVEL`, `INSTANCE_ID` | No | | Como en `api` |

Bloque para el Raw Editor de `collab`:

```
NODE_ENV=production
API_ORIGIN=${{shared.API_ORIGIN}}
COLLAB_ORIGIN=${{shared.COLLAB_ORIGIN}}
CLIENT_ORIGINS=${{shared.CLIENT_ORIGINS}}
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
COLLAB_TOKEN_SECRET=${{shared.COLLAB_TOKEN_SECRET}}
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data
STORAGE_URL_SECRET=${{shared.STORAGE_URL_SECRET}}
```

No pongas en `collab` las variables de correo (si defines `MAIL_DRIVER`, también te pedirá `MAIL_FROM`), ni las de Google o IA, ni `RAILWAY_RUN_UID`. `BETTER_AUTH_SECRET` tampoco hace falta.

`collab` no llama a la API por HTTP: se comunican por Redis. Por eso ninguna variable usa `${{api.RAILWAY_PRIVATE_DOMAIN}}` ni la red privada hacia `api`.

### 7. Servicio web

1. «+ New» → GitHub Repo → el mismo monorepo. Renombra el servicio a `web`.
2. Settings → Root Directory: `/client`. Config-as-code: `/client/railway.json`.
3. Variables. Se usan al compilar (el `Dockerfile` las declara con `ARG` y Railway se las pasa al build), quedan incrustadas en la web y entran en su política de seguridad (CSP). Cualquier cambio exige un despliegue nuevo de `web`.

| Variable | Obligatoria | Valor de ejemplo | De dónde sale |
|---|---|---|---|
| `PUBLIC_SITE_ORIGIN` | Sí | `https://parcify.midominio.com` | El dominio de la web. Tiene que estar en `CLIENT_ORIGINS` |
| `PUBLIC_API_ORIGIN` | Sí | `${{shared.API_ORIGIN}}` | El mismo valor que `API_ORIGIN` |
| `PUBLIC_COLLAB_ORIGIN` | Sí | `${{shared.COLLAB_ORIGIN}}` | El mismo valor que `COLLAB_ORIGIN` |
| `PUBLIC_STORAGE_ORIGIN` | Sí | `${{shared.API_ORIGIN}}` | Con disco local, el origen de la API, porque es quien sirve las imágenes |
| `PUBLIC_SENTRY_DSN` | No | | DSN de Sentry para el navegador |

```
PUBLIC_SITE_ORIGIN=https://parcify.midominio.com
PUBLIC_API_ORIGIN=${{shared.API_ORIGIN}}
PUBLIC_COLLAB_ORIGIN=${{shared.COLLAB_ORIGIN}}
PUBLIC_STORAGE_ORIGIN=${{shared.API_ORIGIN}}
```

Si falta alguna de las cuatro primeras, no es un origen válido o usa `*.up.railway.app`, el build se detiene en `scripts/public-env-check.ts` con un mensaje que dice cuál. `PORT` la pone Railway (Caddy escucha en ella; 8080 si no existe). `PUBLIC_TEST_HOOKS`, `PARCIFY_SERVER_DIR` y `PARCIFY_BENCH` de `client/.env.example` son de pruebas: no las pongas.

### 8. Dominios, CORS y cookies

En Settings → Networking de cada servicio, añade su dominio propio (Custom Domain):

| Servicio | Dominio |
|---|---|
| `web` | `parcify.midominio.com` |
| `api` | `api.parcify.midominio.com` |
| `collab` | `collab.parcify.midominio.com` |

Crea en tu DNS los registros que te indique Railway para cada uno y espera a que aparezcan como verificados. El certificado TLS lo pone Railway. El proxy de Railway admite WebSocket, así que `collab` no necesita nada más. `Postgres` y `Redis` no llevan dominio público.

Los tres dominios tienen que compartir dominio registrable (aquí, `midominio.com`); si no, la API y `collab` no arrancan. La web también puede ir en el dominio raíz (`midominio.com`) con `api.midominio.com` y `collab.midominio.com`. Para un entorno de pruebas, usa otro nivel del mismo dominio: `staging.midominio.com`, `api.staging.midominio.com`, `collab.staging.midominio.com`.

Cómo encajan la sesión y CORS:

- La cookie de sesión (prefijo `parcify`) la pone la API en su propio host, `api.parcify.midominio.com`, con `Secure` en producción y sin atributo `Domain`. No se comparte entre subdominios ni hace falta: la web llama a la API con credenciales y, como las dos son el mismo sitio, el navegador la envía.
- `CLIENT_ORIGINS` tiene que contener exactamente el origen desde el que se abre la web. Con ese valor se configuran el CORS de la API y los `trustedOrigins` de Better Auth.
- Better Auth usa `API_ORIGIN` como `baseURL`: las rutas de autenticación viven en `https://api.parcify.midominio.com/api/auth/...`.
- `API_ORIGIN` y `COLLAB_ORIGIN` tienen que coincidir con `PUBLIC_API_ORIGIN` y `PUBLIC_COLLAB_ORIGIN` de `web`. La URL del WebSocket la devuelve la API a partir de `COLLAB_ORIGIN`.

### 9. Primer despliegue y migraciones

Railway despliega cada servicio al crearlo y cada vez que guardas variables (pulsa «Deploy» para aplicar los cambios pendientes). Si un primer despliegue falla porque aún no había variables, es normal: vuelve a desplegar cuando estén.

En cada despliegue de `api` y `collab`, Railway:

1. Construye la imagen con `server/Dockerfile`.
2. Ejecuta el pre-deploy `npx prisma migrate deploy` con la imagen nueva y las variables del servicio. Aplica las migraciones pendientes de `server/prisma/migrations` sobre `DATABASE_URL`. Si `api` y `collab` lo lanzan a la vez no se pisan: Prisma toma un bloqueo en Postgres y el segundo no encuentra nada pendiente. El volumen no está montado en esta fase y no hace falta.
3. Arranca el proceso y espera a que `/ready` responda 200 (hasta 60 s).

No hay que ejecutar las migraciones a mano. Si el pre-deploy falla, el despliegue se detiene y sigue funcionando el anterior.

Si `api` o `collab` no pasan el healthcheck, abre Deployments → el despliegue → Deploy Logs. Cuando la configuración no vale, el proceso escribe «Configuración inválida» con la lista de problemas (nombra las variables, nunca muestra los secretos) y termina.

### 10. Comprobaciones

Desde una terminal (en Windows, `curl.exe`):

```bash
curl https://api.parcify.midominio.com/health
# {"status":"ok"}
curl https://api.parcify.midominio.com/ready
# {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}
curl https://collab.parcify.midominio.com/ready
# {"status":"ok","checks":{"postgres":"ok","redis":"ok","documents":"ok"}}
curl https://api.parcify.midominio.com/v1/meta
# authProviders: ["email"] (o ["email","google"] con Google)
# aiFeatures: assistant, animation, chat, image y vision a true o false según los modelos configurados
```

Después, en el navegador:

1. Abre `https://parcify.midominio.com`, regístrate con tu email y escribe el código que llega por correo.
2. Recarga `https://parcify.midominio.com/app`: debes seguir dentro.
3. Crea un proyecto y sube una imagen. Su dirección (clic derecho → abrir imagen en otra pestaña) empieza por `https://api.parcify.midominio.com/v1/files/`.
4. Redespliega `api` (Deployments → Redeploy) y comprueba que la imagen sigue ahí: eso confirma que el volumen está bien montado.
5. Abre el mismo proyecto en dos navegadores con dos cuentas y comprueba que los cambios y los cursores se ven en los dos.
6. En los Deploy Logs de `api` es normal ver el aviso «STORAGE_DRIVER=local en producción: la API debe tener una sola réplica con volumen persistente». No debería aparecer el de `TRUST_PROXY_HOPS=0`.

## Correo

El correo es obligatorio: sin él no llegan los códigos de verificación, la recuperación de contraseña ni las invitaciones. Solo lo envía `api`.

Resend (recomendado; el único que funciona en Railway Free, Trial y Hobby, porque va por HTTPS):

1. En Resend, añade y verifica tu dominio (crea en tu DNS los registros SPF y DKIM que te indique).
2. Crea una API key con permiso de envío.
3. En `api`:

   ```
   MAIL_DRIVER=resend
   RESEND_API_KEY=re_...
   MAIL_FROM=Parcify <no-reply@midominio.com>
   ```

SMTP (solo en Railway Pro o superior):

```
MAIL_DRIVER=smtp
SMTP_URL=smtps://usuario:contraseña@smtp.proveedor.com:465
MAIL_FROM=Parcify <no-reply@midominio.com>
```

Codifica en la URL los caracteres especiales de la contraseña (por ejemplo, `@` como `%40`). `MAIL_FROM` tiene que ser de un dominio verificado en el proveedor; con SPF y DKIM configurados los códigos no acaban en spam.

## Google OAuth (opcional)

1. En Google Cloud Console, crea un cliente OAuth de tipo «Aplicación web».
2. Añade esta URI de redirección autorizada, exactamente (la redirección vuelve a la API, no a la web):

   ```
   https://api.parcify.midominio.com/api/auth/callback/google
   ```

3. Copia el id y el secreto en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` de `api`. Van las dos o ninguna.

Sin ellas, el botón de Google no aparece. Si la pantalla de consentimiento está en modo de pruebas, solo pueden entrar los usuarios que añadas allí.

## IA (opcional)

Sin ningún `AI_MODEL_*`, las funciones de IA no aparecen en la interfaz. Para activarlas, pon en `api` la clave del proveedor y el modelo de cada función con el formato `proveedor:modelo`:

| Proveedor | Clave | Ejemplo de modelo |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `AI_MODEL_CHAT=openai:<modelo>`, `AI_MODEL_IMAGE=openai:<modelo de imagen>` |
| Anthropic | `ANTHROPIC_API_KEY` | `AI_MODEL_CHAT=anthropic:<modelo>` (no genera imágenes) |
| Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | `AI_MODEL_CHAT=google:<modelo>` |
| API compatible con OpenAI (OpenRouter, Groq, Ollama…) | `OPENAI_API_KEY` con la clave de ese servicio y `OPENAI_BASE_URL` con su URL | `AI_MODEL_CHAT=openai:<id del modelo en ese servicio>` |

| Función | Variable |
|---|---|
| Asistente del lienzo | `AI_MODEL_ASSISTANT` |
| Animaciones | `AI_MODEL_ANIMATION` |
| Chat de IA del proyecto | `AI_MODEL_CHAT` |
| Imágenes | `AI_MODEL_IMAGE` |
| Describir imágenes adjuntas | `AI_MODEL_VISION` (si falta, usa el del asistente) |

A tener en cuenta:

- Si un `AI_MODEL_*` apunta a un proveedor sin clave, la API no arranca y lo dice en el log.
- No crees `OPENAI_BASE_URL` vacía: si no usas una API compatible, no la definas.
- Cuotas por defecto: 2000 unidades al mes por espacio (`AI_QUOTA_WORKSPACE_MONTHLY_UNITS`) y 100 al día por usuario (`AI_QUOTA_USER_DAILY_UNITS`). Asistente, animación y mensaje de chat cuestan 1 unidad; cada imagen, 4.
- El servidor corta cada petición de texto a los 60 s y cada generación de imagen a los 120 s. Son constantes del código (`AI_TEXT_TIMEOUT_MS` y `AI_IMAGE_TIMEOUT_MS` en `server/src/core/ai/errors.ts`), no variables de entorno. Un modelo lento puede no llegar a tiempo.
- La calidad, la velocidad y el formato de las respuestas dependen del modelo y del proveedor elegidos. Las capturas del README se hicieron en local con Ollama y `qwen2.5:1.5b` en CPU.

Lista completa de funciones y detalles: sección «IA» de [server/README.md](server/README.md#ia).

## Copias de seguridad

Hay dos cosas que guardar: el volumen de `api` (las imágenes) y Postgres (todo lo demás). Redis no hace falta copiarlo: lo que guarda caduca solo o se reconstruye desde Postgres (caché de sesiones, contadores de cuota, bloqueos y trabajos en curso).

Copias en Railway, para el volumen de `api` y para `Postgres`:

1. Abre el servicio → pestaña Backups.
2. Activa una o varias programaciones: diaria (se guarda 6 días), semanal (27 días) o mensual (89 días). También puedes crear una copia manual en cualquier momento (como mucho, del 50 % del tamaño del volumen).
3. Para restaurar, pulsa Restore en la copia. Railway monta un volumen nuevo en la misma ruta, deja el anterior desconectado y prepara el cambio: revísalo y pulsa Deploy.

Las copias de Railway viven en el mismo proyecto y entorno; si se vacía (wipe) el volumen, se borran todas. Conviene tener además una copia fuera de Railway:

- Imágenes: con la [CLI de Railway](https://docs.railway.com/cli), `railway volume browse` o `railway volume files` sobre el volumen de `api` (también por SFTP o SCP a través de `railway ssh`).
- Postgres: copia la URL pública de conexión del servicio `Postgres` (pestaña Connect) y ejecuta desde tu equipo:

  ```bash
  pg_dump -Fc "<URL pública de Postgres>" -f parcify-$(date +%Y%m%d).dump
  ```

  Para restaurar: `pg_restore --clean --if-exists -d "<URL pública de Postgres>" parcify-AAAAMMDD.dump`. Usa una versión de `pg_dump` igual o más nueva que la del servidor.

Haz una copia antes de cada actualización.

## Actualizar

1. Haz una copia del volumen y de Postgres.
2. Sube los cambios a la rama que despliega Railway.
3. Railway redespliega solo lo que cambió: un cambio en `server/` redespliega `api` y `collab`; uno en `client/`, solo `web`.
4. Las migraciones nuevas se aplican solas en el pre-deploy.

`api` tiene unos segundos de corte en cada despliegue por el volumen. `collab` cambia de réplica sin corte (30 s de draining) y los editores abiertos reconectan solos. Como el código anterior sigue vivo mientras se despliega el nuevo, cada migración tiene que ser compatible con él: primero se añade una columna o tabla y, en otro despliegue, se quita lo viejo.

Si cambias un dominio, cambia las variables compartidas y las `PUBLIC_*` y redespliega los tres servicios.

## Problemas frecuentes

- La API no arranca y el log dice `EACCES` o «permission denied» en `/data`. Falta `RAILWAY_RUN_UID=0` en `api`.
- Las imágenes desaparecen después de un despliegue. El volumen no está montado o su ruta no coincide con `STORAGE_LOCAL_PATH`. Revisa en `api` que el volumen exista y que ambos sean `/data`.
- Railway no deja desplegar `api` por las réplicas, o no deja conectar el volumen. `numReplicas` en `server/railway.api.json` es mayor que 1 (paso 1); el archivo manda sobre el panel.
- `api` o `collab` no pasan el healthcheck y el log empieza por «Configuración inválida». La lista dice qué variable falta o no vale. Las causas más comunes: secretos repetidos o de menos de 32 caracteres, orígenes que no comparten dominio, `http://` en lugar de `https://`, `MAIL_DRIVER=console`, o `collab` sin `STORAGE_LOCAL_PATH` o `STORAGE_URL_SECRET`.
- El build de `web` falla con «Variables PUBLIC_* inválidas». Falta una de las cuatro `PUBLIC_*` de origen, tiene ruta o usa `*.up.railway.app`.
- Entras, pero al recargar vuelves a la landing o la API responde 401. Abre la web exactamente en el origen de `CLIENT_ORIGINS` (no en `*.up.railway.app` ni en `www.` si no lo has añadido) y comprueba que los tres dominios cuelgan del mismo dominio registrable.
- El navegador bloquea la API por CORS. `CLIENT_ORIGINS` no coincide con el origen de la web (ojo con la barra final y con `www.`).
- Las imágenes no cargan y la consola habla de CSP (`img-src` o `connect-src`). `PUBLIC_STORAGE_ORIGIN` no es el origen de la API. Corrígelo y redespliega `web`.
- El editor se queda en «Conectando…». Comprueba `https://collab.parcify.midominio.com/ready`, que `COLLAB_ORIGIN` sea ese dominio y que `COLLAB_TOKEN_SECRET` sea el mismo en `api` y `collab`.
- No llega el correo. Con `smtp` en un plan que no es Pro, Railway bloquea la conexión: usa `resend`. Con Resend, el dominio de `MAIL_FROM` tiene que estar verificado. Mira también la carpeta de spam.
- El log de `api` avisa de `TRUST_PROXY_HOPS=0`. Añade `TRUST_PROXY_HOPS=1`.
- La API no arranca tras añadir IA. Un `AI_MODEL_*` apunta a un proveedor sin clave, no tiene la forma `proveedor:modelo` o `OPENAI_BASE_URL` existe pero está vacía.
- El volumen se llena. Amplíalo desde el servicio (en los planes de pago se amplía sin parar el servicio; no se puede reducir).

## Pasar de disco local a S3

Si necesitas varias réplicas de la API o no quieres depender del volumen, usa un bucket S3 compatible (por ejemplo, Cloudflare R2):

1. Crea un bucket privado y un token con lectura y escritura limitado a ese bucket.
2. Añade al bucket una regla CORS que permita `GET`, `HEAD` y `PUT` desde el origen de la web con la cabecera `content-type`.
3. En `api` y `collab`: `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<id de cuenta>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `S3_FORCE_PATH_STYLE=true`. Quita `STORAGE_LOCAL_PATH`, `STORAGE_URL_SECRET` y `RAILWAY_RUN_UID`.
4. En `web`, `PUBLIC_STORAGE_ORIGIN` pasa a ser el origen de `S3_ENDPOINT`. Redespliega `web`.

Los ficheros que ya estén en el volumen no se copian solos al bucket: hay que subirlos con las mismas rutas (`a/...`) antes del cambio. Este paso no tiene script en el repo.

## Local con Docker

Requisitos: Node.js 24.11 o posterior y Docker con Docker Compose.

### Desarrollo

Servidor (una terminal, desde `server/`):

```powershell
npm ci
Copy-Item .env.example .env   # rellena BETTER_AUTH_SECRET y COLLAB_TOKEN_SECRET (32+ caracteres, distintos)
npm run stack:dev:up          # Postgres en 127.0.0.1:55432 y Redis en 127.0.0.1:56379
npx prisma migrate dev        # aplica las migraciones
npm run dev                   # api en http://localhost:3000 y collab en http://localhost:3001
```

`server/.env.example` ya viene con `STORAGE_DRIVER=local`: rellena también `STORAGE_LOCAL_PATH` (una carpeta de tu equipo) y `STORAGE_URL_SECRET` (otro secreto distinto).

Cliente (otra terminal, desde `client/`):

```powershell
npm ci
Copy-Item .env.example .env
npm run dev                   # http://localhost:4321
```

Con `MAIL_DRIVER=console` los códigos de verificación salen en la consola del servidor. Para parar los contenedores sin perder datos: `npm run stack:dev:down` en `server/`.

Si cambias algo en `server/src/shared/`, ejecuta `npm run shared:hash` en `server/` y después `npm run shared:sync` en `client/`.

Comprobaciones antes de subir cambios:

| Carpeta | Comandos |
|---|---|
| `server/` | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| `client/` | `npm run check`, `npm run lint`, `npm test`, `npm run build` |

### Local tipo producción

`server/compose.local.yml` (proyecto `parcify-local`) levanta Parcify con las imágenes de producción, Caddy con certificados internos, SeaweedFS como S3 y Mailpit para el correo. Desde `server/`:

```powershell
powershell -ExecutionPolicy Bypass -File local-deploy\new-secrets.ps1   # crea .env.local-deploy (una sola vez)
docker compose -f compose.local.yml up -d --build --wait
Import-Certificate -FilePath .\local-deploy\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Reinicia el navegador después de importar el certificado (en Firefox, activa `security.enterprise_roots.enabled` en `about:config`).

- Web: https://parcify.localhost
- API y colaboración: https://api.parcify.localhost y https://collab.parcify.localhost
- Correo (Mailpit): http://localhost:8025

Necesita libres los puertos 443 y 8025. Este compose usa S3 (SeaweedFS), no disco local. Parar, resetear y limitaciones: «Despliegue local con Docker» en [server/README.md](server/README.md#despliegue-local-con-docker).

## VPS con Docker

`deploy/compose.prod.yml` levanta todo en un solo servidor: Caddy (`proxy`, con certificados de Let's Encrypt), `web`, `api`, `collab`, `migrate`, Postgres, Redis y, con el perfil `s3`, SeaweedFS como bucket. Este compose fija `STORAGE_DRIVER: s3`: usa el SeaweedFS incluido o un S3 externo como R2. El disco local no está previsto aquí sin editar el compose.

Requisitos: un VPS Linux (Ubuntu 24.04 o Debian 12) con al menos 2 vCPU y 4 GB de RAM (con 2 GB, añade swap), Docker Engine con el plugin de Compose, los puertos 80 y 443 abiertos y un dominio.

1. DNS: registros A (y AAAA si hay IPv6) hacia la IP del VPS para `parcify.midominio.com`, `api.parcify.midominio.com`, `collab.parcify.midominio.com` y, con el S3 incluido, `s3.parcify.midominio.com`. Con Cloudflare, en «DNS only» (nube gris).
2. Configuración:

   ```bash
   git clone https://github.com/Parcify-Oficial/Parcify.git parcify
   cd parcify
   bash deploy/scripts/new-env.sh parcify.midominio.com tu@correo.com
   ```

   El script crea `deploy/.env` con el dominio y secretos aleatorios (no sobrescribe uno existente). En Windows: `deploy\scripts\new-env.ps1 -Domain parcify.midominio.com -AcmeEmail tu@correo.com`. Completa en `deploy/.env` el correo, y si quieres Google e IA, igual que en las secciones de arriba. Para R2 en lugar del S3 incluido, deja `COMPOSE_PROFILES` vacío y rellena las `S3_*`.
3. Arrancar: `docker compose -f deploy/compose.prod.yml up -d --build`. La primera vez construye las imágenes, aplica las migraciones (servicio `migrate`) y pide los certificados.
4. Comprobar: `curl https://api.parcify.midominio.com/ready` y `curl https://collab.parcify.midominio.com/ready`.
5. Copias: `bash deploy/scripts/backup.sh backup` (Postgres y bucket en `deploy/backups/<fecha>/`) y `bash deploy/scripts/backup.sh restore deploy/backups/<fecha>`. Guárdalas también fuera del VPS.
6. Actualizar: `git pull` y `docker compose -f deploy/compose.prod.yml up -d --build`.
7. Firewall: `ufw` con OpenSSH, 80/tcp, 443/tcp y 443/udp. Solo Caddy publica puertos. No uses `down -v`: borra los volúmenes con los datos.

Si el certificado no sale, casi siempre es el DNS o los puertos 80 y 443 cerrados: mira `docker compose -f deploy/compose.prod.yml logs proxy`.

## Seguridad

- No subas nunca ningún `.env` real (`deploy/.env`, `server/.env`, `client/.env`, `server/.env.local-deploy`). Solo se versionan los `.env.example`. Tampoco subas `deploy/backups/`.
- En Railway, sella las variables con secretos y no aceptes las variables sugeridas a partir de los `.env.example`.
- El workflow «Secretos» pasa `gitleaks` en cada push y pull request. Si se cuela un secreto, rótalo: borrarlo del repo no basta.
- Rotar secretos: cambiar `BETTER_AUTH_SECRET` cierra todas las sesiones; `COLLAB_TOKEN_SECRET` solo obliga a reconectar a los editores; `STORAGE_URL_SECRET` invalida las URLs de imágenes ya firmadas (la web pide otras al recargar). Las claves de Resend, Google e IA se rotan en el panel de cada proveedor.
- El historial antiguo del repositorio `Parcify-Oficial/Parcify` contenía credenciales del Parcify anterior. Dalas por comprometidas y rótalas en cada servicio aunque ya no estén en la rama actual. Subir Parcify v2 encima no las borra del historial; para que desaparezcan hay que reescribirlo (por ejemplo, con `git filter-repo`) o empezar un repositorio nuevo, y aun así deben rotarse.
