import { describe, it, expect } from 'vitest';
import {
  MAX_NICKNAME_LENGTH,
  stripInvalidNicknameChars,
  sanitizeNickname,
  generateFallbackNickname,
  resolveNickname,
} from './nickname';

describe('stripInvalidNicknameChars', () => {
  it('keeps plain letters, digits and spaces untouched', () => {
    expect(stripInvalidNicknameChars('Ana Maria 42')).toBe('Ana Maria 42');
  });

  it('keeps accented letters', () => {
    expect(stripInvalidNicknameChars('José Ñandú')).toBe('José Ñandú');
  });

  it('keeps hyphen and underscore', () => {
    expect(stripInvalidNicknameChars('foo-bar_baz')).toBe('foo-bar_baz');
  });

  it('strips emoji', () => {
    expect(stripInvalidNicknameChars('Pilot🚀X')).toBe('PilotX');
  });

  it('strips HTML-ish characters', () => {
    expect(stripInvalidNicknameChars('<script>')).toBe('script');
  });

  it('strips other punctuation', () => {
    expect(stripInvalidNicknameChars('a.b,c!d?e')).toBe('abcde');
  });

  it('does not trim — a trailing space typed mid-word survives', () => {
    expect(stripInvalidNicknameChars('Ana ')).toBe('Ana ');
  });

  it('caps at MAX_NICKNAME_LENGTH', () => {
    expect(stripInvalidNicknameChars('ThisNameIsWayTooLong')).toBe('ThisNameIsWa');
    expect(stripInvalidNicknameChars('ThisNameIsWayTooLong').length).toBe(MAX_NICKNAME_LENGTH);
  });
});

describe('sanitizeNickname', () => {
  it('trims leading/trailing whitespace', () => {
    expect(sanitizeNickname('  Ana  ')).toBe('Ana');
  });

  it('strips invalid characters and trims', () => {
    expect(sanitizeNickname('  <b>Ana</b>🚀  ')).toBe('bAnab');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeNickname('    ')).toBe('');
  });

  it('returns empty string for input that is entirely invalid characters', () => {
    expect(sanitizeNickname('🚀🚀🚀')).toBe('');
  });

  it('never exceeds MAX_NICKNAME_LENGTH after trimming', () => {
    expect(sanitizeNickname('ThisNameIsWayTooLong').length).toBeLessThanOrEqual(MAX_NICKNAME_LENGTH);
  });
});

describe('generateFallbackNickname', () => {
  it('matches the "Piloto ####" shape', () => {
    expect(generateFallbackNickname()).toMatch(/^Piloto \d{4}$/);
  });

  it('is within the max length', () => {
    expect(generateFallbackNickname().length).toBeLessThanOrEqual(MAX_NICKNAME_LENGTH);
  });
});

describe('resolveNickname', () => {
  it('uses the sanitized value when something usable was typed', () => {
    expect(resolveNickname('  Ana  ')).toBe('Ana');
  });

  it('falls back to a generated tag when the input sanitizes to empty', () => {
    expect(resolveNickname('   ')).toMatch(/^Piloto \d{4}$/);
  });

  it('falls back to a generated tag for emoji-only input', () => {
    expect(resolveNickname('🚀🚀🚀')).toMatch(/^Piloto \d{4}$/);
  });
});
