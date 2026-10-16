import { MAX_PATTERN_SIZE } from '../constants.js';
import { parsePattern, PatternError, type Assertion, type RegexNode } from './parse.js';

export type SplitInstruction = { op: 'split'; x: number; y: number };
export type JumpInstruction = { op: 'jump'; to: number };

export type Instruction =
  | { op: 'atom'; atom: number }
  | SplitInstruction
  | JumpInstruction
  | { op: 'assert'; kind: Assertion }
  | { op: 'match' };

export interface Program {
  instructions: Instruction[];
  /** Trozos de fuente de los átomos, sin repetir; `Instruction.atom` indexa aquí. */
  atoms: string[];
}

const CAP = MAX_PATTERN_SIZE + 1;

/** Copias del contenido y pasos opcionales con que se emite una repetición `{min,max}`. */
function repetition(min: number, max: number): { copies: number; optional: number } {
  if (max === Infinity) return { copies: Math.max(min, 1), optional: 1 };
  return { copies: max, optional: max - min };
}

/**
 * Tamaño de un patrón calculado sobre el AST, sin expandir, y contando lo que se emite: átomo o
 * aserción 1; secuencia, la suma; alternativa de k ramas, la suma más k-1 (su split y su jump);
 * repetición, 0 si su contenido vale 0 y si no `contenido · copias + opcionales`. Los resultados
 * intermedios se acotan a `MAX_PATTERN_SIZE + 1`.
 *
 * Invariantes (comprobados por test para todo patrón aceptado): el programa tiene como mucho
 * `2 · tamaño + 1` instrucciones y un tamaño 0 equivale a no emitir nada.
 *
 * @param node Raíz del AST.
 * @returns El tamaño, como mucho `MAX_PATTERN_SIZE + 1`.
 */
export function patternSize(node: RegexNode): number {
  switch (node.type) {
    case 'empty':
      return 0;
    case 'atom':
    case 'assertion':
      return 1;
    case 'sequence':
      return Math.min(CAP, node.items.reduce((sum, item) => sum + patternSize(item), 0));
    case 'alternation':
      return Math.min(CAP, node.options.reduce((sum, option) => sum + patternSize(option), 0) + node.options.length - 1);
    case 'repeat': {
      const inner = patternSize(node.node);
      if (inner === 0) return 0;
      const { copies, optional } = repetition(node.min, node.max);
      return Math.min(CAP, inner * Math.min(CAP, copies) + Math.min(CAP, optional));
    }
  }
}

/** Emite el programa NFA de un AST cuyo tamaño ya se comprobó. */
class ProgramBuilder {
  readonly instructions: Instruction[] = [];
  readonly atoms: string[] = [];
  private readonly atomIndex = new Map<string, number>();

  emit(node: RegexNode): void {
    switch (node.type) {
      case 'empty':
        return;
      case 'atom':
        this.instructions.push({ op: 'atom', atom: this.internAtom(node.source) });
        return;
      case 'assertion':
        this.instructions.push({ op: 'assert', kind: node.kind });
        return;
      case 'sequence':
        node.items.forEach((item) => this.emit(item));
        return;
      case 'alternation':
        return this.emitAlternation(node.options);
      case 'repeat':
        return this.emitRepeat(node.node, node.min, node.max);
    }
  }

  private internAtom(source: string): number {
    let index = this.atomIndex.get(source);
    if (index === undefined) {
      index = this.atoms.push(source) - 1;
      this.atomIndex.set(source, index);
    }
    return index;
  }

  private emitAlternation(options: RegexNode[]): void {
    const jumps: JumpInstruction[] = [];
    options.forEach((option, i) => {
      if (i === options.length - 1) return this.emit(option);
      const split = this.pushSplit();
      this.emit(option);
      const jump: JumpInstruction = { op: 'jump', to: -1 };
      jumps.push(jump);
      this.instructions.push(jump);
      split.y = this.instructions.length;
    });
    for (const jump of jumps) jump.to = this.instructions.length;
  }

  /** Emite `x` y reporta si produjo instrucciones (repetir lo que no emite nada no cambia nada). */
  private emitNonEmpty(node: RegexNode): boolean {
    const before = this.instructions.length;
    this.emit(node);
    return this.instructions.length > before;
  }

  private pushSplit(): SplitInstruction {
    const split: SplitInstruction = { op: 'split', x: this.instructions.length + 1, y: -1 };
    this.instructions.push(split);
    return split;
  }

  private emitRepeat(node: RegexNode, min: number, max: number): void {
    const unbounded = max === Infinity;
    const mandatory = unbounded && min > 0 ? min - 1 : min;
    for (let i = 0; i < mandatory; i++) if (!this.emitNonEmpty(node)) return;
    if (unbounded) return this.emitUnboundedTail(node, min);
    for (let i = min; i < max; i++) {
      const split = this.pushSplit();
      if (!this.emitNonEmpty(node)) return void this.instructions.pop();
      split.y = this.instructions.length;
    }
  }

  /** Última copia de `x{n,}`: `x*` si `n` es 0 y `x+` en otro caso. */
  private emitUnboundedTail(node: RegexNode, min: number): void {
    const loop = this.instructions.length;
    if (min === 0) {
      const split = this.pushSplit();
      if (!this.emitNonEmpty(node)) return void this.instructions.pop();
      this.instructions.push({ op: 'jump', to: loop });
      split.y = this.instructions.length;
    } else if (this.emitNonEmpty(node)) {
      this.instructions.push({ op: 'split', x: loop, y: this.instructions.length + 1 });
    }
  }
}

/**
 * Construye el programa NFA de un AST.
 *
 * @param ast Raíz del AST.
 * @returns El programa.
 * @throws {PatternError} `too_large` si el tamaño supera `MAX_PATTERN_SIZE`; se comprueba antes de expandir.
 */
export function compileProgram(ast: RegexNode): Program {
  if (patternSize(ast) > MAX_PATTERN_SIZE) {
    throw new PatternError('too_large', `el patrón supera el tamaño máximo de ${MAX_PATTERN_SIZE}`);
  }
  const builder = new ProgramBuilder();
  builder.emit(ast);
  builder.instructions.push({ op: 'match' });
  return { instructions: builder.instructions, atoms: builder.atoms };
}

/**
 * Parsea y compila un patrón de `matches`.
 *
 * @param pattern Patrón del autor.
 * @returns El programa NFA.
 * @throws {PatternError} Si el patrón es inválido, usa una construcción no admitida, es demasiado grande o demasiado anidado.
 */
export function compilePattern(pattern: string): Program {
  try {
    return compileProgram(parsePattern(pattern));
  } catch (error) {
    if (error instanceof RangeError) throw new PatternError('too_large', 'el patrón está demasiado anidado');
    throw error;
  }
}
