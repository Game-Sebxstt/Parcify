<p align="center">
  <img src="./client/public/brand/Logo.jpg" alt="Parcify" width="160" />
</p>

<h1 align="center">Parcify</h1>

<p align="center">Un lienzo colaborativo en tiempo real para diseñar, diagramar y presentar en equipo, desde el navegador.</p>

---

Parcify es un espacio de trabajo visual donde varias personas crean sobre el mismo lienzo a la vez. Abres un proyecto, invitas a tu equipo y todos veis los cambios al instante: los cursores de los demás, lo que seleccionan y lo que escriben. Sirve para bocetar ideas, montar diagramas y esquemas, diseñar interfaces, preparar una presentación o pensar en voz alta sobre un tablero infinito. Y cuando necesitas una mano, un asistente de IA crea y edita por ti, siempre con una vista previa antes de tocar nada.

<p align="center">
  <img src="./docs/media/01-portada.png" alt="Portada de Parcify con el logo y el lienzo vivo de ejemplo en la parte principal" width="760" />
</p>

## Contenido

- [Para quién es](#para-quién-es)
- [Qué puedes hacer](#qué-puedes-hacer)
  - [Lienzo y herramientas](#lienzo-y-herramientas)
  - [Edición y estilos](#edición-y-estilos)
  - [Páginas y marcos](#páginas-y-marcos)
  - [Colaboración en tiempo real](#colaboración-en-tiempo-real)
  - [Chat del proyecto](#chat-del-proyecto)
  - [Asistente de IA](#asistente-de-ia)
  - [Animación](#animación)
  - [Versiones e historial](#versiones-e-historial)
  - [Exportar y presentar](#exportar-y-presentar)
  - [Espacios de trabajo y proyectos](#espacios-de-trabajo-y-proyectos)
  - [Compartir e invitar](#compartir-e-invitar)
  - [Plantillas](#plantillas)
  - [Miembros y permisos](#miembros-y-permisos)
  - [Actividad del equipo](#actividad-del-equipo)
  - [Cuentas y acceso](#cuentas-y-acceso)
- [Cómo está hecho](#cómo-está-hecho)
- [Cómo probarlo](#cómo-probarlo)
- [Documentación](#documentación)
- [Autor](#autor)
- [Licencia](#licencia)

## Para quién es

- Equipos de diseño y producto que bocetan y revisan juntos.
- Equipos de marketing que planifican campañas, calendarios y mensajes.
- Quienes hacen diagramas, mapas de experiencia o esquemas de flujos.
- Profesores y formadores que preparan material visual en grupo.
- Cualquiera que quiera un tablero infinito compartido para pensar en equipo.

## Qué puedes hacer

<table>
<tr>
<td width="50%" valign="top">

### Lienzo y herramientas

<img src="./docs/media/05-editor.png" alt="Editor de Parcify con la página Estrategia de una campaña: título, cuatro tarjetas unidas por conectores, un calendario, las capas a la izquierda y el minimapa" width="100%" />

Un lienzo infinito con todo lo necesario para construir:

- Formas (rectángulo, elipse, triángulo, rombo, estrella, polígono, arco, línea y flecha), texto, imágenes y conectores entre elementos.
- Grupos para mover y tratar varias cosas como una sola.
- Árbol de capas y minimapa para no perderte en proyectos grandes.
- Zoom, deshacer y rehacer, y copiar y pegar entre proyectos.

</td>
<td width="50%" valign="top">

### Edición y estilos

<img src="./docs/media/06-edicion.png" alt="Tarjeta Canales seleccionada con el panel de propiedades abierto y su capa resaltada en la lista" width="100%" />

Selecciona cualquier elemento y ajústalo desde su panel de propiedades:

- Relleno, trazo (grosor y estilo), esquinas redondeadas, sombra y opacidad.
- Texto dentro de las formas con fuente, tamaño, peso y alineación.
- Conectores rectos, en codo o curvos, con o sin flecha.
- Ocultar, bloquear, renombrar y reordenar desde la lista de capas.

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

### Páginas y marcos

<img src="./docs/media/07-paginas-y-marcos.png" alt="Página Presentación con cuatro marcos 16:9 y el marco Portada seleccionado con su tamaño predefinido" width="100%" />

- Varias páginas dentro del mismo proyecto: estrategia en una, presentación en otra.
- Marcos para encuadrar pantallas, diapositivas o secciones, con tamaños predefinidos como 16:9.

</td>
<td width="50%" valign="top">

### Colaboración en tiempo real

<img src="./docs/media/08-colaboracion-en-vivo.png" alt="Dos personas en el mismo lienzo: el avatar de Mawiko en la barra superior, su cursor con su nombre sobre la tarjeta Público y su selección en la tarjeta Mensaje" width="100%" />

Trabajar a la vez, sin pisarse:

- Varias personas editando el mismo proyecto al mismo tiempo.
- Cursores y selección de cada quien, con su nombre y su color.
- Avatares de quién está dentro y la opción de «Seguir a» otra persona por el lienzo.
- Los cambios se guardan solos y se sincronizan al recuperar la conexión.

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

### Chat del proyecto

<img src="./docs/media/09-chat-del-proyecto.png" alt="Chat del proyecto con cuatro mensajes entre Sebastian y Mawiko, una mención resaltada, una respuesta citada y el aviso Mawiko está escribiendo" width="100%" />

Cada proyecto tiene su conversación, al lado del lienzo:

- Menciones con `@` para avisar a alguien.
- Responder a un mensaje concreto, adjuntar archivos y editar o borrar lo enviado.
- Aviso de «está escribiendo…» y contador de mensajes sin leer.

</td>
<td width="50%" valign="top">

### Asistente de IA

<img src="./docs/media/10-asistente-ia.png" alt="Pestaña Chat de Parcify IA junto a la estrategia de la campaña: la IA responde con tres ideas de publicaciones para Instagram sobre el mensaje «Tu café, tu primavera»" width="100%" />

Agentes que entienden tu lienzo y trabajan contigo (opcional, requiere configurar un proveedor de IA):

- Asistente que crea y edita elementos a partir de lo que le pides por texto, con vista previa y los botones Aplicar o Descartar.
- Chat de IA dentro del proyecto que tiene en cuenta lo que ves en el lienzo, para resolver dudas o pedir ideas.
- Animaciones propuestas por la IA sobre los elementos que elijas.
- Generación de imágenes a partir de una descripción.

> Sobre la captura: se hizo en local con Ollama y el modelo `qwen2.5:1.5b` ejecutándose en CPU, por limitaciones de hardware. El servidor corta cada petición de texto a los 60 s (`AI_TEXT_TIMEOUT_MS`, fijo en el código). La calidad, la velocidad y el formato de las respuestas dependen del modelo y del proveedor que configures: OpenAI, Anthropic, Google o cualquier API compatible con OpenAI.

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

### Animación

<img src="./docs/media/11-animacion.png" alt="Línea de tiempo con cinco pistas escalonadas y el cabezal a mitad de la animación" width="100%" />

Da vida a tus diseños:

- Línea de tiempo por fotogramas clave para animar posición, escala, opacidad y más.
- Curvas de suavizado, retardos, duración y bucle.
- Reproducción directa en el editor para ver el resultado al instante.

</td>
<td width="50%" valign="top">

### Versiones e historial

<img src="./docs/media/12-versiones.png" alt="Panel Versiones con Lista para presentar, Paleta aprobada, Primer borrador y dos versiones automáticas" width="100%" />

- Versiones automáticas y versiones con nombre de cada proyecto.
- Vista previa de una versión anterior antes de decidir.
- Restaurar el proyecto a un punto previo cuando haga falta.

</td>
</tr>
</table>

### Exportar y presentar

- Exportar a PNG, JPG, SVG y PDF, a la escala que necesites.
- Importar y exportar el formato propio `.parcify` para mover proyectos entre cuentas.
- Modo presentar: los marcos de la página se convierten en diapositivas a pantalla completa.

<table>
<tr>
<td width="50%" valign="top">

Exportar

<img src="./docs/media/13-exportar.png" alt="Diálogo Exportar imagen con formato PNG a escala 2x y el tamaño final en píxeles" width="100%" />

</td>
<td width="50%" valign="top">

Presentar

<img src="./docs/media/14-presentar.png" alt="Modo Presentar mostrando la diapositiva Portada de la campaña" width="100%" />

</td>
</tr>
</table>

### Espacios de trabajo y proyectos

Todo en su sitio, también cuando hay mucho:

- Espacios de trabajo para cada equipo, cliente o tema.
- Proyectos con vista previa, quién lo editó por última vez y cuándo.
- Búsqueda, filtros, orden y favoritos.
- Papelera para recuperar lo que borras sin querer.

<table>
<tr>
<td width="50%" valign="top">

Crear un espacio

<img src="./docs/media/03-crear-espacio.png" alt="Diálogo Crear un espacio con el nombre Equipo de producto sobre la rejilla de proyectos de Estudio Aurora" width="100%" />

</td>
<td width="50%" valign="top">

Proyectos del espacio

<img src="./docs/media/04-proyectos.png" alt="Espacio Estudio Aurora con cuatro proyectos con vista previa y Campaña de primavera marcada como favorita" width="100%" />

</td>
</tr>
</table>

### Compartir e invitar

- Invita por email a un proyecto con el rol que quieras.
- Enlaces para compartir con rol, caducidad, número de usos y la opción de revocarlos.
- Invitaciones a un espacio de trabajo que la otra persona acepta o rechaza desde su correo.

<table>
<tr>
<td width="50%" valign="top">

Compartir un proyecto

<img src="./docs/media/16-compartir.png" alt="Diálogo Compartir Campaña de primavera con invitación por email, personas con acceso y un enlace de solo lectura con su caducidad y el botón Revocar" width="100%" />

</td>
<td width="50%" valign="top">

Aceptar una invitación

<img src="./docs/media/17-invitacion.png" alt="Página de invitación: Sebastian Garces te invita a unirte a Estudio Aurora como miembro, con los botones Aceptar y No, gracias" width="100%" />

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

### Plantillas

<img src="./docs/media/15-plantillas.png" alt="Pestaña Plantillas del espacio con cuatro plantillas y sus me gusta" width="100%" />

- Publica cualquier proyecto como plantilla del espacio.
- Galería de plantillas con «me gusta» para encontrar las más útiles.
- Crea un proyecto nuevo a partir de una plantilla en un clic.

</td>
<td width="50%" valign="top">

### Miembros y permisos

<img src="./docs/media/18-miembros.png" alt="Pestaña Miembros con el formulario de invitación, Sebastian como propietario y Mawiko como miembro con su selector de rol" width="100%" />

- Roles de propietario, administrador y miembro en cada espacio.
- Permisos por proyecto: quién puede ver, editar o administrar.
- Cambiar el rol de alguien, expulsarlo o salir del espacio.

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

### Actividad del equipo

<img src="./docs/media/19-metricas.png" alt="Pestaña Actividad de los últimos 7 días con el resumen, barras por colaborador, minutos por día y la tabla por colaborador" width="100%" />

- Métricas por espacio o por proyecto de los últimos 7, 30 o 90 días.
- Ediciones por día y por colaborador, minutos con actividad, sesiones y mensajes.
- Historial de eventos para ver cómo avanza el trabajo.

</td>
<td width="50%" valign="top">

### Cuentas y acceso

<img src="./docs/media/02-acceso.png" alt="Ventana Crear tu cuenta sobre la portada, con nombre, email y contraseña rellenos" width="100%" />

- Registro con email y contraseña, con verificación por código que llega al correo.
- Recuperar la contraseña y entrar con Google.
- Ajustes de perfil, sesiones abiertas, registro de seguridad y preferencias.

</td>
</tr>
</table>

## Cómo está hecho

Parcify se usa desde el navegador. Detrás hay un servidor para las cuentas y los proyectos, otro que mantiene la edición en vivo entre todas las personas conectadas, una base de datos, un servicio de mensajería interna, un almacén para las imágenes (o una carpeta en disco), el correo para verificaciones e invitaciones y, si se quiere, un proveedor de IA externo.

```mermaid
%%{init: {"theme": "base", "flowchart": {"curve": "basis", "nodeSpacing": 35, "rankSpacing": 40, "padding": 14, "wrappingWidth": 280}, "themeVariables": {"fontFamily": "Manrope, Segoe UI, Arial, sans-serif", "fontSize": "16px", "background": "#000B1D", "primaryColor": "#122136", "primaryTextColor": "#EEF2F6", "primaryBorderColor": "#244355", "secondaryColor": "#122136", "tertiaryColor": "#000B1D", "lineColor": "#A7B3C2", "textColor": "#EEF2F6", "clusterBkg": "#0A1628", "clusterBorder": "#244355", "titleColor": "#EEF2F6", "edgeLabelBackground": "#122136"}}}%%
flowchart TB
    subgraph NAV["Navegador"]
        cliente["Cliente web<br/>Astro + Svelte 5 · Yjs"]
    end

    proxy["Proxy Caddy 2.10 · TLS<br/>web · api · collab · s3"]

    subgraph SRV["Servidor (Docker Compose)"]
        web["web<br/>Caddy · build estático de Astro"]
        api["api<br/>Fastify 5 · REST /v1 y auth"]
        collab["collab<br/>Hocuspocus + Yjs"]
        pg[("PostgreSQL 18")]
        redis[("Redis 8")]
        s3[("Almacenamiento S3<br/>SeaweedFS en local")]
        vol[("o volumen local<br/>STORAGE_DRIVER=local")]
        mailpit["Mailpit<br/>correo en local"]
    end

    subgraph EXT["Servicios externos"]
        ia["Proveedor de IA (opcional)<br/>OpenAI · Anthropic · Google"]
        s3ext[("S3 externo<br/>R2 u otro S3")]
        correo["Correo en producción<br/>Resend o SMTP"]
    end

    cliente -->|"HTTPS · WSS"| proxy
    proxy -->|"HTTP :8080"| web
    proxy -->|"HTTP :3000"| api
    proxy -->|"WebSocket :3001"| collab
    proxy -->|"S3 · URLs firmadas"| s3
    api -->|"SQL"| pg
    collab -->|"SQL"| pg
    api <-->|"Redis pub/sub"| redis
    collab <-->|"Redis pub/sub"| redis
    api -->|"S3"| s3
    api -.->|"archivos"| vol
    api -->|"SMTP :1025"| mailpit
    api -.->|"HTTPS"| ia
    api -.->|"S3"| s3ext
    api -->|"SMTP / HTTPS"| correo

    classDef coral fill:#FB8F5A,stroke:#FB8F5A,color:#000B1D
    classDef salvia fill:#AAD696,stroke:#AAD696,color:#000B1D
    classDef petroleo fill:#244355,stroke:#AAD696,color:#EEF2F6
    classDef ambar fill:#F4C76A,stroke:#F4C76A,color:#000B1D
    classDef lila fill:#B9A6F5,stroke:#B9A6F5,color:#000B1D
    classDef superficie fill:#122136,stroke:#244355,color:#EEF2F6

    class cliente,proxy coral
    class collab salvia
    class pg,redis,s3,vol,s3ext petroleo
    class mailpit,correo ambar
    class ia lila
    class web,api superficie
```

<p align="center">
  <img src="./docs/media/20-arquitectura.png" alt="Diagrama de arquitectura de Parcify: navegador, proxy con TLS, web, api, colaboración en tiempo real, PostgreSQL, Redis, almacenamiento S3 o volumen local, correo y proveedor de IA opcional" width="640" />
</p>

El detalle técnico de cada parte está en [client/README.md](client/README.md) y [server/README.md](server/README.md).

## Cómo probarlo

Puedes ponerlo en marcha en tu equipo en unos minutos o desplegarlo en un servidor para todo el equipo. Los pasos están en [DEPLOY.md](DEPLOY.md):

- En Railway, con las imágenes guardadas en un volumen, para usarlo de verdad.
- En tu equipo, para desarrollar o probar, o con HTTPS como si fuera producción.
- En un VPS propio con Docker.

## Documentación

- [DEPLOY.md](DEPLOY.md): cómo desplegar Parcify en Railway con un volumen, en tu equipo o en un VPS.
- [client/README.md](client/README.md): detalles técnicos del cliente web.
- [server/README.md](server/README.md): detalles técnicos del servidor (API y colaboración).

## Autor

Hecho por Sebxstt ([GarcesSebastian](https://github.com/GarcesSebastian)).

## Licencia

[MIT](LICENSE).
