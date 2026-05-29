import React, { useState, useCallback, useEffect } from 'react';
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
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; z: number } | null>(null);
  const [navigateTo, setNavigateTo] = useState<{ x: number; z: number; dimension: number } | null>(null);

  const [config, setConfig] = useState<ViewerConfig>({
    showNetherPortals: true,
    showEndPortals: true,
    showPlayers: true,
    heightRange: { min: -64, max: 320 },
    dimension: 0,
  });

  // Check if a backend WebSocket is available at ./bedrock-socket
  useEffect(() => {
    if (mode !== 'idle') return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}${window.location.pathname.replace(/\/$/, '')}/bedrock-socket`;

    let ws: WebSocket | null = null;
    let cancelled = false;

    try {
      ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        if (!cancelled) {
          cancelled = true;
          ws?.close();
          setBackendAvailable(false);
        }
      }, 3000);

      ws.onopen = () => {
        if (cancelled) { ws?.close(); return; }
        clearTimeout(timeout);
        cancelled = true;
        ws?.close();
        // Backend is available - auto-connect using the base URL
        const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
        handleBackendConnect(baseUrl);
      };

      ws.onerror = () => {
        if (cancelled) return;
        clearTimeout(timeout);
        cancelled = true;
        setBackendAvailable(false);
      };

      ws.onclose = () => {
        if (cancelled) return;
        clearTimeout(timeout);
        cancelled = true;
        setBackendAvailable(false);
      };
    } catch {
      setBackendAvailable(false);
    }

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handlePlayerNavigate = useCallback((marker: MapMarker) => {
    // Switch dimension if needed, then navigate to the player's position
    if (marker.dimension !== config.dimension) {
      setConfig(prev => ({ ...prev, dimension: marker.dimension }));
    }
    setNavigateTo({ x: marker.x, z: marker.z, dimension: marker.dimension });
  }, [config.dimension]);

  const filteredMarkers = markers.filter(m => {
    if (m.dimension !== config.dimension) return false;
    if (m.type === 'nether_portal' && !config.showNetherPortals) return false;
    if (m.type === 'end_portal' && !config.showEndPortals) return false;
    if (m.type === 'player' && !config.showPlayers) return false;
    return true;
  });

  const playerMarkers = markers.filter(m => m.type === 'player');

  return (
    <div className="app-container">
      {mode === 'idle' && !loading && backendAvailable === false && (
        <FileDropZone
          onFileLoad={handleFileLoad}
          onBackendConnect={handleBackendConnect}
          showBackendOption={false}
        />
      )}

      {mode === 'idle' && backendAvailable === null && !loading && (
        <LoadingIndicator message="Checking for backend..." />
      )}

      {mode !== 'idle' && (
        <>
          <MapCanvas
            mode={mode}
            config={config}
            offlineReader={offlineReader}
            backendService={backendService}
            markers={filteredMarkers}
            onCursorPosition={setCursorPosition}
            navigateTo={navigateTo}
          />
          <ControlsPanel
            config={config}
            features={features}
            worldInfo={worldInfo}
            onChange={handleConfigChange}
            playerMarkers={playerMarkers}
            onPlayerNavigate={handlePlayerNavigate}
          />
          <InfoPanel worldInfo={worldInfo} config={config} cursorPosition={cursorPosition} />
        </>
      )}

      {loading && <LoadingIndicator message={loadingMessage} />}
    </div>
  );
};

export default App;
