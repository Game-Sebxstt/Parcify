# Ajustes de la cuenta (`/app/ajustes`)

Archivos: `src/islands/Settings.svelte`, `src/islands/settings/*`, `src/pages/app/ajustes.astro`, `src/lib/{auth,auth-lazy,motion,local-copies}.ts`.

Lectura: pantalla de cuenta con densidad de `linear.app`, dial ENERGY 1 / RHYTHM 1 / MOTION 1. Una columna de secciones en `surface-1`, en el orden en que se usan: perfil, email, contraseña, cuentas vinculadas, sesiones, historial de seguridad, preferencias y borrar la cuenta.

Decisiones:

- Avatar: subida con `purpose: 'avatar'` (`POST /v1/assets/uploads`, PUT al storage y `complete`) y `PATCH /v1/me`; viaja en la presencia del editor (`avatarAssetId`) y se ve en la barra superior de los demás.
- Email: código al email nuevo con `/email-otp/request-email-change` y confirmación con `/email-otp/change-email`; la dirección actual recibe el aviso (ver el README del servidor sobre `changeEmail` en 1.7.10).
- Contraseña: con contraseña, `change-password` con la actual y «Cerrar sesión en los demás dispositivos» marcado; solo Google, «Crear contraseña» con `POST /v1/me/password` (`setPassword`, solo de servidor).
- Sesiones: `list-sessions`, la actual primero y marcada; «Cerrar sesión en los demás dispositivos» (`revokeOtherSessions`) y cierre de una en concreto. El texto explica cuándo deja de escribir y de leer la otra sesión.
- Historial: `GET /v1/me/security-events`, paginado, con navegador, sistema e IP.
- Preferencias: idioma (solo español por ahora, inglés deshabilitado con «próximamente»), copia local (al desactivarla se borran las copias de este navegador) y reducir el movimiento (se suma a `prefers-reduced-motion`).
- Borrar la cuenta: confirmación; si la sesión no es fresca, pide la contraseña o volver a entrar con Google; con 409 `MUST_TRANSFER_OWNERSHIP` enseña los espacios afectados con enlace a sus miembros.

## antislop-ui, App & Dashboard

| Patrón | Resultado |
|---|---|
| Default Dashboard Shell | PASS: sin estadísticas ni gráficos; secciones según la tarea. |
| Stat Cards / Feed / Charts | PASS: no hay. El historial de seguridad es real (eventos del servidor), no un feed de relleno. |
| Generic Table Columns | PASS: sesiones muestran dispositivo, IP y última actividad, que es lo que hace falta para decidir cerrarla. |
| Filler Data | PASS: los campos traen tus datos reales o están vacíos. |
| Empty and Loading States | PASS: carga con `role="status"`, error con «Reintentar», historial vacío con texto. |

UI Skill Checklist: paleta del DESIGN.md; sin acción coral (no hay una acción principal: cada sección guarda lo suyo), salvo el foco; el rojo solo en «Borrar mi cuenta»; sin emojis; cada control hace lo que dice; sin bucles; los puntos de color son estados. **PASS**.

## web-design-guidelines

```text
src/islands/settings/ProfileSection.svelte ✓ pass (input file oculto con botón con nombre, textarea con label y límite)
src/islands/settings/EmailSection.svelte ✓ pass (type="email", autocomplete, spellcheck="false"; código con inputmode="numeric" y one-time-code)
src/islands/settings/PasswordSection.svelte ✓ pass (autocomplete current-password y new-password; errores junto al campo)
src/islands/settings/SessionsSection.svelte ✓ pass
src/islands/settings/SecurityLog.svelte ✓ pass (fechas con Intl.DateTimeFormat)
src/islands/settings/PreferencesSection.svelte ✓ pass (select con label y pista enlazada; checkbox y texto en un solo objetivo)
src/islands/settings/DeleteAccountSection.svelte ✓ pass (confirmación modal)
```

Desviaciones aceptadas: cerrar las demás sesiones y desvincular Google no piden confirmación porque se deshacen entrando otra vez o vinculando de nuevo.

## accessibility

- axe (WCAG 2.2 AA) sin violaciones en `/app/ajustes` con sesiones e historial cargados (`e2e/a11y.spec.ts`, Chromium y Firefox).
- Cada sección es una región con su `h2`; los errores van en `aria-live="polite"` y enlazados con `aria-describedby`.
- `e2e/settings.spec.ts` recorre la pantalla solo por roles y nombres.

La validación completa necesita pruebas manuales con lector de pantalla y revisión experta.

Resultado: **PASS**.
