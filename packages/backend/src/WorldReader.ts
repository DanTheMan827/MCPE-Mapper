import { ClassicLevel } from 'classic-level';
import { ChunkCoord, ChunkRenderData, HeightRange, MapMarker, WorldInfo } from '@mcpe-mapper/shared';
import { getBlockColor, isTransparent } from '@mcpe-mapper/shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads Minecraft Bedrock world data from an unpacked world directory.
 * Opens and closes the LevelDB as needed to avoid holding locks.
 */
export class WorldReader {
  private worldPath: string;
  private dbPath: string;

  constructor(worldPath: string) {
    this.worldPath = worldPath;
    this.dbPath = path.join(worldPath, 'db');
  }

  /**
   * Open the LevelDB, execute a function, then close it.
   */
  private async withDB<T>(fn: (db: ClassicLevel<Buffer, Buffer>) => Promise<T>): Promise<T> {
    const db = new ClassicLevel<Buffer, Buffer>(this.dbPath, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer',
      createIfMissing: false,
    });

    try {
      await db.open();
      const result = await fn(db);
      return result;
    } finally {
      try {
        await db.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  async getWorldInfo(): Promise<WorldInfo> {
    const levelDatPath = path.join(this.worldPath, 'level.dat');

    if (!fs.existsSync(levelDatPath)) {
      return {
        name: 'Unknown World',
        gameType: 0,
        spawnX: 0,
        spawnY: 64,
        spawnZ: 0,
        lastPlayed: 0,
      };
    }

    const data = fs.readFileSync(levelDatPath);
    return this.parseLevelDat(data);
  }

  private parseLevelDat(data: Buffer): WorldInfo {
    // Skip 8-byte header (version + length)
    let offset = 8;
    const info: WorldInfo = {
      name: 'Unknown World',
      gameType: 0,
      spawnX: 0,
      spawnY: 64,
      spawnZ: 0,
      lastPlayed: 0,
    };

    try {
      // TAG_Compound
      if (data[offset] !== 10) return info;
      offset++;

      // Root compound name
      const rootNameLen = data.readInt16LE(offset);
      offset += 2 + rootNameLen;

      // Read tags
      while (offset < data.length) {
        const tagType = data[offset];
        offset++;
        if (tagType === 0) break;

        const nameLen = data.readInt16LE(offset);
        offset += 2;
        const tagName = data.slice(offset, offset + nameLen).toString('utf8');
        offset += nameLen;

        const payload = this.readNBTPayload(tagType, data, offset);
        if (!payload) break;

        if (tagName === 'LevelName' && typeof payload.value === 'string') info.name = payload.value;
        if (tagName === 'GameType' && typeof payload.value === 'number') info.gameType = payload.value;
        if (tagName === 'SpawnX' && typeof payload.value === 'number') info.spawnX = payload.value;
        if (tagName === 'SpawnY' && typeof payload.value === 'number') info.spawnY = payload.value;
        if (tagName === 'SpawnZ' && typeof payload.value === 'number') info.spawnZ = payload.value;
        if (tagName === 'LastPlayed') info.lastPlayed = Number(payload.value);

        offset = payload.offset;
      }
    } catch {
      // Return partial info on parse error
    }

    return info;
  }

  private readNBTPayload(tagType: number, data: Buffer, offset: number): { value: unknown; offset: number } | null {
    if (offset >= data.length) return null;

    switch (tagType) {
      case 1: return { value: data[offset], offset: offset + 1 };
      case 2: return { value: data.readInt16LE(offset), offset: offset + 2 };
      case 3: return { value: data.readInt32LE(offset), offset: offset + 4 };
      case 4: return { value: data.readBigInt64LE(offset), offset: offset + 8 };
      case 5: return { value: data.readFloatLE(offset), offset: offset + 4 };
      case 6: return { value: data.readDoubleLE(offset), offset: offset + 8 };
      case 7: {
        const len = data.readInt32LE(offset);
        return { value: data.slice(offset + 4, offset + 4 + len), offset: offset + 4 + len };
      }
      case 8: {
        const len = data.readInt16LE(offset);
        return { value: data.slice(offset + 2, offset + 2 + len).toString('utf8'), offset: offset + 2 + len };
      }
      case 9: {
        const listType = data[offset];
        const listLen = data.readInt32LE(offset + 1);
        let pos = offset + 5;
        const list: unknown[] = [];
        for (let i = 0; i < listLen; i++) {
          const item = this.readNBTPayload(listType, data, pos);
          if (!item) break;
          list.push(item.value);
          pos = item.offset;
        }
        return { value: list, offset: pos };
      }
      case 10: {
        let pos = offset;
        const compound: Record<string, unknown> = {};
        while (pos < data.length) {
          const t = data[pos]; pos++;
          if (t === 0) break;
          const nl = data.readInt16LE(pos); pos += 2;
          const n = data.slice(pos, pos + nl).toString('utf8'); pos += nl;
          const p = this.readNBTPayload(t, data, pos);
          if (!p) break;
          compound[n] = p.value;
          pos = p.offset;
        }
        return { value: compound, offset: pos };
      }
      case 11: {
        const len = data.readInt32LE(offset);
        return { value: data.slice(offset + 4, offset + 4 + len * 4), offset: offset + 4 + len * 4 };
      }
      case 12: {
        const len = data.readInt32LE(offset);
        return { value: data.slice(offset + 4, offset + 4 + len * 8), offset: offset + 4 + len * 8 };
      }
      default: return null;
    }
  }

  async getChunks(coords: ChunkCoord[], dimension: number, heightRange: HeightRange): Promise<ChunkRenderData[]> {
    return this.withDB(async (db) => {
      const results: ChunkRenderData[] = [];

      for (const coord of coords) {
        const chunkData = await this.renderChunk(db, coord.x, coord.z, dimension, heightRange);
        if (chunkData) {
          results.push(chunkData);
        }
      }

      return results;
    });
  }

  private async renderChunk(
    db: ClassicLevel<Buffer, Buffer>,
    chunkX: number,
    chunkZ: number,
    dimension: number,
    heightRange: HeightRange
  ): Promise<ChunkRenderData | null> {
    // Collect subchunks
    const subchunks = new Map<number, Buffer>();

    const maxSubchunk = Math.floor(heightRange.max / 16);
    const minSubchunk = Math.floor(heightRange.min / 16);

    for (let sy = minSubchunk; sy <= maxSubchunk; sy++) {
      const key = this.makeChunkKey(chunkX, chunkZ, dimension, 0x2f, sy);
      try {
        const value = await db.get(key);
        subchunks.set(sy, value);
      } catch {
        // Key doesn't exist, skip
      }
    }

    if (subchunks.size === 0) return null;

    // Render top-down
    const pixels = new Uint8Array(16 * 16 * 4);
    this.renderTopDown(subchunks, pixels, heightRange);

    return { x: chunkX, z: chunkZ, pixels };
  }

  private makeChunkKey(x: number, z: number, dimension: number, tag: number, subchunkIdx?: number): Buffer {
    if (dimension === 0) {
      // Overworld: x(4) + z(4) + tag(1) [+ subchunk(1)]
      const buf = Buffer.alloc(subchunkIdx !== undefined ? 10 : 9);
      buf.writeInt32LE(x, 0);
      buf.writeInt32LE(z, 4);
      buf.writeUInt8(tag, 8);
      if (subchunkIdx !== undefined) buf.writeUInt8(subchunkIdx & 0xff, 9);
      return buf;
    } else {
      // Other: x(4) + z(4) + dim(4) + tag(1) [+ subchunk(1)]
      const buf = Buffer.alloc(subchunkIdx !== undefined ? 14 : 13);
      buf.writeInt32LE(x, 0);
      buf.writeInt32LE(z, 4);
      buf.writeInt32LE(dimension, 8);
      buf.writeUInt8(tag, 12);
      if (subchunkIdx !== undefined) buf.writeUInt8(subchunkIdx & 0xff, 13);
      return buf;
    }
  }

  private renderTopDown(subchunks: Map<number, Buffer>, pixels: Uint8Array, heightRange: HeightRange): void {
    for (let bx = 0; bx < 16; bx++) {
      for (let bz = 0; bz < 16; bz++) {
        let found = false;
        const maxSubchunk = Math.floor(heightRange.max / 16);
        const minSubchunk = Math.floor(heightRange.min / 16);

        for (let sy = maxSubchunk; sy >= minSubchunk && !found; sy--) {
          const subchunkData = subchunks.get(sy);
          if (!subchunkData) continue;

          const startY = Math.min(15, heightRange.max - sy * 16);
          const endY = Math.max(0, heightRange.min - sy * 16);

          for (let by = startY; by >= endY && !found; by--) {
            const blockName = this.getBlockFromSubchunk(subchunkData, bx, by, bz);
            if (blockName && !isTransparent(blockName)) {
              const color = getBlockColor(blockName);
              const idx = (bz * 16 + bx) * 4;
              pixels[idx] = color[0];
              pixels[idx + 1] = color[1];
              pixels[idx + 2] = color[2];
              pixels[idx + 3] = 255;
              found = true;
            }
          }
        }
      }
    }
  }

  private getBlockFromSubchunk(data: Buffer, x: number, y: number, z: number): string | null {
    if (data.length < 2) return null;

    const version = data[0];
    if (version < 1 || version > 9) return null;

    let offset = 1;
    let numStorages = 1;
    if (version >= 8) {
      numStorages = data[1];
      offset = 2;
    }

    if (numStorages < 1) return null;

    try {
      const bitsAndFlags = data[offset];
      offset++;
      const bitsPerBlock = bitsAndFlags >> 1;

      if (bitsPerBlock === 0) {
        // Single block palette
        const paletteSize = data.readInt32LE(offset);
        offset += 4;
        return this.readPaletteEntryName(data, offset);
      }

      const blocksPerWord = Math.floor(32 / bitsPerBlock);
      const wordCount = Math.ceil(4096 / blocksPerWord);
      const blockIndex = ((x * 16) + z) * 16 + y;
      const wordIndex = Math.floor(blockIndex / blocksPerWord);
      const bitOffset = (blockIndex % blocksPerWord) * bitsPerBlock;

      if (offset + wordIndex * 4 + 4 > data.length) return null;

      const word = data.readUInt32LE(offset + wordIndex * 4);
      const mask = (1 << bitsPerBlock) - 1;
      const paletteIndex = (word >> bitOffset) & mask;

      offset += wordCount * 4;

      if (offset + 4 > data.length) return null;
      const paletteSize = data.readInt32LE(offset);
      offset += 4;

      for (let i = 0; i < paletteSize && i <= paletteIndex; i++) {
        const entryName = this.readPaletteEntryName(data, offset);
        const entrySize = this.measureNBTCompound(data, offset);
        if (entrySize === 0) return null;
        if (i === paletteIndex) return entryName;
        offset += entrySize;
      }
    } catch {
      return null;
    }

    return null;
  }

  private readPaletteEntryName(data: Buffer, offset: number): string | null {
    if (offset >= data.length || data[offset] !== 10) return null;
    offset++;

    const rootNameLen = data.readInt16LE(offset);
    offset += 2 + rootNameLen;

    while (offset < data.length) {
      const tagType = data[offset]; offset++;
      if (tagType === 0) break;

      const nameLen = data.readInt16LE(offset); offset += 2;
      const tagName = data.slice(offset, offset + nameLen).toString('utf8');
      offset += nameLen;

      if (tagType === 8 && tagName === 'name') {
        const strLen = data.readInt16LE(offset); offset += 2;
        return data.slice(offset, offset + strLen).toString('utf8');
      } else {
        const skipLen = this.skipNBTPayload(tagType, data, offset);
        if (skipLen < 0) return null;
        offset += skipLen;
      }
    }
    return null;
  }

  private measureNBTCompound(data: Buffer, offset: number): number {
    const start = offset;
    if (offset >= data.length || data[offset] !== 10) return 0;
    offset++;

    const rootNameLen = data.readInt16LE(offset);
    offset += 2 + rootNameLen;

    while (offset < data.length) {
      const tagType = data[offset]; offset++;
      if (tagType === 0) break;
      const nameLen = data.readInt16LE(offset);
      offset += 2 + nameLen;
      const skipLen = this.skipNBTPayload(tagType, data, offset);
      if (skipLen < 0) return 0;
      offset += skipLen;
    }

    return offset - start;
  }

  private skipNBTPayload(tagType: number, data: Buffer, offset: number): number {
    const start = offset;
    switch (tagType) {
      case 1: return 1;
      case 2: return 2;
      case 3: return 4;
      case 4: return 8;
      case 5: return 4;
      case 6: return 8;
      case 7: { const len = data.readInt32LE(offset); return 4 + len; }
      case 8: { const len = data.readInt16LE(offset); return 2 + len; }
      case 9: {
        const listType = data[offset]; offset++;
        const listLen = data.readInt32LE(offset); offset += 4;
        for (let i = 0; i < listLen; i++) {
          const skip = this.skipNBTPayload(listType, data, offset);
          if (skip < 0) return -1;
          offset += skip;
        }
        return offset - start;
      }
      case 10: {
        while (offset < data.length) {
          const t = data[offset]; offset++;
          if (t === 0) break;
          const nl = data.readInt16LE(offset); offset += 2 + nl;
          const skip = this.skipNBTPayload(t, data, offset);
          if (skip < 0) return -1;
          offset += skip;
        }
        return offset - start;
      }
      case 11: { const len = data.readInt32LE(offset); return 4 + len * 4; }
      case 12: { const len = data.readInt32LE(offset); return 4 + len * 8; }
      default: return -1;
    }
  }

  async getMarkers(enablePortals: boolean, enablePlayers: boolean): Promise<MapMarker[]> {
    const markers: MapMarker[] = [];

    // Add spawn/player info
    if (enablePlayers) {
      const info = await this.getWorldInfo();
      markers.push({
        id: 'spawn',
        x: info.spawnX,
        y: info.spawnY,
        z: info.spawnZ,
        dimension: 0,
        type: 'player',
        label: 'World Spawn',
      });

      // Look for local player and multiplayer player data in DB
      await this.withDB(async (db) => {
        // Local player
        try {
          const playerKey = Buffer.from('~local_player');
          const playerData = await db.get(playerKey);
          const pos = this.parsePlayerPosition(playerData);
          if (pos) {
            markers.push({
              id: 'local_player',
              x: Math.floor(pos.x),
              y: Math.floor(pos.y),
              z: Math.floor(pos.z),
              dimension: pos.dimension,
              type: 'player',
              label: 'Player',
            });
          }
        } catch {
          // No local player data
        }

        // Multiplayer players (keys starting with "player_")
        try {
          const iterator = db.iterator();
          for await (const [key, value] of iterator) {
            const keyStr = key.toString('utf8');
            if (keyStr.startsWith('player_')) {
              const playerId = keyStr.slice('player_'.length);
              const pos = this.parsePlayerPosition(value);
              if (pos) {
                markers.push({
                  id: `player_${playerId}`,
                  x: Math.floor(pos.x),
                  y: Math.floor(pos.y),
                  z: Math.floor(pos.z),
                  dimension: pos.dimension,
                  type: 'player',
                  label: `Player ${playerId.slice(0, 8)}`,
                });
              }
            }
          }
          await iterator.close();
        } catch {
          // Error reading multiplayer data
        }
      });
    }

    // Find portals
    if (enablePortals) {
      await this.withDB(async (db) => {
        const iterator = db.iterator();
        try {
          for await (const [key, value] of iterator) {
            this.checkForPortalMarker(key, value, markers);
          }
        } finally {
          await iterator.close();
        }
      });
    }

    return markers;
  }

  private parsePlayerPosition(data: Buffer): { x: number; y: number; z: number; dimension: number } | null {
    // Player data is NBT compound with Pos list (3 floats) and DimensionId
    try {
      let offset = 0;
      if (data[offset] !== 10) return null;
      offset++;
      const rootNameLen = data.readInt16LE(offset);
      offset += 2 + rootNameLen;

      let x = 0, y = 0, z = 0, dimension = 0;
      let foundPos = false;

      while (offset < data.length) {
        const tagType = data[offset]; offset++;
        if (tagType === 0) break;
        const nameLen = data.readInt16LE(offset); offset += 2;
        const tagName = data.slice(offset, offset + nameLen).toString('utf8');
        offset += nameLen;

        if (tagType === 9 && tagName === 'Pos') {
          // List of floats
          const listType = data[offset]; offset++;
          const listLen = data.readInt32LE(offset); offset += 4;
          if (listType === 5 && listLen === 3) {
            x = data.readFloatLE(offset); offset += 4;
            y = data.readFloatLE(offset); offset += 4;
            z = data.readFloatLE(offset); offset += 4;
            foundPos = true;
          } else {
            for (let i = 0; i < listLen; i++) {
              const skip = this.skipNBTPayload(listType, data, offset);
              if (skip < 0) return null;
              offset += skip;
            }
          }
        } else if (tagType === 3 && tagName === 'DimensionId') {
          dimension = data.readInt32LE(offset); offset += 4;
        } else {
          const skip = this.skipNBTPayload(tagType, data, offset);
          if (skip < 0) return null;
          offset += skip;
        }
      }

      if (foundPos) return { x, y, z, dimension };
    } catch {
      // Parse error
    }
    return null;
  }

  private checkForPortalMarker(key: Buffer, value: Buffer, markers: MapMarker[]): void {
    if (key.length < 9) return;

    const x = key.readInt32LE(0);
    const z = key.readInt32LE(4);
    let tag: number;
    let dim = 0;

    if (key.length === 9 || key.length === 10) {
      tag = key[8];
    } else if (key.length >= 13) {
      dim = key.readInt32LE(8);
      tag = key[12];
    } else {
      return;
    }

    // Tag 49 (0x31) = BlockEntity
    if (tag !== 0x31) return;

    const text = value.toString('utf8');
    if (text.includes('NetherPortal') || text.includes('nether_portal')) {
      const id = `nether_portal_${x}_${z}_${dim}`;
      if (!markers.some(m => m.id === id)) {
        markers.push({
          id,
          x: x * 16 + 8,
          y: 64,
          z: z * 16 + 8,
          dimension: dim,
          type: 'nether_portal',
          label: 'Nether Portal',
        });
      }
    }

    if (text.includes('EndPortal') || text.includes('end_portal')) {
      const id = `end_portal_${x}_${z}_${dim}`;
      if (!markers.some(m => m.id === id)) {
        markers.push({
          id,
          x: x * 16 + 8,
          y: 64,
          z: z * 16 + 8,
          dimension: dim,
          type: 'end_portal',
          label: 'End Portal',
        });
      }
    }
  }

  async getModifiedChunks(_since: number): Promise<ChunkCoord[]> {
    // Check DB file modification times
    try {
      const files = fs.readdirSync(this.dbPath);
      const modifiedChunks: ChunkCoord[] = [];

      for (const file of files) {
        if (file.endsWith('.log')) {
          const stat = fs.statSync(path.join(this.dbPath, file));
          if (stat.mtimeMs > _since) {
            // Log file was modified - we can't easily determine which chunks
            // For now, signal a generic update
            modifiedChunks.push({ x: 0, z: 0 }); // Placeholder
            break;
          }
        }
      }

      return modifiedChunks;
    } catch {
      return [];
    }
  }
}
