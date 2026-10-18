# Franca — chat web de prueba y editor de flujos

Chat de prueba de Franca (`apps/web`, Next.js 16): una persona abre la web en su máquina, elige un flujo publicado en
la API, conversa con él como lo haría un usuario final y puede reabrir, repetir y borrar sus conversaciones.

Además tiene un **editor visual de flujos** (`/flujos`): una persona crea un flujo (vacío o pegando su JSON), lo edita
sobre un lienzo con formularios por tipo de nodo, ve los problemas de validación mientras edita, guarda, publica y lo
prueba en el chat sin `curl` ni JSON a mano.

La web es una herramienta **local**: el navegador nunca habla con la API. Lo hace el servidor de la web, que es la
frontera local (solo catorce operaciones fijas: ocho del chat y seis del editor, `Host` local en toda petición y
`Origin` propio en las que cambian algo). Mientras la API no tenga autenticación, no se expone fuera de la máquina.

## Arrancar

Necesita la API en marcha (`pnpm --filter @franca/api dev`, con Postgres: `docker compose up -d`).

```bash
pnpm dev                      # desde la raíz: la API y la web
pnpm --filter @franca/web dev # solo la web
```

Después, `http://localhost:3000` (chat de prueba) y `http://localhost:3000/flujos` (editor). La web escucha **solo** en
`127.0.0.1:3000`.

## El editor de flujos

- **`/flujos`** lista todos los flujos vivos (publicados o no) y ofrece «Nuevo flujo». **`/flujos/<id>`** es el editor de
  uno: lienzo (se desplaza y se amplía; los nodos se mueven con el ratón o con las flechas y las conexiones se crean o
  sustituyen arrastrando una salida hasta otro nodo), inspector por tipo, panel del flujo, lista de problemas y las
  acciones Guardar, Publicar, Probar, Descartar cambios, Ver JSON, Añadir nodo y Borrar flujo.
- Con el teclado, cada salida se elige en el selector de salto del inspector (las salidas del lienzo no reciben el foco).
- La validación corre en el navegador (`@franca/spec`, sin llamar a la API) y solo se guarda un flujo válido. Los cambios
  sin guardar viven en la pestaña: salir por un enlace, recargar o cerrar pide confirmación.
- Las posiciones de los nodos se guardan en `nodes[].position` (el esquema ya lo admite; el motor lo ignora).
- Para probar un ejemplo: «Nuevo flujo», «Desde JSON» y pegar `packages/spec/examples/captacion-leads.json`.
- «Probar» abre una conversación del chat con la **última versión publicada**.
- Límite conocido: «atrás» del navegador con cambios sin guardar no pregunta y los pierde.

`dev` y `start` pasan por `scripts/local-only.mjs`, que valida `FRANCA_API_URL` antes de ejecutar `next` y carga
`scripts/local-only-preload.cjs`. No arranques `next` a mano: se saltaría la guarda local.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `FRANCA_API_URL` | `http://127.0.0.1:3001` | Dirección de la API. Solo `http://` hacia `127.0.0.1`, `[::1]` o `localhost`, con puerto opcional y sin ruta, consulta, usuario ni contraseña. Con otro valor, también vacío, la web no arranca. |

## Probar

```bash
pnpm --filter @franca/web test   # Vitest: unit (también el núcleo del editor), marcado, integración con una API simulada y guardas estáticas
pnpm --filter @franca/web mutate # mutación dirigida (a mano): 81 mutantes, todos tienen que morir
pnpm test:e2e                    # desde la raíz: la API y la web, en serie (necesita Postgres y DATABASE_URL)
```

Los E2E usan Chromium con Playwright, la API real, Postgres y el puerto 3000 libre (para `pnpm dev` antes):

```bash
docker compose up -d
pnpm --filter @franca/web exec playwright install chromium
DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca pnpm test:e2e
```

Nada de lo anterior llama a Internet ni a Anthropic.

## Advertencia: el inspector de Node está desactivado

La guarda local (`scripts/local-only-preload.cjs`) neutraliza `inspector.open` en todo el árbol de procesos de Next,
porque un recurso de desarrollo de `next dev` lo abría y, con DNS rebinding, dejaba ejecutar código en el proceso.
Consecuencias:

- El botón de adjuntar el depurador de Node de las herramientas de desarrollo de Next responde 500.
- **`next start --inspect` deja de funcionar** (Next sale con 1: «Failed to start the Node.js inspector»).
- **No uses `NODE_OPTIONS=--inspect`**: abre el inspector al arrancar sin pasar por `open`, y deja su puerto en
  `127.0.0.1:9229` abierto a **cualquier proceso local** durante toda la sesión.

Esto es una advertencia, no una receta: no hay una forma recomendada de depurar el servidor de la web con el inspector.
