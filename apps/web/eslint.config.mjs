import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Restricciones de la frontera local de la web (D4, D13, D17). Cada una se valida a mano una vez: se escribe la línea
// prohibida, `pnpm lint` falla y se quita (tasks 1.3).

const NETWORK_MODULES = ["node:http", "node:https", "node:net", "http", "https", "net", "undici"];
const NETWORK_MESSAGE =
  "Solo src/server/api/transport.ts habla con la API (D4): un cliente HTTP propio saltaría la frontera.";

const networkImports = NETWORK_MODULES.map((name) => ({ name, message: NETWORK_MESSAGE }));
const nextImage = {
  name: "next/image",
  message:
    "next/image con URLs remotas haría que el servidor de la web pidiera la URL (SSRF desde la frontera): usa <img> (D13).",
};

const STORAGE_GLOBALS = ["localStorage", "sessionStorage", "indexedDB", "caches"].map((name) => ({
  name,
  message: "La web no guarda nada de una conversación en el navegador (D17).",
}));
const fetchGlobal = {
  name: "fetch",
  message:
    "Solo src/lib/web-client.ts usa fetch en el navegador; el servidor de la web habla con la API por transport.ts (D4, D9).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Resultados de Playwright.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.{mjs,cjs}"],
    rules: {
      "no-restricted-imports": ["error", { paths: networkImports }],
      "no-restricted-globals": ["error", fetchGlobal, ...STORAGE_GLOBALS],
      "no-restricted-properties": [
        "error",
        { object: "document", property: "cookie", message: "La web no pone ni lee cookies (D17)." },
        { object: "globalThis", property: "fetch", message: fetchGlobal.message },
        { object: "window", property: "fetch", message: fetchGlobal.message },
        { object: "self", property: "fetch", message: fetchGlobal.message },
        ...["localStorage", "sessionStorage", "indexedDB", "caches"].flatMap((property) =>
          ["globalThis", "window", "self"].map((object) => ({ object, property, message: "Nada de una conversación en el navegador (D17)." })),
        ),
      ],
      "no-console": "error",
    },
  },
  {
    // El plugin de React solo existe para estos ficheros.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "react/no-danger": "error" },
  },
  {
    files: ["src/components/chat/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...networkImports, nextImage] }],
    },
  },
  {
    // El único cliente HTTP del servidor de la web.
    files: ["src/server/api/transport.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // El preload solo envuelve los servidores del propio proceso y neutraliza el inspector: no envía nada (D26).
    files: ["scripts/local-only-preload.cjs"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // El único `fetch` del navegador.
    files: ["src/lib/web-client.ts"],
    rules: {
      "no-restricted-globals": ["error", ...STORAGE_GLOBALS],
      "no-restricted-properties": [
        "error",
        { object: "document", property: "cookie", message: "La web no pone ni lee cookies (D17)." },
      ],
    },
  },
  {
    // El único sitio con `console`: el registro mínimo del servidor (D17).
    files: ["src/server/log.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Los .cjs son CommonJS a propósito (se cargan con --require).
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Los tests escriben y leen lo que prohíben las reglas (servidores de prueba, almacenamiento para comprobar que está vacío).
    files: ["**/*.test.{ts,tsx}", "tests/**", "e2e/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "no-console": "off",
    },
  },
]);

export default eslintConfig;
