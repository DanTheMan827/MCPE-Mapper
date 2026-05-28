import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControlsPanel } from '../components/ControlsPanel';
import { ViewerConfig, WorldInfo } from '@mcpe-mapper/shared';

const mockConfig: ViewerConfig = {
  showNetherPortals: true,
  showEndPortals: true,
  showPlayers: true,
  heightRange: { min: -64, max: 320 },
  dimension: 0,
};

const mockWorldInfo: WorldInfo = {
  name: 'My World',
  gameType: 0,
  spawnX: 0,
  spawnY: 64,
  spawnZ: 0,
  lastPlayed: 0,
};

const mockFeatures = { portals: true, players: true };

describe('ControlsPanel', () => {
  it('renders the world name', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/My World/)).toBeInTheDocument();
  });

  it('renders dimension buttons', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('Overworld')).toBeInTheDocument();
    expect(screen.getByText('Nether')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
  });

  it('marks current dimension as active', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('Overworld')).toHaveClass('active');
    expect(screen.getByText('Nether')).not.toHaveClass('active');
  });

  it('calls onChange when dimension button is clicked', () => {
    const onChange = vi.fn();
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('Nether'));
    expect(onChange).toHaveBeenCalledWith({ dimension: 1 });
  });

  it('renders marker checkboxes when features are enabled', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('Nether Portals')).toBeInTheDocument();
    expect(screen.getByText('End Portals')).toBeInTheDocument();
    expect(screen.getByText('Players')).toBeInTheDocument();
  });

  it('hides portal checkboxes when portals feature is disabled', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={{ portals: false, players: true }}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.queryByText('Nether Portals')).not.toBeInTheDocument();
    expect(screen.queryByText('End Portals')).not.toBeInTheDocument();
    expect(screen.getByText('Players')).toBeInTheDocument();
  });

  it('hides player checkbox when players feature is disabled', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={{ portals: true, players: false }}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.queryByText('Players')).not.toBeInTheDocument();
  });

  it('calls onChange when nether portal checkbox is toggled', () => {
    const onChange = vi.fn();
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={onChange}
      />
    );
    const checkbox = screen.getByText('Nether Portals').parentElement?.querySelector('input');
    fireEvent.click(checkbox!);
    expect(onChange).toHaveBeenCalledWith({ showNetherPortals: false });
  });

  it('renders height range sliders', () => {
    render(
      <ControlsPanel
        config={mockConfig}
        features={mockFeatures}
        worldInfo={mockWorldInfo}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Min: -64/)).toBeInTheDocument();
    expect(screen.getByText(/Max: 320/)).toBeInTheDocument();
  });
});
