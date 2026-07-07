import { describe, it, expect } from 'vitest';
import {
  clampScale,
  computeBaseDiameter,
  joystickBaseDiameter,
  actionBaseDiameter,
  clampCenterToViewport,
  computeDefaultLayout,
  computeJoystickVector,
  MIN_SCALE,
  MAX_SCALE,
} from './touch-controls';

describe('clampScale', () => {
  it('leaves an in-range scale unchanged', () => {
    expect(clampScale(1)).toBe(1);
  });

  it('floors below the minimum', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
  });

  it('ceils above the maximum', () => {
    expect(clampScale(5)).toBe(MAX_SCALE);
  });
});

describe('computeBaseDiameter', () => {
  it('scales with the viewport within range', () => {
    expect(computeBaseDiameter(500, 0.3, 50, 300)).toBe(150);
  });

  it('floors on a tiny viewport', () => {
    expect(computeBaseDiameter(50, 0.3, 80, 300)).toBe(80);
  });

  it('ceils on a huge viewport', () => {
    expect(computeBaseDiameter(5000, 0.3, 80, 300)).toBe(300);
  });
});

describe('joystickBaseDiameter / actionBaseDiameter', () => {
  it('joystick is bigger than the action button for the same viewport', () => {
    expect(joystickBaseDiameter(1280, 720)).toBeGreaterThan(actionBaseDiameter(1280, 720));
  });

  it('both stay within their absolute min/max on an extreme viewport', () => {
    expect(joystickBaseDiameter(50, 50)).toBeGreaterThanOrEqual(96);
    expect(joystickBaseDiameter(5000, 5000)).toBeLessThanOrEqual(190);
    expect(actionBaseDiameter(50, 50)).toBeGreaterThanOrEqual(64);
    expect(actionBaseDiameter(5000, 5000)).toBeLessThanOrEqual(130);
  });
});

describe('clampCenterToViewport', () => {
  it('leaves a center that already fits untouched', () => {
    expect(clampCenterToViewport(200, 200, 100, 800, 600)).toEqual({ x: 200, y: 200 });
  });

  it('pulls a center back onto the screen when it is off to the left/top', () => {
    const result = clampCenterToViewport(-50, -50, 100, 800, 600);
    expect(result.x).toBeGreaterThanOrEqual(50);
    expect(result.y).toBeGreaterThanOrEqual(50);
  });

  it('pulls a center back onto the screen when it is off to the right/bottom', () => {
    const result = clampCenterToViewport(9000, 9000, 100, 800, 600);
    expect(result.x).toBeLessThanOrEqual(800 - 40);
    expect(result.y).toBeLessThanOrEqual(600 - 40);
  });

  it('never produces a center outside the viewport even for a control bigger than the screen', () => {
    const result = clampCenterToViewport(50, 50, 900, 800, 600);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x).toBeLessThanOrEqual(800);
  });
});

describe('computeDefaultLayout', () => {
  it('anchors the joystick to the bottom-left and the action button to the bottom-right', () => {
    const layout = computeDefaultLayout(1280, 720);
    expect(layout.joystick.x).toBeLessThan(layout.action.x);
    expect(layout.joystick.y).toBeGreaterThan(400);
    expect(layout.action.y).toBeGreaterThan(400);
  });

  it('starts both controls at scale 1', () => {
    const layout = computeDefaultLayout(1280, 720);
    expect(layout.joystick.scale).toBe(1);
    expect(layout.action.scale).toBe(1);
  });

  it('keeps both controls on-screen on a small phone viewport', () => {
    const layout = computeDefaultLayout(360, 640);
    expect(layout.joystick.x).toBeGreaterThan(0);
    expect(layout.joystick.x).toBeLessThan(360);
    expect(layout.action.x).toBeGreaterThan(0);
    expect(layout.action.x).toBeLessThan(360);
  });
});

describe('computeJoystickVector', () => {
  it('is zero at dead center', () => {
    expect(computeJoystickVector(0, 0, 50)).toEqual({ x: 0, y: 0 });
  });

  it('is zero within the deadzone', () => {
    const result = computeJoystickVector(5, 0, 50, 0.15);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('points in the same direction as the raw offset', () => {
    const result = computeJoystickVector(0, 40, 50);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeGreaterThan(0);
  });

  it('clamps magnitude to 1 at the edge of travel', () => {
    const result = computeJoystickVector(50, 0, 50);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(1);
  });

  it('clamps magnitude to 1 beyond the travel radius (finger dragged past the base)', () => {
    const result = computeJoystickVector(500, 0, 50);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(1);
  });

  it('gives partial magnitude for a partial push, unlike a digital key', () => {
    const result = computeJoystickVector(25, 0, 50);
    const magnitude = Math.hypot(result.x, result.y);
    expect(magnitude).toBeGreaterThan(0);
    expect(magnitude).toBeLessThan(1);
  });

  it('is zero when the base has no travel radius', () => {
    expect(computeJoystickVector(10, 10, 0)).toEqual({ x: 0, y: 0 });
  });
});
