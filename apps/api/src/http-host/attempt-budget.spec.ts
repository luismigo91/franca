import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abortAfter, attemptBudget } from './attempt-budget.js';

describe('attemptBudget', () => {
  it('con plazo de sobra manda el timeoutMs del nodo', () => {
    expect(attemptBudget(8000, 60_000)).toBe(8000);
  });

  it('un intento empezado cerca del final se recorta al plazo restante', () => {
    expect(attemptBudget(8000, 500)).toBe(500);
  });

  it('con el plazo agotado o pasado no queda nada', () => {
    expect(attemptBudget(8000, 0)).toBe(0);
    expect(attemptBudget(8000, -1)).toBe(-1);
  });

  it('iguales dan el mismo valor', () => {
    expect(attemptBudget(500, 500)).toBe(500);
  });
});

describe('abortAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('un temporizador que vence antes de tiempo no aborta: espera lo que falta y aborta al cumplirse el presupuesto', () => {
    let clock = 0;
    const controller = new AbortController();
    abortAfter(controller, 500, () => clock);
    // El setTimeout vence a los 500 ms del bucle, pero el reloj monótono solo ha avanzado 499,4 ms.
    clock = 499.4;
    vi.advanceTimersByTime(500);
    expect(controller.signal.aborted).toBe(false);
    clock = 500.4;
    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);
  });

  it('a su hora aborta a la primera', () => {
    let clock = 0;
    const controller = new AbortController();
    abortAfter(controller, 500, () => clock);
    clock = 500;
    vi.advanceTimersByTime(499);
    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);
  });

  it('cancelar la espera, también tras un vencimiento temprano, deja el intento sin abortar', () => {
    let clock = 0;
    const controller = new AbortController();
    const cancel = abortAfter(controller, 500, () => clock);
    clock = 499.4;
    vi.advanceTimersByTime(500);
    cancel();
    clock = 2000;
    vi.advanceTimersByTime(2000);
    expect(controller.signal.aborted).toBe(false);
  });
});
