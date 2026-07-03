import { describe, it, expect } from 'vitest';
import {
  SKINS,
  getUnlockedSkins,
  isSkinUnlocked,
  computeBestWave,
  resolveActiveSkin,
  findSkinById,
  getEffectiveMaxHealth,
  getEffectiveRadius,
} from './skins';

describe('getUnlockedSkins', () => {
  it('only standard is unlocked at wave 0', () => {
    expect(getUnlockedSkins(0).map(s => s.id)).toEqual(['standard']);
  });

  it('stays locked to standard just below the ember threshold', () => {
    expect(getUnlockedSkins(2).map(s => s.id)).toEqual(['standard']);
  });

  it('unlocks ember exactly at its threshold', () => {
    expect(getUnlockedSkins(3).map(s => s.id)).toEqual(['standard', 'ember']);
  });

  it('unlocks voidwalker exactly at its threshold', () => {
    expect(getUnlockedSkins(6).map(s => s.id)).toEqual(['standard', 'ember', 'voidwalker']);
  });

  it('unlocks every skin at the highest threshold', () => {
    expect(getUnlockedSkins(10).map(s => s.id)).toEqual([
      'standard',
      'ember',
      'voidwalker',
      'abyssal-elite',
    ]);
  });

  it('does not unlock anything new past the highest threshold', () => {
    expect(getUnlockedSkins(999)).toHaveLength(SKINS.length);
  });
});

describe('isSkinUnlocked', () => {
  it('reports locked when best wave is below the requirement', () => {
    expect(isSkinUnlocked(SKINS[1], 2)).toBe(false);
  });

  it('reports unlocked when best wave meets the requirement', () => {
    expect(isSkinUnlocked(SKINS[1], 3)).toBe(true);
  });
});

describe('computeBestWave', () => {
  it('raises the record when the new run goes further', () => {
    expect(computeBestWave(0, 5)).toBe(5);
  });

  it('never lowers the record on a worse run', () => {
    expect(computeBestWave(5, 3)).toBe(5);
  });

  it('is stable when the run ties the record', () => {
    expect(computeBestWave(5, 5)).toBe(5);
  });
});

describe('resolveActiveSkin', () => {
  it('falls back to the best unlocked skin when the selection is still locked', () => {
    expect(resolveActiveSkin('ember', 0).id).toBe('standard');
  });

  it('honors the selection once it is unlocked', () => {
    expect(resolveActiveSkin('ember', 3).id).toBe('ember');
  });

  it('falls back to the best unlocked skin for an unknown id', () => {
    expect(resolveActiveSkin('does-not-exist', 6).id).toBe('voidwalker');
  });

  it('respects an explicit lower-tier selection even when better skins are unlocked', () => {
    expect(resolveActiveSkin('standard', 999).id).toBe('standard');
  });
});

describe('findSkinById', () => {
  it('finds a known skin regardless of unlock state', () => {
    expect(findSkinById('abyssal-elite').id).toBe('abyssal-elite');
  });

  it('falls back to the default skin for an unknown id', () => {
    expect(findSkinById('nonexistent').id).toBe('standard');
  });
});

describe('getEffectiveMaxHealth', () => {
  it('leaves health unchanged for the standard skin', () => {
    expect(getEffectiveMaxHealth(SKINS[0], 100)).toBe(100);
  });

  it('scales health up for a higher-tier skin', () => {
    expect(getEffectiveMaxHealth(findSkinById('ember'), 100)).toBe(110);
  });

  it('rounds to a whole number', () => {
    expect(getEffectiveMaxHealth(findSkinById('voidwalker'), 100)).toBe(120);
  });
});

describe('getEffectiveRadius', () => {
  it('leaves radius unchanged for the standard skin', () => {
    expect(getEffectiveRadius(SKINS[0], 14)).toBe(14);
  });

  it('scales radius up for a higher-tier skin', () => {
    expect(getEffectiveRadius(findSkinById('abyssal-elite'), 14)).toBeCloseTo(16.1);
  });

  it('grants strictly more health and size as unlock tiers rise', () => {
    const tiers = SKINS.map(s => s.stats);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].healthMultiplier).toBeGreaterThan(tiers[i - 1].healthMultiplier);
      expect(tiers[i].sizeMultiplier).toBeGreaterThan(tiers[i - 1].sizeMultiplier);
    }
  });
});
