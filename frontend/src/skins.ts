export interface SkinColors {
  /** Rim / glow color, e.g. "#00f5d4" */
  primary: string;
  /** Radial body gradient inner stop */
  bodyStart: string;
  /** Radial body gradient outer stop */
  bodyEnd: string;
  /** "r,g,b" channel string, used to build rgba() for window/trail/thrusters */
  window: string;
}

export interface SkinStats {
  /** Applied to CFG.maxHealth. 1 = no change. */
  healthMultiplier: number;
  /** Applied to the probe's collision/render radius. 1 = no change. Bigger is a real
   *  trade-off, not just cosmetic: a larger hitbox is easier for enemies to hit, so it's
   *  paired with more health rather than being a strict upgrade. */
  sizeMultiplier: number;
}

export interface Skin {
  id: string;
  name: string;
  /** Minimum best-wave-ever-reached required to unlock this skin. 0 = always unlocked. */
  unlockWave: number;
  colors: SkinColors;
  stats: SkinStats;
}

export const SKINS: Skin[] = [
  {
    id: 'standard',
    name: 'Standard',
    unlockWave: 0,
    colors: { primary: '#00f5d4', bodyStart: '#0d2a50', bodyEnd: '#061428', window: '0,245,212' },
    stats: { healthMultiplier: 1, sizeMultiplier: 1 },
  },
  {
    id: 'ember',
    name: 'Ember',
    unlockWave: 3,
    colors: { primary: '#ffb800', bodyStart: '#3a2205', bodyEnd: '#1e1200', window: '255,184,0' },
    stats: { healthMultiplier: 1.1, sizeMultiplier: 1.05 },
  },
  {
    id: 'voidwalker',
    name: 'Voidwalker',
    unlockWave: 6,
    colors: { primary: '#7b2fff', bodyStart: '#1e0a3a', bodyEnd: '#0d0620', window: '123,47,255' },
    stats: { healthMultiplier: 1.2, sizeMultiplier: 1.1 },
  },
  {
    id: 'abyssal-elite',
    name: 'Abyssal Elite',
    unlockWave: 10,
    colors: { primary: '#ff2d55', bodyStart: '#2a0a12', bodyEnd: '#150508', window: '255,45,85' },
    stats: { healthMultiplier: 1.35, sizeMultiplier: 1.15 },
  },
];

const DEFAULT_SKIN_ID = SKINS[0].id;
const BEST_WAVE_KEY = 'dp_best_wave';
const SELECTED_SKIN_KEY = 'dp_skin_id';

/** Skins whose unlock requirement is met by `bestWave`, in ascending unlock-difficulty order. */
export function getUnlockedSkins(bestWave: number): Skin[] {
  return SKINS.filter(skin => skin.unlockWave <= bestWave);
}

export function isSkinUnlocked(skin: Skin, bestWave: number): boolean {
  return skin.unlockWave <= bestWave;
}

export function computeBestWave(previousBest: number, waveReached: number): number {
  return Math.max(previousBest, waveReached);
}

/**
 * The skin that should actually render given the player's saved selection and progress.
 * Falls back to the best unlocked skin if the saved selection is locked or unknown, so a
 * stale/missing `dp_skin_id` never points at something the player can't use.
 */
export function resolveActiveSkin(selectedId: string, bestWave: number): Skin {
  const unlocked = getUnlockedSkins(bestWave);
  return unlocked.find(skin => skin.id === selectedId) ?? unlocked[unlocked.length - 1];
}

/**
 * Looks up a skin by id with no unlock check — used to render *other*
 * players in multiplayer, whose progress we don't know or care about here.
 * Falls back to the default skin for an unrecognized id (e.g. a remote
 * client running a different skin catalog version).
 */
export function findSkinById(id: string): Skin {
  return SKINS.find(skin => skin.id === id) ?? SKINS[0];
}

/** Pure — CFG.maxHealth scaled by the skin's power. Rounded since health is displayed/compared as a whole number. */
export function getEffectiveMaxHealth(skin: Skin, baseHealth: number): number {
  return Math.round(baseHealth * skin.stats.healthMultiplier);
}

/** Pure — collision/render radius scaled by the skin's power. */
export function getEffectiveRadius(skin: Skin, baseRadius: number): number {
  return baseRadius * skin.stats.sizeMultiplier;
}

export function getBestWave(): number {
  const raw = localStorage.getItem(BEST_WAVE_KEY);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Persists the new best wave (if higher) and returns it. */
export function saveBestWave(waveReached: number): number {
  const updated = computeBestWave(getBestWave(), waveReached);
  localStorage.setItem(BEST_WAVE_KEY, String(updated));
  return updated;
}

export function getSelectedSkinId(): string {
  return localStorage.getItem(SELECTED_SKIN_KEY) || DEFAULT_SKIN_ID;
}

export function setSelectedSkinId(id: string): void {
  localStorage.setItem(SELECTED_SKIN_KEY, id);
}
