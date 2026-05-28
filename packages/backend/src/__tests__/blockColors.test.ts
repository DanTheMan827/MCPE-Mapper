import { describe, it, expect } from 'vitest';
import { getBlockColor, isTransparent, BLOCK_COLORS, DEFAULT_BLOCK_COLOR } from '@mcpe-mapper/shared';

describe('blockColors', () => {
  describe('getBlockColor', () => {
    it('returns correct color for grass_block', () => {
      expect(getBlockColor('minecraft:grass_block')).toEqual([127, 178, 56]);
    });

    it('returns correct color for stone', () => {
      expect(getBlockColor('minecraft:stone')).toEqual([136, 136, 136]);
    });

    it('returns correct color for water', () => {
      expect(getBlockColor('minecraft:water')).toEqual([63, 118, 228]);
    });

    it('handles blocks without minecraft: prefix', () => {
      expect(getBlockColor('grass_block')).toEqual([127, 178, 56]);
    });

    it('returns default color for unknown blocks', () => {
      expect(getBlockColor('minecraft:unknown_block_xyz')).toEqual(DEFAULT_BLOCK_COLOR);
    });

    it('uses heuristic matching for log-type blocks', () => {
      expect(getBlockColor('minecraft:bamboo_mosaic_log')).toEqual([130, 102, 68]);
    });

    it('uses heuristic matching for stone-type blocks', () => {
      expect(getBlockColor('minecraft:custom_stone_thing')).toEqual([136, 136, 136]);
    });
  });

  describe('isTransparent', () => {
    it('returns true for air', () => {
      expect(isTransparent('minecraft:air')).toBe(true);
    });

    it('returns true for cave_air', () => {
      expect(isTransparent('minecraft:cave_air')).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(isTransparent('')).toBe(true);
    });

    it('returns false for stone', () => {
      expect(isTransparent('minecraft:stone')).toBe(false);
    });

    it('returns false for grass_block', () => {
      expect(isTransparent('minecraft:grass_block')).toBe(false);
    });
  });

  describe('BLOCK_COLORS', () => {
    it('has entries defined', () => {
      expect(Object.keys(BLOCK_COLORS).length).toBeGreaterThan(50);
    });

    it('all colors are valid RGB tuples', () => {
      for (const [name, color] of Object.entries(BLOCK_COLORS)) {
        expect(color).toHaveLength(3);
        expect(color[0]).toBeGreaterThanOrEqual(0);
        expect(color[0]).toBeLessThanOrEqual(255);
        expect(color[1]).toBeGreaterThanOrEqual(0);
        expect(color[1]).toBeLessThanOrEqual(255);
        expect(color[2]).toBeGreaterThanOrEqual(0);
        expect(color[2]).toBeLessThanOrEqual(255);
      }
    });
  });
});
