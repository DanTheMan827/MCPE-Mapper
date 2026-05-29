/**
 * Web worker that renders map tile pixel data from raw Bedrock subchunk buffers.
 *
 * A "tile" is TILE_SIZE × TILE_SIZE chunks (default 16).  Each chunk is 16×16
 * blocks, so the tile canvas is (TILE_SIZE*16) × (TILE_SIZE*16) pixels.
 * Chunks that have no data are left transparent.
 */

import { getBlockColor, isTransparent } from '@mcpe-mapper/shared';
import { fnv1a } from '../services/TileCache';

export interface TileRenderRequest {
  id: string;
  tileX: number;
  tileZ: number;
  /** chunks per tile edge, e.g. 16 */
  tileSize: number;
  dimension: number;
  heightRange: { min: number; max: number };
  /**
   * One entry per chunk that has data within this tile.
   * chunkLocalX / chunkLocalZ are the chunk's position relative to the
   * tile's top-left corner (0..tileSize-1).
   */
  chunks: Array<{
    chunkLocalX: number;
    chunkLocalZ: number;
    /** subchunk index (signed) → raw subchunk buffer */
    subchunks: Array<{ index: number; data: ArrayBuffer }>;
  }>;
}

export interface TileRenderResponse {
  id: string;
  tileX: number;
  tileZ: number;
  /** RGBA pixel data: tilePixelSize × tilePixelSize × 4 bytes */
  pixels: ArrayBuffer;
  /** FNV-1a hash of all input chunk data */
  hash: number;
}

// ─── block rendering helpers ──────────────────────────────────────────────────

function readLEInt32(data: Uint8Array, offset: number): number {
  return (
    (data[offset]) |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  );
}

function readLEUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>> 0
  );
}

function readLEInt16(data: Uint8Array, offset: number): number {
  return (data[offset]) | (data[offset + 1] << 8);
}

function measureNBTCompound(data: Uint8Array, offset: number): number {
  const start = offset;
  if (offset >= data.length || data[offset] !== 10) return 0;
  offset++;
  const rootNameLen = readLEInt16(data, offset);
  offset += 2 + rootNameLen;
  while (offset < data.length) {
    const tagType = data[offset]; offset++;
    if (tagType === 0) break;
    const nameLen = readLEInt16(data, offset); offset += 2 + nameLen;
    const skipLen = skipNBTPayload(tagType, data, offset);
    if (skipLen < 0) return 0;
    offset += skipLen;
  }
  return offset - start;
}

function skipNBTPayload(tagType: number, data: Uint8Array, offset: number): number {
  const start = offset;
  switch (tagType) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 4;
    case 4: return 8;
    case 5: return 4;
    case 6: return 8;
    case 7: { const len = readLEInt32(data, offset); return 4 + len; }
    case 8: { const len = readLEInt16(data, offset); return 2 + len; }
    case 9: {
      const listType = data[offset]; offset++;
      const listLen = readLEInt32(data, offset); offset += 4;
      for (let i = 0; i < listLen; i++) {
        const skip = skipNBTPayload(listType, data, offset);
        if (skip < 0) return -1;
        offset += skip;
      }
      return offset - start;
    }
    case 10: {
      while (offset < data.length) {
        const t = data[offset]; offset++;
        if (t === 0) break;
        const nl = readLEInt16(data, offset); offset += 2 + nl;
        const skip = skipNBTPayload(t, data, offset);
        if (skip < 0) return -1;
        offset += skip;
      }
      return offset - start;
    }
    case 11: { const len = readLEInt32(data, offset); return 4 + len * 4; }
    case 12: { const len = readLEInt32(data, offset); return 4 + len * 8; }
    default: return -1;
  }
}

function readPaletteEntryName(data: Uint8Array, offset: number): string | null {
  if (offset >= data.length || data[offset] !== 10) return null;
  offset++;
  const rootNameLen = readLEInt16(data, offset);
  offset += 2 + rootNameLen;
  while (offset < data.length) {
    const tagType = data[offset]; offset++;
    if (tagType === 0) break;
    const nameLen = readLEInt16(data, offset); offset += 2;
    const tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
    offset += nameLen;
    if (tagType === 8 && tagName === 'name') {
      const strLen = readLEInt16(data, offset); offset += 2;
      return new TextDecoder().decode(data.slice(offset, offset + strLen));
    }
    const skipLen = skipNBTPayload(tagType, data, offset);
    if (skipLen < 0) return null;
    offset += skipLen;
  }
  return null;
}

function getBlockFromSubchunk(data: Uint8Array, x: number, y: number, z: number): string | null {
  if (data.length < 2) return null;
  const version = data[0];
  if (version < 1 || version > 9) return null;

  let offset = 1;
  let numStorages = 1;
  if (version >= 8) { numStorages = data[1]; offset = 2; }
  if (version >= 9) { offset = 3; }
  if (numStorages < 1) return null;

  try {
    const bitsAndFlags = data[offset]; offset++;
    const bitsPerBlock = bitsAndFlags >> 1;

    if (bitsPerBlock === 0) {
      // Single-value palette
      readLEInt32(data, offset); offset += 4; // palette size (always 1)
      return readPaletteEntryName(data, offset);
    }

    const blocksPerWord = Math.floor(32 / bitsPerBlock);
    const wordCount = Math.ceil(4096 / blocksPerWord);
    const blockIndex = ((x * 16) + z) * 16 + y;
    const wordIndex = Math.floor(blockIndex / blocksPerWord);
    const bitOffset = (blockIndex % blocksPerWord) * bitsPerBlock;

    if (offset + wordIndex * 4 + 4 > data.length) return null;

    const word = readLEUint32(data, offset + wordIndex * 4);
    const mask = (1 << bitsPerBlock) - 1;
    const paletteIndex = (word >> bitOffset) & mask;

    offset += wordCount * 4;
    if (offset + 4 > data.length) return null;
    const paletteSize = readLEInt32(data, offset); offset += 4;

    for (let i = 0; i < paletteSize && i <= paletteIndex; i++) {
      const entryName = readPaletteEntryName(data, offset);
      const entrySize = measureNBTCompound(data, offset);
      if (entrySize === 0) return null;
      if (i === paletteIndex) return entryName;
      offset += entrySize;
    }
  } catch {
    return null;
  }
  return null;
}

function renderChunkIntoTile(
  subchunks: Map<number, Uint8Array>,
  pixels: Uint8ClampedArray,
  tilePixelWidth: number,
  chunkLocalX: number,  // 0..tileSize-1
  chunkLocalZ: number,
  heightRange: { min: number; max: number },
): void {
  const pxBaseX = chunkLocalX * 16;
  const pxBaseZ = chunkLocalZ * 16;

  const maxSubchunk = Math.floor(heightRange.max / 16);
  const minSubchunk = Math.floor(heightRange.min / 16);

  for (let bx = 0; bx < 16; bx++) {
    for (let bz = 0; bz < 16; bz++) {
      let found = false;
      for (let sy = maxSubchunk; sy >= minSubchunk && !found; sy--) {
        const subchunkData = subchunks.get(sy);
        if (!subchunkData) continue;
        const startY = Math.min(15, heightRange.max - sy * 16);
        const endY   = Math.max(0,  heightRange.min - sy * 16);
        for (let by = startY; by >= endY && !found; by--) {
          const blockName = getBlockFromSubchunk(subchunkData, bx, by, bz);
          if (blockName && !isTransparent(blockName)) {
            const color = getBlockColor(blockName);
            const idx = ((pxBaseZ + bz) * tilePixelWidth + (pxBaseX + bx)) * 4;
            pixels[idx]     = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
            pixels[idx + 3] = 255;
            found = true;
          }
        }
      }
      // If !found, the pixel stays transparent (already 0)
    }
  }
}

// ─── worker message handler ───────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<TileRenderRequest>) => {
  const { id, tileX, tileZ, tileSize, heightRange, chunks } = e.data;

  const tilePixelSize = tileSize * 16;
  const pixels = new Uint8ClampedArray(tilePixelSize * tilePixelSize * 4);
  // Pixels default to 0 (transparent) — missing chunks stay transparent

  // Collect all raw buffers for hashing
  const hashBuffers: Uint8Array[] = [];

  for (const chunk of chunks) {
    const subchunks = new Map<number, Uint8Array>();
    for (const sc of chunk.subchunks) {
      const buf = new Uint8Array(sc.data);
      subchunks.set(sc.index, buf);
      hashBuffers.push(buf);
    }
    const cx = tileX * tileSize + chunk.chunkLocalX;
    const cz = tileZ * tileSize + chunk.chunkLocalZ;
    try {
      renderChunkIntoTile(
        subchunks,
        pixels,
        tilePixelSize,
        chunk.chunkLocalX,
        chunk.chunkLocalZ,
        heightRange,
      );
    } catch (err) {
      console.error(`Chunk render error at tile (${tileX}, ${tileZ}), chunk (${cx}, ${cz}):`, err);
    }
  }

  const hash = fnv1a(hashBuffers);
  const resp: TileRenderResponse = { id, tileX, tileZ, pixels: pixels.buffer, hash };
  (self as unknown as Worker).postMessage(resp, [pixels.buffer]);
};
