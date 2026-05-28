import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ViewerConfig, MapMarker, ChunkRenderData, ChunkCoord } from '@mcpe-mapper/shared';
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

export const MapCanvas: React.FC<MapCanvasProps> = ({
  mode,
  config,
  offlineReader,
  backendService,
  markers,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    zoom: 2,
  });
  const renderedChunks = useRef<Map<string, ImageData>>(new Map());
  const pendingChunks = useRef<Set<string>>(new Set());
  /** Tracks chunks that returned no data so we don't re-request them */
  const emptyChunks = useRef<Set<string>>(new Set());
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef<number | null>(null);
  const animFrameRef = useRef<number>(0);

  // Load chunks that are visible
  const loadVisibleChunks = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { offsetX, offsetY, zoom } = viewState;
    const width = canvas.width;
    const height = canvas.height;

    // Calculate visible chunk range
    const pixelSize = CHUNK_SIZE * zoom;
    const startChunkX = Math.floor((-offsetX - width / 2) / pixelSize) - 1;
    const endChunkX = Math.ceil((-offsetX + width / 2) / pixelSize) + 1;
    const startChunkZ = Math.floor((-offsetY - height / 2) / pixelSize) - 1;
    const endChunkZ = Math.ceil((-offsetY + height / 2) / pixelSize) + 1;

    const chunksToLoad: ChunkCoord[] = [];

    for (let cx = startChunkX; cx <= endChunkX; cx++) {
      for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
        const key = `${cx},${cz},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
        // Skip if already rendered, already pending, or previously returned empty
        if (renderedChunks.current.has(key) || pendingChunks.current.has(key) || emptyChunks.current.has(key)) {
          continue;
        }
        chunksToLoad.push({ x: cx, z: cz });
        pendingChunks.current.add(key);
      }
    }

    if (chunksToLoad.length === 0) return;

    if (mode === 'offline' && offlineReader) {
      // Load chunks from offline reader
      for (const coord of chunksToLoad) {
        const chunkData = offlineReader.getChunkRender(
          coord.x,
          coord.z,
          config.dimension,
          config.heightRange
        );
        const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
        if (chunkData) {
          const imageData = new ImageData(
            new Uint8ClampedArray(chunkData.pixels),
            16,
            16
          );
          renderedChunks.current.set(key, imageData);
        } else {
          // Mark as empty so we don't re-request it
          emptyChunks.current.add(key);
        }
        pendingChunks.current.delete(key);
      }
    } else if (mode === 'backend' && backendService) {
      // Load chunks from backend in batches
      const batchSize = 32;
      for (let i = 0; i < chunksToLoad.length; i += batchSize) {
        const batch = chunksToLoad.slice(i, i + batchSize);
        try {
          const chunkDataList = await backendService.getChunks(
            batch,
            config.dimension,
            config.heightRange
          );

          // Track which chunks actually returned data
          const returnedKeys = new Set<string>();
          for (const chunkData of chunkDataList) {
            const key = `${chunkData.x},${chunkData.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            const imageData = new ImageData(
              new Uint8ClampedArray(chunkData.pixels),
              16,
              16
            );
            renderedChunks.current.set(key, imageData);
            pendingChunks.current.delete(key);
            returnedKeys.add(key);
          }

          // Mark chunks that weren't returned as empty
          for (const coord of batch) {
            const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            if (!returnedKeys.has(key)) {
              emptyChunks.current.add(key);
              pendingChunks.current.delete(key);
            }
          }
        } catch (err) {
          console.error('Failed to load chunks:', err);
          // Clear pending state so they can be retried on network error
          for (const coord of batch) {
            const key = `${coord.x},${coord.z},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
            pendingChunks.current.delete(key);
          }
        }
      }
    }
  }, [mode, offlineReader, backendService, config, viewState]);

  // Clear cache when config changes
  useEffect(() => {
    renderedChunks.current.clear();
    pendingChunks.current.clear();
    emptyChunks.current.clear();
  }, [config.dimension, config.heightRange.min, config.heightRange.max]);

  // Subscribe to WebSocket chunk updates to invalidate specific cached chunks
  useEffect(() => {
    if (mode !== 'backend' || !backendService) return;

    const unsubscribe = backendService.onChunkUpdate((updatedCoords) => {
      // Only invalidate the specific chunks that were updated
      for (const coord of updatedCoords) {
        // Remove from all caches with any height range (since data changed)
        const prefix = `${coord.x},${coord.z},`;
        for (const key of renderedChunks.current.keys()) {
          if (key.startsWith(prefix)) {
            renderedChunks.current.delete(key);
          }
        }
        for (const key of emptyChunks.current) {
          if (key.startsWith(prefix)) {
            emptyChunks.current.delete(key);
          }
        }
      }
    });

    return unsubscribe;
  }, [mode, backendService]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const { offsetX, offsetY, zoom } = viewState;
      const width = canvas.width;
      const height = canvas.height;

      // Clear
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, width, height);

      // Save state
      ctx.save();
      ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
      ctx.scale(zoom, zoom);

      // Draw grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1 / zoom;

      const pixelSize = CHUNK_SIZE;
      const startChunkX = Math.floor((-offsetX / zoom - width / 2 / zoom) / pixelSize) - 1;
      const endChunkX = Math.ceil((-offsetX / zoom + width / 2 / zoom) / pixelSize) + 1;
      const startChunkZ = Math.floor((-offsetY / zoom - height / 2 / zoom) / pixelSize) - 1;
      const endChunkZ = Math.ceil((-offsetY / zoom + height / 2 / zoom) / pixelSize) + 1;

      // Draw rendered chunks
      ctx.imageSmoothingEnabled = false;

      for (let cx = startChunkX; cx <= endChunkX; cx++) {
        for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
          const key = `${cx},${cz},${config.dimension},${config.heightRange.min},${config.heightRange.max}`;
          const imageData = renderedChunks.current.get(key);
          if (imageData) {
            // Create a temporary canvas to draw ImageData
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = 16;
            tmpCanvas.height = 16;
            const tmpCtx = tmpCanvas.getContext('2d')!;
            tmpCtx.putImageData(imageData, 0, 0);
            ctx.drawImage(tmpCanvas, cx * 16, cz * 16, 16, 16);
          }
        }
      }

      // Draw markers
      for (const marker of markers) {
        const mx = marker.x;
        const mz = marker.z;

        ctx.save();
        ctx.translate(mx, mz);

        const markerSize = 4 / zoom;

        if (marker.type === 'player') {
          ctx.fillStyle = '#4fc3f7';
        } else if (marker.type === 'nether_portal') {
          ctx.fillStyle = '#9c27b0';
        } else {
          ctx.fillStyle = '#66bb6a';
        }

        ctx.beginPath();
        ctx.arc(0, 0, markerSize, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        // Label
        const fontSize = Math.max(8, 12 / zoom);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(marker.label, 0, -markerSize - 4 / zoom);

        ctx.restore();
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [viewState, config, markers]);

  // Load chunks when view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      loadVisibleChunks();
    }, 100);
    return () => clearTimeout(timer);
  }, [loadVisibleChunks]);

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Mouse/touch handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
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
    setViewState(prev => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * (1 + delta)));
      const zoomRatio = newZoom / prev.zoom;

      // Zoom toward cursor position
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - canvas.width / 2;
      const my = e.clientY - rect.top - canvas.height / 2;

      return {
        zoom: newZoom,
        offsetX: mx - (mx - prev.offsetX) * zoomRatio,
        offsetY: my - (my - prev.offsetY) * zoomRatio,
      };
    });
  }, []);

  // Touch gesture handling (pinch zoom)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistance.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistance.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = newDist / pinchDistance.current;
      pinchDistance.current = newDist;

      setViewState(prev => ({
        ...prev,
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * scale)),
      }));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    pinchDistance.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="map-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
};
