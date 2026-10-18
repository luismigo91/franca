import { defineConfig } from 'vitest/config';

// Los tests de propiedades y diferenciales recorren decenas de miles de casos: menos de un segundo en solitario, más
// de 15 s cuando `pnpm check` corre a la vez lint, typecheck y los tests de todos los paquetes (cada Vitest con un
// proceso por núcleo). Con el límite de 5 s por defecto daban falsos rojos.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
