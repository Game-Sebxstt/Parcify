// Matriz afín [a, b, c, d, tx, ty]: x' = a·x + c·y + tx, y' = b·x + d·y + ty.
export type Mat = [number, number, number, number, number, number];

export type Point = { x: number; y: number };

export const IDENTITY: Readonly<Mat> = [1, 0, 0, 1, 0, 0];

export function identity(): Mat {
  return [1, 0, 0, 1, 0, 0];
}

export function translation(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function rotation(angle: number): Mat {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, 0, 0];
}

export function scaling(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

// m1 · m2: primero se aplica m2 y después m1.
export function multiply(m1: Readonly<Mat>, m2: Readonly<Mat>): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function compose(...matrices: Array<Readonly<Mat>>): Mat {
  let result = identity();
  for (const matrix of matrices) result = multiply(result, matrix);
  return result;
}

export function invert(m: Readonly<Mat>): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0 || !Number.isFinite(det)) return identity();
  const inv = 1 / det;
  return [
    m[3] * inv,
    -m[1] * inv,
    -m[2] * inv,
    m[0] * inv,
    (m[2] * m[5] - m[3] * m[4]) * inv,
    (m[1] * m[4] - m[0] * m[5]) * inv,
  ];
}

export function apply(m: Readonly<Mat>, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function isIdentity(m: Readonly<Mat>, epsilon = 1e-9): boolean {
  return (
    Math.abs(m[0] - 1) < epsilon &&
    Math.abs(m[1]) < epsilon &&
    Math.abs(m[2]) < epsilon &&
    Math.abs(m[3] - 1) < epsilon &&
    Math.abs(m[4]) < epsilon &&
    Math.abs(m[5]) < epsilon
  );
}

export function isTranslation(m: Readonly<Mat>, epsilon = 1e-9): boolean {
  return Math.abs(m[0] - 1) < epsilon && Math.abs(m[1]) < epsilon && Math.abs(m[2]) < epsilon && Math.abs(m[3] - 1) < epsilon;
}

// Solo gira, traslada o voltea: conserva distancias y ángulos.
export function isRigid(m: Readonly<Mat>, epsilon = 1e-6): boolean {
  return (
    Math.abs(m[0] * m[0] + m[1] * m[1] - 1) < epsilon &&
    Math.abs(m[2] * m[2] + m[3] * m[3] - 1) < epsilon &&
    Math.abs(m[0] * m[2] + m[1] * m[3]) < epsilon
  );
}

export function transformPoints(points: readonly number[], m: Readonly<Mat>): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    out[i] = m[0] * x + m[2] * y + m[4];
    out[i + 1] = m[1] * x + m[3] * y + m[5];
  }
  return out;
}

// Escala respecto a un punto fijo (ox, oy) en el sistema de ejes girado `angle`.
export function scaleAround(ox: number, oy: number, sx: number, sy: number, angle = 0): Mat {
  if (angle === 0) return [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
  return compose(translation(ox, oy), rotation(angle), scaling(sx, sy), rotation(-angle), translation(-ox, -oy));
}

export function rotateAround(ox: number, oy: number, angle: number): Mat {
  return compose(translation(ox, oy), rotation(angle), translation(-ox, -oy));
}

export function normalizeAngle(angle: number): number {
  let value = angle % (2 * Math.PI);
  if (value > Math.PI) value -= 2 * Math.PI;
  if (value < -Math.PI) value += 2 * Math.PI;
  return value;
}
