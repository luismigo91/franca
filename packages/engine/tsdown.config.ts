import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', conformance: 'src/conformance/index.ts' },
  format: 'esm',
  platform: 'node',
  dts: true,
  clean: true,
});
