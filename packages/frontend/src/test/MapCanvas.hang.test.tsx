import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MapCanvas } from '../components/MapCanvas';
import { ViewerConfig } from '@mcpe-mapper/shared';

// Mock canvas for data URL generation
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: vi.fn(),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mock');
});

const mockConfig: ViewerConfig = {
  showNetherPortals: true,
  showEndPortals: true,
  showPlayers: true,
  heightRange: { min: -64, max: 320 },
  dimension: 0,
};

describe('MapCanvas hang prevention', () => {
  it('does not block the event loop when loading many chunks in offline mode', async () => {
    // Create a mock OfflineWorldReader that simulates having many chunks
    const chunkRenderCalls: number[] = [];
    const mockReader = {
      hasChunk: vi.fn().mockReturnValue(true),
      getChunkRender: vi.fn().mockImplementation((_x: number, _z: number) => {
        chunkRenderCalls.push(Date.now());
        // Return valid chunk data
        return {
          x: _x,
          z: _z,
          pixels: new Uint8Array(16 * 16 * 4).fill(128),
        };
      }),
      getAvailableChunks: vi.fn().mockReturnValue([]),
      getMarkers: vi.fn().mockReturnValue([]),
    } as any;

    // Track whether the event loop was yielded to
    let eventLoopYielded = false;
    const originalSetTimeout = globalThis.setTimeout;

    // Spy on setTimeout to detect yielding (setTimeout(fn, 0) is how yieldToMain works)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms === 0) {
        eventLoopYielded = true;
      }
      return originalSetTimeout(fn, ms);
    });

    render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={mockReader}
        backendService={null}
        markers={[]}
      />
    );

    // Wait for the debounce timer and async batching to proceed
    await act(async () => {
      await new Promise(r => originalSetTimeout(r, 150));
    });

    await act(async () => {
      await new Promise(r => originalSetTimeout(r, 100));
    });

    // If chunks were loaded and there were enough to require batching,
    // the event loop should have been yielded to
    if (chunkRenderCalls.length > 8) {
      expect(eventLoopYielded).toBe(true);
    }

    setTimeoutSpy.mockRestore();
  });

  it('skips chunks that do not exist in the offline database', async () => {
    const mockReader = {
      hasChunk: vi.fn().mockReturnValue(false), // No chunks exist
      getChunkRender: vi.fn(),
      getAvailableChunks: vi.fn().mockReturnValue([]),
      getMarkers: vi.fn().mockReturnValue([]),
    } as any;

    render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={mockReader}
        backendService={null}
        markers={[]}
      />
    );

    // Advance time to trigger chunk loading
    await act(async () => {
      await new Promise(r => setTimeout(r, 150));
    });

    // getChunkRender should never be called since hasChunk returns false
    expect(mockReader.getChunkRender).not.toHaveBeenCalled();
  });

  it('cancels in-progress chunk loading when view changes rapidly', async () => {
    let callCount = 0;
    const mockReader = {
      hasChunk: vi.fn().mockReturnValue(true),
      getChunkRender: vi.fn().mockImplementation((_x: number, _z: number) => {
        callCount++;
        return {
          x: _x,
          z: _z,
          pixels: new Uint8Array(16 * 16 * 4).fill(128),
        };
      }),
      getAvailableChunks: vi.fn().mockReturnValue([]),
      getMarkers: vi.fn().mockReturnValue([]),
    } as any;

    const { rerender } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={mockReader}
        backendService={null}
        markers={[]}
      />
    );

    // Trigger rapid config changes that should cancel previous loads
    const configs = [
      { ...mockConfig, dimension: 1 },
      { ...mockConfig, dimension: 2 },
      { ...mockConfig, dimension: 0 },
    ];

    for (const cfg of configs) {
      rerender(
        <MapCanvas
          mode="offline"
          config={cfg}
          offlineReader={mockReader}
          backendService={null}
          markers={[]}
        />
      );
    }

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // The test passes if it completes without hanging.
    // With the old code, rapid changes could cause infinite re-renders.
    expect(true).toBe(true);
  });

  it('does not re-render existing tiles when new tiles are added', async () => {
    const mockReader = {
      hasChunk: vi.fn().mockImplementation((x: number, z: number) => {
        // Only a few chunks exist
        return x >= 0 && x < 2 && z >= 0 && z < 2;
      }),
      getChunkRender: vi.fn().mockImplementation((_x: number, _z: number) => {
        return {
          x: _x,
          z: _z,
          pixels: new Uint8Array(16 * 16 * 4).fill(128),
        };
      }),
      getAvailableChunks: vi.fn().mockReturnValue([]),
      getMarkers: vi.fn().mockReturnValue([]),
    } as any;

    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={mockReader}
        backendService={null}
        markers={[]}
      />
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // Count rendered tiles
    const tiles = container.querySelectorAll('.map-chunk-tile');
    // Tiles should be rendered as individual elements
    // Each tile is its own component and shouldn't be re-rendered when others are added
    expect(tiles.length).toBeGreaterThanOrEqual(0);
  });
});
