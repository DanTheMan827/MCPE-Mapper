export interface ChunkCoord {
  x: number;
  z: number;
}

export interface WorldInfo {
  name: string;
  gameType: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  lastPlayed: number;
}

export interface PlayerPosition {
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: number;
}

export interface PortalLocation {
  x: number;
  y: number;
  z: number;
  dimension: number;
  type: 'nether' | 'end';
}

export interface MapMarker {
  id: string;
  x: number;
  y: number;
  z: number;
  dimension: number;
  type: 'player' | 'nether_portal' | 'end_portal' | 'banner';
  label: string;
}

/** Chunk column pixel data - 16x16 RGBA pixels representing top-down view */
export interface ChunkRenderData {
  x: number;
  z: number;
  /** 16*16*4 bytes RGBA */
  pixels: Uint8Array;
}

export interface HeightRange {
  min: number;
  max: number;
}

export interface ViewerConfig {
  showNetherPortals: boolean;
  showEndPortals: boolean;
  showPlayers: boolean;
  heightRange: HeightRange;
  dimension: number;
}

/** API response types */
export interface ChunkRequest {
  chunks: ChunkCoord[];
  dimension: number;
  heightRange: HeightRange;
}

export interface ChunkResponse {
  chunks: ChunkRenderData[];
}

export interface MarkersResponse {
  markers: MapMarker[];
}

export interface WorldInfoResponse {
  info: WorldInfo;
  features: {
    portals: boolean;
    players: boolean;
  };
}

/** WebSocket message types */
export type WSMessage =
  | { type: 'chunk_updated'; data: ChunkCoord[] }
  | { type: 'subscribe'; data: { chunks: ChunkCoord[]; dimension: number } }
  | { type: 'unsubscribe'; data: { chunks: ChunkCoord[] } };
