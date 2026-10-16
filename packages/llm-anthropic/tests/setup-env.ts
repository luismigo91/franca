import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, vi } from 'vitest';

/**
 * Aísla cada test del entorno de la máquina y de la CI: el SDK lee de él las credenciales, la URL base,
 * las cabeceras, el nivel de registro, las trazas y los perfiles y ficheros de configuración
 * (`HOME` y `XDG_CONFIG_HOME` en un directorio temporal vacío). Así ni la máquina del desarrollador ni la
 * CI cambian el resultado de un test, ni pueden hacer una llamada real.
 */
const home = mkdtempSync(join(tmpdir(), 'franca-llm-anthropic-env-'));

const EMPTY = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_LOG',
  'ANTHROPIC_OPEN_TELEMETRY',
  'ANTHROPIC_OPEN_TELEMETRY_PROPAGATION',
  'ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE',
  'ANTHROPIC_OPEN_TELEMETRY_TRACES_MAX_CONTENT_BYTES',
];

// En un `beforeEach` y no al cargar: un test que llama a `vi.unstubAllEnvs()` no deja al siguiente sin aislar.
beforeEach(() => {
  for (const name of EMPTY) vi.stubEnv(name, '');
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', home);
});
