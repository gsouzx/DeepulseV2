/**
 * Multiplayer nickname: sanitize/persist logic, shared by the menu's input
 * field and (mirrored, since there's no shared package with the backend —
 * see backend/src/realtime/rooms.js) the server's own validation of
 * whatever a client claims.
 */

export const MAX_NICKNAME_LENGTH = 12;

const STORAGE_KEY = 'deeppulse_nickname';

/** Letters (any language, incl. accents), digits, space, hyphen, underscore. Everything else is stripped, not just rejected — emoji, tags, punctuation, control chars. */
const INVALID_CHARS_REGEX = /[^\p{L}\p{N} _-]/gu;

/** Pure — strips disallowed characters and caps the length. Does NOT trim: called live on every keystroke, and trimming mid-typing would eat a space the player is about to continue past (e.g. "Ana " -> "Ana Maria"). */
export function stripInvalidNicknameChars(raw: string): string {
  return raw.replace(INVALID_CHARS_REGEX, '').slice(0, MAX_NICKNAME_LENGTH);
}

/** Pure — the full entry-time sanitization: strip, then trim, then re-check the length (trimming can free up room, stripping already capped it). Returns '' if nothing usable survives. */
export function sanitizeNickname(raw: string): string {
  return stripInvalidNicknameChars(raw).trim().slice(0, MAX_NICKNAME_LENGTH);
}

/** Pure-ish (uses Math.random) — "Piloto ####", a fresh 4-digit tag each call. */
export function generateFallbackNickname(): string {
  const digits = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `Piloto ${digits}`;
}

/** Sanitized nickname, or a fresh fallback tag if nothing usable was typed — never blocks joining for lack of a nickname. */
export function resolveNickname(raw: string): string {
  return sanitizeNickname(raw) || generateFallbackNickname();
}

export function getSavedNickname(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function saveNickname(value: string): void {
  localStorage.setItem(STORAGE_KEY, value);
}
