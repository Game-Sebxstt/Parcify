# Plantillas (`/app/e/:slug?vista=plantillas`, diálogo de nuevo proyecto y «Publicar como plantilla»)

Archivos: `src/islands/templates/{TemplateGallery,TemplateCard,TemplatePreview,TemplateReactions,TemplateThumb,NewProjectDialog,PublishTemplateDialog}.svelte`, `src/islands/templates/byline.ts`, `src/lib/templates.ts`, la pestaña de `src/islands/Workspace.svelte` y el botón de `src/islands/editor/TopBar.svelte`.

Lectura: app de trabajo con la densidad de `linear.app` (DESIGN.md), dial ENERGY 2 / RHYTHM 2 / MOTION 1.

Para qué sirve la pantalla: elegir una plantilla del espacio y empezar un proyecto desde ella. La rejilla repite la del proyecto (vista previa real, nombre y «Publicada por Ana hace 3 días») y deja a mano lo que ayuda a decidir: «Me gusta» con el contador del servidor, la estrella de favorita y «Usar plantilla». Al pulsar el nombre se abre la vista previa grande con la descripción.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: es una pestaña más del espacio, con búsqueda, el filtro Todas/Favoritas y la rejilla. No añade barra lateral ni widgets. |
| Stat Cards With Invented Numbers | PASS: el único número es `likesCount`, que viene de la API y se sustituye por el que devuelve cada PUT/DELETE del like. |
| Filler Data | PASS: no hay plantillas sembradas ni de ejemplo. El espacio vacío lo dice y explica cómo se publica una. |
| Placeholder Empty and Loading States | PASS: son cuatro estados distintos. Sin plantillas: la causa y el botón «Ir a los proyectos». Búsqueda sin resultados: «Borrar los filtros». Sin favoritas: explica la estrella. Error: `role="alert"` con «Reintentar». La carga usa `role="status"` y un esqueleto con `aria-hidden`. |
| Copy-Paste Feature Cards | PASS: las tarjetas son contenido del usuario (vista previa y nombre), no tarjetas de icono. |
| Acento | PASS: en la pestaña no hay coral; «Usar plantilla» en la tarjeta es secundario. El coral solo aparece en el botón principal de cada diálogo: «Usar plantilla» en la vista previa, «Proyecto en blanco» y «Publicar». |

UI Skill Checklist: paleta del DESIGN.md, sin degradados, emojis ni cápsulas, radio de 10 px en paneles, sin sombras en reposo (solo los diálogos llevan `float`) y sin animaciones propias. Todos los controles funcionan. «Proyecto en blanco» es el botón de envío del diálogo y queda separado de la lista de plantillas, así que no se presenta como una plantilla falsa. **PASS**.

## accessibility

- «Me gusta» y la estrella son botones con `aria-pressed`. El nombre accesible del «Me gusta» incluye la plantilla y el contador («Me gusta en Cartel base (1)»).
- Los botones de la lista del diálogo de nuevo proyecto se llaman «Usar la plantilla {nombre}». Mientras se crea el proyecto llevan `aria-busy`.
- La imagen de la tarjeta repite la acción del nombre y está fuera del orden de tabulación (`tabindex="-1"`, `aria-hidden`), igual que en las tarjetas de proyecto. En la vista previa grande la imagen tiene `alt`.
- La búsqueda tiene `label` (solo visible para lectores de pantalla) y el filtro es un `fieldset` con `legend`.

Queda pendiente para la validación final de la fase: `e2e/templates.spec.ts` en Chromium y Firefox y una pasada de axe sobre la pestaña con una plantilla publicada. Para una validación completa hacen falta pruebas manuales con lector de pantalla.
