# Compartir e invitaciones (panel «Compartir», miembros del espacio y `/invitacion`)

Archivos: `src/islands/share/*`, `src/islands/InviteAccept.svelte`, `src/pages/invitacion.astro`, `src/lib/invite-link.ts`.

Lectura: pantallas de gestión con la densidad de `linear.app` (DESIGN.md), dial ENERGY 1 / RHYTHM 1 / MOTION 1. El panel «Compartir» es un diálogo sobre el editor; `/invitacion` es una sola columna con la pregunta que hay que responder (aceptar o no) y nada más.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: el panel se ordena por lo que se decide en él: invitar, quién tiene acceso, enlaces activos. `/invitacion` muestra solo la invitación y sus dos acciones. |
| Filler Data in Fields | PASS: el email lleva el marcador `nombre@ejemplo.com`; las listas muestran personas y enlaces reales. |
| Placeholder Empty and Loading States | PASS: «Comprobando la invitación…», «No hay enlaces activos.», y cada error de §10.6 con su siguiente paso. Desde la Fase 10, un fallo de red o del servidor en `/invitacion` ofrece «Reintentar», y la lista de invitaciones pendientes del espacio muestra el error con «Reintentar» en lugar de quedarse vacía. |
| Non-Functional Controls | PASS: «Copiar», «Revocar», «Anular», «Quitar», el cambio de rol y «Entrar con otra cuenta» hacen lo que dicen. |
| Decorative Status Dot | PASS: no hay puntos de estado. |

UI Skill Checklist: paleta del DESIGN.md; una sola acción coral por pantalla («Invitar» en el panel, «Enviar invitación» en miembros, «Aceptar» o «Reintentar» en `/invitacion`); sin emojis; sombra solo en el diálogo. **PASS**.

## web-design-guidelines

```text
src/islands/share/SharePanel.svelte ✓ pass (diálogo con título, Escape cierra y devuelve el foco a «Compartir»)
src/islands/share/ShareInvite.svelte ✓ pass (email y rol con label; error en aria-live)
src/islands/share/ShareLinks.svelte ✓ pass (rol, caducidad y usos con label; la URL solo se muestra una vez con «Copiar»)
src/islands/share/WorkspaceInvite.svelte ✓ pass (error de carga en role="alert" con «Reintentar»)
src/islands/InviteAccept.svelte ✓ pass (h1 único; estado de carga en role="status"; errores en role="alert")
src/ui/Input.svelte ✓ corregido: `class` con alto o tamaño propio ya no se suma a h-11/text-base (los campos de 36 px del panel salían a 44 px)
```

## accessibility

- Objetivos táctiles: los botones del panel miden 32 o 36 px; los `select` 36 px.
- `prefers-reduced-motion` y el ajuste «Reducir el movimiento» quitan las transiciones del diálogo (regla global de `app.css`).
- `e2e/a11y.spec.ts` pasa axe por el panel «Compartir» (con y sin la URL del enlace recién creado) y por `/invitacion` sin invitación, con un enlace válido y con un error.

La validación completa de WCAG necesita pruebas manuales con tecnologías de asistencia y una revisión experta (ver `lector-de-pantalla.md`).

Resultado: **PASS** (pendiente de la ejecución de `a11y.spec.ts` en la validación final de la fase).
