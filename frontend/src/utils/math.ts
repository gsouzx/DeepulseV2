export interface Point {
  x: number;
  y: number;
}

export function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
