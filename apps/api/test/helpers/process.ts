import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const LISTENING = /escuchando en (\[[^\]]+\]|[^:\s]+):(\d+)/;

export interface RunningApi {
  child: ChildProcess;
  /** Todo lo que el proceso escribió en `stdout` y `stderr`. */
  output(): string;
  /** Resuelve con el código de salida (o `null` si lo mató una señal). */
  exited: Promise<number | null>;
  /** Dirección y puerto de la línea «escuchando en», si ya salió. */
  listening(): { host: string; port: number } | undefined;
  /** Espera la línea «escuchando en» o el fin del proceso. */
  whenListening(timeoutMs?: number): Promise<{ host: string; port: number } | undefined>;
  stop(): Promise<void>;
}

/**
 * Lanza `node dist/main.js` (el proceso real) con un entorno controlado: no hereda `DATABASE_URL`, `HOST` ni `PORT`.
 *
 * @param env Variables que ve el proceso, además de `PATH`.
 */
export function startApi(env: Record<string, string>): RunningApi {
  if (!existsSync(MAIN)) throw new Error('Falta dist/main.js: ejecuta `pnpm --filter @franca/api build` (turbo lo hace antes de test:e2e).');
  const child = spawn(process.execPath, [MAIN], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));

  const listening = () => {
    const match = LISTENING.exec(text);
    return match ? { host: match[1]!, port: Number(match[2]) } : undefined;
  };
  const whenListening = async (timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    let done = false;
    void exited.then(() => (done = true));
    while (!listening() && !done && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return listening();
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  };
  return { child, output: () => text, exited, listening, whenListening, stop };
}
