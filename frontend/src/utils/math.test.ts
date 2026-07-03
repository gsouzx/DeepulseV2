import { describe, it, expect } from 'vitest';
import { clamp, dist, lerp } from './math';

describe('clamp', () => {
  it('keeps values inside the range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps values below the lower bound', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps values above the upper bound', () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpolates linearly between two values', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('returns the start value at t=0', () => {
    expect(lerp(4, 8, 0)).toBe(4);
  });

  it('returns the end value at t=1', () => {
    expect(lerp(4, 8, 1)).toBe(8);
  });
});

describe('dist', () => {
  it('computes Euclidean distance between two points', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('returns 0 for identical points', () => {
    expect(dist({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});
