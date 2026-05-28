import { startServer, ServerConfig } from './server.js';

const config: ServerConfig = {
  worldPath: process.env.WORLD_PATH || './world',
  port: parseInt(process.env.PORT || '3001', 10),
  enablePortals: process.env.ENABLE_PORTALS !== 'false',
  enablePlayers: process.env.ENABLE_PLAYERS !== 'false',
};

startServer(config);
