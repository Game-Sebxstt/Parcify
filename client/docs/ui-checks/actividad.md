# Actividad (`/app/e/:slug?vista=actividad`)

Archivos: `src/islands/activity/{ActivityView,ActivityReport,EditsChart,MinutesChart,EventHistory}.svelte`, `src/islands/activity/{chart,people}.ts`, la pestaña de `src/islands/Workspace.svelte`.

Lectura: app de trabajo para equipos con densidad de `linear.app` (DESIGN.md), dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Trabajo de la pantalla y su decisión principal: saber quién trabajó en el espacio o en un proyecto y cuánto, con números que calcula el servidor. Arriba, «Qué ver» (todo el espacio o un proyecto, `&proyecto=` en la URL) y «Periodo» (7, 30 o 90 días UTC). Debajo, el resumen de los 8 contadores, ediciones por día y colaborador, minutos con actividad por día, la tabla por colaborador, la tabla por proyecto (solo en el espacio), el recuento actual por tipo, «Qué se mide» y, en un proyecto, el historial de eventos.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: no hay barra lateral nueva ni rejilla de widgets; es una pestaña más del espacio, con dos filtros y un informe en una columna. |
| Stat Cards With Invented Numbers | PASS: el resumen son los 8 contadores reales (`totals` de la API), sin variaciones ni flechas inventadas. Sin actividad en el periodo sale «No hubo actividad en este periodo.» y no tarjetas a cero. |
| Filler Activity Feed | PASS: el historial solo aparece en un proyecto y lista eventos reales (`ActivityEvent`), paginado de 20 en 20; los tipos desconocidos tienen un texto genérico. |
| Charts Without a Question | PASS: las barras responden «quién editó y qué día» y la línea «cuánto se trabajó cada día». No hay gráfico de tarta ni de los contadores que ya están en el resumen. |
| Generic Table Columns | PASS: las tablas por colaborador y por proyecto usan los mismos 8 contadores que define «Qué se mide»; el nombre del proyecto abre su actividad. |
| Filler Data | PASS: sin datos de ejemplo; un periodo vacío lo dice, y cada gráfico vacío tiene su texto propio. |
| Placeholder Empty and Loading States | PASS: la carga se anuncia con `role="status"` y un esqueleto con `aria-hidden`; el error sale con `role="alert"` y «Reintentar»; el historial vacío dice que aún no hay eventos. |

UI Skill Checklist: paleta del DESIGN.md; sin coral fuera del foco (ninguna acción principal en esta pestaña); colores de colaborador de `COLLAB_COLORS`, siempre con leyenda en texto; sin emojis, cápsulas ni bento; cada control funciona; sin animaciones propias (solo el esqueleto de carga común); radio 10 px en paneles; sin sombras; números tabulares; vacíos con causa; teclado completo (selects nativos, `details`/`summary`, botones). **PASS**.

## web-design-guidelines

Revisión con las mismas reglas que `dashboard.md`:

```text
src/islands/activity/ActivityView.svelte ✓ pass (select con label visible, estado en la URL con replaceState, carga con role="status")
src/islands/activity/ActivityReport.svelte ✓ pass (dl para el resumen, tablas con caption y scope, tabular-nums)
src/islands/activity/EditsChart.svelte ✓ pass (svg role="img" con title y desc, leyenda en texto, tabla equivalente en details)
src/islands/activity/MinutesChart.svelte ✓ pass (igual que EditsChart)
src/islands/activity/EventHistory.svelte ✓ pass (time con datetime, «Cargar más» con estado de carga)
```

Desviaciones aceptadas (LOW de la revisión 6B, sin cambiar en esta fase):

- La línea de minutos suma los minutos de todas las personas y no lo dice en el título.
- Al cambiar de proyecto en «Qué ver», el informe se desmonta y el foco cae en `body`.
- Un fallo de «Cargar más» en el historial no muestra aviso.

## accessibility

- axe (WCAG 2.2 AA) sin violaciones en la pestaña de un proyecto con los dos gráficos y sus tablas desplegadas, en Chromium y Firefox (`e2e/activity.spec.ts`).
- Cada gráfico tiene nombre accesible (`<title>`) y descripción con el total y el día con más (`<desc>`); la tabla equivalente está en «Ver los datos en una tabla», con `caption` que avisa de que solo aparecen los días con datos.
- Las barras apiladas no dependen solo del color: la leyenda nombra a cada persona y la tabla da los valores por persona y día.
- El e2e recorre la pestaña con roles y nombres accesibles (pestaña, tablas por nombre, botón «Ver la actividad de …», región «Historial»).

La validación completa necesita pruebas manuales con lector de pantalla y revisión experta; axe solo cubre lo detectable automáticamente.

Resultado: **PASS**.
