import { describe, expect, it } from 'vitest';
import { EXPRESSION_MAX_LENGTH, evaluate } from './expression.ts';

describe('evaluate', () => {
  it('un + inicial suma al valor actual', () => {
    expect(evaluate('+15', 30)).toBe(45);
    expect(evaluate(' +15 ', 30)).toBe(45);
    expect(evaluate('+2*3', 10)).toBe(16);
  });

  it('un - inicial es el signo de un número absoluto', () => {
    expect(evaluate('-30', 90)).toBe(-30);
    expect(evaluate('\u221230', 90)).toBe(-30);
  });

  it('opera con precedencia y paréntesis', () => {
    expect(evaluate('90-30', 0)).toBe(60);
    expect(evaluate('(10+2)*3', 0)).toBe(36);
    expect(evaluate('10+2*3', 0)).toBe(16);
    expect(evaluate('8/2/2', 0)).toBe(2);
    expect(evaluate('-(4+1)', 0)).toBe(-5);
  });

  it('acepta coma o punto decimal', () => {
    expect(evaluate('1,5*2', 0)).toBe(3);
    expect(evaluate('1.5*2', 0)).toBe(3);
    expect(evaluate(',5', 0)).toBe(0.5);
  });

  it('la división por 0 no es válida', () => {
    expect(evaluate('10/0', 5)).toBeNull();
    expect(evaluate('10/(2-2)', 5)).toBeNull();
  });

  it('rechaza lo que no es una expresión', () => {
    expect(evaluate('', 5)).toBeNull();
    expect(evaluate('   ', 5)).toBeNull();
    expect(evaluate('abc', 5)).toBeNull();
    expect(evaluate('2+', 5)).toBeNull();
    expect(evaluate('(2+3', 5)).toBeNull();
    expect(evaluate('2)', 5)).toBeNull();
    expect(evaluate('alert(1)', 5)).toBeNull();
    expect(evaluate('1e309', 5)).toBeNull();
    expect(evaluate('Math.PI', 5)).toBeNull();
  });

  it(`no admite más de ${EXPRESSION_MAX_LENGTH} caracteres`, () => {
    const ok = '1+'.repeat(31) + '11';
    expect(ok).toHaveLength(64);
    expect(evaluate(ok, 0)).toBe(42);
    expect(evaluate(`${ok}1`, 0)).toBeNull();
    expect(evaluate('1'.repeat(65), 0)).toBeNull();
  });
});
