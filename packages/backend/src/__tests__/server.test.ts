import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createApp, ServerConfig } from '../server.js';

// Mock the WorldReader
vi.mock('../WorldReader.js', () => {
  return {
    WorldReader: vi.fn().mockImplementation(() => ({
      getWorldInfo: vi.fn().mockResolvedValue({
        name: 'Test World',
        gameType: 0,
        spawnX: 100,
        spawnY: 64,
        spawnZ: -200,
        lastPlayed: 1234567890,
      }),
      getChunks: vi.fn().mockResolvedValue([
        {
          x: 0,
          z: 0,
          pixels: new Uint8Array(16 * 16 * 4).fill(128),
        },
      ]),
      getMarkers: vi.fn().mockResolvedValue([
        {
          id: 'spawn',
          x: 100,
          y: 64,
          z: -200,
          dimension: 0,
          type: 'player',
          label: 'World Spawn',
        },
      ]),
      getModifiedChunks: vi.fn().mockResolvedValue([]),
    })),
  };
});

const config: ServerConfig = {
  worldPath: '/tmp/test-world',
  port: 3001,
  enablePortals: true,
  enablePlayers: true,
};

describe('Server API', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp(config);
  });

  describe('GET /api/world', () => {
    it('returns world info', async () => {
      const response = await makeRequest(app, 'GET', '/api/world');
      expect(response.status).toBe(200);
      expect(response.body.info.name).toBe('Test World');
      expect(response.body.info.spawnX).toBe(100);
    });

    it('returns feature flags', async () => {
      const response = await makeRequest(app, 'GET', '/api/world');
      expect(response.body.features.portals).toBe(true);
      expect(response.body.features.players).toBe(true);
    });
  });

  describe('POST /api/chunks', () => {
    it('returns chunk data', async () => {
      const response = await makeRequest(app, 'POST', '/api/chunks', {
        chunks: [{ x: 0, z: 0 }],
        dimension: 0,
        heightRange: { min: -64, max: 320 },
      });
      expect(response.status).toBe(200);
      expect(response.body.chunks).toHaveLength(1);
      expect(response.body.chunks[0].x).toBe(0);
      expect(response.body.chunks[0].z).toBe(0);
      expect(response.body.chunks[0].pixels).toBeTruthy(); // Base64 string
    });

    it('returns 400 for invalid request', async () => {
      const response = await makeRequest(app, 'POST', '/api/chunks', {});
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/markers', () => {
    it('returns markers', async () => {
      const response = await makeRequest(app, 'GET', '/api/markers');
      expect(response.status).toBe(200);
      expect(response.body.markers).toHaveLength(1);
      expect(response.body.markers[0].type).toBe('player');
    });
  });
});

// Simple test helper that uses the Express app directly
async function makeRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const req = {
      method,
      url: path,
      headers: { 'content-type': 'application/json' },
      body: body || {},
    } as any;

    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.body = data;
        resolve({ status: this.statusCode, body: data });
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      getHeader(name: string) {
        return this.headers[name];
      },
      end() {
        resolve({ status: this.statusCode, body: this.body });
      },
    } as any;

    // Use supertest-like approach: pipe through express
    app(req, res);
  });
}
