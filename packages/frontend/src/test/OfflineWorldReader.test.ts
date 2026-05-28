import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineWorldReader } from '../services/OfflineWorldReader';

// Helper: build a minimal NBT compound for a palette entry with the given block name.
// Layout: compound(0x0A) + rootNameLen(0) + string-tag "name"=<blockName> + compound "states"(empty) + end
function buildPaletteNBT(blockName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(blockName);
  const nameLen = nameBytes.length;
  const statesName = new TextEncoder().encode('states');

  const result = new Uint8Array(
    3 +                       // 0A 00 00 (compound, empty root name)
    1 + 2 + 4 + 2 + nameLen + // string tag: type + nameLen + "name" + valueLen + value
    1 + 2 + 6 + 1 +           // compound tag "states": type + nameLen + "states" + end(0x00)
    1                         // end of root compound
  );

  let i = 0;
  result[i++] = 0x0A;                  // compound tag
  result[i++] = 0x00; result[i++] = 0x00; // root name len = 0

  result[i++] = 0x08;                  // string tag
  result[i++] = 0x04; result[i++] = 0x00; // name len = 4
  result[i++] = 0x6E; result[i++] = 0x61; result[i++] = 0x6D; result[i++] = 0x65; // "name"
  result[i++] = nameLen & 0xff; result[i++] = (nameLen >> 8) & 0xff;
  result.set(nameBytes, i); i += nameLen;

  result[i++] = 0x0A;                  // compound tag for "states"
  result[i++] = statesName.length & 0xff; result[i++] = 0x00;
  result.set(statesName, i); i += statesName.length;
  result[i++] = 0x00;                  // end of states compound

  result[i++] = 0x00;                  // end of root compound
  return result;
}

// Build a minimal version-8 subchunk where every block is the given blockName.
// Uses bpb=0 (single-value storage) so there is no block data array.
function buildSubchunkV8(blockName: string): Uint8Array {
  const nbt = buildPaletteNBT(blockName);
  const data = new Uint8Array(
    1 + // version = 8
    1 + // numStorages = 1
    1 + // bitsAndFlags = 0 (bpb=0)
    4 + // paletteSize = 1 (int32 LE)
    nbt.length
  );
  let i = 0;
  data[i++] = 0x08;                      // version 8
  data[i++] = 0x01;                      // 1 storage
  data[i++] = 0x00;                      // bpb = 0 (all blocks same)
  data[i++] = 0x01; data[i++] = 0x00; data[i++] = 0x00; data[i++] = 0x00; // paletteSize = 1
  data.set(nbt, i);
  return data;
}

// Build the LevelDB key for an overworld subchunk at (chunkX, chunkZ), subchunk index sy.
function buildSubchunkKey(chunkX: number, chunkZ: number, sy: number): Uint8Array {
  const key = new Uint8Array(10);
  const view = new DataView(key.buffer);
  view.setInt32(0, chunkX, true); // x LE
  view.setInt32(4, chunkZ, true); // z LE
  key[8] = 0x2f;                  // tag = SubChunkPrefix
  key[9] = sy & 0xff;             // subchunk index (treated as signed int8 in reader)
  return key;
}

function keyToHex(key: Uint8Array): string {
  return Array.from(key)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Inject a synthetic subchunk directly into reader's private caches so we can test
// getChunkRender() without needing to parse a real .mcworld file.
function injectSubchunk(
  reader: OfflineWorldReader,
  chunkX: number,
  chunkZ: number,
  dimension: number,
  sy: number,
  subchunkData: Uint8Array
): void {
  const r = reader as any;
  const key = buildSubchunkKey(chunkX, chunkZ, sy);
  const hex = keyToHex(key);
  r.parsedKeys.set(hex, subchunkData);
  const indexKey = `${chunkX},${chunkZ},${dimension}`;
  if (!r.chunkIndex.has(indexKey)) {
    r.chunkIndex.set(indexKey, new Set<string>());
  }
  r.chunkIndex.get(indexKey).add(hex);
}

describe('OfflineWorldReader', () => {
  describe('parseDB hang prevention', () => {
    let originalSetTimeout: typeof globalThis.setTimeout;

    beforeEach(() => {
      originalSetTimeout = globalThis.setTimeout;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('yields to the event loop (setTimeout 0) between each LDB file', async () => {
      const reader = new OfflineWorldReader();
      const r = reader as any;

      // Inject two minimal .ldb entries (48 bytes each — wrong magic, but still triggers yield)
      r.dbFiles.set('000001.ldb', new Uint8Array(48));
      r.dbFiles.set('000002.ldb', new Uint8Array(48));

      const setTimeoutCalls: number[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number, ...args: any[]) => {
        if (ms === 0) setTimeoutCalls.push(0);
        return originalSetTimeout(fn, ms, ...args);
      });

      await r.parseDB();

      // One yield per LDB file (2 files)
      expect(setTimeoutCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('yields to the event loop (setTimeout 0) between each log file', async () => {
      const reader = new OfflineWorldReader();
      const r = reader as any;

      // Inject one .log entry (empty — parseLogFile will return early, but yield still happens)
      r.dbFiles.set('000001.log', new Uint8Array(0));
      r.dbParsed = false;

      const setTimeoutCalls: number[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number, ...args: any[]) => {
        if (ms === 0) setTimeoutCalls.push(0);
        return originalSetTimeout(fn, ms, ...args);
      });

      await r.parseDB();

      expect(setTimeoutCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('does not hang or call setTimeout when there are no DB files', async () => {
      const reader = new OfflineWorldReader();
      const r = reader as any;
      // dbFiles is empty by default

      const setTimeoutCalls: number[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number, ...args: any[]) => {
        if (ms === 0) setTimeoutCalls.push(0);
        return originalSetTimeout(fn, ms, ...args);
      });

      await r.parseDB();

      // No files → no yields needed
      expect(setTimeoutCalls.length).toBe(0);
    });
  });

  describe('spawn chunk has renderable data', () => {
    it('getChunkRender returns non-null with opaque pixels for an injected stone subchunk at (0,0)', () => {
      const reader = new OfflineWorldReader();
      // Skip DB parsing — inject data directly
      (reader as any).dbParsed = true;

      // Inject a version-8 subchunk (bpb=0, all stone) at chunk (0,0), subchunk Y=4
      // Subchunk Y=4 corresponds to world Y 64-79 — above the surface in default range
      const stoneSubchunk = buildSubchunkV8('minecraft:stone');
      injectSubchunk(reader, 0, 0, 0, 4, stoneSubchunk);

      const result = reader.getChunkRender(0, 0, 0, { min: -64, max: 320 });

      expect(result).not.toBeNull();
      expect(result!.x).toBe(0);
      expect(result!.z).toBe(0);
      expect(result!.pixels.length).toBe(16 * 16 * 4);

      // At least one pixel must be fully opaque (alpha = 255)
      let hasOpaquePixel = false;
      for (let i = 3; i < result!.pixels.length; i += 4) {
        if (result!.pixels[i] === 255) {
          hasOpaquePixel = true;
          break;
        }
      }
      expect(hasOpaquePixel).toBe(true);
    });

    it('getChunkRender returns null for a chunk with no injected data', () => {
      const reader = new OfflineWorldReader();
      (reader as any).dbParsed = true;

      const result = reader.getChunkRender(0, 0, 0, { min: -64, max: 320 });
      expect(result).toBeNull();
    });

    it('hasChunk returns true after a subchunk is injected at the spawn chunk', () => {
      const reader = new OfflineWorldReader();
      (reader as any).dbParsed = true;

      expect(reader.hasChunk(0, 0, 0)).toBe(false);
      injectSubchunk(reader, 0, 0, 0, 4, buildSubchunkV8('minecraft:stone'));
      expect(reader.hasChunk(0, 0, 0)).toBe(true);
    });
  });

  describe('version 9 subchunk extra byte', () => {
    it('getBlockFromSubchunk handles version 9 with extra subchunk-Y byte before storage', () => {
      const reader = new OfflineWorldReader();

      // Build a version-9 subchunk: [version=9, numStorages=1, subchunkY=4, bitsAndFlags=0, paletteSize=1, NBT...]
      const nbt = buildPaletteNBT('minecraft:grass');
      const data = new Uint8Array(
        1 + // version = 9
        1 + // numStorages = 1
        1 + // extra subchunk-Y byte (= 4)
        1 + // bitsAndFlags = 0 (bpb=0)
        4 + // paletteSize = 1
        nbt.length
      );
      let i = 0;
      data[i++] = 0x09;                     // version 9
      data[i++] = 0x01;                     // numStorages
      data[i++] = 0x04;                     // extra subchunk-Y byte (must be skipped)
      data[i++] = 0x00;                     // bpb = 0
      data[i++] = 0x01; data[i++] = 0x00; data[i++] = 0x00; data[i++] = 0x00; // paletteSize=1
      data.set(nbt, i);

      const r = reader as any;
      const result = r.getBlockFromSubchunk(data, 0, 0, 0);
      expect(result).toBe('minecraft:grass');
    });

    it('getBlockFromSubchunk returns null for version 9 data parsed as version 8 (wrong offset)', () => {
      // Demonstrates the bug: if the extra byte were NOT skipped, bpb would be read from the
      // subchunk-Y byte (0x04 → bpb=2) and the palette would be at the wrong offset.
      const reader = new OfflineWorldReader();

      // Same data as the test above, but force-parsed as version 8 by replacing version byte
      const nbt = buildPaletteNBT('minecraft:grass');
      const data = new Uint8Array(
        1 + 1 + 1 + 1 + 4 + nbt.length
      );
      let i = 0;
      data[i++] = 0x08;  // version 8 — will NOT skip the extra byte
      data[i++] = 0x01;  // numStorages
      data[i++] = 0x04;  // this would be bitsAndFlags for v8, giving bpb=2 (wrong)
      data[i++] = 0x00;  // this would be start of block data for v8
      data[i++] = 0x01; data[i++] = 0x00; data[i++] = 0x00; data[i++] = 0x00;
      data.set(nbt, i);

      // With version 8, bpb=2, wordCount=ceil(4096/16)=256, it would try to read
      // far past the end of this tiny buffer and return null
      const r = reader as any;
      const result = r.getBlockFromSubchunk(data, 0, 0, 0);
      // Either null (bounds check) or a wrong block name — definitely NOT 'minecraft:grass'
      expect(result).not.toBe('minecraft:grass');
    });
  });
});
