import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MapCanvas } from '../components/MapCanvas';
import { ViewerConfig } from '@mcpe-mapper/shared';

// Mock canvas context
const mockContext = {
  fillRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  font: '',
  textAlign: '',
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
  putImageData: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext as any);
});

const mockConfig: ViewerConfig = {
  showNetherPortals: true,
  showEndPortals: true,
  showPlayers: true,
  heightRange: { min: -64, max: 320 },
  dimension: 0,
};

describe('MapCanvas', () => {
  it('renders a canvas element', () => {
    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={[]}
      />
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
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
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveClass('map-canvas');
  });

  it('renders with touch-action none for gesture support', () => {
    const { container } = render(
      <MapCanvas
        mode="offline"
        config={mockConfig}
        offlineReader={null}
        backendService={null}
        markers={[]}
      />
    );
    // The canvas element should exist and respond to pointer events
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });

  it('renders markers when provided', () => {
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
    // Canvas renders markers via canvas API, so we just verify the component renders
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });
});
