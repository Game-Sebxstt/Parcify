# Comprobación manual con lector de pantalla

axe y `e2e/a11y.spec.ts` solo detectan una parte de los problemas. La validación completa de WCAG 2.2 AA necesita pruebas manuales con tecnologías de asistencia y una revisión experta; esta lista sirve para preparar esa revisión, no la sustituye.

Combinaciones mínimas: NVDA con Firefox y JAWS o NVDA con Chrome en Windows, VoiceOver con Safari en macOS y VoiceOver en iOS para la landing y `/invitacion`. Hacer cada paso solo con el teclado (o con gestos en iOS), con el monitor apagado o la cortina de pantalla activada, y anotar lo que se oye.

## En todas las pantallas

- [ ] El título de la página (`<title>`) dice dónde estás.
- [ ] Hay un único `h1` y los encabezados siguen un orden que permite saltar por ellos (H en NVDA, rotor en VoiceOver).
- [ ] Las regiones (`banner`, `navigation`, `main`, `complementary`) tienen nombre cuando hay más de una del mismo tipo.
- [ ] El foco se ve siempre y nunca se pierde detrás de un panel o un aviso.
- [ ] Los avisos (toasts) se anuncian una vez, sin robar el foco; los que tienen acción se pueden alcanzar con el teclado.
- [ ] Con «Reducir el movimiento» activado, nada se mueve solo.
- [ ] Al hacer zoom al 200 % y a 320 px de ancho no hay que desplazarse en horizontal (salvo el lienzo).

## Landing (`/`)

- [ ] «Saltar al contenido» es lo primero que se oye y lleva a `main`.
- [ ] Las pestañas de «Cada cambio, a la vista» se anuncian como pestañas, con su estado, y se recorren con las flechas.
- [ ] Cada captura del producto se anuncia con su `alt` y el texto describe lo que se ve, no «imagen».
- [ ] El lienzo de demostración anuncia su nombre y que se puede arrastrar; «Añadir 1.000 elementos» anuncia el resultado.
- [ ] La frase del cierre se entiende leída de corrido: «Mi email es, campo de edición, y quiero, botón empezar».

## Acceso (overlay)

- [ ] Al abrirse, el foco va al primer campo y el diálogo anuncia su título.
- [ ] Los errores de cada campo se leen al llegar al campo y al enviar.
- [ ] El código de 6 dígitos se puede pegar y se anuncia como un único campo.
- [ ] Escape cierra y el foco vuelve a «Entrar» o «Crear cuenta».

## Inicio, espacio y ajustes (`/app`, `/app/e/:slug`, `/app/ajustes`)

- [ ] Las pestañas del espacio (Proyectos, Plantillas, Miembros, Actividad, Ajustes) se anuncian como pestañas y la URL cambia con ellas.
- [ ] En la lista de proyectos, cada tarjeta se lee con su nombre y la casilla de selección dice qué proyecto selecciona.
- [ ] La barra de selección anuncia cuántos proyectos hay seleccionados.
- [ ] Plantillas: la galería vacía dice qué hacer; las reacciones anuncian su estado.
- [ ] Actividad: cada gráfico tiene su tabla («Ver los datos en una tabla») y el historial se lee en orden.
- [ ] Miembros: el selector de rol y «Expulsar» dicen a quién afectan; las invitaciones pendientes y «Anular» también; si la lista no carga, se anuncia el error y «Reintentar».
- [ ] Ajustes de la cuenta: sesiones activas, historial de seguridad y «Borrar la cuenta» (con su confirmación) se alcanzan y se entienden.

## Editor (`/p/:id`)

- [ ] El lienzo se anuncia como aplicación con su nombre; dentro, Tab recorre las formas y la región en vivo dice qué hay seleccionado y su tamaño.
- [ ] Las flechas mueven la selección y se anuncia el cambio; Escape sale de la selección.
- [ ] El árbol de capas se anuncia como árbol: nivel, expandido o no, oculto o bloqueado; F2 renombra y H oculta.
- [ ] Las herramientas dicen su nombre y su atajo.
- [ ] Propiedades: cada campo tiene etiqueta; los deslizadores dicen su valor con unidad.
- [ ] Estado de conexión y «Solo lectura» se anuncian cuando cambian.
- [ ] Menú contextual (Shift+F10): se anuncia como menú y se recorre con las flechas.
- [ ] Timeline: la rejilla se anuncia como rejilla; cada fotograma clave dice pista, tiempo y valor; el cabezal es un deslizador; Enter abre el editor del fotograma y Escape vuelve a la celda.
- [ ] Parcify IA: la vista previa se anuncia al llegar, «Aplicar» y «Descartar» son alcanzables y el resultado se anuncia; el chat de IA lee las respuestas cuando terminan, no a trozos.
- [ ] Chat del proyecto: los mensajes nuevos se anuncian sin mover el foco; el botón «Chat, N sin leer» dice cuántos hay; quitar un adjunto dice cuál.
- [ ] Versiones: cada versión se lee con su fecha; la vista previa dice que es una vista previa y cómo salir.
- [ ] Compartir: el diálogo anuncia su título; el enlace recién creado se lee y se copia; «Revocar» y «Quitar» dicen a quién o a qué afectan.
- [ ] Exportar y Presentar: el diálogo anuncia sus opciones; en Presentar, el contador de diapositivas se anuncia al cambiar y Escape sale.

## Invitación (`/invitacion`)

- [ ] Sin sesión, el overlay se abre y, al entrar, vuelves a la misma invitación.
- [ ] El mensaje de la invitación (quién, qué proyecto o espacio, con qué rol, cuándo caduca) se lee entero antes de «Aceptar».
- [ ] Cada error se anuncia y dice qué hacer; si falla la red, «Reintentar» vuelve a pedir la misma invitación.

## Resultado

Anotar por pantalla: combinación usada, fecha, quién lo probó, lo que falló y cómo se reproduce. Esta lista no está ejecutada todavía: queda para la revisión manual antes del despliegue.
