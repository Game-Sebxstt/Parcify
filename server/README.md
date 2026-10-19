# Parcify: servidor (`server/`)

Servidor de Parcify: la API REST (Fastify) y el servidor de colaboración en tiempo real (Hocuspocus). Los dos salen del mismo código y de la misma imagen Docker, pero se ejecutan como procesos separados:

- `api`: `node dist/api/main.js`, puerto 3000 en desarrollo.
- `collab`: `node dist/collab/main.js`, puerto 3001 en desarrollo.

## Requisitos

- Node.js 24.11 o posterior.
- Docker con Docker Compose (para Postgres, Redis y, si hace falta, el S3 local).

## Puesta en marcha

```powershell
npm ci
Copy-Item .env.example .env   # y rellena los secretos (al menos 32 caracteres cada uno)
npm run stack:dev:up          # Postgres en 127.0.0.1:55432 y Redis en 127.0.0.1:56379
npx prisma migrate dev        # aplica las migraciones
npm run dev                   # api en :3000 y collab en :3001 con recarga automática
```

Comprueba que todo responde:

```powershell
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3001/health
```

Para parar los contenedores sin perder los datos: `npm run stack:dev:down`.

Si quieres probar el almacenamiento S3 en local, levanta SeaweedFS con `docker compose -f compose.dev.yml --profile s3 up -d` (escucha en 127.0.0.1:58333).

Los contenedores solo escuchan en `127.0.0.1` y usan puertos propios para no chocar con otros servicios del equipo (por ejemplo, un Redis en el 6379).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca `api` y `collab` con `tsx watch` (requiere el stack de desarrollo arriba) |
| `npm run build` | `prisma generate` y compilación a `dist/` |
| `npm run typecheck` | Comprobación de tipos |
| `npm run lint` | ESLint |
| `npm test` | Pruebas unitarias |
| `npm run stack:test:up` / `stack:test:down` | Stack de pruebas (Postgres en 55433, Redis en 56380; SeaweedFS en 58334 con `--profile s3`). `down` para también SeaweedFS y borra los volúmenes |
| `npm run test:int` | Pruebas de integración contra el stack de pruebas; aplica las migraciones antes de empezar |
| `npm run shared:hash` | Recalcula `src/shared/SHARED_HASH` después de tocar `src/shared` |
| `npm run start:e2e` | `api` y `collab` compilados contra el stack de pruebas, con correo en memoria |
| `npm ls yjs` | Debe mostrar una sola versión de Yjs |

## Configuración

Todas las variables están documentadas en `.env.example`. Solo `src/core/config.ts` lee el entorno: si falta algo o un valor no es válido, el proceso registra el problema y termina con código 1.

Algunas reglas que conviene saber:

- `API_ORIGIN`, `COLLAB_ORIGIN` y `CLIENT_ORIGINS` tienen que compartir dominio registrable (por ejemplo `parcify.app` y `api.parcify.app`). Los dominios `*.up.railway.app` no sirven, porque el navegador los trata como sitios distintos y la cookie de sesión no viajaría.
- `MAIL_DRIVER=console` solo vale fuera de producción, y `memory` solo con `NODE_ENV=test`.
- `BETTER_AUTH_SECRET`, `COLLAB_TOKEN_SECRET` y `STORAGE_URL_SECRET` tienen que ser distintos entre sí.
- `STORAGE_DRIVER` puede ser `s3` o `local`. Con `local` en producción la API debe tener una sola réplica con volumen persistente.
- Las variables `AI_MODEL_*` usan el formato `proveedor:modelo`, y el proveedor necesita su clave (ver «IA»).

## Autenticación

Better Auth 1.7.10 vive en `src/core/auth/` y se monta en `/api/auth/*` desde `src/api/plugins/auth.ts`. El adaptador pasa el cuerpo de la petición sin tocar, construye la URL con `API_ORIGIN` y reescribe siempre la cabecera `x-parcify-client-ip` con `request.ip`; Better Auth solo lee la IP de esa cabecera, así que un `X-Forwarded-For` inventado no cambia su rate limit.

- Sesiones en Postgres y en Redis (`parcify:ba:*`), con caché de cookie de 5 minutos. Las rutas `/v1` que cambian estado consultan la sesión sin caché (`requireSession`), y `requireVerified` exige además el email verificado.
- El inicio de sesión por OTP no existe: las rutas de `DISABLED_AUTH_PATHS` responden 404 y `send-verification-otp` solo admite `email-verification`. La recuperación de contraseña usa `/email-otp/request-password-reset` y `/email-otp/reset-password`.
- Al registrarse se crea el espacio personal (`personal = true`). Si falla, `GET /v1/me` lo vuelve a intentar.
- `DELETE /v1/me` exige una sesión de menos de 2 horas; si no, responde 403 `SESSION_NOT_FRESH`.

Cambio de email, contrastado con la versión instalada: en 1.7.10 `user.changeEmail` de Better Auth solo sabe mandar enlaces con token (`sendChangeEmailConfirmation` a la dirección actual y la verificación por enlace a la nueva), y el reemplazo por OTP de `emailOTP` los descarta. El equivalente documentado que encaja con el resto del producto es el cambio por código del plugin: `emailOTP({ changeEmail: { enabled: true } })` con `/email-otp/request-email-change` (manda el código a la dirección nueva y el aviso `emailChangeNotice` a la actual) y `/email-otp/change-email` (verifica el código y cambia el email ya verificado). Por eso esas dos rutas ya no están en `DISABLED_AUTH_PATHS`; tienen sus límites en `customRules` y exigen sesión. El evento `security.email_changed` se escribe solo desde esas rutas, porque verificar el email al registrarse también escribe el campo.

Ajustes de cuenta:

- `GET /v1/me/security-events` devuelve, paginados por cursor y del más reciente al más antiguo, los eventos `security.*` del propio usuario (`session_created`, `session_revoked`, `email_changed`, `password_changed`, `account_linked`) con IP, navegador y proveedor; nunca ids de sesión.
- `POST /v1/me/password` crea la contraseña de una cuenta que solo entra con Google (`auth.api.setPassword` solo existe en el servidor). Exige sesión fresca como `DELETE /v1/me` y responde 409 si ya hay contraseña. El cambio de una contraseña existente va por `/api/auth/change-password`.

Proyectos: `lastEditedById` guarda quién hizo el último cambio guardado del documento (lo escribe `collab` con el contexto de la última conexión que lo cambió) y los listados lo devuelven como `lastEditedBy: { id, name }`, o `null` si nadie lo ha editado o la cuenta ya no existe.

## Espacios, proyectos y permisos

Los servicios de `src/api/modules/*` reciben un `Actor` (`userId` y `sessionId`) y nunca el `request`. Toda la autorización pasa por `src/core/permissions.ts`:

- `loadWorkspaceAccess` devuelve el espacio y el rol propio. Un espacio en la papelera solo existe para su owner, y para él solo valen `GET /v1/workspaces/:slug` y `POST …/restore`; el resto de rutas del espacio responde 409 `WORKSPACE_IN_TRASH`.
- `loadProjectAccess` lee en una consulta el proyecto, la papelera del espacio, el `Member` y el `ProjectMember` del usuario, y aplica `effectiveProjectRole` de `src/shared/permissions.ts`. Sin rol, la respuesta es 404; con rol pero sin la capacidad, 403.
- Expulsar, cambiar roles o salir de un espacio entra por `auth.api.*` después de aplicar las reglas propias (409 `LAST_OWNER`, 409 `PERSONAL_WORKSPACE`). Al salir, el servicio publica `access.changed` él mismo. Los cambios de miembros de proyecto publican `access.changed` en el canal del proyecto después de confirmar.

Decisiones que no salen literalmente del contrato:

- El listado de proyectos admite además `filter=trash`: los proyectos en la papelera que el usuario puede restaurar (admin efectivo).
- Quien crea o duplica un proyecto siendo `member` del espacio recibe un `ProjectMember` `admin`, para que pueda administrar lo que crea. Owner y admin ya lo son por su rol.
- Duplicar sin `targetWorkspaceSlug` copia en el mismo espacio si se es miembro; un invitado externo duplica en su espacio personal.
- `PUT /v1/projects/:id/members/:userId` solo admite personas del espacio o que ya tienen acceso directo; el resto entra por invitación.

Límites propios por usuario: `POST /v1/assets/uploads` 60 por hora, `POST /v1/projects/:id/collab-token` 30 por minuto , `POST /v1/projects/:id/chat` 20 cada 10 s, y crear o restaurar versiones 20 por minuto. `GET /v1/files/*` admite 3.000 por minuto e IP, porque un lienzo pide muchas imágenes de golpe y cada URL ya va firmada.

## Chat del proyecto

`src/api/modules/chat/` guarda los mensajes en `ChatMessage`. Los lectores también chatean; editar es solo del autor y borrar, del autor o de un admin del proyecto. El borrado es lógico: la fila se queda, pero la API devuelve el mensaje con el cuerpo, los adjuntos y las menciones vacíos y `deletedAt`.

- `GET /v1/projects/:id/chat?before=&limit=` devuelve hasta 50 mensajes del más antiguo al más reciente; `nextCursor` es el id del más antiguo de la página si quedan anteriores.
- Los adjuntos tienen que ser assets `ready` del mismo proyecto (400 `INVALID_ATTACHMENT`). Una mención a alguien sin acceso al proyecto responde 400 `VALIDATION_FAILED` con la posición en `details.issues`. `replyToId` tiene que ser un mensaje del mismo proyecto.
- Crear un mensaje suma 1 a `ActivityDaily.chatMessages` del día UTC en la misma transacción (`incrementDaily` de `src/core/activity.ts`, un `INSERT … ON CONFLICT` con `$executeRaw` parametrizado). Crear, editar y borrar publican `chat.message` con el mensaje ya serializado después de confirmar; `collab` lo reenvía a las conexiones del documento y el cliente lo sustituye por id.

## IA

Usa el AI SDK de Vercel (`ai@7.0.141`, `@ai-sdk/openai@4.0.94`, `@ai-sdk/anthropic@4.0.80` y `@ai-sdk/google@4.0.96`, fijadas; en npm hay parches más nuevos, que no se han probado aquí). `src/core/ai/registry.ts` crea un registro de proveedores con `createProviderRegistry` y solo registra los que tienen clave. En el código no hay ids de modelo: cada función lee el suyo de una variable.

| Función | Variable | Tipo de modelo |
|---|---|---|
| Asistente del lienzo | `AI_MODEL_ASSISTANT` | de lenguaje, con salida estructurada |
| Animaciones | `AI_MODEL_ANIMATION` | de lenguaje, con salida estructurada |
| Chat del proyecto | `AI_MODEL_CHAT` | de lenguaje, con streaming |
| Imágenes | `AI_MODEL_IMAGE` | de imagen |
| Describir imágenes adjuntas (opcional) | `AI_MODEL_VISION` | de lenguaje; si falta, el del asistente |

Proveedores y claves:

| Proveedor | Clave | Ejemplo |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `AI_MODEL_CHAT=openai:gpt-5.1`, `AI_MODEL_IMAGE=openai:gpt-image-1` |
| Anthropic | `ANTHROPIC_API_KEY` | `AI_MODEL_CHAT=anthropic:claude-sonnet-4-5` (no genera imágenes) |
| Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | `AI_MODEL_CHAT=google:gemini-2.5-flash`, `AI_MODEL_IMAGE=google:gemini-2.5-flash-image` |
| Cualquier API compatible con OpenAI (OpenRouter, Groq, Ollama, LM Studio…) | `OPENAI_API_KEY` con la clave de ese servicio y `OPENAI_BASE_URL` con su URL | `AI_MODEL_CHAT=openai:<id del modelo en ese servicio>` |

Los ids son ejemplos: los vigentes están en la documentación de cada proveedor. Con `OPENAI_BASE_URL` los modelos de lenguaje van por Chat Completions, que es lo que implementan los servicios compatibles. Cambiar de proveedor es cambiar la clave y la variable `AI_MODEL_*` y reiniciar la API; se pueden mezclar proveedores entre funciones. Al arrancar, `config.ts` comprueba que cada `AI_MODEL_*` tiene la forma `proveedor:modelo` y que el proveedor tiene clave; si no, el proceso termina con el motivo. Una función sin modelo queda desactivada: `GET /v1/meta` la devuelve como `false` en `aiFeatures` y la UI oculta su botón, así que en desarrollo sin claves no se rompe nada. Para añadir otro proveedor se instala su paquete `@ai-sdk/*` y se añade una línea en `providersFor` y su clave en `config.ts`.

Las claves nunca se registran en los logs, y los errores del proveedor se registran con la longitud del prompt y el modelo, no con el prompt.

Cuotas (`src/core/ai/quota.ts`): asistente, animación y mensaje de chat cuestan 1 unidad y cada imagen 4. Cobra el espacio dueño del proyecto (`AI_QUOTA_WORKSPACE_MONTHLY_UNITS`, 2.000 al mes por defecto) y además hay un tope por usuario (`AI_QUOTA_USER_DAILY_UNITS`, 100 al día). Un espacio puede tener otros valores en `WorkspaceAiQuota` (`monthlyUnits`, `perUserDailyUnits`). Antes de llamar al modelo, un script Lua reserva las unidades en `parcify:aiq:ws:{orgId}:{yyyymm}` y `parcify:aiq:u:{userId}:{yyyymmdd}` (UTC); si no caben, 429 `AI_QUOTA_EXCEEDED` con `details: { scope: 'workspace' | 'user', resetsAt }`. Si la llamada falla, las unidades se devuelven. Cada intento deja una fila en `AiUsage` (`ok`, `error` o `rejected`; solo `ok` cobra) y cada acción correcta suma 1 a `ActivityDaily.aiActions`. Si Redis pierde un contador, se reconstruye con la suma de `AiUsage` del mes o del día.

`app.ai.run()` (`src/core/ai/run.ts`) aplica todo eso alrededor de la llamada al modelo, con tope de 60 s (120 s en imágenes). Errores del proveedor: tiempo agotado → 504 `AI_TIMEOUT`, 429 del proveedor → 503 `AI_PROVIDER_BUSY`, contenido bloqueado → 422 `AI_REFUSED`, salida que no cumple el esquema → 502 `AI_BAD_OUTPUT` (sin cobro) y el resto → 502 `AI_PROVIDER_ERROR`. Las rutas de IA usan además `aiRateLimit` (10 peticiones por minuto y usuario entre todas, en `parcify:rl:ai:u:{userId}`) y `requireAiFeature`, que da 404 si la función no tiene modelo.

Sin SSRF: ninguna función de IA acepta URLs del cliente; las imágenes de contexto son `assetId`s que el servidor lee de su storage. Si un proveedor devolviera una URL en vez de los bytes, `downloadProviderImage` solo la descarga por https, con el host exacto en `AI_IMAGE_DOWNLOAD_HOSTS` (vacío por defecto, es decir, ninguna descarga), sin seguir redirecciones, con 30 s y 20 MiB como tope.

`GET /v1/workspaces/:slug/ai/usage?month=YYYY-MM` (admin del espacio; por defecto el mes actual) devuelve los límites, el total y el consumo por usuario y función.

Asistente del lienzo (`src/api/modules/ai/assistant.ts`, rol editor o superior): `POST /v1/projects/:id/ai/assistant` admite hasta 1 MiB de cuerpo y recibe el prompt, el viewport, la selección y un resumen del lienzo (como mucho 300 nodos y 200 KB), además de hasta 4 `imageAssetIds` del mismo proyecto (se lee su variante `medium` del storage). La salida del modelo se valida con `AssistantPlanSchema` (`src/shared/ai/assistant.ts`) y después `sanitizeAssistantPlan` recorta los valores a los límites del documento y descarta los `update`/`delete` sobre ids que no venían en el resumen, los padres desconocidos y los tempIds repetidos. Responde `{ plan, dropped, usage }`. El plan no toca el documento: el cliente lo enseña como vista previa y solo lo escribe si el usuario lo acepta.

Chat de IA (`src/api/modules/ai/chat.ts`, rol editor o superior; las conversaciones son privadas de cada usuario): `GET /v1/projects/:id/ai/conversations` lista las 50 más recientes, `GET …/ai/conversations/:conversationId` devuelve sus mensajes y `POST /v1/projects/:id/ai/chat { conversationId?, message, canvas? }` responde en streaming (protocolo de mensajes UI del AI SDK, SSE). El historial que ve el modelo son los 30 últimos mensajes de la base de datos, nunca lo que mande el cliente. Si el cliente corta la conexión se aborta la llamada al modelo y se guarda lo generado hasta ese punto. El id de una conversación nueva llega en los metadatos del primer trozo (`messageMetadata.conversationId`).

Imágenes (`src/api/modules/ai/images.ts` y `src/core/ai/jobs.ts`, rol editor o superior): `POST /v1/projects/:id/ai/images { prompt, count: 1–4, aspect: '1:1' | '4:3' | '3:4' | '16:9' | '9:16' }` responde 202 `{ jobId }` y genera en segundo plano, dentro del proceso de la API: 2 generaciones a la vez por instancia y hasta 20 en cola; por encima, 503 `AI_BUSY` sin reservar cuota. Al aceptar se reservan 4 unidades por imagen pedida; `generateImage` tiene 120 s desde que el trabajo sale de la cola. Cada imagen pasa por el mismo procesado que una subida (tipo por bytes, `sharp` y variantes) y se guarda como `Asset` `ready` con `source = 'ai'`, `aiPrompt` e `inGallery = true` (si el proyecto ya tiene esa misma imagen generada, se reutiliza). Solo se cobran las imágenes guardadas; si no se guarda ninguna, el trabajo falla con `AI_BAD_OUTPUT` y se devuelve todo. El estado vive en `parcify:ai:job:{jobId}` (TTL 1 h) y cada cambio (`queued`, `running`, `done`, `failed`) se publica como `ai.job`, que `collab` reenvía solo a quien lo pidió. `GET /v1/ai/jobs/:jobId` lo devuelve solo a quien lo creó (404 para cualquier otro). Mientras corre, la instancia renueva `parcify:ai:job:{jobId}:alive` cada 30 s; si el proceso cae, al minuto y medio el trabajo aparece como `failed` con `AI_JOB_LOST`. El trabajo guarda en Redis la cuota que reservó: la primera lectura que lo encuentra sin latido lo deja escrito como fallido y devuelve esas unidades una sola vez. Al cerrar la instancia, los trabajos que aún esperaban en la cola se dan por fallidos con `AI_JOB_LOST` y también se les devuelve la reserva.

Animaciones (`src/api/modules/ai/animation.ts`, rol editor o superior): `POST /v1/projects/:id/ai/animation { prompt, nodeIds (1–50), canvas }`. La salida del modelo se valida con `AnimationPlanSchema` (`src/shared/ai/animation.ts`: pistas como listas y giro en grados) y `sanitizeAnimationPlan` la convierte en animaciones completas del documento (`AnimationSchema`): recorta duración, retardo, vueltas, tiempos, valores y curvas, y descarta los nodos que no estaban en `nodeIds`, los repetidos, los conectores y las animaciones sin pistas utilizables. Responde `{ plan, dropped, usage }` y cuesta 1 unidad. Como el asistente, no toca el documento: el cliente las previsualiza en el timeline y las escribe al aplicar.

Pruebas: con `NODE_ENV=test` existe además el proveedor `mock` (`src/core/ai/mock.ts`, con `MockLanguageModelV4` y `MockImageModelV4` de `ai/test` y salidas fijas: el asistente propone un rectángulo, el chat responde «Respuesta de prueba.», la animación desplaza 100 px el primer nodo pedido y las imágenes son un PNG de 1×1 px), por ejemplo `AI_MODEL_ASSISTANT=mock:assistant`. Los e2e del cliente arrancan la API con los cuatro `AI_MODEL_*` en `mock:*`. Fuera de las pruebas `config.ts` lo rechaza.

## Versiones

La API no tiene el documento en memoria, así que crear y restaurar versiones lo hace `collab` con petición y respuesta sobre Redis (`src/core/rpc.ts` y `src/collab/extensions/rpc.ts`). La API publica `{ type, requestId, … }` en `parcify:rpc:collab` y espera en `parcify:rpc:reply:{requestId}`. Quien actúa toma antes `SET parcify:rpc:claim:{requestId} … NX PX 15000`, de modo que cada petición tiene un solo ejecutor aunque varias instancias tengan el documento.

- `GET /v1/projects/:id/versions?cursor=&limit=` lista de la más reciente a la más antigua (automáticas, manuales y puntos de restauración). `GET …/:vid/state` devuelve el estado Yjs binario para la vista previa.
- `POST /v1/projects/:id/versions { name? }` (editor): la instancia con el documento guarda en el acto con el `epoch` cargado y copia ese estado; si el `epoch` cambió, 409 `DOCUMENT_RELOADED`. Si en 1 s no responde nadie, la API intenta el reclamo y, si lo gana, copia `ProjectDocument.state`. Suma `ActivityDaily.versionsCreated` y registra `version.created`. Se guardan hasta 200 manuales: al pasar de ahí se borra la más antigua.
- `POST /v1/projects/:id/versions/:vid/restore` (editor): las instancias con el documento reclaman en el acto y las demás tras 1 s; si gana una sin él, lo abre con `openDirectConnection`. El ejecutor toma `parcify:restore:{projectId}` (`NX PX 30000`; si está tomado, 409 `RESTORE_IN_PROGRESS`), guarda el estado actual como `restore_point` y sustituye `pages`, `nodes`, `texts` y `animations` en una transacción con origen `restore`: solo escribe lo que difiere y los `Y.Text` distintos se borran y se escriben enteros. Registra `version.restored`. Al terminar, un script Lua que compara el valor deja caducar el bloqueo en 1,5 s (o lo borra si no llegó a sustituir nada), para que el update alcance a las demás instancias antes de otra restauración. Sin respuesta en 10 s, 503 `COLLAB_UNAVAILABLE`; el ejecutor puede terminar después y la restauración se aplica igualmente (las dos partes lo registran en el log). Los `restore_point` no se podan por ahora.
- Automáticas: en `afterStoreDocument`, si la última `auto` tiene más de 30 min y la instancia obtiene `parcify:autover:{projectId}` (`NX PX 1800000`), se copia el estado recién guardado. Se conservan las 48 más recientes.

## Actividad

Las métricas salen solo del servidor; el cliente no envía ninguna. `ActivityDaily` guarda una fila por proyecto, usuario y día UTC.

- `collab` (`src/collab/extensions/activity.ts`) cuenta solo las transacciones con origen `connection` de sus propias conexiones; las que llegan por Redis las cuenta la instancia que tiene la conexión y las `local` del servidor no cuentan. Suma `editOps` (una por transacción aceptada), `nodesCreated` y `nodesDeleted` (claves añadidas o borradas en `nodes`), los minutos con actividad (cada edición y cada cambio de `cursor` en Awareness) y `sessions` (conexiones de más de 60 s; una reconexión que empieza menos de 10 min después del final de la anterior no cuenta como sesión nueva, con el último final en `parcify:act:sess:{projectId}:{userId}`). Vuelca cada 60 s, al descargar el documento y al cerrar, con `addEditCounters` de `src/core/activity.ts` (`INSERT … ON CONFLICT` aditivo). Los minutos se deduplican entre instancias con `SADD parcify:act:{projectId}:{userId}:{yyyymmdd}` (TTL 2 días) y solo se suman los que Redis da como nuevos. Si el volcado falla, los contadores vuelven a memoria para el siguiente intento.
- `chatMessages`, `versionsCreated` y `aiActions` los suma la API en la misma transacción que la acción.
- `GET /v1/projects/:id/activity?from=&to=` (quien ve el proyecto): días `yyyy-mm-dd` inclusivos, como mucho 90 (400 `VALIDATION_FAILED` si no); sin fechas, los últimos 30 días. Devuelve `series` por usuario y día (solo los días con actividad), `byUser`, `totals`, `users` con nombre y avatar, y `nodeCountByType` del documento guardado.
- `GET /v1/projects/:id/activity/events?cursor=&limit=` pagina `ActivityEvent` del más reciente al más antiguo (hasta 50 por página).
- `GET /v1/workspaces/:slug/activity?from=&to=` (miembro del espacio): lo mismo sumado sobre los proyectos que el usuario puede ver, sin los de la papelera, más `projects` con los totales de cada uno.

## Trabajos periódicos y compactación

`src/core/jobs/scheduler.ts` programa cada trabajo a su hora (los intervalos alineados con la época Unix; los diarios a las 03:00 UTC). Antes de ejecutarlo toma `SET parcify:cron:{nombre} … NX PX <vida>`; si otra instancia lo tiene, no hace nada. Mientras el trabajo sigue, renueva el bloqueo con un script Lua que compara el valor y, al terminar, lo deja caducar para que una instancia con el reloj algo atrasado no repita la misma ejecución. Si un trabajo falla, se registra en `error` y se vuelve a intentar en la siguiente ejecución (todos son idempotentes).

| Trabajo | Cuándo | Dónde | Qué hace |
|---|---|---|---|
| `compact` | cada 15 min | `collab` | Compacta los documentos pedidos con «Recompactar» y los de más de 1 MiB sin cambios desde hace 10 min, en lotes de 20 |
| `activity-purge` | 03:00 UTC | `collab` | Borra los `ActivityEvent` de más de 400 días |
| `assets-pending` | cada hora | `collab` con `s3`, API con `local` | Borra los assets `pending` de más de 1 h y sus objetos |
| `purge` | 03:00 UTC | `collab` con `s3`, API con `local` | Proyectos en papelera de más de 30 días (con sus objetos; documento, versiones, assets y chat caen en cascada), espacios en papelera de más de 30 días (sus proyectos, plantillas, logo y la organización, borrada con Prisma y nunca con Better Auth) y assets con `deletedAt` de más de 30 días que ningún `ProjectDocument.assetRefs` referencia, como el avatar de una cuenta borrada. Todo en lotes de 100 |

Ninguna purga toca assets con `templateId`: solo caen al borrar su plantilla. Los objetos se borran antes que las filas, así que si el storage falla las filas se quedan y la siguiente ejecución lo reintenta. Con `STORAGE_DRIVER=local` solo la API tiene el volumen, por eso allí corren los trabajos que borran ficheros.

Compactación (`src/core/jobs/compact.ts`), por proyecto:

1. Toma `parcify:compact:{projectId}` con `NX PX 60000` (si no puede, pasa al siguiente) y lo renueva cada 20 s.
2. Lee `parcify:doc:{projectId}:instances` limpiando los miembros caducados. Si queda alguien (una instancia con el documento o una conexión `pending:` autenticándose), suelta el bloqueo y pasa al siguiente.
3. Copia `pages`, `nodes`, `texts`, `animations` y `meta` en un `Y.Doc` nuevo. Si no baja de la mitad y nadie lo pidió, no lo guarda y lo apunta en `parcify:compact:seen:{projectId}` (7 días) para no reconstruirlo otra vez hasta que cambie.
4. En una transacción: `UPDATE … SET state, sizeBytes, epoch = epoch + 1 WHERE epoch = <leído>` y la copia anterior como `restore_point`.
5. Suelta el bloqueo con un script Lua que solo lo borra si sigue siendo suyo.

`POST /v1/projects/:id/compact` (admin del proyecto, 5 por minuto) añade el id a `parcify:compact:requested` y responde 202 sin cuerpo. El trabajo lo atiende cuando ninguna instancia tiene el documento cargado; hasta entonces el id sigue en el conjunto.

## Storage e imágenes

`STORAGE_DRIVER` elige el driver al arrancar (`src/core/storage`); el resto del código solo conoce la interfaz `StorageDriver`.

- Claves: `a/{scope}/{assetId}/{variant}.{ext}`, con `scope` el id del espacio o `u-{userId}` en los avatares. Las genera el servidor y cualquier clave fuera de ese formato (por ejemplo con `..`) lanza `StorageKeyError`.
- `local`: ficheros bajo `STORAGE_LOCAL_PATH` con escritura atómica (temporal y `rename`). La subida va a `PUT /v1/assets/uploads/:id/content` y la descarga a `GET /v1/files/*`, las dos con firma HMAC-SHA256 (`STORAGE_URL_SECRET`) sobre método, clave y caducidad, comparada en tiempo constante.
- `s3`: S3, R2, SeaweedFS o MinIO. El navegador sube con una URL prefirmada que firma `Content-Type` y `Content-Length`; las descargas son URLs prefirmadas de 1 hora. El cliente desactiva las sumas CRC por defecto del SDK (`WHEN_REQUIRED`), que algunos compatibles rechazan, y borra con `DeleteObject` por clave por la misma razón.
- Procesado (`src/core/images`): tipo real con `file-type` (el SVG se reconoce aparte, porque `file-type` no lo distingue), `sharp` con `limitInputPixels` de 50 Mpx, sin EXIF ni GPS, variantes `thumb`, `medium` (solo si el original pasa de 1024 px) y `full`, SVG rasterizado a PNG, primer fotograma del GIF, 30 s de tope y como mucho 2 procesados a la vez por instancia.

Pruebas de storage: `src/core/storage/storage.int.test.ts` es un solo conjunto de contrato que corre con `local` (directorio temporal) y con `s3` (SeaweedFS del perfil `s3`). Si SeaweedFS no responde, solo corre `local` y avisa; con `TEST_REQUIRE_S3=1` falla. Las pruebas de assets y de duplicar usan el driver de `TEST_STORAGE_DRIVER` (`local` por defecto):

```powershell
docker compose -f compose.test.yml --profile s3 up -d --wait
$env:TEST_REQUIRE_S3 = '1'; npm run test:int -- storage
$env:TEST_STORAGE_DRIVER = 's3'; npm run test:int -- assets duplicate
```

El SeaweedFS de pruebas lee las credenciales de `test/seaweedfs/s3.json` (solo de pruebas), así que comprueba las firmas igual que S3.

## Colaboración (`collab`)

`src/collab/server.ts` monta Hocuspocus 4.7.1 con estas extensiones, por orden de prioridad:

| Extensión | Qué hace |
|---|---|
| `HealthExtension` | `/health`, `/ready` (Postgres, Redis y menos del 90 % de 2.000 documentos cargados) y `/metrics` con `METRICS_TOKEN` |
| `Redis` | Updates y Awareness entre instancias (`prefix: 'parcify:hp'`, `identifier` = `INSTANCE_ID`) |
| `AuthExtension` | Token de `POST /v1/projects/:id/collab-token`, documento, `schemaVersion` de la URL, acceso y sesión, registro provisional, espera a la compactación y `epoch` |
| `GuardExtension` | Conexiones por documento (`COLLAB_MAX_CONN_PER_DOC`, 100) y por usuario (8), 60 mensajes/s con ráfaga de 300, 40 Awareness/s, mensajes de 2 MiB, Awareness de 32 KiB, strikes y solo lectura por tamaño |
| `PersistenceExtension` | `fetch` y `store` sobre `ProjectDocument`, con el `UPDATE … WHERE epoch` |
| `NormalizeExtension` | Migraciones al cargar y normalización por microlote de 200 ms de lo que llega de conexiones de esta instancia |
| `EventsExtension` | `PSUBSCRIBE parcify:evt:project:* parcify:evt:org:*` y entrega a las conexiones locales |

La lógica de normalización es pura y vive en `src/shared/document/normalize.ts` (`recordTouches`, `planNormalization`, `applyCorrections`), así que el cliente puede probar la convergencia con exactamente el mismo código.

El cliente conecta a `wss://…/?schemaVersion=N` con el token como `token` del proveedor. Motivos de rechazo que recibe en `authenticationFailed`: `invalid_token`, `client_outdated`, `no_access`, `session_revoked`, `not_found`, `compacting`, `epoch_changed`, `document_full`, `too_many_tabs` y `unavailable` (transitorio: reintentar).

Códigos de cierre: 4400 (demasiados strikes), 4401 (cambió el acceso; reconectar con token nuevo), 4409 (cambió el `epoch`), 4410 (proyecto o espacio en la papelera) y 4429 (demasiados mensajes). El mensaje de cierre de Hocuspocus no lleva código, así que el servidor cierra también el WebSocket con el suyo; cada proyecto usa su propio socket.

Mensajes *stateless*: el cliente solo puede mandar `{ "type": "ping" }` (responde `{ "type": "pong" }`); cualquier otro cuenta como strike. El servidor manda `{ "type": "limit", "what": "nodes" | "pages" | "animations" | "size" | "size_warning" }` y reenvía `asset.ready`, `chat.message` y `ai.job`.

Claves de Redis: `parcify:doc:{projectId}:instances` (instancias y conexiones `pending:{socketId}` con el documento), `parcify:doc:{projectId}:inst:{miembro}` (latido de 90 s, o 15 s para las pendientes), `parcify:compact:{projectId}` (bloqueo de compactación), `parcify:compact:requested` (proyectos pedidos con «Recompactar»), `parcify:cron:{nombre}` (bloqueo de cada trabajo periódico) y `parcify:sess:{sessionId}` (sesión viva, 30 s).

Decisiones de implementación:

- `PersistenceExtension` tiene más prioridad que `NormalizeExtension` para que las migraciones de `onLoadDocument` vean el estado leído de Postgres.
- El contenido inicial se crea en `afterLoadDocument`, después de que la extensión Redis traiga el estado de otras instancias, y la «Página 1» usa un id derivado del proyecto: si dos instancias inicializan a la vez el mismo proyecto nuevo, escriben la misma clave y no aparece una página duplicada.
- El límite de conexiones por documento se cuenta en cada instancia.
- Un proyecto en la papelera no admite conexiones (`not_found`), aunque su owner pueda restaurarlo desde la API.
- Hocuspocus confirma la autenticación antes de registrar la conexión en el documento. `EventsExtension` guarda 30 s los eventos de cierre (`access.changed`, `project.deleted`, `workspace.deleted`) y, en `connected`, cierra la conexión si llegó alguno después de leer su acceso.
- Si falla Postgres, `store` reintenta con 1, 2, 4, 8, 16 y 30 s sin soltar el documento, y vuelve a codificar el estado en cada intento.
- El hook `connected` existe en 4.7.1 y es donde se borra el registro provisional.

Pruebas: `npm run test:int -- collab` levanta servidores de Hocuspocus en puertos efímeros (dos instancias en las pruebas de sincronización) y conecta `HocuspocusProvider` desde Node. `@hocuspocus/provider@4.7.1` es dependencia de desarrollo solo para eso.

## Migraciones

El esquema vive en `prisma/schema.prisma` y el cliente se genera en `src/generated/prisma` (no se versiona). Para comprobar que las migraciones y el esquema coinciden:

```powershell
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script
```

Necesita `SHADOW_DATABASE_URL` apuntando a una base de datos vacía (en desarrollo, `parcify_shadow` dentro del mismo Postgres: `docker exec parcify-dev-postgres-1 psql -U parcify -d parcify -c "CREATE DATABASE parcify_shadow"`).

En producción las migraciones se aplican con `npx prisma migrate deploy` en el *pre-deploy* de `api` y de `collab` (ver «Producción en Railway»).

## Observabilidad

- Logs: JSON con Pino. El `redact` oculta cookies, `authorization`, `set-cookie` y los campos `password`, `currentPassword`, `newPassword`, `token`, `otp` y `secret` en la raíz y hasta dos niveles más abajo. Las líneas de cada petición llevan la URL sin la query (`/ruta?[oculto]`), porque puede traer el código de vuelta de Google o un token.
- Métricas: `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>` en `api` y en `collab`; sin token configurado responde 401. La API expone `http_request_duration_seconds` (por método, ruta y código), `ai_usage_total` (por función y estado: `ok`, `error` o `rejected`), `images_processing_running` e `images_processing_queued` (colas `assets` y `ai-images`) y las del proceso de Node. `collab` expone `collab_connections`, `collab_documents_loaded`, `collab_store_duration_seconds`, `collab_store_errors_total`, `collab_document_size_bytes`, `collab_strikes_total`, `collab_normalize_corrections_total` y `collab_rejections_total`. Railway no las recoge: están listas para un colector externo.
- Errores: con `SENTRY_DSN`, los dos servicios envían a Sentry los errores no controlados (los 5xx de la API, los guardados del documento que fallan, una vez por racha, y los fallos al arrancar). Sin la variable, el SDK no se carga. Se envía sin datos personales: en el SDK 11, `sendDefaultPii` ya no existe y lo sustituye `dataCollection`, que aquí desactiva usuario, cookies, cabeceras, cuerpos, query, variables locales y prompts. Además, `beforeSend` quita cookies, cabeceras de credenciales e IP, cuerpos y la query de las URLs, también en las migas.
- Secretos en el repo: el workflow «Secretos» de la raíz del monorepo (`.github/workflows/secrets.yml`) pasa `gitleaks` con el `.gitleaks.toml` de la raíz (reglas por defecto; se excluyen `.env.example`, las pruebas y las contraseñas del stack local de compose).

## Docker

Una sola imagen sirve para `api` y para `collab`. El `Dockerfile` tiene cuatro etapas (dependencias, compilación, dependencias de producción y ejecución sobre `node:24.11-bookworm-slim`), corre con el usuario `node` (no root) y trae un `HEALTHCHECK` que pide `/health` en el puerto de `PORT`. Por defecto arranca la API; `collab` cambia el comando.

```powershell
docker build -t parcify-server .
docker run --env-file .env -p 3000:3000 parcify-server                                       # api
docker run --env-file .env -e PORT=3001 -p 3001:3001 parcify-server node dist/collab/main.js  # collab
docker run --env-file .env parcify-server npx prisma migrate deploy                          # migraciones
```

`compose.verify.yml` (proyecto `parcify-verify`) levanta las dos imágenes con `NODE_ENV=production` para comprobarlas en local: Postgres en 127.0.0.1:55441, Redis en 56391, `api` en 53000, `collab` en 53001 y `web` (la imagen del cliente, construida desde `../client`) en 58080. Un servicio `migrate` aplica las migraciones antes de que arranquen `api` y `collab`, igual que el *pre-deploy* de Railway. Los secretos de ese archivo son de usar y tirar y los datos van en `tmpfs`.

```powershell
docker compose -f compose.verify.yml build
docker compose -f compose.verify.yml up -d
curl http://127.0.0.1:53000/ready
curl http://127.0.0.1:53001/ready
docker compose -f compose.verify.yml down
```

## Despliegue local con Docker

`compose.local.yml` (proyecto `parcify-local`) deja Parcify funcionando en tu equipo con las imágenes de producción (`NODE_ENV=production`), storage `s3` y HTTPS, para usarlo desde el navegador. A diferencia de `compose.verify.yml`, los datos persisten en volúmenes con nombre.

| Servicio | Qué es |
|---|---|
| `proxy` | Caddy 2.10.2 con TLS interno (`local-deploy/Caddyfile`). Es lo único publicado junto con Mailpit: `127.0.0.1:443` |
| `web` | Imagen del cliente, construida desde `../client` con los orígenes `*.parcify.localhost` |
| `api`, `collab` | Imagen de `server/`; `migrate` aplica `prisma migrate deploy` antes de que arranquen |
| `postgres`, `redis` | Postgres 18.1 y Redis 8.2.2 con contraseña |
| `s3` | SeaweedFS 4.00 con una identidad propia (comprueba las firmas como S3); `bucket-init` crea el bucket privado `parcify` y su regla CORS, limitada a `https://parcify.localhost` |
| `mailpit` | Recibe el correo por SMTP (`MAIL_DRIVER=smtp`); no sale nada a Internet |
| `ca-export` | Copia el certificado raíz de la CA de Caddy a `local-deploy/caddy-root.crt` y a un volumen que leen `api` y `collab` |

URLs (los subdominios de `localhost` resuelven a 127.0.0.1 en los navegadores, sin tocar el archivo `hosts`):

- `https://parcify.localhost`: la web.
- `https://api.parcify.localhost` y `https://collab.parcify.localhost`: API y colaboración (WebSocket).
- `https://s3.parcify.localhost`: el bucket; las imágenes se sirven desde aquí con URLs firmadas.
- `http://localhost:8025`: Mailpit, donde llegan los códigos de verificación y de recuperación de contraseña.

`api` y `collab` hablan con el bucket por `https://s3.parcify.localhost`, igual que el navegador, porque la firma de las URLs incluye el host. Dentro de la red de compose ese nombre apunta al proxy y la CA de Caddy entra por `NODE_EXTRA_CA_CERTS`. `TRUST_PROXY_HOPS=1`, porque hay un proxy delante.

### Requisitos

- Docker Desktop con el puerto 443 libre en el equipo (y el 8025 para Mailpit).
- El monorepo completo: el compose construye la imagen del cliente desde `../client`.

### Primer arranque

```powershell
# Genera .env.local-deploy con contraseñas y secretos aleatorios (una sola vez; no lo sobrescribe).
powershell -ExecutionPolicy Bypass -File local-deploy\new-secrets.ps1
docker compose -f compose.local.yml up -d --build --wait
```

`.env.local-deploy` está en `.gitignore`. Si lo borras y lo regeneras con los volúmenes existentes, Postgres conserva la contraseña antigua y `migrate`, `api` y `collab` no conectan; además, las sesiones abiertas dejan de valer. En ese caso, resetea los datos (ver abajo).

### Certificado

Caddy firma los certificados con su propia CA, que se guarda en el volumen `caddydata` y no cambia entre reinicios. Al arrancar, su certificado raíz queda en `local-deploy\caddy-root.crt`. Para que el navegador confíe en él, impórtalo en el almacén de tu usuario (Windows pide confirmación en un aviso):

```powershell
Import-Certificate -FilePath .\local-deploy\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Reinicia el navegador después. Chrome y Edge usan ese almacén; Firefox, si no lo ves aceptado, activa `security.enterprise_roots.enabled` en `about:config`. Si prefieres no importarlo, acepta el aviso del navegador en cada uno de los cuatro dominios (abre primero `https://api.parcify.localhost/ready`, `https://collab.parcify.localhost/ready` y `https://s3.parcify.localhost`, o la web no podrá llamarlos). Para quitarlo más tarde: `certmgr.msc` → «Entidades de certificación raíz de confianza» → «Caddy Local Authority - 2026 ECC Root».

### Uso diario

```powershell
docker compose -f compose.local.yml ps                     # estado
docker compose -f compose.local.yml logs -f api collab     # logs
docker compose -f compose.local.yml stop                   # parar (conserva todo)
docker compose -f compose.local.yml up -d --wait           # volver a arrancar
docker compose -f compose.local.yml up -d --build --wait   # reconstruir tras cambiar código del servidor o del cliente
docker compose -f compose.local.yml down                   # quitar los contenedores (los datos siguen en los volúmenes)
```

Para empezar de cero: `docker compose -f compose.local.yml down -v`. Borra todo: cuentas, proyectos, imágenes del bucket, correos y la CA de Caddy (habrá que importar el certificado nuevo).

### Limitaciones

- Google OAuth está desactivado (sin `GOOGLE_CLIENT_ID`): solo se entra con email y contraseña.
- La IA no tiene credenciales: las funciones de IA aparecen como no configuradas. Para probarlas, añade a `.env.local-deploy` la clave y los `AI_MODEL_*` (ver «IA») y recrea `api`.
- El correo no sale de tu equipo: todo lo que envía la API está en Mailpit.
- Solo escucha en 127.0.0.1: no se puede abrir desde otro dispositivo de la red.

## Producción en Railway

Esta guía deja Parcify funcionando en Railway con dominio propio. Para un VPS propio con Docker, la vía más sencilla es [`DEPLOY.md`](../DEPLOY.md) en la raíz del monorepo. Lo que hay en el repo ya está preparado (imágenes, `railway.api.json`, `railway.collab.json` y la validación de la configuración); lo que falta son las cuentas, los dominios y los secretos, que pones tú.

### 1. Servicios

Crea un proyecto en Railway con cinco servicios. `api`, `collab` y `web` salen del mismo repo (el monorepo); cada uno con su *Root Directory* y su archivo de configuración. Railway no resuelve la ruta del archivo de configuración relativa al *Root Directory*, así que va siempre desde la raíz del repo:

| Servicio | Origen | *Root Directory* | *Settings → Config-as-code* |
|---|---|---|---|
| `Postgres` | Plantilla de Postgres de Railway | | Sin cambios |
| `Redis` | Plantilla de Redis de Railway | | Sin cambios |
| `api` | El monorepo | `/server` | `/server/railway.api.json` |
| `collab` | El monorepo | `/server` | `/server/railway.collab.json` |
| `web` | El monorepo | `/client` | `/client/railway.json` (ver el README de `client/`) |

Los archivos de `server/` fijan el `Dockerfile` (relativo al *Root Directory*), las rutas que disparan un despliegue (`/server/**`, así un cambio solo en `client/` no redespliega la API), el comando de arranque, el *healthcheck* en `/ready`, dos réplicas y 30 s de *draining* (Railway espera 30 s entre el SIGTERM y el SIGKILL; los procesos cierran solos en menos de 25 s y los clientes de `collab` reconectan a la otra réplica). Lo que pongas en esos archivos manda sobre lo que diga el panel.

### 2. Dominios

Asigna un dominio propio a cada servicio público, todos bajo el mismo dominio registrable:

- `parcify.app` → `web`
- `api.parcify.app` → `api`
- `collab.parcify.app` → `collab` (el proxy de Railway admite WebSocket)

Crea en tu DNS los registros que te indique Railway; el TLS lo pone Railway. Para staging usa otro nivel del mismo dominio, por ejemplo `staging.parcify.app`, `api.staging.parcify.app` y `collab.staging.parcify.app`.

No uses los dominios `*.up.railway.app`, ni siquiera para staging: `up.railway.app` está en la Public Suffix List, así que el navegador trata `web-x.up.railway.app` y `api-x.up.railway.app` como sitios distintos y la cookie de sesión no viaja. La API y `collab` se niegan a arrancar si `API_ORIGIN`, `COLLAB_ORIGIN` y `CLIENT_ORIGINS` no comparten dominio registrable, si alguno no usa `https` o si apuntan a `localhost`.

### 3. Cookies entre subdominios

La cookie de sesión la pone la API en su propio host (`api.parcify.app`), con `Secure`, `HttpOnly` y `SameSite=Lax`, y sin atributo `Domain`. No hace falta compartirla con `parcify.app`: el cliente llama a la API con `credentials: 'include'` y, como los dos son el mismo sitio, el navegador la envía. Lo que sí tiene que cuadrar:

- `CLIENT_ORIGINS` tiene que contener exactamente el origen desde el que se abre la web (`https://parcify.app`; añade `https://www.parcify.app` si también lo sirves). Ese valor alimenta el CORS y los `trustedOrigins` de Better Auth.
- `API_ORIGIN` y `COLLAB_ORIGIN` tienen que coincidir con los `PUBLIC_API_ORIGIN` y `PUBLIC_COLLAB_ORIGIN` con los que se construyó el cliente.

### 4. Variables

Genera cada secreto con algo como `openssl rand -base64 48` y no reutilices ninguno. Los que comparten `api` y `collab` (`COLLAB_TOKEN_SECRET` y, con storage `local`, `STORAGE_URL_SECRET`) conviene declararlos como *shared variables* del proyecto y referenciarlos desde cada servicio. Para la base de datos y Redis usa las referencias de Railway, que apuntan a la red privada: `DATABASE_URL=${{Postgres.DATABASE_URL}}` y `REDIS_URL=${{Redis.REDIS_URL}}`. `PORT` la pone Railway.

| Variable | `api` | `collab` | Qué espera |
|---|---|---|---|
| `NODE_ENV` | sí | sí | `production` |
| `API_ORIGIN`, `COLLAB_ORIGIN` | sí | sí | Orígenes `https://` sin ruta de la API y de `collab` |
| `CLIENT_ORIGINS` | sí | sí | Orígenes de la web separados por comas |
| `TRUST_PROXY_HOPS` | sí | no | `1` detrás del proxy de Railway; sin ella todas las peticiones parecen venir de la misma IP (la API avisa al arrancar) |
| `DATABASE_URL` | sí | sí | URL `postgresql://` (referencia a `Postgres`) |
| `DATABASE_POOL_MAX` | opcional | opcional | Conexiones por proceso; por defecto 10 en `api` y 5 en `collab` |
| `REDIS_URL` | sí | sí | URL `redis://` o `rediss://` (referencia a `Redis`) |
| `BETTER_AUTH_SECRET` | sí | no | Secreto de al menos 32 caracteres |
| `COLLAB_TOKEN_SECRET` | sí | sí | El mismo en los dos, de al menos 32 caracteres y distinto de `BETTER_AUTH_SECRET` |
| `MAIL_DRIVER`, `MAIL_FROM` | sí | no | `resend` o `smtp`, y el remitente (`Parcify <no-reply@parcify.app>`) |
| `RESEND_API_KEY` o `SMTP_URL` | sí | no | La del driver elegido |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opcional | no | Las dos o ninguna; sin ellas no aparece el botón de Google |
| `STORAGE_DRIVER` | sí | sí | `s3` o `local` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | con `s3` | con `s3` | Datos del bucket (ver el paso 8) |
| `STORAGE_LOCAL_PATH`, `STORAGE_URL_SECRET` | con `local` | con `local` | Ruta del volumen y secreto de firma de al menos 32 caracteres, distinto de los demás |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | opcional | no | Claves de los proveedores de IA que uses |
| `AI_MODEL_ASSISTANT`, `AI_MODEL_ANIMATION`, `AI_MODEL_CHAT`, `AI_MODEL_IMAGE`, `AI_MODEL_VISION` | opcional | no | `proveedor:modelo`; la función sin modelo queda desactivada |
| `AI_QUOTA_WORKSPACE_MONTHLY_UNITS`, `AI_QUOTA_USER_DAILY_UNITS`, `AI_IMAGE_DOWNLOAD_HOSTS` | opcional | no | Cuotas y hosts de descarga (ver «IA») |
| `COLLAB_MAX_CONN_PER_DOC` | no | opcional | Conexiones por documento y réplica; 100 por defecto |
| `INSTANCE_ID` | opcional | opcional | Por defecto `RAILWAY_REPLICA_ID`, que pone Railway |
| `METRICS_TOKEN` | opcional | opcional | Al menos 16 caracteres; sin él `/metrics` responde 401 |
| `SENTRY_DSN` | opcional | opcional | DSN del proyecto de Sentry |
| `LOG_LEVEL` | opcional | opcional | `info` por defecto |

Si falta algo o un valor no vale, el proceso escribe la lista de problemas (nombra las variables, sin mostrar los secretos) y termina con código 1, así que el despliegue no llega a quedar sano.

La URL privada de Redis (`redis.railway.internal`) puede resolver solo a IPv6. El cliente de Redis se crea con `family: 0`, que admite IPv4 e IPv6, así que no hay que añadir nada a la URL.

### 5. Migraciones

`railway.api.json` y `railway.collab.json` definen el mismo *pre-deploy* `npx prisma migrate deploy`, que Railway ejecuta con la imagen nueva y las variables del servicio antes de cambiar el tráfico. Los dos servicios se despliegan en paralelo desde el mismo repo, así que ninguno arranca con un esquema por aplicar. Si se lanzan a la vez no se pisan: `migrate deploy` toma un bloqueo de Postgres y el segundo no encuentra nada pendiente. Si falla, el despliegue de ese servicio se detiene y siguen las réplicas anteriores. Como las réplicas antiguas siguen vivas durante el *draining*, cada migración tiene que ser compatible con el código anterior (primero se añade, en otro despliegue se quita).

### 6. Google OAuth

En Google Cloud Console, crea un cliente OAuth de tipo «Aplicación web» y añade como URI de redirección autorizada `https://api.parcify.app/api/auth/callback/google` (con staging, añade también `https://api.staging.parcify.app/api/auth/callback/google`). La redirección vuelve a la API, no a la web. Copia el id y el secreto en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` de `api`. Si la pantalla de consentimiento está en modo de pruebas, solo entran los usuarios que añadas allí.

### 7. Correo

En producción hace falta un proveedor real: con `MAIL_DRIVER=console` la API no arranca.

- Resend: verifica tu dominio en Resend, crea una clave con permiso de envío y pon `MAIL_DRIVER=resend`, `RESEND_API_KEY` y un `MAIL_FROM` de ese dominio.
- SMTP: `MAIL_DRIVER=smtp` y `SMTP_URL` con el formato `smtps://usuario:contraseña@servidor:465` (codifica en la URL los caracteres especiales de la contraseña).

Configura SPF y DKIM del dominio de envío para que los códigos no acaben en spam.

### 8. Storage

Recomendado: `STORAGE_DRIVER=s3` con Cloudflare R2 u otro compatible.

1. Crea un bucket privado (sin acceso público).
2. Crea un token de API con lectura y escritura de objetos, limitado a ese bucket.
3. En `api` y `collab`: `S3_ENDPOINT=https://<id de cuenta>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `S3_FORCE_PATH_STYLE=true`. Con estilo de ruta las URLs firmadas usan el origen de `S3_ENDPOINT`, que es el que va en `PUBLIC_STORAGE_ORIGIN` del cliente.
4. Añade al bucket una regla CORS que permita `GET` y `PUT` desde `https://parcify.app` con la cabecera `content-type`. Sin ella la subida desde el navegador falla.
5. Activa el versionado de objetos si tu proveedor lo ofrece; es la copia de seguridad del storage.

`STORAGE_DRIVER=local` guarda los ficheros en disco y solo vale con estas condiciones:

- Un Railway Volume montado en `api` en la ruta de `STORAGE_LOCAL_PATH` (por ejemplo, el volumen en `/data` y `STORAGE_LOCAL_PATH=/data`). Sin volumen, los ficheros se pierden en cada despliegue.
- Una sola instancia de `api`: cambia `numReplicas` a 1 en `railway.api.json`. Un volumen no se comparte entre réplicas ni entre servicios, así que `collab` no ve los ficheros; por eso, con `local`, la limpieza de assets y el borrado definitivo de proyectos corren en la API. `collab` necesita igualmente `STORAGE_DRIVER=local`, `STORAGE_LOCAL_PATH` y el mismo `STORAGE_URL_SECRET`.
- Railway monta los volúmenes como root y la imagen corre como `node`, así que la API no puede escribir en él salvo que añadas `RAILWAY_RUN_UID=0` al servicio, que la ejecuta como root. Es otra razón para preferir `s3`.
- En el cliente, `PUBLIC_STORAGE_ORIGIN` es el origen de la API.

### 9. IA

Es opcional. Sin ningún `AI_MODEL_*`, las funciones de IA no aparecen en la interfaz. Para activarlas, pon en `api` la clave del proveedor y el modelo de cada función, por ejemplo `OPENAI_API_KEY` y `AI_MODEL_CHAT=openai:<modelo>`; la sección «IA» tiene la lista de proveedores y unidades. Si un `AI_MODEL_*` apunta a un proveedor sin clave, la API no arranca. El proveedor `mock` solo existe con `NODE_ENV=test`.

### 10. Copias de seguridad y observabilidad

- Postgres: activa las copias de seguridad del servicio en Railway.
- Storage: el versionado del bucket (paso 8) o, con `local`, las copias del volumen.
- Métricas: con `METRICS_TOKEN`, `GET /metrics` en `api` y `collab` (ver «Observabilidad»). Railway no las recoge; hay que apuntar un colector externo.
- Errores: `SENTRY_DSN` en `api` y `collab`, y `PUBLIC_SENTRY_DSN` en el cliente.

### 11. Después del primer despliegue

- `https://api.parcify.app/ready` y `https://collab.parcify.app/ready` responden 200.
- Registra una cuenta: llega el código por correo y, al entrar, la sesión se mantiene al recargar `https://parcify.app/app`.
- Abre un proyecto en dos navegadores y comprueba que los cambios se ven en los dos.
- Quedan por comprobar con el entorno real: que la IP del cliente llega bien con `TRUST_PROXY_HOPS=1`, el CORS del bucket con una subida real y que el proxy no corta los WebSocket de un documento abierto sin actividad durante varios minutos.

## Notas sobre dependencias

Todas las versiones están fijadas sin rangos. Las herramientas añadidas para el desarrollo son `eslint@10.12.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.71.2`, `globals@17.13.0` y `@hocuspocus/provider@4.7.1` (cliente de las pruebas de colaboración, la misma versión que el servidor). El esquema de las tablas de autenticación se contrastó con la salida de `npx auth@1.7.10 generate` (la CLI de Better Auth de la misma versión); de ahí sale la relación entre `Invitation.inviterId` y `User`.

`fastify-type-provider-zod` se usa con `validatorCompiler` y `serializerCompiler`, así que las respuestas solo contienen los campos declarados en su esquema.
