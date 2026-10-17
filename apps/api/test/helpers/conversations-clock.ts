import type { Clock } from '../../src/flows/clock.js';

/** Instante de partida de los e2e de conversaciones. */
export const CLOCK_START = Date.UTC(2026, 9, 17, 10, 0, 0);

/**
 * Reloj manual: `now()` devuelve el instante actual y lo avanza 1 ms (así dos pasos de una petición nunca coinciden);
 * `advance(ms)` salta el tiempo y `set(date)` fija el instante que devolverá la próxima llamada. Se instala con
 * `configure: (builder) => builder.overrideProvider(CLOCK).useValue(clock)`.
 */
export class ManualClock implements Clock {
  private current: number;

  constructor(private readonly start = CLOCK_START) {
    this.current = start;
  }

  now(): Date {
    const value = new Date(this.current);
    this.current += 1;
    return value;
  }

  /** Avanza el reloj `ms` milisegundos. */
  advance(ms: number): void {
    this.current += ms;
  }

  /** La próxima llamada a `now()` devolverá exactamente `date`. */
  set(date: Date): void {
    this.current = date.getTime();
  }

  /** Instante que devolvería `now()`, sin avanzar. */
  peek(): Date {
    return new Date(this.current);
  }

  /** Vuelve al instante de partida. */
  reset(): void {
    this.current = this.start;
  }
}
