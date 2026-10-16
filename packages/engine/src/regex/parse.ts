/**
 * Parser del subconjunto regular de ECMAScript que admite `matches`: literales, `.`, clases,
 * escapes, grupos (`(...)`, `(?:...)`, `(?<nombre>...)`), alternativa, cuantificadores y las
 * aserciones `^`, `$`, `\b` y `\B`. Convierte el patrón en un AST; no lo ejecuta.
 */

export type Assertion = 'start' | 'end' | 'wordBoundary' | 'notWordBoundary';

export type RegexNode =
  | { type: 'empty' }
  /** Un carácter (code point): `source` es el trozo de fuente del patrón que lo describe. */
  | { type: 'atom'; source: string }
  | { type: 'assertion'; kind: Assertion }
  | { type: 'sequence'; items: RegexNode[] }
  | { type: 'alternation'; options: RegexNode[] }
  /** `max` es `Infinity` si no tiene tope. Voraz y perezoso son equivalentes para un resultado booleano. */
  | { type: 'repeat'; node: RegexNode; min: number; max: number };

export type PatternErrorKind = 'invalid' | 'unsupported' | 'too_large';

/** El patrón no se puede evaluar. El mensaje nombra la causa, nunca el texto evaluado. */
export class PatternError extends Error {
  constructor(
    readonly kind: PatternErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PatternError';
  }
}

/**
 * Convierte un patrón en su AST. El motor nativo solo **compila** el patrón (nunca lo ejecuta
 * contra un texto) para validar la sintaxis: si el parser acepta, el nativo compila.
 *
 * @param pattern Patrón del autor.
 * @returns El AST del patrón.
 * @throws {PatternError} Si la sintaxis es inválida o usa una construcción no admitida.
 */
export function parsePattern(pattern: string): RegexNode {
  try {
    new RegExp(pattern, 'u');
  } catch {
    throw new PatternError('invalid', 'la expresión regular no es válida');
  }
  return parseAssumingValid(pattern);
}

/**
 * Parsea un patrón que ya se sabe válido en modo Unicode, sin consultar al motor nativo. Existe
 * para que los rechazos propios (nombres repetidos, modificadores) se puedan probar aunque el V8
 * del host ya los rechace por su cuenta.
 *
 * @param pattern Patrón de sintaxis válida.
 * @returns El AST del patrón.
 * @throws {PatternError} Si usa una construcción no admitida.
 */
export function parseAssumingValid(pattern: string): RegexNode {
  return new Parser(pattern).parse();
}

class Parser {
  private pos = 0;
  private readonly groupNames = new Set<string>();

  constructor(private readonly src: string) {}

  parse(): RegexNode {
    return this.disjunction();
  }

  private disjunction(): RegexNode {
    const options = [this.alternative()];
    while (this.src[this.pos] === '|') {
      this.pos++;
      options.push(this.alternative());
    }
    return options.length === 1 ? options[0]! : { type: 'alternation', options };
  }

  private alternative(): RegexNode {
    const items: RegexNode[] = [];
    while (this.pos < this.src.length && this.src[this.pos] !== '|' && this.src[this.pos] !== ')') {
      items.push(this.term());
    }
    if (items.length === 0) return { type: 'empty' };
    return items.length === 1 ? items[0]! : { type: 'sequence', items };
  }

  private term(): RegexNode {
    const c = this.src[this.pos]!;
    if (c === '^') return this.assertion('start');
    if (c === '$') return this.assertion('end');
    let atom: RegexNode;
    if (c === '(') atom = this.group();
    else if (c === '[') atom = this.characterClass();
    else if (c === '\\') {
      atom = this.escape();
      if (atom.type === 'assertion') return atom;
    } else if (c === '.') {
      this.pos++;
      atom = { type: 'atom', source: '.' };
    } else {
      const cp = String.fromCodePoint(this.src.codePointAt(this.pos)!);
      this.pos += cp.length;
      atom = { type: 'atom', source: cp };
    }
    return this.quantified(atom);
  }

  private assertion(kind: Assertion): RegexNode {
    this.pos++;
    return { type: 'assertion', kind };
  }

  private quantified(atom: RegexNode): RegexNode {
    const c = this.src[this.pos];
    let min: number;
    let max: number;
    if (c === '*') [min, max] = [0, Infinity];
    else if (c === '+') [min, max] = [1, Infinity];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') {
      const close = this.src.indexOf('}', this.pos);
      const [low = '', high] = this.src.slice(this.pos + 1, close).split(',');
      min = Number(low);
      max = high === undefined ? min : high === '' ? Infinity : Number(high);
      this.pos = close;
    } else return atom;
    this.pos++;
    if (this.src[this.pos] === '?') this.pos++;
    return { type: 'repeat', node: atom, min, max };
  }

  private group(): RegexNode {
    this.pos++; // (
    if (this.src[this.pos] === '?') {
      const rest = this.src.slice(this.pos + 1, this.pos + 3);
      if (rest[0] === ':') this.pos += 2;
      else if (rest[0] === '=' || rest[0] === '!') throw unsupported('lookahead');
      else if (rest === '<=' || rest === '<!') throw unsupported('lookbehind');
      else if (rest[0] === '<') this.namedGroupHeader();
      else throw unsupported('modificadores en línea o grupos (?...) distintos de (?:...) y (?<nombre>...)');
    }
    const inner = this.disjunction();
    this.pos++; // )
    return inner;
  }

  private namedGroupHeader(): void {
    this.pos += 2; // ?<
    let name = '';
    while (this.src[this.pos] !== '>') {
      if (this.src[this.pos] === '\\') {
        name += this.unicodeEscape();
      } else {
        const cp = String.fromCodePoint(this.src.codePointAt(this.pos)!);
        this.pos += cp.length;
        name += cp;
      }
    }
    this.pos++; // >
    if (this.groupNames.has(name)) throw unsupported('nombres de grupo repetidos');
    this.groupNames.add(name);
  }

  private characterClass(): RegexNode {
    const start = this.pos;
    this.pos++; // [
    while (this.src[this.pos] !== ']') {
      this.pos += this.src[this.pos] === '\\' ? 2 : 1;
    }
    this.pos++; // ]
    return { type: 'atom', source: this.src.slice(start, this.pos) };
  }

  private escape(): RegexNode {
    const start = this.pos;
    const c = this.src[this.pos + 1]!;
    if (c === 'b' || c === 'B') {
      this.pos += 2;
      return { type: 'assertion', kind: c === 'b' ? 'wordBoundary' : 'notWordBoundary' };
    }
    if (c >= '1' && c <= '9') throw unsupported('referencias hacia atrás');
    if (c === 'k') throw unsupported('referencias hacia atrás');
    if (c === 'u') {
      this.unicodeEscape();
    } else if (c === 'p' || c === 'P') {
      this.pos = this.src.indexOf('}', this.pos) + 1;
    } else if (c === 'x') {
      this.pos += 4;
    } else if (c === 'c') {
      this.pos += 3;
    } else {
      this.pos += 2;
    }
    return { type: 'atom', source: this.src.slice(start, this.pos) };
  }

  /**
   * Lee `\uXXXX` o `\u{X...}` desde la barra y deja `pos` tras la secuencia. Dos escapes de cuatro
   * dígitos consecutivos, sustituto alto y sustituto bajo, forman un solo code point.
   *
   * @returns El texto que representa.
   */
  private unicodeEscape(): string {
    const braced = this.src[this.pos + 2] === '{';
    const first = this.readUnicodeEscape();
    const high = first.charCodeAt(0);
    if (!braced && first.length === 1 && high >= 0xd800 && high <= 0xdbff && this.isFourDigitEscapeAhead()) {
      const save = this.pos;
      const second = this.readUnicodeEscape();
      const low = second.charCodeAt(0);
      if (low >= 0xdc00 && low <= 0xdfff) return first + second;
      this.pos = save;
    }
    return first;
  }

  private isFourDigitEscapeAhead(): boolean {
    return this.src.startsWith('\\u', this.pos) && this.src[this.pos + 2] !== '{';
  }

  private readUnicodeEscape(): string {
    this.pos += 2; // \u
    if (this.src[this.pos] === '{') {
      const close = this.src.indexOf('}', this.pos);
      const code = parseInt(this.src.slice(this.pos + 1, close), 16);
      this.pos = close + 1;
      return String.fromCodePoint(code);
    }
    const hex = this.src.slice(this.pos, this.pos + 4);
    this.pos += 4;
    return String.fromCharCode(parseInt(hex, 16));
  }
}

function unsupported(what: string): PatternError {
  return new PatternError('unsupported', `construcción no admitida en matches: ${what}`);
}
