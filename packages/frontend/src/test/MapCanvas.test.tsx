import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

describe('MapCanvas', () => {
  it('renders a container div element', () => {
    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={[]}
      />
    );
    const mapDiv = container.querySelector('.map-canvas');
    expect(mapDiv).toBeInTheDocument();
  });

  it('has map-canvas class', () => {
    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={[]}
      />
    );
    const mapDiv = container.querySelector('.map-canvas');
    expect(mapDiv).toHaveClass('map-canvas');
  });

  it('contains a chunk layer', () => {
    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={[]}
      />
    );
    const chunkLayer = container.querySelector('.map-chunk-layer');
    expect(chunkLayer).toBeInTheDocument();
  });

  it('renders markers as DOM elements when provided', () => {
    const markers = [
      { id: '1', x: 0, y: 64, z: 0, dimension: 0, type: 'player' as const, label: 'Player 1' },
      { id: '2', x: 100, y: 64, z: 100, dimension: 0, type: 'nether_portal' as const, label: 'Portal' },
    ];

    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={markers}
      />
    );
    const markerElements = container.querySelectorAll('.map-marker');
    expect(markerElements).toHaveLength(2);
  });

  it('renders marker labels', () => {
    const markers = [
      { id: '1', x: 0, y: 64, z: 0, dimension: 0, type: 'player' as const, label: 'Player 1' },
    ];

    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={markers}
      />
    );
    const label = container.querySelector('.marker-label');
    expect(label).toHaveTextContent('Player 1');
  });

  it('renders marker dots with correct type class', () => {
    const markers = [
      { id: '1', x: 0, y: 64, z: 0, dimension: 0, type: 'nether_portal' as const, label: 'NP' },
    ];

    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={markers}
      />
    );
    const dot = container.querySelector('.marker-dot');
    expect(dot).toHaveClass('nether_portal');
  });
});
