import React, { useState } from 'react';
import { ViewerConfig, WorldInfo } from '@mcpe-mapper/shared';

interface ControlsPanelProps {
  config: ViewerConfig;
  features: { portals: boolean; players: boolean };
  worldInfo: WorldInfo | null;
  onChange: (config: Partial<ViewerConfig>) => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  config,
  features,
  worldInfo,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="controls-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle controls"
      >
        ☰
      </button>
      <div className={`controls-panel ${isOpen ? 'open' : ''}`}>
        {worldInfo && (
          <div className="control-group">
            <h3>🗺️ {worldInfo.name}</h3>
          </div>
        )}

        <div className="control-group">
          <h3>Dimension</h3>
          <div className="dimension-selector">
            <button
              className={config.dimension === 0 ? 'active' : ''}
              onClick={() => onChange({ dimension: 0 })}
            >
              Overworld
            </button>
            <button
              className={config.dimension === 1 ? 'active' : ''}
              onClick={() => onChange({ dimension: 1 })}
            >
              Nether
            </button>
            <button
              className={config.dimension === 2 ? 'active' : ''}
              onClick={() => onChange({ dimension: 2 })}
            >
              End
            </button>
          </div>
        </div>

        <div className="control-group">
          <h3>Height Range</h3>
          <label>
            Min: {config.heightRange.min}
            <input
              type="range"
              min={-64}
              max={320}
              value={config.heightRange.min}
              onChange={(e) =>
                onChange({
                  heightRange: {
                    ...config.heightRange,
                    min: Math.min(Number(e.target.value), config.heightRange.max - 1),
                  },
                })
              }
            />
          </label>
          <label>
            Max: {config.heightRange.max}
            <input
              type="range"
              min={-64}
              max={320}
              value={config.heightRange.max}
              onChange={(e) =>
                onChange({
                  heightRange: {
                    ...config.heightRange,
                    max: Math.max(Number(e.target.value), config.heightRange.min + 1),
                  },
                })
              }
            />
          </label>
        </div>

        <div className="control-group">
          <h3>Markers</h3>
          {features.portals && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={config.showNetherPortals}
                  onChange={(e) => onChange({ showNetherPortals: e.target.checked })}
                />
                Nether Portals
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.showEndPortals}
                  onChange={(e) => onChange({ showEndPortals: e.target.checked })}
                />
                End Portals
              </label>
            </>
          )}
          {features.players && (
            <label>
              <input
                type="checkbox"
                checked={config.showPlayers}
                onChange={(e) => onChange({ showPlayers: e.target.checked })}
              />
              Players
            </label>
          )}
        </div>
      </div>
    </>
  );
};
