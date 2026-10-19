# Landing (`/`)

Archivos: `src/pages/index.astro`, `src/components/landing/*.astro`, `src/islands/{LandingCanvas,LandingControls,AuthLauncher}.svelte`, `src/landing/*.ts`, `src/styles/landing.css`.

## Proceso de design-taste-frontend

Lectura: landing de una herramienta de lienzo colaborativo para equipos, con la marca ya fijada (paleta y Manrope), dial ENERGY 2 / RHYTHM 3 / MOTION 2.

Inventario de lo que solo tiene Parcify: el logo (un aro coral que encierra dos medias lunas, coral y salvia sobre petróleo, con estrellas de cuatro puntas); el motor propio sobre Pixi que pinta formas reales; dos cursores con nombre y color de colaborador; el deshacer por persona; la copia local sin conexión; los roles por proyecto que cambian en vivo; la IA con vista previa antes de aplicar; el timeline de keyframes; el overlay de acceso sin rutas `/login`; el nombre «Parcify».

Argumento (una afirmación por sección, con su prueba):

| Sección | Afirmación | Prueba en la página |
|---|---|---|
| Hero | Un lienzo que edita todo el equipo a la vez | El motor real con un documento embebido y Ana editando |
| En vivo | Cada cambio se ve mientras ocurre | Capturas del editor: el cursor de otra persona con su selección, la barra de presencia y el estado sin conexión, deshacer y rehacer |
| Detalle | El editor cuida el detalle | Primeros planos capturados del editor: opacidad, barra de herramientas, sin conexión, presencia, solo lectura, zoom, timeline |
| IA | La IA propone y tú decides | Cuatro capturas del asistente: la petición, la vista previa, el cambio aplicado en el lienzo y deshacer |
| Espacios | Cada equipo tiene su espacio y sus permisos | Captura de la lista de miembros de un espacio con tres roles |
| Cierre | Crear la cuenta es un paso | Frase con el hueco del email que abre el overlay |

Dirección: `draw.mjs --sector saas --sections showcase,features,how-it-works,about,cta,footer --have product-ui --keep palette,type --options 3`, semilla 743952456. De las tres (colour-chapters, quiet-instrument, one-motif) se elige **one-motif**: el logo es un círculo y sus medias lunas, y esa forma puede ser el escenario del lienzo, los botones y el pie. Un redraw: el hero «Tabbed folder stack» pedía mayúsculas condensadas y cinco carpetas de colores que la marca no tiene; se redibujó a «Giant cropped shape», que es el motivo mismo.

Idea: en esta página, **el aro y las dos medias lunas del logo** se convierten en **el escenario circular del lienzo vivo, donde dos cursores construyen un cartel mientras lees**. Prueba del competidor: con Figma o Miro la frase no funciona, porque el aro es de Parcify.

Lo vivo: el hero monta el motor real (`createEngine` con `embedded: true`) sobre un `Y.Doc` local; «Ana» es un segundo `Y.Doc` con su propio Awareness sincronizado por updates, así que su cursor, su selección y sus formas llegan por la misma ruta que un colaborador remoto. El visitante arrastra cualquier forma y Ana deja lo que hace y se acerca a mirarla. «Añadir 1.000 elementos» mete mil nodos en el documento y la línea de al lado da el tiempo medio de trabajo por fotograma medido en el navegador del visitante (no es una cifra inventada: la calcula `onFrame`).

Copy: titular «Un lienzo para todo tu equipo» (29 caracteres, ≤ 32, aprobado por el propietario), una frase de apoyo y una acción: «Crear cuenta gratis», que abre el overlay. Sin cifras, clientes ni testimonios. Desde la Fase 10, todas las secciones muestran capturas reales del producto en `public/landing/`, dentro de contenedores `data-ui` y con `alt` que describe lo que se ve.

Carga: `LandingCanvas` con `client:visible` y el motor en `import()` dentro de `requestIdleCallback` (con `setTimeout` de respaldo). Antes, y sin JS, se ve `public/landing/lienzo.png`, una captura del mismo lienzo generada con `scripts/landing-capture.ts`. Con `prefers-reduced-motion` (o el ajuste «Reducir el movimiento») Ana no se mueve sola y no hay entradas ni animación del titular. El overlay de acceso también se descarga al primer uso (`AuthLauncher`).

## Capturas del producto

`scripts/landing-shots.ts` genera las 14 capturas con Playwright contra el entorno de los e2e (stack de pruebas, `npm run start:e2e` en el servidor y el build servido en 4321 con `PUBLIC_TEST_HOOKS=1`). Crea tres cuentas de ejemplo (Ana Ruiz, Bea Marín y Carla Soto, con emails `@example.com`), une a Bea y a Carla al espacio con invitaciones reales, dibuja un cartel con las piezas del logo y recorta cada control del editor real a 2x: cursores y selección de Bea vistos por Ana, barra de presencia, estado sin conexión (contexto de Bea con `setOffline`), «Solo lectura» de Carla, deshacer y zoom, propiedades con la opacidad al 72 %, barra de herramientas, timeline con la animación propuesta por la IA, el asistente (petición, vista previa y resultado) y la lista de miembros. La IA es el proveedor simulado de los e2e, así que la vista previa dice «Plan de prueba»: es la salida real de la interfaz con ese proveedor. Para la versión pública, conviene repetir la captura del asistente con un modelo real. Los nombres y emails de las cuentas son de ejemplo y lo dice el `alt`; no son clientes.

La captura del hero (`lienzo.png`) sigue siendo la de `scripts/landing-capture.ts`: es el mismo motor que se monta encima.

## Gate

| Comprobación | Resultado |
|---|---|
| `lint.mjs` sobre index, componentes, CSS e islas | 0 FAIL, 0 WARN |
| `inspect.mjs` (1440, 768 y 390 px) | 0 FAIL, 3 WARN (abajo); 18 imágenes, titular en 2 líneas en los tres anchos |
| Presupuesto de JS antes del lienzo vivo (`npm run budget`) | 31,4 KB gzip de 60 KB |

WARN defendidos:

- `card-rows`: las piezas del tablero «Detalle» y los cuatro campos de la IA tienen el mismo marco a propósito (blueprints «Close-ups on a board» y «One card, four fields»); cada pieza tiene otro tamaño, otro color y otra captura.
- `no-real-pictures` y `no-footage`: es software; las imágenes son capturas reales de su interfaz, que es lo que la hoja de dirección pide para un producto digital. No se usan fotos de archivo ni de relleno. Un vídeo grabado del editor queda como mejora (no hay ninguna grabación del producto).

## Crítica sobre capturas (tres rondas, Fase 10)

1. Escritorio: las capturas se veían como sellos en piezas grandes (herramientas y presencia diminutas, «Sin conexión» ilegible en una pieza estrecha; el lienzo llevaba un marco gris del editor). Se recorta el lienzo sin margen, la pieza «Sin conexión» pasa a 5 columnas y las capturas de herramientas y presencia se amplían a su pieza.
2. Escritorio: la timeline salía con «1,00 s» partido en dos líneas y los avisos de «aplicado» tapaban el panel; la vista previa decía «1 cambios propuestos». Se arregla en el producto (etiquetas de la regla sin salto de línea; plurales en `es.json`) y la captura espera a que caduquen los avisos. Deshacer y zoom se recortan dentro de su barra, sin el fondo del lienzo.
3. Móvil (390 px): «Sin conexión» y el zoom eran ilegibles a media anchura y la lista de miembros salía muy pequeña dentro del círculo. Las dos piezas van a todo el ancho en móvil y la captura de miembros ocupa el 94 % del círculo.

Puntuación final (`references/critique.md`, de 10): diseño 7,5, usabilidad 8, creatividad 7, contenido 7,5. Lo que aún falta: una pieza en movimiento grabada del producto y la captura del asistente con un modelo real.

Titular para validar con el propietario: «Un lienzo para todo tu equipo» (29 caracteres, ≤ 32). No ha cambiado en esta fase.
## Delivery Gate de antislop

Bloque 1 (todas **no**):

- R-02 PASS: sin raya (`—`) en los textos de la landing (`grep` sobre `messages/es.json` y los componentes).
- R-03 PASS: `inspect.mjs` sin `overflow` a 390, 768 y 1440 px.
- R-17 PASS: la única cifra es la del fotograma, medida en vivo en el navegador del visitante.
- R-18 PASS: sin testimonios. «Ana» es el personaje del cursor guionizado del diseño aprobado (§12.4), no una clienta; la lista de miembros usa «Tú», «Ana», «Otra persona del equipo» y «Alguien de fuera».
- R-23 PASS: solo el logo de la marca y capturas reales del producto; las cuentas de las capturas son de ejemplo (`@example.com`).
- R-24 PASS: «En vivo», «Detalle», «IA» y «Espacios» apuntan a `#colaboracion`, `#detalle`, `#ia` y `#espacios`, que existen; «Privacidad» y «Términos» a sus páginas.
- R-25 PASS: `inspect.mjs` sin `contrast`; `npm run contrast` en verde; axe sin violaciones.
- R-26 PASS: cada botón hace algo: acceso (abre el overlay), «Añadir 1.000 elementos» (añade y quita), pestañas (cambian el panel), formulario del cierre (abre el registro con el email ya escrito, también sin JS por `GET /?acceso=crear&email=`).
- R-27 PASS: el lienzo tiene estado de carga («Cargando el lienzo…»), listo («Arrastra una forma…») y fallo (sin WebGL se queda la captura).
- R-28 PASS: no hay FAQ.
- R-32 PASS: navegable con teclado; pestañas con flechas; el lienzo recibe el foco y su teclado solo actúa con el foco dentro (`embedded`); enlace «Saltar al contenido».
- R-33 PASS: nada parcheado con scripts externos.
- R-34 PASS: tema único oscuro, sin conmutador.
- R-35 PASS: build y `inspect.mjs` en los tres anchos. Los e2e (`a11y.spec.ts` ampliado) se ejecutan en la validación final de la fase.
- R-36 PASS: sin afirmaciones de seguridad, rendimiento ni clientes; el control de 1.000 elementos lo demuestra en vez de afirmarlo.
- R-37 PASS: dirección escrita en `DESIGN.md` y en este informe.
- R-38 PASS: todo lo que se enseña es la interfaz real capturada; la salida del asistente es la del proveedor simulado y así se indica arriba.

Bloque 2 (técnica con propósito):

- R-01 PASS: sin degradados.
- R-04 PASS: los únicos iconos son los del editor dentro de sus capturas.
- R-06 PASS: Manrope por la marca; sin mayúsculas espaciadas ni monoespaciada (`kbd` en Manrope).
- R-07, R-08, R-09, R-10, R-13 PASS: sin rejilla de fondo, flechas decorativas, cápsulas, vidrio ni brillos.
- R-12 PASS: sin sombras en reposo en la landing (el overlay, que flota, sí la tiene).
- R-14 PASS: el tablero tiene ocho piezas de cuatro tamaños y colores distintos, cada una con un control distinto.
- R-19 PASS: titular que sube línea a línea (gesto principal), aro que se asienta, entradas por sección una vez, respuesta al pulsar; nada en bucle salvo el guion de Ana, que es el contenido del lienzo y se detiene con movimiento reducido.
- R-22 PASS: sin ilustraciones genéricas; el pie dibuja el logo con círculos planos.

Bloque 3 (vida): dial ENERGY 2 / RHYTHM 3 / MOTION 2 declarado; secciones con composiciones distintas (hero recortado, split, mosaico, tira de cuatro campos, panel con retrato circular, frase con hueco, banda del logo); un foco por pantalla; un acento (coral en la acción y en el aro); motivo de identidad: el círculo del logo (escenario, botones, retrato, pie). Lectura de diseño declarada arriba. PASS.

Bloque 4 (oficio): C-1 a C-5 PASS (cada decisión tiene su razón en este informe; ningún control muerto; ninguna sección de relleno; funciona sin ratón y sin JS; nada inventado). R-05 PASS (sin el patrón hero + tarjetas + «cómo funciona» en 3 pasos). R-11 PASS (botones redondos; paneles a 10 px). R-15 PASS («Crear cuenta gratis», «empezar»). R-16 PASS (sin palabras de marketing vacías). R-20 PASS (el aro y las medias lunas no sirven para otra marca). R-21 PASS (tema oscuro por la marca, §12.4). R-29 PASS (paleta del logo). R-30 PASS (no copia la landing de Figma ni de Linear). R-31 PASS.

**Excepción declarada**: el coral `#FB8F5A` se parece al «terracota» que tasteskill marca como tic de páginas generadas. Es el color del aro del logo, muestreado de `Logo.jpg`, y va sobre azul marino, no sobre crema. Se mantiene a propósito (el inspector no lo marca porque no hay crema).

## UI Skill Checklist de antislop-ui

- [x] Paleta del `DESIGN.md` (muestreada del logo). R-01, R-29
- [x] Acento solo en el momento clave: la acción principal y el aro.
- [x] Sin emojis.
- [x] Composiciones distintas según RHYTHM 3.
- [x] Sin bento genérico, terminal falsa, tres columnas de precios ni franjas de color sin sentido (el tablero es el blueprint «Close-ups on a board», cada pieza con la captura de su control).
- [x] Sin cápsula sobre el H1.
- [x] Cada enlace y control tiene destino o comportamiento.
- [x] El movimiento sigue MOTION 2 con propósito escrito; sin bucles decorativos.
- [x] Sin vidrio ni brillo; radio de 10 px en paneles y redondo en botones; sombra solo en lo que flota.
- [x] Puntos de color solo para estados reales (conectado en salvia, sin conexión en rojo).
- [x] (App) no aplica a la landing.
- [x] Sin métricas inventadas: la del fotograma se mide.
- [x] Campos vacíos con marcadores honestos («tu@email.com»).
- [x] Estados de carga y fallo del lienzo con causa.
- [x] Responde a 390, 768 y 1440 px y se usa solo con teclado.

Resultado: **PASS**.
