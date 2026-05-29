/**
 * IndexedDB-backed cache for rendered map tiles.
 * Key format: `${dimension}:${heightMin}:${heightMax}:${tileX}:${tileZ}`
 * Stored value includes the pixel data and a hash of the source chunk data
 * so stale entries can be detected and replaced.
 */

const DB_NAME = 'mcpe-mapper-tiles';
const STORE_NAME = 'tiles';
const DB_VERSION = 1;

export interface CachedTile {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  /** FNV-1a hash of all source chunk data used to render this tile */
  hash: number;
}

function tileKey(
  dimension: number,
  heightMin: number,
  heightMax: number,
  tileX: number,
  tileZ: number,
): string {
  return `${dimension}:${heightMin}:${heightMax}:${tileX}:${tileZ}`;
}

/**
 * Fast 32-bit FNV-1a hash over arbitrary byte arrays.
 * Suitable for cache-invalidation comparisons — not cryptographic.
 */
export function fnv1a(buffers: Uint8Array[]): number {
  let hash = 0x811c9dc5;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      hash ^= buf[i];
      // 32-bit multiply — JS bitwise ops stay 32-bit
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

export class TileCache {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;

  private open(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.opening) return this.opening;

    this.opening = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };

      req.onerror = () => reject(req.error);
    });

    return this.opening;
  }

  async get(
    dimension: number,
    heightMin: number,
    heightMax: number,
    tileX: number,
    tileZ: number,
  ): Promise<CachedTile | null> {
    try {
      await this.open();
      if (!this.db) return null;
      const key = tileKey(dimension, heightMin, heightMax, tileX, tileZ);
      return await new Promise<CachedTile | null>((resolve) => {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve((req.result as CachedTile) ?? null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async put(
    dimension: number,
    heightMin: number,
    heightMax: number,
    tileX: number,
    tileZ: number,
    pixels: Uint8ClampedArray<ArrayBuffer>,
    hash: number,
  ): Promise<void> {
    try {
      await this.open();
      if (!this.db) return;
      const key = tileKey(dimension, heightMin, heightMax, tileX, tileZ);
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put({ pixels, hash }, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Cache writes are best-effort; ignore errors
    }
  }

  async delete(
    dimension: number,
    heightMin: number,
    heightMax: number,
    tileX: number,
    tileZ: number,
  ): Promise<void> {
    try {
      await this.open();
      if (!this.db) return;
      const key = tileKey(dimension, heightMin, heightMax, tileX, tileZ);
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch {
      // Best-effort
    }
  }
}

/** Singleton instance shared across the application */
export const tileCache = new TileCache();
