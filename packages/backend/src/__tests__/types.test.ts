import { describe, it, expect } from 'vitest';
import { ChunkCoord, ViewerConfig, WorldInfo, MapMarker } from '@mcpe-mapper/shared';

describe('Shared Types', () => {
  it('ChunkCoord has x and z properties', () => {
    const coord: ChunkCoord = { x: 5, z: -3 };
    expect(coord.x).toBe(5);
    expect(coord.z).toBe(-3);
  });

  it('ViewerConfig has all required properties', () => {
    const config: ViewerConfig = {
      showNetherPortals: true,
      showEndPortals: false,
      showPlayers: true,
      heightRange: { min: -64, max: 320 },
      dimension: 0,
    };
    expect(config.showNetherPortals).toBe(true);
    expect(config.showEndPortals).toBe(false);
    expect(config.heightRange.min).toBe(-64);
    expect(config.heightRange.max).toBe(320);
  });

  it('WorldInfo has name and spawn coordinates', () => {
    const info: WorldInfo = {
      name: 'Test',
      gameType: 1,
      spawnX: 10,
      spawnY: 64,
      spawnZ: 20,
      lastPlayed: 0,
    };
    expect(info.name).toBe('Test');
    expect(info.spawnX).toBe(10);
  });

  it('MapMarker supports all marker types', () => {
    const markers: MapMarker[] = [
      { id: '1', x: 0, y: 0, z: 0, dimension: 0, type: 'player', label: 'P1' },
      { id: '2', x: 0, y: 0, z: 0, dimension: 0, type: 'nether_portal', label: 'NP' },
      { id: '3', x: 0, y: 0, z: 0, dimension: 0, type: 'end_portal', label: 'EP' },
    ];
    expect(markers).toHaveLength(3);
    expect(markers[0].type).toBe('player');
    expect(markers[1].type).toBe('nether_portal');
    expect(markers[2].type).toBe('end_portal');
  });
});
