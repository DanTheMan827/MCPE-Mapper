import { ChunkCoord, ChunkRenderData, HeightRange, MapMarker, WorldInfo } from '@mcpe-mapper/shared';
import { getBlockColor, isTransparent } from '@mcpe-mapper/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * Reads Minecraft Bedrock world data from an unpacked world directory.
 * All LevelDB files are loaded into memory; the on-disk files are only read,
 * never modified. Supports periodic refresh to pick up external changes.
 */
export class WorldReader {
  private worldPath: string;
  private dbPath: string;
  /** In-memory key-value store parsed from LevelDB files */
  private parsedKeys: Map<string, Buffer> = new Map();
  /** Chunk index: "x,z,dim" → set of key hex strings with subchunk data */
  private chunkIndex: Map<string, Set<string>> = new Map();
  private loaded = false;

  constructor(worldPath: string) {
    this.worldPath = worldPath;
    this.dbPath = path.join(worldPath, 'db');
  }

  /**
   * Load all LevelDB files from disk into memory.
   * Can be called multiple times to refresh data.
   */
  async load(): Promise<void> {
    this.parsedKeys.clear();
    this.chunkIndex.clear();

    if (!fs.existsSync(this.dbPath)) {
      this.loaded = true;
      return;
    }

    const files = fs.readdirSync(this.dbPath);

    // Parse .ldb/.sst files (sorted tables)
    for (const file of files) {
      if (file.endsWith('.ldb') || file.endsWith('.sst')) {
        const data = fs.readFileSync(path.join(this.dbPath, file));
        this.parseLDBFile(data);
      }
    }

    // Parse .log files (write-ahead log) for most recent data
    for (const file of files) {
      if (file.endsWith('.log')) {
        const data = fs.readFileSync(path.join(this.dbPath, file));
        this.parseLogFile(data);
      }
    }

    this.loaded = true;
  }

  /**
   * Ensure data is loaded.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Close / release resources.
   */
  async close(): Promise<void> {
    this.parsedKeys.clear();
    this.chunkIndex.clear();
    this.loaded = false;
  }

  // ─── LDB (SSTable) Parsing ────────────────────────────────────────────

  private parseLDBFile(data: Buffer): void {
    if (data.length < 48) return;

    try {
      // Read footer (last 48 bytes)
      const footerOffset = data.length - 48;

      // Check magic number
      const magic1 = data.readUInt32LE(footerOffset + 40);
      const magic2 = data.readUInt32LE(footerOffset + 44);
      if (magic1 !== 0x8b80fb57 || magic2 !== 0xdb477524) return;

      // Read index block handle from footer
      let pos = footerOffset;
      // Skip metaindex handle
      const { value: _metaOffset, bytesRead: b1 } = this.readVarint(data, pos);
      pos += b1;
      const { value: _metaSize, bytesRead: b2 } = this.readVarint(data, pos);
      pos += b2;

      // Read index handle
      const { value: indexOffset, bytesRead: b3 } = this.readVarint(data, pos);
      pos += b3;
      const { value: indexSize, bytesRead: b4 } = this.readVarint(data, pos);
      pos += b4;

      if (indexOffset + indexSize > data.length) return;
      const indexBlock = this.readBlock(data, indexOffset, indexSize);
      if (!indexBlock) return;

      this.parseIndexBlock(indexBlock, data);
    } catch {
      // Silently skip corrupt table files
    }
  }

  private readBlock(data: Buffer, offset: number, size: number): Buffer | null {
    if (offset + size + 1 > data.length) return null;
    const compressionType = data[offset + size];
    const raw = data.slice(offset, offset + size);

    if (compressionType === 0) return raw;

    // Try zlib raw inflate then regular inflate
    try {
      return Buffer.from(zlib.inflateRawSync(raw));
    } catch { /* fall through */ }
    try {
      return Buffer.from(zlib.inflateSync(raw));
    } catch { /* fall through */ }
    return null;
  }

  private parseIndexBlock(indexBlock: Buffer, fullData: Buffer): void {
    let pos = 0;
    let prevKey = Buffer.alloc(0);

    if (indexBlock.length < 4) return;
    const numRestarts = indexBlock.readUInt32LE(indexBlock.length - 4);
    const dataEnd = indexBlock.length - 4 - numRestarts * 4;

    while (pos < dataEnd) {
      try {
        const { value: shared, bytesRead: b1 } = this.readVarint(indexBlock, pos);
        if (shared > prevKey.length) break;
        pos += b1;

        const { value: unshared, bytesRead: b2 } = this.readVarint(indexBlock, pos);
        pos += b2;

        const { value: valueLen, bytesRead: b3 } = this.readVarint(indexBlock, pos);
        pos += b3;

        if (pos + unshared + valueLen > dataEnd) break;
        if (unshared > 10000 || valueLen > 100) break;

        const key = Buffer.alloc(shared + unshared);
        prevKey.copy(key, 0, 0, shared);
        indexBlock.copy(key, shared, pos, pos + unshared);
        pos += unshared;
        prevKey = key;

        const handleData = indexBlock.slice(pos, pos + valueLen);
        pos += valueLen;

        const { value: blockOffset, bytesRead: hb1 } = this.readVarint(handleData, 0);
        const { value: blockSize } = this.readVarint(handleData, hb1);

        if (blockOffset + blockSize <= fullData.length) {
          const decompressed = this.readBlock(fullData, blockOffset, blockSize);
          if (decompressed) {
            this.parseDataBlock(decompressed);
          }
        }
      } catch {
        break;
      }
    }
  }

  private parseDataBlock(block: Buffer): void {
    let pos = 0;
    let prevKey = Buffer.alloc(0);

    if (block.length < 4) return;
    const numRestarts = block.readUInt32LE(block.length - 4);
    const dataEnd = block.length - 4 - numRestarts * 4;

    while (pos < dataEnd) {
      try {
        const { value: shared, bytesRead: b1 } = this.readVarint(block, pos);
        pos += b1;
        if (pos >= dataEnd) break;

        const { value: unshared, bytesRead: b2 } = this.readVarint(block, pos);
        pos += b2;
        if (pos >= dataEnd) break;

        const { value: valueLen, bytesRead: b3 } = this.readVarint(block, pos);
        pos += b3;

        if (unshared > 100000 || valueLen > 10000000 || shared > prevKey.length) break;
        if (pos + unshared + valueLen > dataEnd) break;

        const fullKey = Buffer.alloc(shared + unshared);
        prevKey.copy(fullKey, 0, 0, shared);
        block.copy(fullKey, shared, pos, pos + unshared);
        pos += unshared;
        prevKey = fullKey;

        const value = block.slice(pos, pos + valueLen);
        pos += valueLen;

        // Internal key: user_key (N-8 bytes) + sequence|type (8 bytes)
        if (fullKey.length > 8) {
          const typeVal = fullKey[fullKey.length - 8] & 0xff;
          if (typeVal === 1) {
            const userKey = fullKey.slice(0, fullKey.length - 8);
            this.storeKey(userKey, value);
          }
        }
      } catch {
        break;
      }
    }
  }

  // ─── Log (WAL) Parsing ────────────────────────────────────────────────

  private parseLogFile(data: Buffer): void {
    const BLOCK_SIZE = 32768;
    let offset = 0;

    while (offset < data.length) {
      const blockEnd = Math.min(offset + BLOCK_SIZE, data.length);
      let pos = offset;

      while (pos + 7 <= blockEnd) {
        const length = data.readUInt16LE(pos + 4);
        const type = data[pos + 6];
        pos += 7;
        if (pos + length > blockEnd) break;

        if (type === 1 || type === 2 || type === 3) {
          const recordData = data.slice(pos, pos + length);
          this.parseWriteBatch(recordData);
        }
        pos += length;
      }

      offset = blockEnd;
    }
  }

  private parseWriteBatch(data: Buffer): void {
    if (data.length < 12) return;
    const count = data.readUInt32LE(8);
    let pos = 12;

    for (let i = 0; i < count && pos < data.length; i++) {
      const type = data[pos];
      pos++;

      if (type === 1) {
        const { value: keyLen, bytesRead: b1 } = this.readVarint(data, pos);
        pos += b1;
        if (pos + keyLen > data.length) break;
        const key = data.slice(pos, pos + keyLen);
        pos += keyLen;

        const { value: valLen, bytesRead: b2 } = this.readVarint(data, pos);
        pos += b2;
        if (pos + valLen > data.length) break;
        const value = data.slice(pos, pos + valLen);
        pos += valLen;

        this.storeKey(key, value);
      } else if (type === 0) {
        const { value: keyLen, bytesRead: b1 } = this.readVarint(data, pos);
        pos += b1;
        pos += keyLen;
      } else {
        break;
      }
    }
  }

  // ─── Key Storage & Indexing ───────────────────────────────────────────

  private storeKey(key: Buffer, value: Buffer): void {
    const keyHex = key.toString('hex');
    this.parsedKeys.set(keyHex, value);
    this.indexChunkKey(key, keyHex);
  }

  private indexChunkKey(key: Buffer, keyHex: string): void {
    if (key.length < 9) return;

    const x = key.readInt32LE(0);
    const z = key.readInt32LE(4);

    // Overworld subchunk key: length 9-14, tag 0x2f at offset 8
    if (key.length >= 9 && key.length <= 14 && key[8] === 0x2f) {
      const indexKey = `${x},${z},0`;
      let set = this.chunkIndex.get(indexKey);
      if (!set) { set = new Set(); this.chunkIndex.set(indexKey, set); }
      set.add(keyHex);
      return;
    }

    // Other dimensions: length >= 13, dim at offset 8, tag 0x2f at offset 12
    if (key.length >= 13) {
      const dim = key.readInt32LE(8);
      if (key[12] === 0x2f) {
        const indexKey = `${x},${z},${dim}`;
        let set = this.chunkIndex.get(indexKey);
        if (!set) { set = new Set(); this.chunkIndex.set(indexKey, set); }
        set.add(keyHex);
      }
    }
  }

  private readVarint(data: Buffer, offset: number): { value: number; bytesRead: number } {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;
    while (offset < data.length) {
      const b = data[offset];
      offset++;
      bytesRead++;
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (bytesRead > 5) break;
    }
    return { value: result >>> 0, bytesRead };
  }

  // ─── Public API ───────────────────────────────────────────────────────

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
      if (data[offset] !== 10) return info;
      offset++;

      const rootNameLen = data.readInt16LE(offset);
      offset += 2 + rootNameLen;

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
        if (tagName === 'SpawnY' && typeof payload.value === 'number') {
          info.spawnY = payload.value === 32767 ? 64 : payload.value;
        }
        if (tagName === 'SpawnZ' && typeof payload.value === 'number') info.spawnZ = payload.value;
        if (tagName === 'LastPlayed') info.lastPlayed = Number(payload.value);

        offset = payload.offset;
      }
    } catch {
      // Return partial info on parse error
    }

    return info;
  }

  async getChunks(coords: ChunkCoord[], dimension: number, heightRange: HeightRange): Promise<ChunkRenderData[]> {
    await this.ensureLoaded();
    const results: ChunkRenderData[] = [];

    for (const coord of coords) {
      const chunkData = this.renderChunk(coord.x, coord.z, dimension, heightRange);
      if (chunkData) {
        results.push(chunkData);
      }
    }

    return results;
  }

  private renderChunk(
    chunkX: number,
    chunkZ: number,
    dimension: number,
    heightRange: HeightRange
  ): ChunkRenderData | null {
    const indexKey = `${chunkX},${chunkZ},${dimension}`;
    const chunkKeySet = this.chunkIndex.get(indexKey);
    if (!chunkKeySet || chunkKeySet.size === 0) return null;

    // Collect subchunks
    const subchunks = new Map<number, Buffer>();

    for (const keyHex of chunkKeySet) {
      const value = this.parsedKeys.get(keyHex);
      if (!value) continue;

      const key = Buffer.from(keyHex, 'hex');
      let subchunkIdx: number | undefined;

      if (dimension === 0) {
        if (key.length >= 10) subchunkIdx = key.readInt8(9);
      } else {
        if (key.length >= 14) subchunkIdx = key.readInt8(13);
      }

      if (subchunkIdx !== undefined) {
        subchunks.set(subchunkIdx, value);
      }
    }

    if (subchunks.size === 0) return null;

    // Render top-down
    const pixels = new Uint8Array(16 * 16 * 4);
    this.renderTopDown(subchunks, pixels, heightRange);

    return { x: chunkX, z: chunkZ, pixels };
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
    // Version 9 adds an extra subchunk-Y index byte after num_storages (before the first storage).
    if (version >= 9) {
      offset = 3;
    }

    if (numStorages < 1) return null;

    try {
      const bitsAndFlags = data[offset];
      offset++;
      const bitsPerBlock = bitsAndFlags >> 1;

      if (bitsPerBlock === 0) {
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

  // ─── Markers ──────────────────────────────────────────────────────────

  async getMarkers(enablePortals: boolean, enablePlayers: boolean): Promise<MapMarker[]> {
    await this.ensureLoaded();
    const markers: MapMarker[] = [];

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

      // Look for player keys in parsed data
      for (const [keyHex, value] of this.parsedKeys) {
        const key = Buffer.from(keyHex, 'hex');
        try {
          const keyStr = key.toString('utf8');
          if (keyStr === '~local_player') {
            const parsed = this.parsePlayerPosition(value);
            if (parsed) {
              markers.push({
                id: 'local_player',
                x: Math.floor(parsed.x),
                y: Math.floor(parsed.y),
                z: Math.floor(parsed.z),
                dimension: parsed.dimension,
                type: 'player',
                label: parsed.name ?? 'Player',
              });
            }
          } else if (keyStr.startsWith('player_')) {
            const playerId = keyStr.slice('player_'.length);
            const parsed = this.parsePlayerPosition(value);
            if (parsed) {
              markers.push({
                id: `player_${playerId}`,
                x: Math.floor(parsed.x),
                y: Math.floor(parsed.y),
                z: Math.floor(parsed.z),
                dimension: parsed.dimension,
                type: 'player',
                label: parsed.name ?? `Player ${playerId.slice(0, 8)}`,
              });
            }
          }
        } catch {
          // Not a text key
        }
      }
    }

    if (enablePortals) {
      for (const [keyHex, value] of this.parsedKeys) {
        const key = Buffer.from(keyHex, 'hex');
        this.checkForPortalMarker(key, value, markers);
        this.checkForBannerMarker(key, value, markers);
      }
    }

    return markers;
  }

  private parsePlayerPosition(data: Buffer): { x: number; y: number; z: number; dimension: number; name?: string } | null {
    try {
      let offset = 0;
      if (data[offset] !== 10) return null;
      offset++;
      const rootNameLen = data.readInt16LE(offset);
      offset += 2 + rootNameLen;

      let x = 0, y = 0, z = 0, dimension = 0;
      let foundPos = false;
      let name: string | undefined;

      while (offset < data.length) {
        const tagType = data[offset]; offset++;
        if (tagType === 0) break;
        const nameLen = data.readInt16LE(offset); offset += 2;
        const tagName = data.slice(offset, offset + nameLen).toString('utf8');
        offset += nameLen;

        if (tagType === 9 && tagName === 'Pos') {
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
        } else if (tagType === 8 && (tagName === 'Username' || tagName === 'Name')) {
          const strLen = data.readInt16LE(offset); offset += 2;
          if (!name) name = data.slice(offset, offset + strLen).toString('utf8');
          offset += strLen;
        } else {
          const skip = this.skipNBTPayload(tagType, data, offset);
          if (skip < 0) return null;
          offset += skip;
        }
      }

      if (foundPos) return { x, y, z, dimension, name };
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

  private checkForBannerMarker(key: Buffer, value: Buffer, markers: MapMarker[]): void {
    if (key.length < 9) return;

    const kx = key.readInt32LE(0);
    const kz = key.readInt32LE(4);
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

    if (tag !== 0x31) return;

    const text = value.toString('utf8');
    if (!text.includes('Banner')) return;

    try {
      let offset = 0;
      if (value[offset] !== 10) return;
      offset++;
      const rootNameLen = value.readInt16LE(offset);
      offset += 2 + rootNameLen;

      let bx = kx * 16, by = 64, bz = kz * 16;
      let id = '';
      let customName: string | undefined;

      while (offset < value.length) {
        const tagType = value[offset]; offset++;
        if (tagType === 0) break;
        const nameLen = value.readInt16LE(offset); offset += 2;
        const tagName = value.slice(offset, offset + nameLen).toString('utf8');
        offset += nameLen;

        if (tagType === 3 && tagName === 'x') {
          bx = value.readInt32LE(offset); offset += 4;
        } else if (tagType === 3 && tagName === 'y') {
          by = value.readInt32LE(offset); offset += 4;
        } else if (tagType === 3 && tagName === 'z') {
          bz = value.readInt32LE(offset); offset += 4;
        } else if (tagType === 8 && tagName === 'id') {
          const strLen = value.readInt16LE(offset); offset += 2;
          id = value.slice(offset, offset + strLen).toString('utf8');
          offset += strLen;
        } else if (tagType === 8 && tagName === 'CustomName') {
          const strLen = value.readInt16LE(offset); offset += 2;
          const raw = value.slice(offset, offset + strLen).toString('utf8');
          offset += strLen;
          try {
            const parsed = JSON.parse(raw) as { text?: string };
            customName = typeof parsed.text === 'string' ? parsed.text : raw;
          } catch {
            customName = raw;
          }
        } else {
          const skip = this.skipNBTPayload(tagType, value, offset);
          if (skip < 0) return;
          offset += skip;
        }
      }

      if (id === 'Banner' && customName) {
        const markerId = `banner_${bx}_${by}_${bz}_${dim}`;
        if (!markers.some(m => m.id === markerId)) {
          markers.push({
            id: markerId,
            x: bx,
            y: by,
            z: bz,
            dimension: dim,
            type: 'banner',
            label: customName,
          });
        }
      }
    } catch {
      // Parse error — ignore
    }
  }
}
