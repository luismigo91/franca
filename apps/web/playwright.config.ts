import { defineConfig, devices } from '@playwright/test';

// E2E (D20): Chromium contra la API real, Postgres y `next start` de la web, todo en loopback y sin llamar a Internet.
// Una sola pila en serie (un worker): la web ocupa el 3000 y los tests comparten base, que se vacía entre tests.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  // Lo inestable se ve: ningún reintento.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { actionTimeout: 10_000, trace: 'retain-on-failure', baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
