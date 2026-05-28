# MCPE Mapper

A Minecraft Bedrock Edition world viewer built with React/TypeScript that operates in two modes:

1. **Offline/Static Mode** - Runs entirely in the browser. Select a `.mcworld` file and it renders the map on the fly.
2. **Backend/Frontend Mode** - An Express backend reads unpacked world files and relays data to the frontend via REST API and WebSocket.

## Features

- 🗺️ Top-down block map rendering with in-game map colors
- 🔍 Zoom and pan with mouse/touch gesture support
- 📱 Fully responsive (desktop + mobile)
- 🌑 Dark mode UI with translucency
- 📏 Adjustable height range for map generation
- 🌍 Dimension switching (Overworld, Nether, End)
- 📍 Map markers for nether portals, end portals, and players
- ⚡ On-demand chunk loading (only loads visible chunks)
- 🔄 WebSocket updates when world changes (backend mode)

## Quick Start

### Offline Mode (Static)

```bash
npm install
npm run build:shared
npm run build:frontend
# Serve packages/frontend/dist with any static server
```

Or use the [GitHub Pages deployment](../../deployments) for instant access.

### Backend Mode

```bash
npm install
npm run build:shared

# Set environment variables
export WORLD_PATH=/path/to/your/bedrock/world
export PORT=3001
export ENABLE_PORTALS=true
export ENABLE_PLAYERS=true

# Start the backend
npm run dev:backend
```

Then open the frontend and click "connect to a backend server" → enter `http://localhost:3001`.

## Development

```bash
npm install
npm run build:shared

# Frontend dev server
npm run dev:frontend

# Backend dev server (with hot reload)
npm run dev:backend

# Run all tests
npm test
```

## Project Structure

```
packages/
├── shared/       # Shared types and block color mapping
├── frontend/     # Vite + React frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── services/     # World reader and backend service
│   │   └── test/         # Visual and unit tests
│   └── ...
└── backend/      # Express backend
    ├── src/
    │   ├── server.ts       # Express + WebSocket server
    │   ├── WorldReader.ts  # LevelDB world reader
    │   └── __tests__/      # Backend tests
    └── ...
```

## Configuration (Backend Mode)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `WORLD_PATH` | `./world` | Path to unpacked Bedrock world directory |
| `PORT` | `3001` | Server port |
| `ENABLE_PORTALS` | `true` | Enable portal marker detection |
| `ENABLE_PLAYERS` | `true` | Enable player position detection |

## Testing

```bash
# All tests
npm test

# Frontend tests only
npm run test:frontend

# Backend tests only
npm run test:backend
```

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Vitest
- **Backend**: Express, classic-level (LevelDB), WebSocket
- **Shared**: TypeScript types, block color mapping
- **CI/CD**: GitHub Actions (CI + GitHub Pages deployment)
