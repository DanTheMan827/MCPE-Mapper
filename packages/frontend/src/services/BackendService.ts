import { ChunkCoord, ChunkRenderData, HeightRange, MapMarker, WorldInfo, WorldInfoResponse } from '@mcpe-mapper/shared';

/**
 * Service for communicating with the backend API
 */
export class BackendService {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private chunkUpdateCallbacks: ((chunks: ChunkCoord[]) => void)[] = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getWorldInfo(): Promise<WorldInfoResponse> {
    const res = await fetch(`${this.baseUrl}/api/world`);
    if (!res.ok) throw new Error(`Failed to fetch world info: ${res.statusText}`);
    return res.json();
  }

  async getChunks(chunks: ChunkCoord[], dimension: number, heightRange: HeightRange): Promise<ChunkRenderData[]> {
    const res = await fetch(`${this.baseUrl}/api/chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks, dimension, heightRange }),
    });
    if (!res.ok) throw new Error(`Failed to fetch chunks: ${res.statusText}`);
    const data = await res.json();
    // Convert base64 pixel data back to Uint8Array
    return data.chunks.map((c: { x: number; z: number; pixels: string }) => ({
      x: c.x,
      z: c.z,
      pixels: Uint8Array.from(atob(c.pixels), ch => ch.charCodeAt(0)),
    }));
  }

  async getMarkers(): Promise<MapMarker[]> {
    const res = await fetch(`${this.baseUrl}/api/markers`);
    if (!res.ok) throw new Error(`Failed to fetch markers: ${res.statusText}`);
    const data = await res.json();
    return data.markers;
  }

  connectWebSocket(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chunk_updated') {
          this.chunkUpdateCallbacks.forEach(cb => cb(msg.data));
        }
      } catch {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      // Attempt reconnection after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  onChunkUpdate(callback: (chunks: ChunkCoord[]) => void): () => void {
    this.chunkUpdateCallbacks.push(callback);
    return () => {
      this.chunkUpdateCallbacks = this.chunkUpdateCallbacks.filter(cb => cb !== callback);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
