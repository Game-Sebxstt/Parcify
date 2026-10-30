// Expresiones de los campos numéricos: números, + − * /, paréntesis y un «+» inicial que suma al valor actual.
// Parser recursivo descendente propio: el texto lo escribe el usuario y nunca pasa por eval ni Function.

export const EXPRESSION_MAX_LENGTH = 64;

class Parser {
  private at = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): number | null {
    const result = this.sum();
    this.skipSpace();
    return result !== null && this.at === this.text.length ? result : null;
  }

  private sum(): number | null {
    let left = this.product();
    while (left !== null) {
      const op = this.peek();
      if (op !== '+' && op !== '-') break;
      this.at++;
      const right = this.product();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private product(): number | null {
    let left = this.factor();
    while (left !== null) {
      const op = this.peek();
      if (op !== '*' && op !== '/') break;
      this.at++;
      const right = this.factor();
      if (right === null || (op === '/' && right === 0)) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private factor(): number | null {
    const next = this.peek();
    if (next === '-' || next === '+') {
      this.at++;
      const value = this.factor();
      return value === null ? null : next === '-' ? -value : value;
    }
    if (next === '(') {
      this.at++;
      const value = this.sum();
      if (value === null || this.peek() !== ')') return null;
      this.at++;
      return value;
    }
    return this.number();
  }

  private number(): number | null {
    const match = /^(\d+([.,]\d*)?|[.,]\d+)/.exec(this.text.slice(this.at));
    if (!match) return null;
    this.at += match[0].length;
    return Number(match[0].replace(',', '.'));
  }

  private peek(): string | undefined {
    this.skipSpace();
    return this.text[this.at];
  }

  private skipSpace() {
    while (this.text[this.at] === ' ') this.at++;
  }
}

// `+15` es relativo (actual + 15); `-30` es el número −30. Devuelve null si el texto no es válido o el resultado no es finito.
export function evaluate(text: string, current: number): number | null {
  if (text.length > EXPRESSION_MAX_LENGTH) return null;
  const clean = text.replace(/\u2212/g, '-').replace(/[\t\u00a0]/g, ' ').trim();
  if (!clean) return null;
  const relative = clean.startsWith('+');
  const result = new Parser(relative ? clean.slice(1) : clean).parse();
  if (result === null) return null;
  const value = relative ? current + result : result;
  return Number.isFinite(value) ? value : null;
}
