# Fish Tank — Agentic World Simulation

**[Live Demo](https://fishtank.scidonia.ai)** | **[Blog Post: The Danger of AI — The Evolutionary Imperative](https://scidonia.ai/blog/the-danger-of-ai-the-evolutionary-imperative/)**

An agent-based survival simulation where LLM-powered agents (DeepSeek v3) live, fight, eat, reproduce, and die in a 1000×1000 tile world — rendered live in the browser. Users can watch, read AI-generated narration, and bet on who survives.

## Features

- **LLM agents** — Each agent runs DeepSeek v3, receives a structured observation (FOV map, inventory, nearby entities, memory), and decides actions as JSON
- **Survival mechanics** — Combat, foraging, eating, giving items, energy/HP regeneration, starvation death
- **Reproduction** — Agents can mate; offspring inherit fused prompts and auto-spawn as new LLM processes
- **Persistent identity** — Agents have a persistent prompt and private notes they can read/edit each turn
- **Memory system** — Agents remember visited locations, known agents, food sources, danger zones, and recent events
- **Predator AI** — Wolves and bears hunt agents using scent-based tracking; deer and rabbits roam as prey
- **Narrator** — A separate LLM process watches the world and generates dramatic turn-by-turn narration
- **Betting** — Auth0-authenticated users can bet on agent survival; payouts are lineage-aware
- **Archaeology** — Full run history browser: browse past rounds, deaths, events, agent lifespans
- **Live viewer** — Browser-based renderer with camera controls, FOV overlay, surveillance panel, agent log, narrator feed
- **NixOS deployment** — Production-ready NixOS module included

## Architecture

```
fishtank/
├── server/                  # Node.js world server (authoritative, turn-based, SSE)
│   └── src/
│       ├── index.js         # Express app, all API + SSE endpoints
│       ├── world.js         # World simulation, turn loop, all game logic
│       ├── worldLogger.js   # SQLite persistence (runs, events, bets, deaths)
│       ├── worldSummarizer.js
│       └── narrator.js      # Narrator broadcast logic
├── runner/                  # Python agent processes
│   ├── main_llm.py          # LLM agent runner (DeepSeek v3)
│   ├── agent.py             # AgentPersonality, AgentMemory, prompt building
│   ├── llm.py               # LLM provider abstraction (DeepSeek + mock)
│   ├── launcher.py          # Multi-agent launcher + birth watcher
│   ├── narrator_agent.py    # Narrator process (watches SSE, generates narration)
│   └── main.py              # Legacy random-walk runner (for testing)
├── viewer/                  # Browser-based live viewer
│   ├── index.html           # Main viewer (world, actions, archaeology tabs)
│   ├── betting.html         # Betting UI (Auth0 login, agent cards, leaderboard)
│   ├── viewer.js            # Canvas renderer, viewport, FOV overlay
│   ├── betting.js           # Betting logic, odds calculation
│   ├── archaeology.js       # Run history browser
│   └── config.js            # Runtime config (server URL, Auth0 — overridden at deploy)
├── shared/
│   ├── map.txt              # 1000×1000 ASCII map
│   ├── generate_map.py      # Map generator
│   └── schemas.json         # Protocol contracts
├── nixos-modules/
│   └── fishtank-server.nix  # NixOS module for production deployment
├── agents.yaml              # Agent roster (names, avatars, optional starting prompts)
├── env/                     # Environment config structure
├── flake.nix                # Nix flake (dev shell + deployment packages)
└── pyproject.toml           # Python package (agent-llm, fishtank-launcher, fishtank-narrator)
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- DeepSeek API key (get one at [platform.deepseek.com](https://platform.deepseek.com))

### 1. Start the world server

```bash
cd server && npm install && npm start
```

Server runs on `http://localhost:3000`.

### 2. Open the viewer

Open `viewer/index.html` directly in your browser, or serve it:

```bash
cd viewer && python -m http.server 8080
# then open http://localhost:8080
```

The viewer auto-connects to `http://localhost:3000`.

### 3. Start agents

```bash
export DEEPSEEK_API_KEY="sk-..."

# Start a single agent
uv run agent-llm --agent-id Scout

# Or start a full fleet from a config file
uv run fishtank-launcher --config agents.yaml --server-url http://localhost:3000
```

The launcher reads `agents.yaml`, spawns all agents as separate processes, and watches for newborns to auto-spawn child processes.

### 4. Start the narrator (optional)

```bash
uv run fishtank-narrator --server-url http://localhost:3000
```

### Testing without an API key

```bash
uv run agent-llm --agent-id Scout --use-mock
```

## Agent Config (`agents.yaml`)

```yaml
agents:
  - id: Scout
    avatar: scout.png
  - id: Ranger
    avatar: ranger.png
    starting_prompt: "I protect the weak and avoid unnecessary conflict."
```

Each agent self-registers with the server when it starts. No agents are pre-spawned.

## Actions

Agents submit a JSON action each turn:

```json
{ "action": "move", "args": { "dir": "NE" }, "reasoning": "..." }
```

Available actions:

| Action | Args | Description |
|---|---|---|
| `move` | `dir`: N/S/E/W/NE/NW/SE/SW | Move one tile |
| `wait` | — | Do nothing |
| `attack` | `target_id` | Attack an adjacent entity |
| `forage` | — | Pick up food from current tile |
| `eat` | `item_index` | Eat an item from inventory |
| `give` | `target_id`, `item_index` | Give item to adjacent agent |
| `mate` | `target_id` | Attempt to mate with adjacent agent |
| `edit_prompt` | `prompt` | Update persistent identity prompt |
| `edit_notes` | `notes` | Update private notes |
| `read_prompt` | — | Read own persistent prompt |
| `read_notes` | — | Read own private notes |

## API Endpoints

### SSE Streams

| Endpoint | Description |
|---|---|
| `GET /stream/public` | World snapshots + deltas + events (for viewer) |
| `GET /stream/agent?agent_id=<id>` | Per-turn observation for an agent |
| `GET /stream/surveillance?agent_id=<id>` | Agent telemetry + prompt/notes updates (for viewer) |

### Agent API

| Endpoint | Description |
|---|---|
| `POST /register` | Agent self-registration and spawn |
| `POST /act` | Submit an action for the current turn |
| `POST /telemetry` | Post per-turn telemetry event |
| `POST /narrate` | Post narrator text for broadcast |

### World Control

| Endpoint | Description |
|---|---|
| `GET /health` | `{ status, turn, paused }` |
| `POST /pause` | Pause the world |
| `POST /resume` | Resume the world |
| `POST /reset` | End current round and start a new one |

### Archaeology

| Endpoint | Description |
|---|---|
| `GET /api/runs` | List all past runs |
| `GET /api/runs/:runId` | Events + agent lifespans for a run |

### Betting (Auth0 required for write endpoints)

| Endpoint | Description |
|---|---|
| `GET /api/betting/current` | Current run info + alive agents + odds |
| `POST /api/betting/bet` | Place a bet on an agent |
| `GET /api/betting/mybets` | Your bets for the current run |
| `GET /api/betting/history` | Your full bet history |
| `GET /api/betting/leaderboard` | Public leaderboard |
| `GET /api/user` | Your profile + points balance |

## Deployment (NixOS)

A NixOS module is provided in `nixos-modules/fishtank-server.nix`:

```nix
services.fishtank-server = {
  enable = true;
  src = inputs.fishtank;
  npmDepsHash = "sha256-...";
  port = 3000;
  auth0 = {
    domain = "your-tenant.eu.auth0.com";
    clientId = "your-client-id";
  };
  nginx.serverName = "fishtank.example.com";
  environmentFile = config.sops.secrets."fishtank.env".path;
  agentsConfig = "${inputs.fishtank}/agents.yaml";
  runnerPackage = inputs.fishtank.packages.${pkgs.system}.fishtank-runner;
};
```

The module creates `fishtank-server` and `fishtank-launcher` systemd services, generates `config.js` with the correct Auth0 credentials, and sets up nginx.

## Contributing

See [CONVENTIONS.md](./CONVENTIONS.md) for coding standards.

Core principles:
- World server is authoritative — all state changes go through the turn loop
- SSE for server → client; HTTP POST for client → server
- Agents are stateless between processes; all persistent state lives in the server

## License

Apache 2.0 — see [LICENSE](./LICENSE).
