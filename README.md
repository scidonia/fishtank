# Fish Tank - Agentic World Simulation

An agent-based simulation environment where LLM-powered agents operate in a turn-based world rendered with DCSS-style tiles in the browser.

**Features:**
- 🗺️ Large 1000×1000 tile world with procedural dungeons
- 🎮 Real-time viewport rendering with camera controls
- 🤖 LLM-ready agent framework (currently random walk)
- 📡 SSE streaming for real-time updates
- 🎨 Authentic DCSS tile graphics
- 📊 Surveillance panel for monitoring agents

## Architecture

See [fish_tank_architecture_spec_v1.md](./fish_tank_architecture_spec_v1.md) for the complete specification.

### Components

- **`server/`** - Node.js world server (authoritative, turn-based, SSE)
- **`runner/`** - Python agent runner (DeepSeek v3 ready)
- **`viewer/`** - Browser-based live viewer with viewport (SSE client)
- **`shared/`** - Contract definitions and map data

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.12+
- uv (Python package manager)

### One-Command Demo

```bash
./start-demo.sh
```

This will:
1. Start the world server on port 3000 (loads 1000×1000 map)
2. Start the viewer HTTP server on port 8080
3. Display instructions for running agents

**Then:**
1. Open http://localhost:8080 in your browser
2. Click **"Connect"** button
3. You'll see the large map with 2 agents spawned

### Running Agents

In **separate terminals**, start agents:

```bash
# Agent 1
uv run agent --agent-id scout

# Agent 2
uv run agent --agent-id nomad
```

Watch them move around in the viewer!

## How to Use the Viewer

### Camera Controls

**Mouse:**
- **Click & Drag** - Pan the camera around the large map
- **Hover over entities** - See tooltips with stats

**Keyboard:**
- **Arrow Keys** - Move the camera
- **+/- Buttons** - Zoom in/out

**Agent Tracking:**
- Click **"Follow Agent"** button to auto-track the first agent
- Click any agent in the **Surveillance Panel** to follow them
- Camera will smoothly follow the selected agent
- Click **"Follow Agent"** again (now shows "Free Camera") to stop following

### Surveillance Panel

The right sidebar shows:
- **World Stats** - Turn number, agent count, map size, camera position
- **Surveillance** - List of all agents with:
  - Agent ID
  - Position (x, y)
  - HP and Hunger
  - Click any agent to follow them
- **Event Log** - Recent world events (combat, deaths, etc.)

### Tips

- The map is **1000×1000 tiles** - use camera controls to explore!
- Only the **visible viewport** is rendered for performance
- Agents have **limited hunger** and will starve if they don't eat
- Watch agents **wander randomly** through the dungeon rooms

## Manual Setup

If you prefer to start components individually:

### 1. Install Dependencies

```bash
# Server dependencies
cd server && npm install && cd ..

# Python agent dependencies
uv sync
```

### 2. Start the World Server

```bash
cd server
npm start
```

Server runs on `http://localhost:3000` and loads the map from `shared/map.txt`

You should see:
```
✓ Loaded map from shared/map.txt: 1000 rows × 1000 columns
🐠 Fish Tank Server running on http://localhost:3000
```

### 3. Start the Viewer

```bash
cd viewer
python -m http.server 8080
```

Then open http://localhost:8080 and click **"Connect"**

### 4. Start Agent Runners

In separate terminals:

```bash
# Agent 1
uv run agent --agent-id scout

# Agent 2
uv run agent --agent-id nomad

# You can add more agents (they'll spawn in random valid locations)
uv run agent --agent-id a3
```

Each agent will:
- Connect to the server via SSE
- Receive observations each turn
- Make decisions (currently random walk)
- Submit actions via HTTP POST

## Map Generation

The world uses a **1000×1000 tile map** stored in `shared/map.txt`.

### Regenerating the Map

To create a new map layout:

```bash
cd shared
python3 generate_map.py
```

This generates a procedural dungeon with:
- 50 randomly sized rooms (10-40 tiles each)
- Corridors connecting all rooms
- Random pillars for variety
- ~6% floor space, ~94% walls

The map is deterministic based on the seed (default 42).

## Development

See [DEVELOPMENT_CHECKLIST.md](./DEVELOPMENT_CHECKLIST.md) for implementation progress.

See [CONVENTIONS.md](./CONVENTIONS.md) for Python coding standards.

See [WHERE_WE_ARE.txt](./WHERE_WE_ARE.txt) for quick status overview.

## API Endpoints

### SSE Streams

**Public Stream** - For viewers
```
GET http://localhost:3000/stream/public
```
Events:
- `snapshot` - Full world state on connect
- `delta` - Incremental updates each turn
- `public` - Combat logs, deaths, spawns

**Agent Stream** - For agent runners
```
GET http://localhost:3000/stream/agent?agent_id=<id>
```
Events:
- `obs` - Private observation for this turn

### Action Submission

**Submit Action**
```
POST http://localhost:3000/act
Content-Type: application/json
```

Request body:
```json
{
  "agent_id": "scout",
  "turn_id": 1842,
  "type": "move",
  "args": { "dir": "NW" }
}
```

Response:
```json
{ "ok": true }
```

Or on error:
```json
{ "ok": false, "error": "Invalid turn_id" }
```

**Available Actions:**
- `move` - Move in 8 directions: N, S, E, W, NE, NW, SE, SW
- `wait` - Do nothing this turn
- More actions coming: `attack`, `forage`, `eat`, `talk`

### Health Check

```
GET http://localhost:3000/health
```

Returns:
```json
{ "status": "ok", "turn": 42 }
```

## Project Structure

```
fishtank/
├── server/              # Node.js world server
│   ├── src/
│   │   ├── index.js    # Express app + SSE endpoints
│   │   └── world.js    # World simulation + turn loop
│   └── package.json
├── runner/              # Python agent runner
│   ├── main.py         # CLI + SSE client + decision loop
│   └── __init__.py
├── viewer/              # Browser viewer
│   ├── index.html      # UI layout
│   ├── style.css       # Styling
│   ├── viewer.js       # Canvas renderer with viewport
│   └── tiles/          # DCSS tile assets
│       ├── floor/      # Floor tile variants
│       ├── wall/       # Wall tile variants
│       └── entities/   # Agent/creature sprites
├── shared/              # Shared resources
│   ├── map.txt         # 1000×1000 ASCII map (978KB)
│   ├── generate_map.py # Map generator script
│   └── schemas.json    # Protocol contracts
├── start-demo.sh        # Quick start script
├── README.md            # This file
├── QUICKSTART.md        # User guide
├── STATUS.md            # Comprehensive status
├── WHERE_WE_ARE.txt     # Quick reference
└── DEVELOPMENT_CHECKLIST.md  # Implementation tracker
```

## Troubleshooting

### Ports Already in Use

If you get "Address already in use" errors, run the cleanup script:

```bash
./stop-all.sh
```

This will kill all Fish Tank processes and free ports 3000 and 8080.

**Manual cleanup:**
```bash
# Kill by process
pkill -f "node src/index.js"
pkill -f "python -m http.server 8080"

# Kill by port (more aggressive)
lsof -ti:3000 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

### Server Won't Start

**Check if ports are in use:**
```bash
lsof -i:3000  # World server
lsof -i:8080  # Viewer server
```

**Check server logs:**
```bash
tail -f /tmp/fishtank-server.log
```

### Viewer Not Connecting

1. **Verify server is running:**
   ```bash
   curl http://localhost:3000/health
   # Should return: {"status":"ok","turn":...}
   ```

2. **Check browser console** (F12) for errors

3. **Try refreshing the page** after clicking Connect

4. **Check viewer logs:**
   ```bash
   tail -f /tmp/fishtank-viewer.log
   ```

### Agent Not Receiving Observations

- **Verify agent_id matches spawned agents** (scout, nomad, warden are pre-spawned)
- **Check server logs** for connection messages
- **Check network requests** in agent terminal output
- **Verify server is running** on port 3000

### Tiles Not Loading

- **Verify tiles exist:**
  ```bash
  ls viewer/tiles/floor/
  ls viewer/tiles/wall/
  ls viewer/tiles/entities/
  ```
- **Check browser console** for 404 errors
- Tiles were copied from DCSS Nov-2015 tileset

### Performance Issues

The viewport system should provide smooth 60 FPS even with 1000×1000 maps:

- **Only visible tiles are rendered** (viewport culling)
- **Try zooming in** to reduce visible area
- **Check browser performance** tab (F12) for bottlenecks
- **Reduce agent count** if running many agents

### Map Not Loading

If server says "Falling back to generated map":

```bash
# Verify map file exists
ls -lh shared/map.txt

# Regenerate if needed
cd shared
python3 generate_map.py
cd ..
```

### Common Issues

**"Cannot find module" (Node.js)**
```bash
cd server
npm install
```

**"Command not found: uv" (Python)**
```bash
# Install uv first
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**"Module not found" (Python)**
```bash
uv sync
```

## What's Next

Current status: **MVP complete with large map support** (65% done)

**Coming soon:**
- ⏳ Combat system (attack action)
- ⏳ Food/items (forage, eat actions)
- ⏳ Line-of-sight visibility
- ⏳ LLM integration (DeepSeek v3)
- ⏳ Agent memory system
- ⏳ Determinism tests

See [DEVELOPMENT_CHECKLIST.md](./DEVELOPMENT_CHECKLIST.md) for details.

## Contributing

Follow [CONVENTIONS.md](./CONVENTIONS.md) for Python coding standards.

Key principles:
- World server is authoritative
- All state changes go through turn loop
- Use SSE for server → client
- Use HTTP POST for client → server
- Maintain determinism

## License

TBD
