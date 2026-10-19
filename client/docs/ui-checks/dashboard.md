# Inicio (`/app`) y espacio (`/app/e/:slug`)

Archivos: `src/islands/{AppShell,Dashboard,Workspace}.svelte`, `src/islands/dashboard/*`, `src/layouts/AppLayout.astro`, `src/ui/Menu.svelte`.

Lectura: app de trabajo para equipos con densidad de `linear.app` (DESIGN.md), dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Trabajo de cada pantalla y su decisión principal:

- Inicio: volver a lo que estabas haciendo. Lo primero son los recientes (los 8 últimos editados de tus espacios), después favoritos, compartidos conmigo y la lista de espacios. Sin tarjetas de estadísticas ni feed de actividad.
- Espacio: encontrar un proyecto y actuar sobre él. Búsqueda, filtro (todos, míos, compartidos conmigo, favoritos, papelera) y orden arriba; la rejilla es la página. Selección múltiple con casillas (Shift+clic selecciona el tramo) y barra de acciones flotante (duplicar, mover a la papelera, restaurar en la papelera). Pestañas de proyectos, miembros y ajustes (ajustes solo para owner y admin); `?vista=` en la URL. Búsqueda, filtro y orden también en la URL (`?q=`, `?filtro=`, `?orden=`).
- Barra lateral: inicio, ajustes de la cuenta, espacios con «Nuevo espacio» y, para su owner, los espacios en la papelera con la fecha de borrado y «Restaurar». En móvil es un cajón con Escape y fondo que lo cierra.
- Tarjeta: vista previa (asset `preview` resuelto por lotes; hasta la Fase 7, el marcador «Sin vista previa»), nombre como enlace, «Editado hace 12 min por Ana» con `lastEditedBy` (nuevo en el servidor: lo escribe `collab` al guardar), estrella de favorito con `aria-pressed` y menú de acciones según el rol.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: hay barra lateral porque los espacios son la navegación; no hay fila de estadísticas, gráfico ni tabla genérica. |
| Stat Cards With Invented Numbers | PASS: los únicos números son los contadores reales del espacio (`counts` de la API). |
| Filler Activity Feed | PASS: no hay feed (la actividad llega en su fase). |
| Charts Without a Question | PASS: sin gráficos. |
| Generic Table Columns | PASS: miembros muestra nombre, email, desde cuándo y rol, que es lo que decide expulsar o cambiar el rol. |
| Filler Data | PASS: sin datos de relleno; el nombre por defecto de un proyecto es «Proyecto sin título», editable antes de crear. |
| Placeholder Empty and Loading States | PASS: cada vacío dice la causa y el siguiente paso, distinto para espacio vacío, búsqueda sin resultados, filtro vacío, favoritos y papelera; la carga se anuncia con `role="status"` y el error ofrece «Reintentar». |

UI Skill Checklist: paleta del DESIGN.md; el coral solo en «Nuevo proyecto» (en `/app/e/:slug`, solo en la pestaña de proyectos); sin emojis; sin cápsulas ni bento; cada control funciona; sin bucles; radio 10 px en paneles y redondo en botones; sombra solo en la barra de selección y los menús, que flotan; los puntos de color son estados; todo número es real; vacíos con causa y acción; teclado completo. **PASS**.

## web-design-guidelines

Revisión con las reglas de `vercel-labs/web-interface-guidelines` (versión del 16/10/2026):

```text
src/islands/AppShell.svelte ✓ pass (botones de icono con aria-label, cajón con overscroll-contain y Escape)
src/islands/Dashboard.svelte ✓ pass
src/islands/Workspace.svelte ✓ pass (pestañas en ?vista=)
src/islands/dashboard/ProjectBrowser.svelte ✓ pass (filtros en la URL, lista paginada de 24, confirmación y «Deshacer» al borrar)
src/islands/dashboard/ProjectFilters.svelte ✓ pass (label en búsqueda y orden, placeholder con «…», autocomplete="off")
src/islands/dashboard/ProjectCard.svelte ✓ pass (img con alt="" y loading="lazy" dentro de un contenedor de proporción fija; truncate con min-w-0)
src/islands/dashboard/MembersPanel.svelte ✓ pass (select con label, confirmación al expulsar y al salir)
src/ui/Menu.svelte ✓ pass (patrón menú WAI-ARIA: flechas, Inicio, Fin, Escape devuelve el foco)
```

Desviaciones aceptadas: títulos y botones en mayúscula inicial y no en Title Case (es la norma en español); la vista previa no lleva `width`/`height` porque su caja tiene `aspect-ratio` y no hay salto de maquetación.

## accessibility

- axe (WCAG 2.2 AA) sin violaciones en `/app`, en la pestaña de proyectos y en la de miembros (`e2e/a11y.spec.ts`, Chromium y Firefox).
- Foco visible coral en todo; enlace «Saltar al contenido»; `aria-current="page"` en la navegación; la barra de selección es un `toolbar` con la cuenta en `aria-live`.
- Las casillas de selección tienen nombre («Seleccionar Cartel») y aparecen también con el foco, no solo al pasar el ratón.
- Toda la pantalla funciona sin ratón: `e2e/dashboard.spec.ts` usa roles y nombres accesibles.

La validación completa necesita pruebas manuales con lector de pantalla y revisión experta; axe solo cubre lo detectable automáticamente.

Resultado: **PASS**.
