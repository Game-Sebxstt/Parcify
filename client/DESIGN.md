---
name: Parcify
description: "Herramienta de lienzo colaborativo con tema oscuro fijo sobre el azul marino del logo. Superficies separadas por pasos de tono, un único acento coral por pantalla y botones totalmente redondeados en eco de los círculos de la marca."
dial: "ENERGY 2 / RHYTHM 2 / MOTION 1 en la app; la landing se decide con su propio proceso"

colors:
  ground: "#000B1D"
  surface-1: "#0A1628"
  surface-2: "#122136"
  petrol: "#244355"
  edge: "#5D6E84"
  ink: "#EEF2F6"
  ink-muted: "#A7B3C2"
  coral: "#FB8F5A"
  coral-hover: "#FCA478"
  coral-ink: "#000B1D"
  sage: "#AAD696"
  danger: "#F07167"

typography:
  family: "Manrope Variable"
  app-scale: [12, 14, 16, 20, 28]
  lead: 18
  display: "clamp(44px, 8vw, 120px), interletrado -0.03em, interlineado 0.98"

rounded:
  panel: 10px
  full: 9999px

shadow:
  float: "0 16px 48px rgb(0 0 0 / .45), 0 2px 8px rgb(0 0 0 / .35)"
---

## Tema y atmósfera

Parcify es una herramienta de lienzo: lo que importa es el trabajo de quien diseña, no el cromado. El tema es oscuro y fijo porque el fondo azul marino es el del propio logo y porque las imágenes y formas del usuario se leen mejor sobre un fondo oscuro y neutro. No hay conmutador claro/oscuro en v1.

De `figma` se toma la idea de una interfaz que se aparta para dejar sitio al lienzo, botones de un solo relleno y totalmente redondeados, y profundidad casi sin sombras. De `linear.app` se toma la escalera de superficies (fondo, superficie 1, superficie 2) que marca la jerarquía sin líneas, la densidad de app SaaS para el dashboard y los ajustes, y un acento escaso. No se toman sus colores ni su tipografía: los fija la marca.

## Paleta y roles

Valores muestreados del `public/brand/Logo.jpg` (mediana de los píxeles de cada zona) y ajustados para contraste AA. `npm run contrast` lo comprueba.

| Token | Valor | Rol |
|---|---|---|
| `ground` | `#000B1D` | fondo de la app y del lienzo (muestreado del fondo del logo) |
| `surface-1` | `#0A1628` | paneles y barras, un paso de tono sobre el fondo |
| `surface-2` | `#122136` | menús, popovers, campos y botones secundarios |
| `petrol` | `#244355` | selección, hover sobre superficie 2, avisos neutros (muestreado de la media luna petróleo) |
| `edge` | `#5D6E84` | borde de los campos de texto (3:1 sobre las tres superficies) |
| `ink` | `#EEF2F6` | texto principal |
| `ink-muted` | `#A7B3C2` | texto secundario, pistas |
| `coral` | `#FB8F5A` | una sola acción principal por pantalla, selección del lienzo y foco (muestreado del aro naranja) |
| `coral-ink` | `#000B1D` | texto sobre coral |
| `sage` | `#AAD696` | conectado, éxito, presencia (muestreado de la media luna verde) |
| `danger` | `#F07167` | errores y acciones destructivas |

Los 12 colores de colaborador viven en `src/shared/collab-colors.ts` (OKLCH L ≈ 0,72, contraste ≥ 3:1 sobre `ground`).

El coral es cercano al «terracota» que se considera un tic de páginas generadas, pero aquí es el color del logo y va sobre azul marino, no sobre crema. Se mantiene a propósito.

## Tipografía

Una sola familia, Manrope variable, autoalojada con `@fontsource-variable/manrope`. Su construcción geométrica redondeada se parece a la palabra «parcify» del logo. En la app, como máximo cinco tamaños por pantalla: 12, 14, 16, 20 y 28 px. La jerarquía sale del peso (400 a 800) antes que del tamaño. Cifras tabulares (`tabular`) en contadores, tablas y métricas. Sin mayúsculas espaciadas y sin monoespaciada decorativa.

## Componentes

Los componentes base viven en `src/ui/` y se montan sobre bits-ui:

- `Button`: `primary` (coral, uno por pantalla), `secondary` (superficie 2), `ghost` y `danger`. Siempre totalmente redondeado. Los de solo icono exigen `label`, que es su nombre accesible. Por defecto `type="button"`.
- `Dialog`: modal sobre `surface-1`, radio 10 px, sombra `float`. Atrapa el foco y lo devuelve al disparador.
- `Menu`, `Tooltip`, `Tabs`: patrones de bits-ui. Menús y tooltips en `surface-2` con sombra `float`; las pestañas marcan la activa con un paso de tono, no con color.
- `Input` y `Field`: campo en `surface-2` con borde `edge`, radio 10 px, 44 px de alto. El error va debajo, en `danger`, enlazado con `aria-describedby` y en una región `aria-live="polite"`.
- `Toast`: abajo a la derecha, región `aria-live`. Con acción no caduca solo.
- `Avatar`: imagen o iniciales sobre `petrol`, o sobre el color de colaborador.
- `Skeleton`: bloques en `surface-2`, sin animación.

El overlay de acceso (`src/islands/AuthOverlay.svelte`) es un `<dialog>` nativo con los mismos tokens.

## Layout

Rejilla de 4 px. Contenido de la app con ancho máximo de 1280 px. Las superficies se separan por pasos de tono y no por líneas de 1 px; la única línea es el borde de los campos, porque un campo tiene que verse como campo. Objetivos táctiles de 24 px como mínimo; los botones miden 32 o 40 px.

## Profundidad

Sin sombras en reposo. Solo flota lo que flota de verdad: menús, diálogos, toasts y el overlay de acceso, con la sombra `float`. Sin vidrio ni desenfoque de fondo, sin brillos.

## Qué hacer y qué no

Hacer:

- Una única acción coral por pantalla.
- Foco visible siempre: anillo coral de 2 px con 2 px de separación.
- Estados vacío, de carga y de error que digan la causa y el siguiente paso.
- Textos de la interfaz en `messages/es.json`, nunca escritos en el componente.

No hacer:

- Degradados (el del logo solo existe dentro del logo).
- Etiquetas pequeñas en mayúsculas espaciadas, «eyebrows» sobre los títulos o numeración decorativa 01/02/03.
- Tarjetas con icono en fila, emojis, palabras de un titular resaltadas con otro color.
- Más de un tipo de esquina en botones, o botones pill fuera de los botones.
- Separar superficies con líneas de 1 px.

## Responsive

Los paneles del editor se pliegan por debajo de 1024 px; el dashboard pasa a una columna por debajo de 640 px. Los diálogos ocupan el ancho disponible menos 12 px por lado en móvil. `prefers-reduced-motion` desactiva las transiciones de la UI; el contenido del lienzo no cambia.
