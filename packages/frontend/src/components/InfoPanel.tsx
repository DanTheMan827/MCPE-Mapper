import React from 'react';
import { WorldInfo, ViewerConfig } from '@mcpe-mapper/shared';

interface InfoPanelProps {
  worldInfo: WorldInfo | null;
  config: ViewerConfig;
}

const DIMENSION_NAMES: Record<number, string> = {
  0: 'Overworld',
  1: 'Nether',
  2: 'The End',
};

export const InfoPanel: React.FC<InfoPanelProps> = ({ worldInfo, config }) => {
  if (!worldInfo) return null;

  return (
    <div className="info-panel">
      <div>
        Dimension: <span className="coord">{DIMENSION_NAMES[config.dimension] || `Dim ${config.dimension}`}</span>
      </div>
      <div>
        Spawn: <span className="coord">{worldInfo.spawnX}, {worldInfo.spawnY}, {worldInfo.spawnZ}</span>
      </div>
      <div>
        Height: <span className="coord">{config.heightRange.min} → {config.heightRange.max}</span>
      </div>
    </div>
  );
};
