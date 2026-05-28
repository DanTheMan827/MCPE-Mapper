import React, { useRef, useEffect, useState, useCallback, memo, useMemo } from 'react';
import { ViewerConfig, MapMarker, ChunkCoord } from '@mcpe-mapper/shared';
import { OfflineWorldReader } from '../services/OfflineWorldReader';
import { BackendService } from '../services/BackendService';
import { AppMode } from '../App';

interface MapCanvasProps {
  mode: AppMode;
  config: ViewerConfig;
  offlineReader: OfflineWorldReader | null;
  backendService: BackendService | null;
  markers: MapMarker[];
}

const CHUNK_SIZE = 16;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 32;
/** Number of chunks to process per batch before yielding to the event loop */
const CHUNK_BATCH_SIZE = 8;


interface ChunkTileData {
  key: string;
  x: number;
  z: number;
  pixels: Uint8ClampedArray;
}

/** Individual chunk tile rendered as a canvas element - only re-renders when its pixels change */
const ChunkTile = memo<{ tile: ChunkTileData }>(({ tile }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = new ImageData(tile.pixels, 16, 16);
    ctx.putImageData(imageData, 0, 0);
  }, [tile.pixels]);

  return (
    <canvas
      ref={canvasRef}
      className="map-chunk-tile"
      width={16}
      height={16}
      style={{
        left: tile.x * CHUNK_SIZE,
        top: tile.z * CHUNK_SIZE,
        width: CHUNK_SIZE,
        height: CHUNK_SIZE,
      }}
    />
  );
});
ChunkTile.displayName = 'ChunkTile';

/** Yield control back to the event loop */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  mode,
  config,
  offlineReader,
  backendService,
  markers,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    zoom: 2,
  });
  const [chunkTiles, setChunkTiles] = useState<Map<string, ChunkTileData>>(new Map());
  const pendingChunks = useRef<Set<string>>(new Set());
  /** Tracks chunks that returned no data so we don't re-request them */
  const emptyChunks = useRef<Set<string>>(new Set());
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef<number | null>(null);
  const pinchActive = useRef(false);
  const activeTouches = useRef(0);
  /** Cancellation flag for in-progress chunk loading */
  const loadGeneration = useRef(0);
  /** Whether a load task is currently running */
  const loadRunning = useRef(false);
  /** Pending load request to run after current one finishes */
  const pendingLoad = useRef(false);

  // Load chunks that are visible (and would be visible when zooming out)
  const loadVisibleChunks = useCallback(async () => {
    // Only allow one rendering task at a time
    if (loadRunning.current) {
      pendingLoad.current = true;
      return;
    }
    loadRunning.current = true;
    pendingLoad.current = false;

    const container = containerRef.current;
    if (!container) {
      loadRunning.current = false;
      return;
    }

    const generation = ++loadGeneration.current;

    const { offsetX, offsetY, zoom } = viewState;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Use a lower zoom (more zoomed out) to pre-render tiles that would
    // become visible when zooming out
    const effectiveZoom = Math.max(MIN_ZOOM, zoom * 0.5);
    const pixelSize = CHUNK_SIZE * effectiveZoom;
    const startChunkX = Math.floor((-offsetX - width / 2) / pixelSize) - 1;
    const endChunkX = Math.ceil((-offsetX + width / 2) / pixelSize) + 1;
    const startChunkZ = Math.floor((-offsetY - height / 2) / pixelSize) - 1;
    const endChunkZ = Math.ceil((-offsetY + height / 2) / pixelSize) + 1;

    // Center chunk for distance sorting
    const centerChunkX = -offsetX / (CHUNK_SIZE * zoom);
    const centerChunkZ = -offsetY / (CHUNK_SIZE * zoom);

    const chunksToLoad: ChunkCoord[] = [];

    for (let cx = startChunkX; cx <= endChunkX; cx++) {
      for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
        const key = `${cx},${cz},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
        // Skip if already rendered, already pending, or previously returned empty
        if (pendingChunks.current.has(key) || emptyChunks.current.has(key)) {
          continue;
        }
        // Check if already in tile state
        if (chunkTiles.has(key)) continue;
        // Skip chunks that don't exist in the offline database
        if (mode === 'offline' && offlineReader && !offlineReader.hasChunk(cx, cz, config.dimension)) {
          emptyChunks.current.add(key);
          continue;
        }
        chunksToLoad.push({ x: cx, z: cz });
        pendingChunks.current.add(key);
      }
    }

    if (chunksToLoad.length === 0) {
      loadRunning.current = false;
      // If a new request came in while we were checking, run it
      if (pendingLoad.current) {
        pendingLoad.current = false;
        loadVisibleChunks();
      }
      return;
    }

    // Sort chunks from closest to center going outward
    chunksToLoad.sort((a, b) => {
      const distA = (a.x - centerChunkX) ** 2 + (a.z - centerChunkZ) ** 2;
      const distB = (b.x - centerChunkX) ** 2 + (b.z - centerChunkZ) ** 2;
      return distA - distB;
    });

    if (mode === 'offline' && offlineReader) {
      // Process in small batches, yielding to the event loop between batches
      for (let i = 0; i < chunksToLoad.length; i += CHUNK_BATCH_SIZE) {
        // Check if this load has been superseded
        if (loadGeneration.current !== generation) break;

        const batch = chunksToLoad.slice(i, i + CHUNK_BATCH_SIZE);
        const newTiles = new Map<string, ChunkTileData>();

        for (const coord of batch) {
          const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
          const chunkData = offlineReader.getChunkRender(
            coord.x,
            coord.z,
            config.dimension,
            config.heightRange
          );
          if (chunkData) {
            const pixels = new Uint8ClampedArray(chunkData.pixels);
            newTiles.set(key, { key, x: coord.x, z: coord.z, pixels });
          } else {
            emptyChunks.current.add(key);
          }
          pendingChunks.current.delete(key);
        }

        // Merge batch results into state
        if (newTiles.size > 0) {
          setChunkTiles(prev => {
            const updated = new Map(prev);
            for (const [k, v] of newTiles) {
              updated.set(k, v);
            }
            return updated;
          });
        }

        // Yield to the event loop to prevent hanging
        if (i + CHUNK_BATCH_SIZE < chunksToLoad.length) {
          await yieldToMain();
        }
      }
    } else if (mode === 'backend' && backendService) {
      const batchSize = 32;
      for (let i = 0; i < chunksToLoad.length; i += batchSize) {
        if (loadGeneration.current !== generation) break;

        const batch = chunksToLoad.slice(i, i + batchSize);
        try {
          const chunkDataList = await backendService.getChunks(
            batch,
            config.dimension,
            config.heightRange
          );

          if (loadGeneration.current !== generation) break;

          const newTiles = new Map<string, ChunkTileData>();
          const returnedKeys = new Set<string>();

          for (const chunkData of chunkDataList) {
            const key = `${chunkData.x},${chunkData.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            const pixels = new Uint8ClampedArray(chunkData.pixels);
            newTiles.set(key, { key, x: chunkData.x, z: chunkData.z, pixels });
            pendingChunks.current.delete(key);
            returnedKeys.add(key);
          }

          for (const coord of batch) {
            const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            if (!returnedKeys.has(key)) {
              emptyChunks.current.add(key);
              pendingChunks.current.delete(key);
            }
          }

          if (newTiles.size > 0) {
            setChunkTiles(prev => {
              const updated = new Map(prev);
              for (const [k, v] of newTiles) {
                updated.set(k, v);
              }
              return updated;
            });
          }
        } catch (err) {
          console.error('Failed to load chunks:', err);
          for (const coord of batch) {
            const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            pendingChunks.current.delete(key);
          }
        }
      }
    }

    loadRunning.current = false;
    // If a new load was requested while this one was running, start it
    if (pendingLoad.current) {
      pendingLoad.current = false;
      loadVisibleChunks();
    }
  }, [mode, offlineReader, backendService, config, viewState, chunkTiles]);

  // Clear cache when config changes
  useEffect(() => {
    pendingChunks.current.clear();
    emptyChunks.current.clear();
    setChunkTiles(new Map());
  }, [config.dimension, config.heightRange.min, config.heightRange.max]);

  // Subscribe to WebSocket chunk updates to invalidate specific cached chunks
  useEffect(() => {
    if (mode !== 'backend' || !backendService) return;

    const unsubscribe = backendService.onChunkUpdate((updatedCoords) => {
      for (const coord of updatedCoords) {
        const prefix = `${coord.x},${coord.z},`;
        for (const key of emptyChunks.current) {
          if (key.startsWith(prefix)) {
            emptyChunks.current.delete(key);
          }
        }
        setChunkTiles(prev => {
          const updated = new Map(prev);
          for (const key of updated.keys()) {
            if (key.startsWith(prefix)) {
              updated.delete(key);
            }
          }
          return updated;
        });
      }
    });

    return unsubscribe;
  }, [mode, backendService]);

  // Load chunks when view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      loadVisibleChunks();
    }, 100);
    return () => clearTimeout(timer);
  }, [viewState, config, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse/touch handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (pinchActive.current) return;
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || pinchActive.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setViewState(prev => ({
      ...prev,
      offsetX: prev.offsetX + dx,
      offsetY: prev.offsetY + dy,
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const container = containerRef.current;
    if (!container) return;

    setViewState(prev => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * (1 + delta)));
      const zoomRatio = newZoom / prev.zoom;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left - container.clientWidth / 2;
      const my = e.clientY - rect.top - container.clientHeight / 2;

      return {
        zoom: newZoom,
        offsetX: mx - (mx - prev.offsetX) * zoomRatio,
        offsetY: my - (my - prev.offsetY) * zoomRatio,
      };
    });
  }, []);

  // Touch gesture handling (pinch zoom)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    activeTouches.current = e.touches.length;
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

      // Zoom centered on pinch midpoint
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = container.getBoundingClientRect();
      const mx = midX - rect.left - container.clientWidth / 2;
      const my = midY - rect.top - container.clientHeight / 2;

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
    activeTouches.current = e.touches.length;
    if (e.touches.length < 2) {
      pinchDistance.current = null;
      // Delay clearing pinch state to prevent stale pointer events from causing jitter
      setTimeout(() => {
        pinchActive.current = false;
      }, 100);
    }
  }, []);

  const { offsetX, offsetY, zoom } = viewState;

  // Compute which tiles are currently visible in the viewport for culling.
  // Non-visible tiles are kept in memory (chunkTiles) but not rendered in the DOM.
  const visibleTiles = useMemo(() => {
    const container = containerRef.current;
    const width = container?.clientWidth || 0;
    const height = container?.clientHeight || 0;
    if (width === 0 || height === 0) return Array.from(chunkTiles.values());

    const pixelSize = CHUNK_SIZE * zoom;
    const startChunkX = Math.floor((-offsetX - width / 2) / pixelSize) - 1;
    const endChunkX = Math.ceil((-offsetX + width / 2) / pixelSize) + 1;
    const startChunkZ = Math.floor((-offsetY - height / 2) / pixelSize) - 1;
    const endChunkZ = Math.ceil((-offsetY + height / 2) / pixelSize) + 1;

    const result: ChunkTileData[] = [];
    for (const tile of chunkTiles.values()) {
      if (tile.x >= startChunkX && tile.x <= endChunkX &&
          tile.z >= startChunkZ && tile.z <= endChunkZ) {
        result.push(tile);
      }
    }
    return result;
  }, [chunkTiles, offsetX, offsetY, zoom]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Chunk layer */}
      <div
        className="map-chunk-layer"
        style={{
          transform: `translate(${offsetX + (containerRef.current?.clientWidth || 0) / 2}px, ${offsetY + (containerRef.current?.clientHeight || 0) / 2}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {visibleTiles.map(tile => (
          <ChunkTile key={tile.key} tile={tile} />
        ))}

        {/* Markers */}
        {markers.map(marker => (
          <div
            key={marker.id}
            className="map-marker"
            style={{
              left: marker.x,
              top: marker.z,
            }}
          >
            <div className={`marker-dot ${marker.type}`} />
            <div className="marker-label">{marker.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
