---
name: decision-filtro-de-urls-sobre-lo-parseado
description: Por qué el chat decide sobre la URL parseada y pinta su href, sin next/image (SSRF), sin Referer y con el iframe sin allow-same-origin
metadata:
  type: project
  enforcement: apps/web/src/lib/chat/url-filter.test.ts, apps/web/src/components/chat/media-item.test.tsx, apps/web/eslint.config.mjs
---

# Se decide sobre lo parseado y se pinta lo decidido

`admitUrl` (`apps/web/src/lib/chat/url-filter.ts`) admite una URL absoluta WHATWG sin usuario ni contraseña, con `https:` o, salvo en `embed`, `http:`, y **devuelve su `href`**: es lo único que se pinta. `new URL` quita tabuladores y saltos de línea en silencio ([[gotcha-url-whatwg-normaliza]]), así que `java\nscript:` se vuelve `javascript:` y se rechaza por su protocolo; pintar el texto original dejaría pasar lo que el navegador también limpia.

- **Sin `next/image`**: con URLs remotas, el servidor de la web pediría la URL (`/_next/image` con `remotePatterns`), un SSRF desde la frontera ([[decision-frontera-local-de-la-web]]). ESLint lo prohíbe en `src/components/chat/`.
- **Sin `Referer`**: `<video>` y `<audio>` no tienen `referrerpolicy`; solo `<img>` e `<iframe>`. Por eso la política del documento (cabecera y `<meta>`) más el atributo donde existe.
- **`iframe` con `sandbox="allow-scripts"` solo**: sin `allow-same-origin` queda en un origen opaco y no puede navegar ni leer el chat.
- Los textos son siempre texto plano, sin autoenlazado: el formato no tiene enlaces, y autoenlazar abriría una vía de enlaces peligrosos que el flujo no pidió.
