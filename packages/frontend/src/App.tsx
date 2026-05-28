import React, { useState, useCallback } from 'react';
import { WorldInfo, MapMarker, HeightRange, ViewerConfig } from '@mcpe-mapper/shared';
import { MapCanvas } from './components/MapCanvas';
import { ControlsPanel } from './components/ControlsPanel';
import { FileDropZone } from './components/FileDropZone';
import { InfoPanel } from './components/InfoPanel';
import { LoadingIndicator } from './components/LoadingIndicator';
import { OfflineWorldReader } from './services/OfflineWorldReader';
import { BackendService } from './services/BackendService';

export type AppMode = 'idle' | 'offline' | 'backend';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('idle');
  const [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [offlineReader, setOfflineReader] = useState<OfflineWorldReader | null>(null);
  const [backendService, setBackendService] = useState<BackendService | null>(null);
  const [features, setFeatures] = useState({ portals: true, players: true });

  const [config, setConfig] = useState<ViewerConfig>({
    showNetherPortals: true,
    showEndPortals: true,
    showPlayers: true,
    heightRange: { min: -64, max: 320 },
    dimension: 0,
  });

  const handleFileLoad = useCallback(async (file: File) => {
    setLoading(true);
    setLoadingMessage('Loading world file...');

    try {
      const reader = new OfflineWorldReader();
      const info = await reader.loadFile(file);
      setOfflineReader(reader);
      setWorldInfo(info);
      setMode('offline');
      setLoadingMessage('Extracting markers...');
      const worldMarkers = reader.getMarkers();
      setMarkers(worldMarkers);
      setFeatures({ portals: true, players: true });
    } catch (err) {
      console.error('Failed to load world file:', err);
      alert('Failed to load world file. Make sure it is a valid .mcworld file.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  }, []);

  const handleBackendConnect = useCallback(async (url: string) => {
    setLoading(true);
    setLoadingMessage('Connecting to backend...');

    try {
      const service = new BackendService(url);
      const worldInfoResp = await service.getWorldInfo();
      setBackendService(service);
      setWorldInfo(worldInfoResp.info);
      setFeatures(worldInfoResp.features);
      setMode('backend');

      if (worldInfoResp.features.portals || worldInfoResp.features.players) {
        const worldMarkers = await service.getMarkers();
        setMarkers(worldMarkers);
      }

      service.connectWebSocket();
    } catch (err) {
      console.error('Failed to connect to backend:', err);
      alert('Failed to connect to backend. Check the URL and try again.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  }, []);

  const handleConfigChange = useCallback((newConfig: Partial<ViewerConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  const filteredMarkers = markers.filter(m => {
    if (m.dimension !== config.dimension) return false;
    if (m.type === 'nether_portal' && !config.showNetherPortals) return false;
    if (m.type === 'end_portal' && !config.showEndPortals) return false;
    if (m.type === 'player' && !config.showPlayers) return false;
    return true;
  });

  return (
    <div className="app-container">
      {mode === 'idle' && !loading && (
        <FileDropZone onFileLoad={handleFileLoad} onBackendConnect={handleBackendConnect} />
      )}

      {mode !== 'idle' && (
        <>
          <MapCanvas
            mode={mode}
            config={config}
            offlineReader={offlineReader}
            backendService={backendService}
            markers={filteredMarkers}
          />
          <ControlsPanel
            config={config}
            features={features}
            worldInfo={worldInfo}
            onChange={handleConfigChange}
          />
          <InfoPanel worldInfo={worldInfo} config={config} />
        </>
      )}

      {loading && <LoadingIndicator message={loadingMessage} />}
    </div>
  );
};

export default App;
