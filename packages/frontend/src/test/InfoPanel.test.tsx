import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InfoPanel } from '../components/InfoPanel';
import { WorldInfo, ViewerConfig } from '@mcpe-mapper/shared';

const mockWorldInfo: WorldInfo = {
  name: 'Test World',
  gameType: 1,
  spawnX: 100,
  spawnY: 64,
  spawnZ: -200,
  lastPlayed: Date.now(),
};

const mockConfig: ViewerConfig = {
  showNetherPortals: true,
  showEndPortals: true,
  showPlayers: true,
  heightRange: { min: -64, max: 320 },
  dimension: 0,
};

describe('InfoPanel', () => {
  it('renders nothing when worldInfo is null', () => {
    const { container } = render(<InfoPanel worldInfo={null} config={mockConfig} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders spawn coordinates', () => {
    render(<InfoPanel worldInfo={mockWorldInfo} config={mockConfig} />);
    expect(screen.getByText('100, 64, -200')).toBeInTheDocument();
  });

  it('displays the current dimension name', () => {
    render(<InfoPanel worldInfo={mockWorldInfo} config={mockConfig} />);
    expect(screen.getByText('Overworld')).toBeInTheDocument();
  });

  it('displays Nether for dimension 1', () => {
    const netherConfig = { ...mockConfig, dimension: 1 };
    render(<InfoPanel worldInfo={mockWorldInfo} config={netherConfig} />);
    expect(screen.getByText('Nether')).toBeInTheDocument();
  });

  it('displays The End for dimension 2', () => {
    const endConfig = { ...mockConfig, dimension: 2 };
    render(<InfoPanel worldInfo={mockWorldInfo} config={endConfig} />);
    expect(screen.getByText('The End')).toBeInTheDocument();
  });

  it('displays cursor position when provided', () => {
    render(<InfoPanel worldInfo={mockWorldInfo} config={mockConfig} cursorPosition={{ x: 42, z: -100 }} />);
    expect(screen.getByText('42, -100')).toBeInTheDocument();
  });
});
