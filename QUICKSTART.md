# Fish Tank - Quick Start Guide

## What is Fish Tank?

Fish Tank is an agent-based simulation environment where LLM-powered agents operate in a turn-based world. Think of it as a "petri dish" for observing AI agent behavior in a constrained, observable environment with DCSS-style tile rendering.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Fish Tank System                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Browser    │◄─SSE─┤    World     │─SSE─►│  Agent    │ │
│  │   Viewer     │      │    Server    │      │  Runner   │ │
│  │  (Viewer/)   │      │  (Node.js)   │◄─POST│ (Python)  │ │
│  └──────────────┘      └──────────────┘      └───────────┘ │
│                              │                               │
│                        Authoritative                         │
│                        Turn Loop                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **World Server** (`server/`)
   - Node.js + Express
   - Authoritative game state
   - Turn-based simulation (1 turn/second)
   - SSE event streams for real-time updates
   - Deterministic with seeded RNG

2. **Agent Runner** (`runner/`)
   - Python + httpx + typer + rich
   - Subscribes to private observation stream
   - Decides actions (currently random walk)
   - Submits actions via HTTP POST

3. **Browser Viewer** (`viewer/`)
   - Vanilla JS + Canvas
   - Real DCSS tile rendering
   - Event log and stats display
   - Hover tooltips

4. **Shared Contracts** (`shared/`)
   - JSON Schema definitions
   - Protocol documentation

## Running the Demo

### Quick Start (Recommended)

```bash
./start-demo.sh
```

Then:
1. Open http://localhost:8080 in your browser
2. Click "Connect" button
3. In new terminals, run agents:
   ```bash
   uv run agent --agent-id scout
   uv run agent --agent-id nomad
   uv run agent --agent-id warden
   ```

### Manual Start

**Terminal 1 - World Server:**
```bash
cd server
npm install  # first time only
npm start
```

**Terminal 2 - Scout Agent:**
```bash
uv run agent --agent-id scout
```

**Terminal 3 - Nomad Agent:**
```bash
uv run agent --agent-id nomad
```

**Terminal 4 - Warden Agent:**
```bash
uv run agent --agent-id warden
```

**Terminal 5 - Viewer:**
```bash
cd viewer
python -m http.server 8080
```

Then open http://localhost:8080 and click "Connect".

## Current Features

### World Mechanics
- ✅ 25x18 procedurally generated map with walls
- ✅ Turn-based simulation (1 second/turn)
- ✅ Hunger system (decrements each turn)
- ✅ Starvation damage when hunger = 0
- ✅ Collision detection (walls + entities)
- ✅ Deterministic with seeded RNG

### Agent Actions
- ✅ `move` - Move in 8 directions (N, S, E, W, NE, NW, SE, SW)
- ✅ `wait` - Do nothing this turn
- ⏳ `attack` - Coming soon
- ⏳ `forage` - Coming soon
- ⏳ `eat` - Coming soon
- ⏳ `talk` - Coming soon

### Agent AI
- ✅ Random walk heuristic (80% move, 20% wait)
- ⏳ LLM integration (planned)
- ⏳ Memory system (planned)

### Visualization
- ✅ Real DCSS tile rendering (from Nov-2015 tileset)
- ✅ Entity sprites (human agents, sheep, hogs)
- ✅ Health bars
- ✅ Hover tooltips
- ✅ Event log
- ✅ Turn counter and agent stats

## API Endpoints

### SSE Streams (Server → Client)

**Public Stream** - World state for viewers
```
GET http://localhost:3000/stream/public

Events:
- snapshot: Full world state on connect
- delta: Incremental updates each turn
- public: Combat logs, deaths, spawns
```

**Agent Stream** - Private observations for agents
```
GET http://localhost:3000/stream/agent?agent_id=scout

Events:
- obs: Observation for this turn (includes visible tiles, entities, stats)
```

### Action Submission (Client → Server)

**Submit Action**
```
POST http://localhost:3000/act
Content-Type: application/json

{
  "agent_id": "scout",
  "turn_id": 42,
  "type": "move",
  "args": { "dir": "NE" }
}

Response:
{ "ok": true }
or
{ "ok": false, "error": "Invalid turn_id" }
```

### Health Check
```
GET http://localhost:3000/health

Response:
{ "status": "ok", "turn": 42 }
```

## Development

### Project Structure
```
fishtank/
├── server/              # Node.js world server
│   ├── src/
│   │   ├── index.js    # Express app + SSE endpoints
│   │   └── world.js    # World state + turn loop
│   └── package.json
├── runner/              # Python agent runner
│   ├── main.py         # CLI + agent logic
│   └── __init__.py
├── viewer/              # Browser viewer
│   ├── index.html      # UI layout
│   ├── style.css       # Styling
│   ├── viewer.js       # Canvas rendering + SSE client
│   └── tiles/          # DCSS tile assets
├── shared/              # Protocol contracts
│   └── schemas.json    # JSON Schema definitions
├── pyproject.toml       # Python project config
├── start-demo.sh        # Quick start script
├── README.md            # Full documentation
├── CONVENTIONS.md       # Python coding standards
├── DEVELOPMENT_CHECKLIST.md  # Implementation progress
└── fish_tank_architecture_spec_v1.md  # Architecture spec
```

### Adding a New Agent

```bash
uv run agent --agent-id a3
```

Agent IDs must be unique. The world server currently spawns `scout`, `nomad`, and `warden` at startup.

### Customizing the World

Edit `server/src/world.js`:

```javascript
// Map size
const world = new WorldServer({ seed: 42, width: 25, height: 18 });

// Turn speed
this.turnInterval = 1000; // ms per turn

// Initial agents
this.spawnAgent('scout', 5, 5);
this.spawnAgent('nomad', 8, 7);
this.spawnAgent('warden', 6, 9);
```

### Next Steps

See `DEVELOPMENT_CHECKLIST.md` for full implementation roadmap.

Priority next features:
1. Combat system (`attack` action)
2. Food/items system (`forage`, `eat` actions)
3. Proper line-of-sight visibility
4. LLM integration (DeepSeek v3)
5. Agent memory and planning

## Troubleshooting

**Port already in use:**
```bash
pkill -f "node src/index.js"
```

**Viewer not connecting:**
- Check server is running: `curl http://localhost:3000/health`
- Check browser console for errors
- Try refreshing the page

**Agent not receiving observations:**
- Check agent_id matches spawned agent
- Check server logs for connection
- Verify network requests in terminal

**Tiles not loading:**
- Verify `viewer/tiles/` directory exists
- Check browser console for 404 errors
- Tiles are copied from `/home/gavin/dev/Personal/tiles/releases/Nov-2015/`

## Contributing

See `CONVENTIONS.md` for Python coding standards.

Key principles:
- World server is authoritative
- All state changes go through turn loop
- Use SSE for server → client
- Use HTTP POST for client → server
- Maintain determinism

## License

TBD
