import { Logger, type LoggerService } from '@nestjs/common';
import { afterEach, vi } from 'vitest';

export interface CapturedOutput {
  /** El logger capturado: pásalo a `createTestApp({ logger })` (Nest en testing sustituye el que se instale antes). */
  logger: LoggerService;
  /** Todo lo que se escribió: líneas del logger de Nest y `process.stdout`/`process.stderr`. */
  text(): string;
  /** Solo las líneas del logger de Nest. */
  lines(): string[];
  restore(): void;
}

/**
 * Captura la salida de registro de la API mientras dure el test: el logger de Nest (sustituido, nada llega a la
 * terminal) y las escrituras en `process.stdout`/`process.stderr`. Se restaura sola al terminar cada test.
 */
export function captureOutput(): CapturedOutput {
  const lines: string[] = [];
  const written: string[] = [];
  const push = (level: string) => (message: unknown, ...rest: unknown[]) => {
    const parts = [message, ...rest].filter((part) => part !== undefined && part !== '');
    lines.push(`${level} ${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}`);
  };
  const logger: LoggerService = { log: push('log'), error: push('error'), warn: push('warn'), debug: push('debug'), verbose: push('verbose') };
  Logger.overrideLogger(logger);
  const spies = [process.stdout, process.stderr].map((stream) =>
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as never),
  );
  const restore = () => {
    spies.forEach((spy) => spy.mockRestore());
    Logger.overrideLogger(['log', 'error', 'warn']);
  };
  afterEach(restore);
  return { logger, text: () => [...lines, ...written].join('\n'), lines: () => [...lines], restore };
}
