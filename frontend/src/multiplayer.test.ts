import { describe, it, expect } from 'vitest';
import { shouldSendPosition } from './multiplayer';

describe('shouldSendPosition', () => {
  it('blocks a send right after the previous one', () => {
    expect(shouldSendPosition(1000, 1010, 50)).toBe(false);
  });

  it('allows a send once the interval has fully elapsed', () => {
    expect(shouldSendPosition(1000, 1050, 50)).toBe(true);
  });

  it('allows a send when well past the interval', () => {
    expect(shouldSendPosition(1000, 2000, 50)).toBe(true);
  });

  it('always allows the very first send', () => {
    expect(shouldSendPosition(0, 5, 50)).toBe(false);
    expect(shouldSendPosition(0, 50, 50)).toBe(true);
  });
});
