import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ViewerConfig, MapMarker, ChunkCoord, ChunkRenderData } from '@mcpe-mapper/shared';
import { OfflineWorldReader } from '../services/OfflineWorldReader';
import { BackendService } from '../services/BackendService';
import { AppMode } from '../App';
import { tileCache, fnv1a } from '../services/TileCache';
import type { TileRenderRequest, TileRenderResponse } from '../workers/tileWorker';

// ─── constants ────────────────────────────────────────────────────────────────

/** Chunks per tile edge (tile = TILE_SIZE×TILE_SIZE chunks = 256×256 blocks) */
const TILE_SIZE = 4;
const CHUNK_SIZE = 16;
/** Pixel dimensions of one rendered tile canvas */
const TILE_PIXEL_SIZE = TILE_SIZE * CHUNK_SIZE;
const MAX_WORKERS = 16;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 32;
const DEFAULT_ZOOM = 2;
/** Tiles to render per main-thread batch when workers unavailable */
const FALLBACK_BATCH_SIZE = 4;

// ─── types ────────────────────────────────────────────────────────────────────

interface MapCanvasProps {
  mode: AppMode;
  config: ViewerConfig;
  offlineReader: OfflineWorldReader | null;
  backendService: BackendService | null;
  markers: MapMarker[];
  onCursorPosition?: (pos: { x: number; z: number } | null) => void;
}

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
}

interface TileJob {
  key: string;
  generation: number;
  request: TileRenderRequest;
  dimension: number;
  heightMin: number;
  heightMax: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function tileKey(tileX: number, tileZ: number): string {
  return `${tileX},${tileZ}`;
}

function emptyKey(dimension: number, tileX: number, tileZ: number): string {
  return `${dimension}:${tileX}:${tileZ}`;
}

function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createTileCanvas(tileX: number, tileZ: number, pixels: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PIXEL_SIZE;
  canvas.height = TILE_PIXEL_SIZE;
  canvas.className = 'map-chunk-tile';
  canvas.style.position = 'absolute';
  canvas.style.left = `${tileX * TILE_PIXEL_SIZE}px`;
  canvas.style.top = `${tileZ * TILE_PIXEL_SIZE}px`;
  canvas.style.width = `${TILE_PIXEL_SIZE}px`;
  canvas.style.height = `${TILE_PIXEL_SIZE}px`;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(new ImageData(pixels, TILE_PIXEL_SIZE, TILE_PIXEL_SIZE), 0, 0);
  }
  return canvas;
}

// ─── component ────────────────────────────────────────────────────────────────

export const MapCanvas: React.FC<MapCanvasProps> = ({
  mode,
  config,
  offlineReader,
  backendService,
  markers,
  onCursorPosition,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chunkLayerRef = useRef<HTMLDivElement>(null);

  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    zoom: DEFAULT_ZOOM,
  });

  // Keep a ref in sync so async callbacks always see current values
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const configRef = useRef(config);
  configRef.current = config;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const offlineReaderRef = useRef(offlineReader);
  offlineReaderRef.current = offlineReader;
  const backendServiceRef = useRef(backendService);
  backendServiceRef.current = backendService;

  // Per-dimension in-memory tile canvas cache: dimension → tileKey → canvas
  // Preserved across dimension switches so switching back is instant.
  const tileCacheByDim = useRef<Map<number, Map<string, HTMLCanvasElement>>>(new Map());

  // Worker pool (created once, reused)
  const workerPool = useRef<WorkerEntry[]>([]);
  const workersAvailable = useRef(false);

  // Job queue for when all workers are busy
  const jobQueue = useRef<TileJob[]>([]);

  // Set of tile keys (tileKey(tx,tz)) currently being rendered (in-flight)
  const pendingTileKeys = useRef<Set<string>>(new Set());

  // Empty tile tracking: tiles that have no chunk data at all (skip re-requesting)
  // Key: emptyKey(dimension, tileX, tileZ)
  const emptyTileKeys = useRef<Set<string>>(new Set());

  // Canvases currently in the DOM (visible layer)
  const visibleCanvases = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Generation counter — incrementing cancels all in-flight work
  const loadGeneration = useRef(0);

  // Pointer interaction state
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef<number | null>(null);
  const pinchActive = useRef(false);

  // ─── worker management ──────────────────────────────────────────────────────

  // Stable ref to the response handler so worker onmessage closures stay valid
  const handleWorkerResponseRef = useRef<(resp: TileRenderResponse, entry: WorkerEntry) => void>(
    () => {}
  );

  const assignNextJobRef = useRef<() => void>(() => {});

  // Initialize workers once
  useEffect(() => {
    try {
      if (typeof Worker === 'undefined') throw new Error('Worker API unavailable');

      for (let i = 0; i < MAX_WORKERS; i++) {
        const entry: WorkerEntry = { worker: null as unknown as Worker, busy: false };
        const worker = new Worker(
          new URL('../workers/tileWorker.ts', import.meta.url),
          { type: 'module' }
        );
        entry.worker = worker;

        worker.onmessage = (e: MessageEvent<TileRenderResponse>) => {
          entry.busy = false;
          handleWorkerResponseRef.current(e.data, entry);
          assignNextJobRef.current();
        };

        worker.onerror = () => {
          entry.busy = false;
          assignNextJobRef.current();
        };

        workerPool.current.push(entry);
      }
      workersAvailable.current = true;
    } catch {
      workersAvailable.current = false;
    }

    return () => {
      for (const e of workerPool.current) e.worker.terminate();
      workerPool.current = [];
      workersAvailable.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── tile DOM helpers ────────────────────────────────────────────────────────

  /** Append a tile canvas to the chunk layer if it is not already attached */
  const attachTile = useCallback((key: string, canvas: HTMLCanvasElement) => {
    const layer = chunkLayerRef.current;
    if (!layer) return;
    if (!canvas.parentElement) {
      layer.appendChild(canvas);
    }
    visibleCanvases.current.set(key, canvas);
  }, []);

  /** Remove all tile canvases from DOM but keep them in the dimension cache */
  const clearDom = useCallback(() => {
    for (const canvas of visibleCanvases.current.values()) {
      canvas.remove();
    }
    visibleCanvases.current.clear();
  }, []);

  // ─── worker response handler (kept in ref for stability) ────────────────────

  useEffect(() => {
    handleWorkerResponseRef.current = (resp: TileRenderResponse, _entry: WorkerEntry) => {
      const { id, tileX, tileZ, pixels: pixelsBuf, hash } = resp;

      // Decode job context from id: "generation:dimension:heightMin:heightMax:tileX:tileZ"
      const parts = id.split(':');
      const jobGen    = parseInt(parts[0], 10);
      const dimension = parseInt(parts[1], 10);
      const heightMin = parseInt(parts[2], 10);
      const heightMax = parseInt(parts[3], 10);

      const key = tileKey(tileX, tileZ);
      pendingTileKeys.current.delete(key);

      // Discard if this load has been superseded
      if (jobGen !== loadGeneration.current) return;

      const pixels = new Uint8ClampedArray(pixelsBuf);
      const canvas = createTileCanvas(tileX, tileZ, pixels);

      // Store in in-memory dimension cache
      const dimMap = tileCacheByDim.current.get(dimension) ?? new Map();
      tileCacheByDim.current.set(dimension, dimMap);
      dimMap.set(key, canvas);

      // Save to IndexedDB (best-effort, async)
      tileCache.put(dimension, heightMin, heightMax, tileX, tileZ, pixels, hash);

      // Add to DOM if this is the currently-viewed dimension
      if (dimension === configRef.current.dimension) {
        attachTile(key, canvas);
      }
    };
  }); // No deps — runs every render, keeping the ref current

  // ─── job queue assignment ────────────────────────────────────────────────────

  useEffect(() => {
    assignNextJobRef.current = () => {
      // Drain stale jobs from the front of the queue
      while (jobQueue.current.length > 0 &&
             jobQueue.current[0].generation !== loadGeneration.current) {
        const stale = jobQueue.current.shift()!;
        pendingTileKeys.current.delete(stale.key);
      }

      const job = jobQueue.current.shift();
      if (!job) return;

      const idleWorker = workerPool.current.find(w => !w.busy);
      if (!idleWorker) {
        // No idle worker — put job back
        jobQueue.current.unshift(job);
        return;
      }

      idleWorker.busy = true;
      idleWorker.worker.postMessage(job.request);
    };
  }); // No deps — runs every render

  // ─── collect subchunk data for a tile (offline mode) ────────────────────────

  /**
   * Gather subchunk buffers for all chunks in a tile from the offline reader.
   * Returns null if no chunk in the tile has any data.
   */
  const collectTileChunks = useCallback((
    tileX: number,
    tileZ: number,
    dimension: number,
  ): TileRenderRequest['chunks'] | null => {
    const reader = offlineReaderRef.current;
    if (!reader) return null;

    const chunks: TileRenderRequest['chunks'] = [];
    const baseCX = tileX * TILE_SIZE;
    const baseCZ = tileZ * TILE_SIZE;

    for (let lx = 0; lx < TILE_SIZE; lx++) {
      for (let lz = 0; lz < TILE_SIZE; lz++) {
        const cx = baseCX + lx;
        const cz = baseCZ + lz;
        if (!reader.hasChunk(cx, cz, dimension)) continue;
        const subchunkMap = reader.getChunkSubchunks(cx, cz, dimension);
        if (!subchunkMap) continue;

        const subchunks: { index: number; data: ArrayBuffer }[] = [];
        for (const [idx, buf] of subchunkMap) {
          // Structured-clone the buffer so the worker gets its own copy
          // (avoids detaching the reader's internal cache buffers)
          const raw = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          subchunks.push({ index: idx, data: raw as ArrayBuffer });
        }
        chunks.push({ chunkLocalX: lx, chunkLocalZ: lz, subchunks });
      }
    }

    return chunks.length > 0 ? chunks : null;
  }, []);

  // ─── fallback: render tile on main thread without workers ────────────────────

  /**
   * Main-thread tile rendering path used when web workers are unavailable
   * (e.g., test environment). Calls getChunkRender per chunk.
   */
  const renderTileFallback = useCallback((
    tileX: number,
    tileZ: number,
    dimension: number,
    heightRange: { min: number; max: number },
  ): HTMLCanvasElement | null => {
    const reader = offlineReaderRef.current;
    if (!reader) return null;

    const pixels = new Uint8ClampedArray(TILE_PIXEL_SIZE * TILE_PIXEL_SIZE * 4);
    const baseCX = tileX * TILE_SIZE;
    const baseCZ = tileZ * TILE_SIZE;
    let hasAny = false;

    for (let lx = 0; lx < TILE_SIZE; lx++) {
      for (let lz = 0; lz < TILE_SIZE; lz++) {
        const cx = baseCX + lx;
        const cz = baseCZ + lz;
        if (!reader.hasChunk(cx, cz, dimension)) continue;
        try {
          const chunkData = reader.getChunkRender(cx, cz, dimension, heightRange);
          if (!chunkData) continue;
          hasAny = true;

          const srcPx = new Uint8ClampedArray(chunkData.pixels);
          const dstBaseX = lx * CHUNK_SIZE;
          const dstBaseZ = lz * CHUNK_SIZE;
          for (let bx = 0; bx < CHUNK_SIZE; bx++) {
            for (let bz = 0; bz < CHUNK_SIZE; bz++) {
              const srcIdx = (bz * CHUNK_SIZE + bx) * 4;
              const dstIdx = ((dstBaseZ + bz) * TILE_PIXEL_SIZE + (dstBaseX + bx)) * 4;
              pixels[dstIdx]     = srcPx[srcIdx];
              pixels[dstIdx + 1] = srcPx[srcIdx + 1];
              pixels[dstIdx + 2] = srcPx[srcIdx + 2];
              pixels[dstIdx + 3] = srcPx[srcIdx + 3];
            }
          }
        } catch (err) {
          console.error(`Chunk render error at tile (${tileX}, ${tileZ}), chunk (${cx}, ${cz}):`, err);
        }
      }
    }

    if (!hasAny) return null;
    return createTileCanvas(tileX, tileZ, pixels);
  }, []);

  // ─── core: load visible tiles ────────────────────────────────────────────────

  const loadVisibleTilesRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    loadVisibleTilesRef.current = async () => {
      const container = containerRef.current;
      if (!container) return;

      const { offsetX, offsetY, zoom } = viewStateRef.current;
      const width  = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      const { dimension, heightRange } = configRef.current;

      // Cancel all in-flight work and clear the job queue so tiles are
      // re-queued with priority based on the current viewport center.
      loadGeneration.current++;
      jobQueue.current = [];
      pendingTileKeys.current.clear();

      const generation = loadGeneration.current;

      // ── compute visible tile range ────────────────────────────────────────
      const tilePixelW = TILE_PIXEL_SIZE * zoom;
      const startTileX = Math.floor((-offsetX - width  / 2) / tilePixelW) - 1;
      const endTileX   = Math.ceil( (-offsetX + width  / 2) / tilePixelW) + 1;
      const startTileZ = Math.floor((-offsetY - height / 2) / tilePixelW) - 1;
      const endTileZ   = Math.ceil( (-offsetY + height / 2) / tilePixelW) + 1;

      const dimMap = tileCacheByDim.current.get(dimension) ?? new Map<string, HTMLCanvasElement>();
      tileCacheByDim.current.set(dimension, dimMap);

      // ── cull tiles that have scrolled off-screen ──────────────────────────
      for (const [key, canvas] of visibleCanvases.current) {
        const [tx, tz] = key.split(',').map(Number);
        if (tx < startTileX || tx > endTileX || tz < startTileZ || tz > endTileZ) {
          canvas.remove();
          visibleCanvases.current.delete(key);
        }
      }

      // ── show cached tiles that scrolled into view ─────────────────────────
      for (const [key, canvas] of dimMap) {
        const [tx, tz] = key.split(',').map(Number);
        if (tx >= startTileX && tx <= endTileX && tz >= startTileZ && tz <= endTileZ) {
          if (!canvas.parentElement) {
            attachTile(key, canvas);
          }
        }
      }

      // ── determine which tiles still need rendering ─────────────────────────
      const centerTileX = -offsetX / tilePixelW;
      const centerTileZ = -offsetY / tilePixelW;
      const tilesToLoad: { tileX: number; tileZ: number }[] = [];

      for (let tx = startTileX; tx <= endTileX; tx++) {
        for (let tz = startTileZ; tz <= endTileZ; tz++) {
          const key = tileKey(tx, tz);
          if (dimMap.has(key)) continue;
          if (pendingTileKeys.current.has(key)) continue;
          if (emptyTileKeys.current.has(emptyKey(dimension, tx, tz))) continue;
          tilesToLoad.push({ tileX: tx, tileZ: tz });
        }
      }

      if (tilesToLoad.length === 0) return;

      // Sort center-first
      tilesToLoad.sort((a, b) => {
        const dA = (a.tileX - centerTileX) ** 2 + (a.tileZ - centerTileZ) ** 2;
        const dB = (b.tileX - centerTileX) ** 2 + (b.tileZ - centerTileZ) ** 2;
        return dA - dB;
      });

      // ── offline mode ──────────────────────────────────────────────────────
      if (modeRef.current === 'offline' && offlineReaderRef.current) {
        for (let i = 0; i < tilesToLoad.length; i++) {
          if (loadGeneration.current !== generation) break;

          const { tileX, tileZ } = tilesToLoad[i];
          const key = tileKey(tileX, tileZ);
          pendingTileKeys.current.add(key);

          if (workersAvailable.current) {
            // ── worker path: check IndexedDB first ────────────────────────
            const chunks = collectTileChunks(tileX, tileZ, dimension);
            if (!chunks) {
              pendingTileKeys.current.delete(key);
              emptyTileKeys.current.add(emptyKey(dimension, tileX, tileZ));
              continue;
            }

            // Compute hash of raw subchunk data to compare with cached hash
            const hashBufs = chunks.flatMap(c => c.subchunks.map(sc => new Uint8Array(sc.data)));
            const currentHash = fnv1a(hashBufs);

            const cached = await tileCache.get(dimension, heightRange.min, heightRange.max, tileX, tileZ);
            if (loadGeneration.current !== generation) break;

            if (cached && cached.hash === currentHash) {
              // IndexedDB cache hit
              pendingTileKeys.current.delete(key);
              const canvas = createTileCanvas(tileX, tileZ, cached.pixels);
              dimMap.set(key, canvas);
              attachTile(key, canvas);
              continue;
            }

            // Dispatch to worker
            const jobId = `${generation}:${dimension}:${heightRange.min}:${heightRange.max}:${tileX}:${tileZ}`;
            const request: TileRenderRequest = {
              id: jobId,
              tileX,
              tileZ,
              tileSize: TILE_SIZE,
              dimension,
              heightRange: { min: heightRange.min, max: heightRange.max },
              chunks,
            };
            const job: TileJob = { key, generation, request, dimension, heightMin: heightRange.min, heightMax: heightRange.max };

            const idleWorker = workerPool.current.find(w => !w.busy);
            if (idleWorker) {
              idleWorker.busy = true;
              idleWorker.worker.postMessage(request);
            } else {
              jobQueue.current.push(job);
            }

          } else {
            // ── fallback: main-thread rendering ───────────────────────────
            const canvas = renderTileFallback(tileX, tileZ, dimension, heightRange);
            pendingTileKeys.current.delete(key);

            if (!canvas) {
              emptyTileKeys.current.add(emptyKey(dimension, tileX, tileZ));
            } else {
              dimMap.set(key, canvas);
              if (loadGeneration.current === generation) {
                attachTile(key, canvas);
              }
            }

            // Yield to the event loop between fallback batches
            if ((i + 1) % FALLBACK_BATCH_SIZE === 0 && i + 1 < tilesToLoad.length) {
              await yieldToMain();
            }
          }
        }
      }

      // ── backend mode ──────────────────────────────────────────────────────
      if (modeRef.current === 'backend' && backendServiceRef.current) {
        const batchSize = 32;
        // Collect all chunk coords for unrendered tiles
        const allCoords: ChunkCoord[] = [];
        const coordToTile = new Map<string, { tileX: number; tileZ: number }>();

        for (const { tileX, tileZ } of tilesToLoad) {
          const key = tileKey(tileX, tileZ);
          pendingTileKeys.current.add(key);
          const baseCX = tileX * TILE_SIZE;
          const baseCZ = tileZ * TILE_SIZE;
          for (let lx = 0; lx < TILE_SIZE; lx++) {
            for (let lz = 0; lz < TILE_SIZE; lz++) {
              const cx = baseCX + lx;
              const cz = baseCZ + lz;
              allCoords.push({ x: cx, z: cz });
              coordToTile.set(`${cx},${cz}`, { tileX, tileZ });
            }
          }
        }

        // Process in batches
        for (let i = 0; i < allCoords.length; i += batchSize) {
          if (loadGeneration.current !== generation) break;

          const batch = allCoords.slice(i, i + batchSize);
          try {
            const chunkDataList: ChunkRenderData[] = await backendServiceRef.current.getChunks(
              batch,
              dimension,
              heightRange,
            );
            if (loadGeneration.current !== generation) break;

            // Accumulate chunks per tile
            const tilePxMap = new Map<string, Uint8ClampedArray<ArrayBuffer>>();
            const tileHasData = new Set<string>();

            for (const chunkData of chunkDataList) {
              const tileInfo = coordToTile.get(`${chunkData.x},${chunkData.z}`);
              if (!tileInfo) continue;
              const { tileX, tileZ } = tileInfo;
              const key = tileKey(tileX, tileZ);
              if (!tilePxMap.has(key)) {
                tilePxMap.set(key, new Uint8ClampedArray(TILE_PIXEL_SIZE * TILE_PIXEL_SIZE * 4));
              }
              const px = tilePxMap.get(key)!;
              const lx = chunkData.x - tileX * TILE_SIZE;
              const lz = chunkData.z - tileZ * TILE_SIZE;
              const srcPx = new Uint8ClampedArray(chunkData.pixels);
              const dstBaseX = lx * CHUNK_SIZE;
              const dstBaseZ = lz * CHUNK_SIZE;
              for (let bx = 0; bx < CHUNK_SIZE; bx++) {
                for (let bz = 0; bz < CHUNK_SIZE; bz++) {
                  const srcIdx = (bz * CHUNK_SIZE + bx) * 4;
                  const dstIdx = ((dstBaseZ + bz) * TILE_PIXEL_SIZE + (dstBaseX + bx)) * 4;
                  px[dstIdx]     = srcPx[srcIdx];
                  px[dstIdx + 1] = srcPx[srcIdx + 1];
                  px[dstIdx + 2] = srcPx[srcIdx + 2];
                  px[dstIdx + 3] = srcPx[srcIdx + 3];
                }
              }
              tileHasData.add(key);
            }

            // Commit completed tile canvases
            for (const { tileX, tileZ } of tilesToLoad) {
              const key = tileKey(tileX, tileZ);
              if (!dimMap.has(key) && tileHasData.has(key)) {
                const pixels = tilePxMap.get(key)!;
                const canvas = createTileCanvas(tileX, tileZ, pixels);
                dimMap.set(key, canvas);
                pendingTileKeys.current.delete(key);
                if (loadGeneration.current === generation) {
                  attachTile(key, canvas);
                }
              }
            }
          } catch (err) {
            console.error('Failed to load backend chunks:', err);
            for (const { tileX, tileZ } of tilesToLoad) {
              pendingTileKeys.current.delete(tileKey(tileX, tileZ));
            }
          }
        }

        // Mark tiles with no data as empty
        for (const { tileX, tileZ } of tilesToLoad) {
          const key = tileKey(tileX, tileZ);
          if (!dimMap.has(key)) {
            pendingTileKeys.current.delete(key);
            emptyTileKeys.current.add(emptyKey(dimension, tileX, tileZ));
          }
        }
      }
    };
  }); // No deps — updated every render so refs are always current

  // ─── effects ─────────────────────────────────────────────────────────────────

  // Trigger tile loading after view or config changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadVisibleTilesRef.current();
    }, 100);
    return () => clearTimeout(timer);
  }, [viewState, config, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear caches when height range changes (height affects rendered pixels)
  useEffect(() => {
    loadGeneration.current++;
    jobQueue.current = [];
    pendingTileKeys.current = new Set();
    emptyTileKeys.current = new Set();

    // Remove all tile canvases from DOM and clear all dimension caches
    for (const dimMap of tileCacheByDim.current.values()) {
      for (const canvas of dimMap.values()) canvas.remove();
      dimMap.clear();
    }
    visibleCanvases.current.clear();
  }, [config.heightRange.min, config.heightRange.max]);

  // Clear DOM (not dimension cache) when dimension changes
  useEffect(() => {
    loadGeneration.current++;
    jobQueue.current = [];
    pendingTileKeys.current = new Set();

    clearDom();
    // loadVisibleTiles (triggered by viewState/config effect above) will
    // re-show any cached tiles for the new dimension and queue missing ones.
  }, [config.dimension, clearDom]);

  // Subscribe to backend WebSocket chunk updates
  useEffect(() => {
    if (mode !== 'backend' || !backendService) return;

    const unsubscribe = backendService.onChunkUpdate((updatedCoords) => {
      for (const coord of updatedCoords) {
        const tileX = Math.floor(coord.x / TILE_SIZE);
        const tileZ = Math.floor(coord.z / TILE_SIZE);
        const key   = tileKey(tileX, tileZ);

        // Invalidate this tile in all dimension caches
        for (const [dim, dimMap] of tileCacheByDim.current) {
          if (dimMap.has(key)) {
            const canvas = dimMap.get(key)!;
            canvas.remove();
            dimMap.delete(key);
            visibleCanvases.current.delete(key);
            // Also remove from IndexedDB (we don't know height ranges to clear exactly,
            // but a new render will overwrite on next load)
            tileCache.delete(dim, config.heightRange.min, config.heightRange.max, tileX, tileZ);
          }
        }

        // Remove from empty-tile tracking so it gets re-checked
        emptyTileKeys.current.delete(emptyKey(config.dimension, tileX, tileZ));
      }
    });

    return unsubscribe;
  }, [mode, backendService, config.heightRange.min, config.heightRange.max, config.dimension]);

  // ─── input handlers ──────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (pinchActive.current) return;
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Update cursor world position
    if (onCursorPosition) {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const { offsetX, offsetY, zoom } = viewStateRef.current;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const worldX = Math.round((mx - container.clientWidth  / 2 - offsetX) / zoom);
        const worldZ = Math.round((my - container.clientHeight / 2 - offsetY) / zoom);
        onCursorPosition({ x: worldX, z: worldZ });
      }
    }

    if (!isDragging.current || pinchActive.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setViewState(prev => ({
      ...prev,
      offsetX: prev.offsetX + dx,
      offsetY: prev.offsetY + dy,
    }));
  }, [onCursorPosition]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handlePointerLeave = useCallback(() => {
    isDragging.current = false;
    if (onCursorPosition) onCursorPosition(null);
  }, [onCursorPosition]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const container = containerRef.current;
    if (!container) return;

    setViewState(prev => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * (1 + delta)));
      const zoomRatio = newZoom / prev.zoom;
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left - container.clientWidth  / 2;
      const my = e.clientY - rect.top  - container.clientHeight / 2;
      return {
        zoom: newZoom,
        offsetX: mx - (mx - prev.offsetX) * zoomRatio,
        offsetY: my - (my - prev.offsetY) * zoomRatio,
      };
    });
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchActive.current = true;
      isDragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistance.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistance.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = newDist / pinchDistance.current;
      pinchDistance.current = newDist;

      const container = containerRef.current;
      if (!container) return;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = container.getBoundingClientRect();
      const mx = midX - rect.left - container.clientWidth  / 2;
      const my = midY - rect.top  - container.clientHeight / 2;

      setViewState(prev => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * scale));
        const zoomRatio = newZoom / prev.zoom;
        return {
          zoom: newZoom,
          offsetX: mx - (mx - prev.offsetX) * zoomRatio,
          offsetY: my - (my - prev.offsetY) * zoomRatio,
        };
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchDistance.current = null;
      setTimeout(() => { pinchActive.current = false; }, 100);
    }
  }, []);

  // ─── render ──────────────────────────────────────────────────────────────────

  const { offsetX, offsetY, zoom } = viewState;
  const containerWidth  = containerRef.current?.clientWidth  ?? 0;
  const containerHeight = containerRef.current?.clientHeight ?? 0;

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Tile canvases are managed imperatively via chunkLayerRef */}
      <div
        ref={chunkLayerRef}
        className="map-chunk-layer"
        style={{
          transform: `translate(${offsetX + containerWidth / 2}px, ${offsetY + containerHeight / 2}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      />

      {/* Marker overlay — sits above the tile layer, NOT scaled with zoom */}
      <div
        className="map-marker-overlay"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {markers.map(marker => {
          const screenX = marker.x * zoom + offsetX + containerWidth  / 2;
          const screenZ = marker.z * zoom + offsetY + containerHeight / 2;
          return (
            <div
              key={marker.id}
              className="map-marker"
              style={{
                position: 'absolute',
                left: screenX,
                top:  screenZ,
                width: 0,
                height: 0,
              }}
            >
              <div className={`marker-dot ${marker.type}`} />
              <div className="marker-label">{marker.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
