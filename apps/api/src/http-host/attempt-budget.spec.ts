import { describe, expect, it } from 'vitest';
import { attemptBudget } from './attempt-budget.js';

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
