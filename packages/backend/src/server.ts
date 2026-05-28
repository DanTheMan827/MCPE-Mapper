import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { WorldReader } from './WorldReader.js';
import { ChunkRequest } from '@mcpe-mapper/shared';

export interface ServerConfig {
  worldPath: string;
  port: number;
  enablePortals: boolean;
  enablePlayers: boolean;
}

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const worldReader = new WorldReader(config.worldPath);

  // GET /api/world - Get world info
  app.get('/api/world', async (_req, res) => {
    try {
      const info = await worldReader.getWorldInfo();
      res.json({
        info,
        features: {
          portals: config.enablePortals,
          players: config.enablePlayers,
        },
      });
    } catch (err) {
      console.error('Error getting world info:', err);
      res.status(500).json({ error: 'Failed to read world info' });
    }
  });

  // POST /api/chunks - Get chunk render data
  app.post('/api/chunks', async (req, res) => {
    try {
      const { chunks, dimension, heightRange } = req.body as ChunkRequest;
      if (!chunks || !Array.isArray(chunks)) {
        res.status(400).json({ error: 'Invalid request: chunks array required' });
        return;
      }

      const results = await worldReader.getChunks(chunks, dimension, heightRange);
      // Encode pixel data as base64 for transport
      const encoded = results.map(c => ({
        x: c.x,
        z: c.z,
        pixels: Buffer.from(c.pixels).toString('base64'),
      }));

      res.json({ chunks: encoded });
    } catch (err) {
      console.error('Error getting chunks:', err);
      res.status(500).json({ error: 'Failed to read chunk data' });
    }
  });

  // GET /api/markers - Get map markers
  app.get('/api/markers', async (_req, res) => {
    try {
      const markers = await worldReader.getMarkers(
        config.enablePortals,
        config.enablePlayers
      );
      res.json({ markers });
    } catch (err) {
      console.error('Error getting markers:', err);
      res.status(500).json({ error: 'Failed to read markers' });
    }
  });

  return app;
}

export function startServer(config: ServerConfig) {
  const app = createApp(config);
  const server = createServer(app);

  // WebSocket server for live updates
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  // Poll for world changes (check every 10 seconds)
  const worldReader = new WorldReader(config.worldPath);
  let lastCheckTime = Date.now();

  const pollInterval = setInterval(async () => {
    try {
      const updatedChunks = await worldReader.getModifiedChunks(lastCheckTime);
      lastCheckTime = Date.now();

      if (updatedChunks.length > 0) {
        const message = JSON.stringify({
          type: 'chunk_updated',
          data: updatedChunks,
        });
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      }
    } catch {
      // Ignore polling errors
    }
  }, 10000);

  server.on('close', () => clearInterval(pollInterval));

  server.listen(config.port, () => {
    console.log(`MCPE Mapper backend running on http://localhost:${config.port}`);
    console.log(`World path: ${config.worldPath}`);
    console.log(`Features - Portals: ${config.enablePortals}, Players: ${config.enablePlayers}`);
  });

  return server;
}
