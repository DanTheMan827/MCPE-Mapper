import JSZip from 'jszip';
import pako from 'pako';
import { ChunkRenderData, HeightRange, MapMarker, WorldInfo } from '@mcpe-mapper/shared';
import { getBlockColor, isTransparent } from '@mcpe-mapper/shared';

/**
 * Offline world reader that parses .mcworld files in the browser.
 * Uses JSZip to read the zip contents and a simplified LevelDB parser
 * to extract chunk data.
 */
export class OfflineWorldReader {
  private zip: JSZip | null = null;
  private dbFiles: Map<string, Uint8Array> = new Map();
  private worldInfo: WorldInfo | null = null;
  private chunkCache: Map<string, ChunkRenderData> = new Map();
  private parsedKeys: Map<string, Uint8Array> = new Map();
  private dbParsed = false;
  /** Index mapping "chunkX,chunkZ,dimension" to set of subchunk key hex strings */
  private chunkIndex: Map<string, Set<string>> = new Map();

  async loadFile(file: File): Promise<WorldInfo> {
    this.zip = await JSZip.loadAsync(file);
    this.dbFiles.clear();
    this.parsedKeys.clear();
    this.chunkCache.clear();
    this.chunkIndex.clear();
    this.dbParsed = false;

    // Load DB files into memory
    const entries = Object.entries(this.zip.files);
    for (const [path, zipEntry] of entries) {
      if (path.startsWith('__MACOSX')) continue;
      if (path.startsWith('db/') || path.match(/^[^/]+\/db\//)) {
        const data = await zipEntry.async('uint8array');
        // Normalize path to just be relative to db/
        const normalizedPath = path.replace(/^[^/]*\//, '').replace(/^db\//, '');
        this.dbFiles.set(normalizedPath, data);
      }
    }

    // Parse level.dat for world info
    this.worldInfo = await this.parseLevelDat();

    // Parse the LevelDB files
    await this.parseDB();

    return this.worldInfo;
  }

  private async parseLevelDat(): Promise<WorldInfo> {
    if (!this.zip) throw new Error('No file loaded');

    let levelDatEntry = this.zip.file('level.dat');
    if (!levelDatEntry) {
      // Try to find it in a subdirectory
      const files = Object.keys(this.zip.files);
      const levelDatPath = files.find(f => f.endsWith('level.dat') && !f.includes('__MACOSX') && !f.endsWith('_old'));
      if (levelDatPath) {
        levelDatEntry = this.zip.file(levelDatPath);
      }
    }

    if (!levelDatEntry) {
      return { name: 'Unknown World', gameType: 0, spawnX: 0, spawnY: 64, spawnZ: 0, lastPlayed: 0 };
    }

    const data = await levelDatEntry.async('uint8array');
    // Bedrock level.dat has 8 byte header (version + length), then NBT
    return this.parseNBTLevelDat(data);
  }

  private parseNBTLevelDat(data: Uint8Array): WorldInfo {
    // Skip 8-byte header
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
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
      // Parse compound tag
      const result = this.readNBTCompound(view, offset, data);
      if (result) {
        const compound = result.value;
        if (compound['LevelName']) info.name = compound['LevelName'] as string;
        if (compound['GameType'] !== undefined) info.gameType = compound['GameType'] as number;
        if (compound['SpawnX'] !== undefined) info.spawnX = compound['SpawnX'] as number;
        if (compound['SpawnY'] !== undefined) {
          const rawSpawnY = compound['SpawnY'] as number;
          // 32767 (0x7FFF) means "auto/surface level" in Bedrock Edition
          info.spawnY = rawSpawnY === 32767 ? 64 : rawSpawnY;
        }
        if (compound['SpawnZ'] !== undefined) info.spawnZ = compound['SpawnZ'] as number;
        if (compound['LastPlayed'] !== undefined) info.lastPlayed = Number(compound['LastPlayed']);
      }
    } catch {
      // NBT parsing failure is not fatal
    }

    return info;
  }

  private readNBTCompound(view: DataView, offset: number, data: Uint8Array): { value: Record<string, unknown>; offset: number } | null {
    // First byte should be TAG_Compound (10)
    if (offset >= data.length) return null;
    const tagType = data[offset];
    offset++;

    if (tagType !== 10) return null;

    // Read name
    const nameLen = view.getInt16(offset, true);
    offset += 2;
    offset += nameLen; // Skip root compound name

    return this.readCompoundPayload(view, offset, data);
  }

  private readCompoundPayload(view: DataView, offset: number, data: Uint8Array): { value: Record<string, unknown>; offset: number } {
    const result: Record<string, unknown> = {};

    while (offset < data.length) {
      const tagType = data[offset];
      offset++;
      if (tagType === 0) break; // TAG_End

      // Read tag name
      const nameLen = view.getInt16(offset, true);
      offset += 2;
      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      // Read payload based on type
      const payload = this.readNBTPayload(tagType, view, offset, data);
      if (!payload) break;
      result[name] = payload.value;
      offset = payload.offset;
    }

    return { value: result, offset };
  }

  private readNBTPayload(tagType: number, view: DataView, offset: number, data: Uint8Array): { value: unknown; offset: number } | null {
    if (offset >= data.length) return null;

    switch (tagType) {
      case 1: // TAG_Byte
        return { value: data[offset], offset: offset + 1 };
      case 2: // TAG_Short
        return { value: view.getInt16(offset, true), offset: offset + 2 };
      case 3: // TAG_Int
        return { value: view.getInt32(offset, true), offset: offset + 4 };
      case 4: { // TAG_Long
        const lo = view.getUint32(offset, true);
        const hi = view.getInt32(offset + 4, true);
        return { value: BigInt(hi) * BigInt(0x100000000) + BigInt(lo), offset: offset + 8 };
      }
      case 5: // TAG_Float
        return { value: view.getFloat32(offset, true), offset: offset + 4 };
      case 6: // TAG_Double
        return { value: view.getFloat64(offset, true), offset: offset + 8 };
      case 7: { // TAG_Byte_Array
        const len = view.getInt32(offset, true);
        offset += 4;
        return { value: data.slice(offset, offset + len), offset: offset + len };
      }
      case 8: { // TAG_String
        const len = view.getInt16(offset, true);
        offset += 2;
        const str = new TextDecoder().decode(data.slice(offset, offset + len));
        return { value: str, offset: offset + len };
      }
      case 9: { // TAG_List
        const listType = data[offset];
        offset++;
        const listLen = view.getInt32(offset, true);
        offset += 4;
        const list: unknown[] = [];
        for (let i = 0; i < listLen; i++) {
          const item = this.readNBTPayload(listType, view, offset, data);
          if (!item) break;
          list.push(item.value);
          offset = item.offset;
        }
        return { value: list, offset };
      }
      case 10: { // TAG_Compound
        const compound = this.readCompoundPayload(view, offset, data);
        return compound;
      }
      case 11: { // TAG_Int_Array
        const len = view.getInt32(offset, true);
        offset += 4;
        const arr: number[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(view.getInt32(offset, true));
          offset += 4;
        }
        return { value: arr, offset };
      }
      case 12: { // TAG_Long_Array
        const len = view.getInt32(offset, true);
        offset += 4;
        return { value: data.slice(offset, offset + len * 8), offset: offset + len * 8 };
      }
      default:
        return null;
    }
  }

  private async parseDB(): Promise<void> {
    if (this.dbParsed) return;

    // Parse LDB files (sorted table files), yielding between each file so the
    // event loop can process UI updates and prevent the page from hanging.
    for (const [filename, data] of this.dbFiles) {
      if (filename.endsWith('.ldb') || filename.endsWith('.sst')) {
        this.parseLDBFile(data);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    // Parse log file (WAL - write-ahead log) for recent data
    for (const [filename, data] of this.dbFiles) {
      if (filename.endsWith('.log')) {
        this.parseLogFile(data);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    this.dbParsed = true;
  }

  private parseLDBFile(data: Uint8Array): void {
    // LevelDB Table format:
    // The footer is the last 48 bytes, containing handles to meta-index and index blocks
    if (data.length < 48) return;

    try {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      // Read footer (last 48 bytes)
      const footerOffset = data.length - 48;

      // Check magic number (last 8 bytes of footer)
      // LevelDB table magic: 0xdb4775248b80fb57 stored as two LE uint32s
      const magic1 = view.getUint32(footerOffset + 40, true);
      const magic2 = view.getUint32(footerOffset + 44, true);
      if (magic1 !== 0x8b80fb57 || magic2 !== 0xdb477524) {
        // Not a valid table file, skip
        return;
      }

      // Read index block handle from footer
      // metaindex handle is first, then index handle
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

      void _metaOffset;
      void _metaSize;

      // Read index block
      if (indexOffset + indexSize > data.length) return;
      const indexBlock = this.readBlock(data, view, indexOffset, indexSize);
      if (!indexBlock) return;

      // Parse index block entries to find data blocks
      this.parseIndexBlock(indexBlock, data, view);
    } catch {
      // Silently skip corrupt table files
    }
  }

  private readBlock(data: Uint8Array, _view: DataView, offset: number, size: number): Uint8Array | null {
    // Block format on disk: data[size] + compression_type[1] + crc[4]
    if (offset + size + 1 > data.length) return null;
    const compressionType = data[offset + size];
    const raw = data.slice(offset, offset + size);

    if (compressionType === 0) {
      // No compression
      return raw;
    }

    // Compression types 2 and 4 (zlib raw deflate) used by Bedrock LevelDB
    try {
      return pako.inflateRaw(raw);
    } catch {
      // Fall through
    }
    try {
      return pako.inflate(raw);
    } catch {
      // Fall through
    }
    return null;
  }

  private parseIndexBlock(indexBlock: Uint8Array, fullData: Uint8Array, fullView: DataView): void {
    // Index block entries point to data blocks
    // Each entry: shared_bytes (varint), unshared_bytes (varint), value_length (varint), key_delta, value
    // The value in index entries is a BlockHandle (offset varint, size varint)
    let pos = 0;
    let prevKey = new Uint8Array(0);

    // Read restart count from end of block to determine data region
    if (indexBlock.length < 4) return;
    const ibView = new DataView(indexBlock.buffer, indexBlock.byteOffset, indexBlock.byteLength);
    const numRestarts = ibView.getUint32(indexBlock.length - 4, true);
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
        if (unshared > 10000 || valueLen > 100) break; // Sanity check

        // Reconstruct key
        const key = new Uint8Array(shared + unshared);
        key.set(prevKey.slice(0, shared), 0);
        key.set(indexBlock.slice(pos, pos + unshared), shared);
        pos += unshared;
        prevKey = key;

        // Value is a block handle
        const handleData = indexBlock.slice(pos, pos + valueLen);
        pos += valueLen;

        // Parse block handle
        const { value: blockOffset, bytesRead: hb1 } = this.readVarint(handleData, 0);
        const { value: blockSize, bytesRead: hb2 } = this.readVarint(handleData, hb1);
        void hb2;

        if (blockOffset + blockSize <= fullData.length) {
          // Decompress and parse this data block
          const decompressed = this.readBlock(fullData, fullView, blockOffset, blockSize);
          if (decompressed) {
            this.parseDataBlock(decompressed);
          }
        }
      } catch {
        break;
      }
    }
  }

  private parseDataBlock(block: Uint8Array): void {
    // Data block entries: shared_bytes, unshared_bytes, value_length, key_delta, value
    let pos = 0;
    let prevKey = new Uint8Array(0);

    // Find num_restarts at end
    if (block.length < 4) return;
    const restartView = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const numRestarts = restartView.getUint32(block.length - 4, true);
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

        // Reconstruct key (internal key = user_key + 8 bytes sequence/type)
        const fullKey = new Uint8Array(shared + unshared);
        fullKey.set(prevKey.slice(0, shared), 0);
        fullKey.set(block.slice(pos, pos + unshared), shared);
        pos += unshared;
        prevKey = fullKey;

        // Value
        const value = block.slice(pos, pos + valueLen);
        pos += valueLen;

        // Internal key: user_key (N-8 bytes) + sequence|type (8 bytes)
        if (fullKey.length > 8) {
          const userKey = fullKey.slice(0, fullKey.length - 8);
          // Check the type byte (lowest byte of the 8-byte trailer)
          const typeAndSeq = new DataView(fullKey.buffer, fullKey.byteOffset + fullKey.length - 8, 8);
          const typeVal = typeAndSeq.getUint8(0) & 0xff;
          // type 1 = value, type 0 = deletion
          if (typeVal === 1) {
            this.storeKey(userKey, value);
          }
        }
      } catch {
        break;
      }
    }
  }

  private parseLogFile(data: Uint8Array): void {
    // LevelDB log format: sequence of 32KB blocks, each containing records
    // Record: checksum (4), length (2), type (1), data
    const BLOCK_SIZE = 32768;
    let offset = 0;

    while (offset < data.length) {
      const blockEnd = Math.min(offset + BLOCK_SIZE, data.length);

      let pos = offset;
      while (pos + 7 <= blockEnd) {
        const view = new DataView(data.buffer, data.byteOffset + pos, Math.min(7, data.length - pos));
        // const checksum = view.getUint32(0, true);
        const length = view.getUint16(4, true);
        const type = view.getUint8(6);

        pos += 7;
        if (pos + length > blockEnd) break;

        if (type === 1 || type === 2 || type === 3) {
          // Full record or first/middle/last of fragmented
          const recordData = data.slice(pos, pos + length);
          this.parseWriteBatch(recordData);
        }

        pos += length;
      }

      offset = blockEnd;
    }
  }

  private parseWriteBatch(data: Uint8Array): void {
    // WriteBatch format: sequence (8 bytes), count (4 bytes), then entries
    if (data.length < 12) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // const sequence = view.getBigUint64(0, true); // unused
    const count = view.getUint32(8, true);
    let pos = 12;

    for (let i = 0; i < count && pos < data.length; i++) {
      const type = data[pos];
      pos++;

      if (type === 1) {
        // Put: key_length (varint), key, value_length (varint), value
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
        // Delete
        const { value: keyLen, bytesRead: b1 } = this.readVarint(data, pos);
        pos += b1;
        pos += keyLen;
      } else {
        break;
      }
    }
  }

  private storeKey(key: Uint8Array, value: Uint8Array): void {
    const keyStr = this.keyToString(key);
    this.parsedKeys.set(keyStr, value);
    // Index subchunk keys for fast chunk lookup
    this.indexChunkKey(key, keyStr);
  }

  /**
   * Index a key into the chunk index if it's a subchunk key.
   */
  private indexChunkKey(key: Uint8Array, keyHex: string): void {
    if (key.length < 9) return;

    const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
    const x = view.getInt32(0, true);
    const z = view.getInt32(4, true);

    // Check overworld subchunk key
    if (key.length >= 9 && key.length <= 14 && key[8] === 0x2f) {
      const indexKey = `${x},${z},0`;
      let set = this.chunkIndex.get(indexKey);
      if (!set) { set = new Set(); this.chunkIndex.set(indexKey, set); }
      set.add(keyHex);
      return;
    }

    // Check other dimension subchunk keys
    if (key.length >= 13) {
      const dim = view.getInt32(8, true);
      if (key[12] === 0x2f) {
        const indexKey = `${x},${z},${dim}`;
        let set = this.chunkIndex.get(indexKey);
        if (!set) { set = new Set(); this.chunkIndex.set(indexKey, set); }
        set.add(keyHex);
      }
    }
  }

  /**
   * Check if a chunk exists in the database.
   */
  hasChunk(chunkX: number, chunkZ: number, dimension: number): boolean {
    const indexKey = `${chunkX},${chunkZ},${dimension}`;
    const set = this.chunkIndex.get(indexKey);
    return !!set && set.size > 0;
  }

  private keyToString(key: Uint8Array): string {
    // Store as hex for reliable comparison
    return Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private readVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
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
      if (bytesRead > 5) break; // Max 5 bytes for 32-bit varint
    }
    return { value: result >>> 0, bytesRead };
  }

  /**
   * Get available chunk coordinates from parsed DB keys
   */
  getAvailableChunks(dimension: number): { x: number; z: number }[] {
    const chunks = new Set<string>();

    for (const keyHex of this.parsedKeys.keys()) {
      const key = this.hexToBytes(keyHex);
      const chunkKey = this.parseChunkKey(key, dimension);
      if (chunkKey) {
        chunks.add(`${chunkKey.x},${chunkKey.z}`);
      }
    }

    return Array.from(chunks).map(s => {
      const [x, z] = s.split(',').map(Number);
      return { x, z };
    });
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  /**
   * Parse a LevelDB key to determine if it's a chunk subchunk key
   * Bedrock chunk keys:
   * - Overworld: x(4) + z(4) + tag(1) [+ subchunk_index(1)]
   * - Other dimensions: x(4) + z(4) + dimension(4) + tag(1) [+ subchunk_index(1)]
   * Tag 47 (0x2f) = SubChunkPrefix
   */
  private parseChunkKey(key: Uint8Array, dimension: number): { x: number; z: number } | null {
    if (key.length < 9) return null;

    const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
    const x = view.getInt32(0, true);
    const z = view.getInt32(4, true);

    if (dimension === 0) {
      // Overworld: 8 bytes coords + 1 byte tag (+ optional 1 byte subchunk)
      if (key.length >= 9 && key.length <= 14) {
        const tag = key[8];
        if (tag === 0x2f) return { x, z };
      }
    } else {
      // Other dimensions: 8 bytes coords + 4 bytes dim + 1 byte tag
      if (key.length >= 13) {
        const dim = view.getInt32(8, true);
        if (dim === dimension) {
          const tag = key[12];
          if (tag === 0x2f) return { x, z };
        }
      }
    }
    return null;
  }

  /**
   * Return the raw subchunk data for a chunk (for worker-based rendering).
   * Returns a Map of subchunk index → Uint8Array, or null if the chunk has no data.
   */
  getChunkSubchunks(chunkX: number, chunkZ: number, dimension: number): Map<number, Uint8Array> | null {
    const indexKey = `${chunkX},${chunkZ},${dimension}`;
    const chunkKeySet = this.chunkIndex.get(indexKey);
    if (!chunkKeySet || chunkKeySet.size === 0) return null;

    const subchunks = new Map<number, Uint8Array>();
    for (const keyHex of chunkKeySet) {
      const value = this.parsedKeys.get(keyHex);
      if (!value) continue;
      const key = this.hexToBytes(keyHex);
      let subchunkIdx: number | undefined;
      if (dimension === 0) {
        if (key.length >= 10) subchunkIdx = (key[9] << 24) >> 24;
      } else {
        if (key.length >= 14) subchunkIdx = (key[13] << 24) >> 24;
      }
      if (subchunkIdx !== undefined) subchunks.set(subchunkIdx, value);
    }

    return subchunks.size > 0 ? subchunks : null;
  }

  /**
   * Render a chunk as top-down pixel data
   */
  getChunkRender(chunkX: number, chunkZ: number, dimension: number, heightRange: HeightRange): ChunkRenderData | null {
    const cacheKey = `${chunkX},${chunkZ},${dimension},${heightRange.min},${heightRange.max}`;
    if (this.chunkCache.has(cacheKey)) {
      return this.chunkCache.get(cacheKey)!;
    }

    // Use chunk index for fast lookup instead of iterating all keys
    const indexKey = `${chunkX},${chunkZ},${dimension}`;
    const chunkKeySet = this.chunkIndex.get(indexKey);
    if (!chunkKeySet || chunkKeySet.size === 0) return null;

    // Collect subchunk data for this chunk
    const subchunks = new Map<number, Uint8Array>();

    for (const keyHex of chunkKeySet) {
      const value = this.parsedKeys.get(keyHex);
      if (!value) continue;

      const key = this.hexToBytes(keyHex);
      let subchunkIdx: number | undefined;

      if (dimension === 0) {
        if (key.length >= 10) subchunkIdx = (key[9] << 24) >> 24; // signed int8
      } else {
        if (key.length >= 14) subchunkIdx = (key[13] << 24) >> 24; // signed int8
      }

      if (subchunkIdx !== undefined) {
        subchunks.set(subchunkIdx, value);
      }
    }

    if (subchunks.size === 0) return null;

    // Render top-down view
    const pixels = new Uint8Array(16 * 16 * 4);
    this.renderChunkTopDown(subchunks, pixels, heightRange);

    const renderData: ChunkRenderData = { x: chunkX, z: chunkZ, pixels };
    this.chunkCache.set(cacheKey, renderData);
    return renderData;
  }

  private renderChunkTopDown(subchunks: Map<number, Uint8Array>, pixels: Uint8Array, heightRange: HeightRange): void {
    // For each x,z column, find the topmost non-transparent block within height range
    for (let bx = 0; bx < 16; bx++) {
      for (let bz = 0; bz < 16; bz++) {
        let found = false;

        // Iterate from top to bottom
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

        if (!found) {
          // Set transparent
          const idx = (bz * 16 + bx) * 4;
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 0;
        }
      }
    }
  }

  /**
   * Parse subchunk data to get block name at position.
   * Bedrock subchunk format (version 8+):
   * version (1 byte), num_storages (1 byte), then for each storage:
   *   bits_per_block|flags (1 byte), blocks (ceil(4096*bpb/32)*4 bytes), palette (NBT list)
   * Note: version 9 inserts an extra subchunk-Y byte between num_storages and the first storage.
   */
  private getBlockFromSubchunk(data: Uint8Array, x: number, y: number, z: number): string | null {
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

    // Only read first storage (block layer)
    try {
      const bitsAndFlags = data[offset];
      offset++;
      const bitsPerBlock = bitsAndFlags >> 1;
      // const isRuntime = bitsAndFlags & 1; // unused

      if (bitsPerBlock === 0) {
        // Single block palette
        // Skip to palette
        const paletteSize = this.readLittleEndianInt32(data, offset);
        offset += 4;
        // Read first palette entry (NBT compound)
        const blockName = this.readPaletteEntryName(data, offset);
        return blockName;
      }

      const blocksPerWord = Math.floor(32 / bitsPerBlock);
      const wordCount = Math.ceil(4096 / blocksPerWord);

      // Calculate block index
      const blockIndex = ((x * 16) + z) * 16 + y;
      const wordIndex = Math.floor(blockIndex / blocksPerWord);
      const bitOffset = (blockIndex % blocksPerWord) * bitsPerBlock;

      if (offset + wordIndex * 4 + 4 > data.length) return null;

      const word = this.readLittleEndianUint32(data, offset + wordIndex * 4);
      const mask = (1 << bitsPerBlock) - 1;
      const paletteIndex = (word >> bitOffset) & mask;

      // Skip past block data to palette
      offset += wordCount * 4;

      // Read palette size
      if (offset + 4 > data.length) return null;
      const paletteSize = this.readLittleEndianInt32(data, offset);
      offset += 4;

      // Read palette entries to find our index
      for (let i = 0; i < paletteSize && i <= paletteIndex; i++) {
        const entryName = this.readPaletteEntryName(data, offset);
        const entrySize = this.measureNBTCompound(data, offset);
        if (entrySize === 0) return null;

        if (i === paletteIndex) {
          return entryName;
        }
        offset += entrySize;
      }
    } catch {
      return null;
    }

    return null;
  }

  private readPaletteEntryName(data: Uint8Array, offset: number): string | null {
    // NBT compound: tag_type(1) + name_len(2) + name + payload
    if (offset >= data.length) return null;
    if (data[offset] !== 10) return null; // Must be compound
    offset++;

    // Root compound name
    const rootNameLen = this.readLittleEndianInt16(data, offset);
    offset += 2 + rootNameLen;

    // Look for "name" string tag inside
    while (offset < data.length) {
      const tagType = data[offset];
      offset++;
      if (tagType === 0) break; // End

      const nameLen = this.readLittleEndianInt16(data, offset);
      offset += 2;
      const tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      if (tagType === 8 && tagName === 'name') {
        // String tag
        const strLen = this.readLittleEndianInt16(data, offset);
        offset += 2;
        return new TextDecoder().decode(data.slice(offset, offset + strLen));
      } else {
        // Skip this tag's payload
        const skipLen = this.skipNBTPayload(tagType, data, offset);
        if (skipLen < 0) return null;
        offset += skipLen;
      }
    }
    return null;
  }

  private measureNBTCompound(data: Uint8Array, offset: number): number {
    const start = offset;
    if (offset >= data.length || data[offset] !== 10) return 0;
    offset++;

    // Root name
    const rootNameLen = this.readLittleEndianInt16(data, offset);
    offset += 2 + rootNameLen;

    // Tags until End
    while (offset < data.length) {
      const tagType = data[offset];
      offset++;
      if (tagType === 0) break;

      const nameLen = this.readLittleEndianInt16(data, offset);
      offset += 2 + nameLen;

      const skipLen = this.skipNBTPayload(tagType, data, offset);
      if (skipLen < 0) return 0;
      offset += skipLen;
    }

    return offset - start;
  }

  private skipNBTPayload(tagType: number, data: Uint8Array, offset: number): number {
    const start = offset;
    switch (tagType) {
      case 1: return 1;
      case 2: return 2;
      case 3: return 4;
      case 4: return 8;
      case 5: return 4;
      case 6: return 8;
      case 7: { // Byte array
        if (offset + 4 > data.length) return -1;
        const len = this.readLittleEndianInt32(data, offset);
        return 4 + len;
      }
      case 8: { // String
        if (offset + 2 > data.length) return -1;
        const len = this.readLittleEndianInt16(data, offset);
        return 2 + len;
      }
      case 9: { // List
        if (offset + 5 > data.length) return -1;
        const listType = data[offset];
        offset++;
        const listLen = this.readLittleEndianInt32(data, offset);
        offset += 4;
        for (let i = 0; i < listLen; i++) {
          const skip = this.skipNBTPayload(listType, data, offset);
          if (skip < 0) return -1;
          offset += skip;
        }
        return offset - start;
      }
      case 10: { // Compound
        while (offset < data.length) {
          const t = data[offset];
          offset++;
          if (t === 0) break;
          const nl = this.readLittleEndianInt16(data, offset);
          offset += 2 + nl;
          const skip = this.skipNBTPayload(t, data, offset);
          if (skip < 0) return -1;
          offset += skip;
        }
        return offset - start;
      }
      case 11: { // Int array
        if (offset + 4 > data.length) return -1;
        const len = this.readLittleEndianInt32(data, offset);
        return 4 + len * 4;
      }
      case 12: { // Long array
        if (offset + 4 > data.length) return -1;
        const len = this.readLittleEndianInt32(data, offset);
        return 4 + len * 8;
      }
      default: return -1;
    }
  }

  private readLittleEndianInt32(data: Uint8Array, offset: number): number {
    return (data[offset]) | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
  }

  private readLittleEndianUint32(data: Uint8Array, offset: number): number {
    return ((data[offset]) | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  }

  private readLittleEndianInt16(data: Uint8Array, offset: number): number {
    return (data[offset]) | (data[offset + 1] << 8);
  }

  /**
   * Get markers (portals, players, banners) from the world
   */
  getMarkers(): MapMarker[] {
    const markers: MapMarker[] = [];

    // Add spawn/player info from level.dat
    if (this.worldInfo) {
      markers.push({
        id: 'spawn',
        x: this.worldInfo.spawnX,
        y: this.worldInfo.spawnY,
        z: this.worldInfo.spawnZ,
        dimension: 0,
        type: 'player',
        label: 'World Spawn',
      });
    }

    // Look for local player and multiplayer player keys
    for (const [keyHex, value] of this.parsedKeys) {
      const key = this.hexToBytes(keyHex);

      // Check for ~local_player key
      try {
        const keyStr = new TextDecoder().decode(key);
        if (keyStr === '~local_player') {
          const parsed = this.parsePlayerNBT(value);
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
          // Multiplayer player
          const playerId = keyStr.slice('player_'.length);
          const parsed = this.parsePlayerNBT(value);
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
        // Not a text key, skip
      }
    }

    // Look for portal blocks and banners in block entity data
    for (const [keyHex, value] of this.parsedKeys) {
      const key = this.hexToBytes(keyHex);
      if (key.length < 9) continue;

      // Check block entity data (tag 49 = BlockEntity)
      const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
      const kx = view.getInt32(0, true);
      const kz = view.getInt32(4, true);

      let tag: number;
      let dim = 0;

      if (key.length === 9 || key.length === 10) {
        tag = key[8];
      } else if (key.length >= 13) {
        dim = view.getInt32(8, true);
        tag = key[12];
      } else {
        continue;
      }

      // Tag 49 (0x31) = BlockEntity data
      if (tag === 0x31) {
        this.extractPortalMarkers(value, kx, kz, dim, markers);
        this.extractBannerMarkers(value, kx, kz, dim, markers);
      }

      // Tag 47 (0x2f) = SubChunkPrefix - scan palette for portal blocks
      if (tag === 0x2f) {
        this.extractPortalFromSubchunk(value, kx, kz, dim, markers);
      }
    }

    return markers;
  }

  private parsePlayerNBT(data: Uint8Array): { x: number; y: number; z: number; dimension: number; name?: string } | null {
    try {
      if (data.length < 3 || data[0] !== 10) return null;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      let offset = 1;
      const rootNameLen = view.getInt16(offset, true);
      offset += 2 + rootNameLen;

      let x = 0, y = 0, z = 0, dimension = 0;
      let foundPos = false;
      let name: string | undefined;

      while (offset < data.length) {
        const tagType = data[offset]; offset++;
        if (tagType === 0) break;

        const nameLen = view.getInt16(offset, true); offset += 2;
        const tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
        offset += nameLen;

        if (tagType === 9 && tagName === 'Pos') {
          // List of floats
          const listType = data[offset]; offset++;
          const listLen = view.getInt32(offset, true); offset += 4;
          if (listType === 5 && listLen === 3) {
            x = view.getFloat32(offset, true); offset += 4;
            y = view.getFloat32(offset, true); offset += 4;
            z = view.getFloat32(offset, true); offset += 4;
            foundPos = true;
          } else {
            for (let i = 0; i < listLen; i++) {
              const skip = this.skipNBTPayload(listType, data, offset);
              if (skip < 0) return null;
              offset += skip;
            }
          }
        } else if (tagType === 3 && tagName === 'DimensionId') {
          dimension = view.getInt32(offset, true); offset += 4;
        } else if (tagType === 8 && (tagName === 'NameTag' || tagName === 'Username' || tagName === 'Name')) {
          const strLen = view.getInt16(offset, true); offset += 2;
          const candidate = new TextDecoder().decode(data.slice(offset, offset + strLen));
          offset += strLen;
          if (!name && candidate.length > 0) name = candidate;
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

  private extractPortalMarkers(data: Uint8Array, chunkX: number, chunkZ: number, dimension: number, markers: MapMarker[]): void {
    // Look for nether portal or end portal blocks in block entity data
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);

    if (text.includes('NetherPortal') || text.includes('nether_portal')) {
      markers.push({
        id: `nether_portal_${chunkX}_${chunkZ}_${dimension}`,
        x: chunkX * 16 + 8,
        y: 64,
        z: chunkZ * 16 + 8,
        dimension,
        type: 'nether_portal',
        label: 'Nether Portal',
      });
    }

    if (text.includes('EndPortal') || text.includes('end_portal')) {
      markers.push({
        id: `end_portal_${chunkX}_${chunkZ}_${dimension}`,
        x: chunkX * 16 + 8,
        y: 64,
        z: chunkZ * 16 + 8,
        dimension,
        type: 'end_portal',
        label: 'End Portal',
      });
    }
  }

  private extractPortalFromSubchunk(data: Uint8Array, chunkX: number, chunkZ: number, dimension: number, markers: MapMarker[]): void {
    // Quick text scan of subchunk palette for portal block names
    // Nether portals use 'minecraft:portal', end portals use 'minecraft:end_portal'
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);

    const portalId = `nether_portal_${chunkX}_${chunkZ}_${dimension}`;
    if ((text.includes('minecraft:portal') || text.includes('minecraft:nether_portal')) &&
        !markers.some(m => m.id === portalId)) {
      markers.push({
        id: portalId,
        x: chunkX * 16 + 8,
        y: 64,
        z: chunkZ * 16 + 8,
        dimension,
        type: 'nether_portal',
        label: 'Nether Portal',
      });
    }

    const endId = `end_portal_${chunkX}_${chunkZ}_${dimension}`;
    if (text.includes('minecraft:end_portal') &&
        !markers.some(m => m.id === endId)) {
      markers.push({
        id: endId,
        x: chunkX * 16 + 8,
        y: 64,
        z: chunkZ * 16 + 8,
        dimension,
        type: 'end_portal',
        label: 'End Portal',
      });
    }
  }

  private extractBannerMarkers(data: Uint8Array, chunkX: number, chunkZ: number, dimension: number, markers: MapMarker[]): void {
    // Banners have id == "Banner" in their block entity NBT
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    if (!text.includes('Banner')) return;

    try {
      if (data.length < 3 || data[0] !== 10) return;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      let offset = 1;
      const rootNameLen = view.getInt16(offset, true);
      offset += 2 + rootNameLen;

      let bx = chunkX * 16, by = 64, bz = chunkZ * 16;
      let id = '';
      let customName: string | undefined;

      while (offset < data.length) {
        const tagType = data[offset]; offset++;
        if (tagType === 0) break;

        const nameLen = view.getInt16(offset, true); offset += 2;
        const tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
        offset += nameLen;

        if (tagType === 3 && tagName === 'x') {
          bx = view.getInt32(offset, true); offset += 4;
        } else if (tagType === 3 && tagName === 'y') {
          by = view.getInt32(offset, true); offset += 4;
        } else if (tagType === 3 && tagName === 'z') {
          bz = view.getInt32(offset, true); offset += 4;
        } else if (tagType === 8 && tagName === 'id') {
          const strLen = view.getInt16(offset, true); offset += 2;
          id = new TextDecoder().decode(data.slice(offset, offset + strLen));
          offset += strLen;
        } else if (tagType === 8 && tagName === 'CustomName') {
          const strLen = view.getInt16(offset, true); offset += 2;
          const raw = new TextDecoder().decode(data.slice(offset, offset + strLen));
          offset += strLen;
          // CustomName can be a JSON text component like {"text":"My Banner"}
          try {
            const parsed = JSON.parse(raw) as { text?: string };
            if (typeof parsed.text === 'string') {
              customName = parsed.text;
            } else {
              customName = raw;
            }
          } catch {
            customName = raw;
          }
        } else {
          const skip = this.skipNBTPayload(tagType, data, offset);
          if (skip < 0) return;
          offset += skip;
        }
      }

      if (id === 'Banner' && customName) {
        markers.push({
          id: `banner_${bx}_${by}_${bz}_${dimension}`,
          x: bx,
          y: by,
          z: bz,
          dimension,
          type: 'banner',
          label: customName,
        });
      }
    } catch {
      // Parse error — ignore
    }
  }

  getWorldInfo(): WorldInfo | null {
    return this.worldInfo;
  }
}
