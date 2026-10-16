# Franca

Flujos conversacionales declarativos: mensajes, preguntas, condiciones, llamadas HTTP y pasos con LLM acotados, descritos en JSON y validados contra una spec pública.

## Estructura

Monorepo con pnpm workspaces y Turborepo.

```
franca/
├── apps/
│   ├── api/           # @franca/api: backend NestJS (puerto 3001)
│   └── web/           # @franca/web: frontend Next.js, App Router + Tailwind (puerto 3000)
├── packages/
│   └── spec/          # @franca/spec: esquema JSON de flujos, tipos TS, validador y ejemplos
├── docs/
│   └── rfcs/          # decisiones de diseño (RFC-0001: flujos v0)
└── .github/workflows/ # CI
```

Las aplicaciones van en `apps/` y el código compartido en `packages/`, publicado como `@franca/<nombre>`.

## Desarrollo

Requisitos: Node 22+ y pnpm.

```
pnpm install
pnpm dev        # api en :3001 y web en :3000
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm validate   # valida los flujos de ejemplo contra la spec
```

Una sola app: `pnpm --filter @franca/api dev`.

## API

- `POST /flows/validate`: valida un flujo contra la spec y responde `{ valid, issues }` (siempre 200).

## Estado

Borrador v0 (`specVersion: "0.1"`). La spec puede cambiar sin compatibilidad hacia atrás hasta la 1.0.

## Licencia

[MIT](LICENSE)
