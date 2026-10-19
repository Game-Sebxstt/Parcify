# Editor (`/p/:id`)

Archivos: `src/islands/Editor.svelte`, `src/islands/editor/*`, `src/layouts/EditorLayout.astro`.

Lectura: herramienta de lienzo con los hábitos de `figma` (DESIGN.md): la interfaz se aparta para dejar sitio al lienzo. Dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Estado en la Fase 10: barra superior (volver, nombre editable, «Solo lectura», estado de conexión, presencia, Parcify IA, versiones, chat, galería, «Presentar» y «Compartir»), herramientas a la izquierda, páginas y capas en el lateral, propiedades a la derecha, deshacer, zoom, minimapa y timeline abajo. Paneles: Parcify IA (asistente y chat), chat del proyecto, versiones, galería, timeline con «Animar con IA», Compartir (ver `compartir-e-invitacion.md`), exportar y presentar.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: la disposición sale del trabajo (lienzo en el centro, herramientas y propiedades a los lados). |
| Stat Cards / Feed / Charts | PASS: no hay. |
| Non-Functional Controls | PASS: todos los botones de la barra y de los paneles hacen algo; los que dependen del rol se ocultan o explican por qué no están (`editor_share_admin_only`). |
| Decorative Status Dot | PASS: el punto de la barra es el estado real de la conexión, con texto al lado. |
| Empty and Loading States | PASS: «Abriendo el proyecto…», pantallas de bloqueo con causa (sin acceso, papelera, lleno, demasiadas pestañas, contexto gráfico perdido) y avisos del documento con su acción. |

UI Skill Checklist: paleta del DESIGN.md; el coral en «Compartir» (acción principal del editor) y en la selección del lienzo; sin emojis; iconos de Lucide elegidos por su significado; sin bucles; sombras solo en lo que flota (zoom y avisos sobre el lienzo). **PASS**.

## web-design-guidelines

```text
src/islands/editor/TopBar.svelte ✓ pass (botón volver con aria-label; nombre con label, Enter guarda y Escape deshace; estado en role="status")
src/islands/editor/Toolbar.svelte ✓ pass (botones de icono con nombre y atajo en la etiqueta)
src/islands/editor/PropertiesPanel.svelte ✓ pass (cada control con label; sin selección, texto que dice qué hacer)
src/islands/Editor.svelte ✓ pass (el lienzo es role="application" con nombre y recibe el foco para los atajos)
```

Desviación aceptada: el lienzo no tiene alternativa por teclado para dibujar formas a mano alzada; mover, borrar, ordenar y duplicar sí van por teclado, y el árbol de capas accesible llega con los paneles (§12.7).

## accessibility

- El lienzo WebGL queda fuera de axe. `a11y.spec.ts` pasa axe por el editor vacío y con selección, y por cada panel: IA (petición, vista previa y chat), chat del proyecto, versiones, timeline y «Animar con IA», Compartir y Exportar.
- Avisos y estado de conexión en regiones vivas; foco visible en barras y paneles; `prefers-reduced-motion` y el ajuste de la cuenta quitan las transiciones de la interfaz sin cambiar el contenido del lienzo.

La validación completa necesita pruebas manuales con lector de pantalla y revisión experta.

## Repaso de la Fase 10

Pasada de `antislop-ui` (App & Dashboard), `web-design-guidelines`, `frontend-design` y `accessibility` por todos los paneles, con capturas a 1440 px. Correcciones:

```text
src/islands/Editor.svelte:616 - el lienzo tenía outline-none sin sustituto → outline coral interior con focus-visible (una box-shadow quedaría bajo el canvas opaco)
src/islands/editor/PropertiesPanel.svelte:524 - los ocho botones de «Orden» se salían del panel → flex-wrap
src/islands/editor/timeline/TimelinePanel.svelte:682 - «1,00 s» de la regla se partía en dos líneas → whitespace-nowrap
src/islands/editor/chat/ChatComposer.svelte:176 - «Quitar adjunto» medía 20 px → 24 px (objetivo táctil mínimo)
src/islands/editor/ExportDialog.svelte - radios y casilla de 16 px sin margen → la etiqueta entera es el objetivo, con min-h-6
messages/es.json - «1 cambios propuestos» y otros recuentos de IA, timeline y versiones → plurales
```

Objetivos táctiles: el resto de botones de icono miden 24 px (capas, timeline) o 32 px (barra y herramientas); las casillas de 16 px van dentro de su `label`, que es el objetivo. `prefers-reduced-motion` y «Reducir el movimiento» anulan transiciones y animaciones de toda la interfaz (`app.css`); el lienzo no cambia. Coherencia con DESIGN.md: superficies por paso de tono, una acción coral por pantalla («Compartir» en la barra), sombra solo en lo que flota.
Resultado: **PASS** (pendiente de la ejecución de `a11y.spec.ts` en la validación final de la fase).
