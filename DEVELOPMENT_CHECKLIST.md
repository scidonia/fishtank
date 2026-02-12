# Fish Tank Development Checklist

This checklist tracks progress on implementing the Fish Tank Agentic World according to the architecture specification.

---

## 🎯 CURRENT STATUS - LLM AGENTS WORKING!

**Last Updated:** 2026-02-12 (Evening)

### ✅ What Works Now
- **World Server**: Turn-based simulation with SSE streaming on port 3000
- **Agent Runner**: Python agents with **DeepSeek v3 LLM** and 5 personalities
- **Browser Viewer**: DCSS tile rendering on port 8081 with viewport
- **Full Integration**: All components communicate properly
- **Game Mechanics**: Movement, collision, energy system, food (plants/meat/bones), plant growth
- **Surveillance**: Real-time agent telemetry with reasoning logs
- **FOV**: 10-tile radius field of view visualization

### 🚀 Quick Start
```bash
# Set your DeepSeek API key
export DEEPSEEK_API_KEY="your-key"

# Start server + viewer
./start-demo.sh

# Run LLM agents in new terminals
uv run agent-llm --agent-id scout --personality explorer
uv run agent-llm --agent-id nomad --personality cooperative
uv run agent-llm --agent-id warden --personality cautious
```
Open http://localhost:8081 and click "Connect", then click an agent to see their thinking

### 📈 Progress: Stages 0-7 Mostly Complete (85%)
- ✅ **Stage 0-2**: Architecture, contracts, world server MVP
- ✅ **Stage 3**: FOV-based observations (10-tile radius)
- ✅ **Stage 4**: Core validation working
- ✅ **Stage 5**: Agent runner with **LLM (DeepSeek v3)** ✨
- ✅ **Stage 6**: Viewer with DCSS tiles + viewport + surveillance
- ✅ **Stage 7**: Energy, food (plants/meat/bones), plant growth ✨
- ⏳ **Stage 8**: Determinism tests pending
- ⏳ **Stage 9**: Security pending

### 🔧 Next Priority
1. Combat system (`attack` action)
2. Agent communication (`talk` action)
3. Agent memory/notes (`edit_prompt` action)
4. Determinism tests & replay logging

---

## Stage 0: Decisions & Setup ✅

**Architecture Decisions**
- [x] Confirm Node vs Python world server (Node.js per spec)
- [x] Confirm monorepo vs split repos (Monorepo)
- [x] Confirm viewer framework choice (Vanilla JS + Canvas)
- [x] Confirm LLM integration timing (Stub-first with heuristic)
- [x] Define target MVP scale (25x18 map, 2 agents, hunger decay)

**Repository Setup**
- [x] Establish folder layout (server/, runner/, viewer/, shared/)
- [x] Document "how to run" for each component
- [x] Configure development environment
- [x] Integration with DCSS tiles

## Stage 1: Shared Contracts & Schemas ✅

**Schema Definitions**
- [x] Define SSE event envelope + types (`snapshot`, `delta`, `public`, `obs`)
- [x] Define `/act` request/response schema
- [x] Define `obs` schema + action_space encoding
- [x] Decide contract format (JSON Schema in shared/)
- [x] Add contract validation in all components

## Stage 2: World Server MVP - Turn Loop & Movement ✅

**Core Turn System**
- [x] Seeded RNG + deterministic ordering
- [x] Turn loop with per-agent timeout → `wait`
- [x] Entity model (id, pos, hp, hunger)
- [x] Map model (grid + walls/floor)

**SSE Endpoints**
- [x] `GET /stream/public` - snapshot on connect
- [x] `GET /stream/public` - delta per turn
- [x] `GET /stream/agent?agent_id=X` - obs stream per turn

**Action Processing**
- [x] `POST /act` endpoint
- [x] Validate turn_id and agent_id
- [x] Implement `move` action with direction validation
- [x] Implement `wait` action
- [x] Default to `wait` on timeout

## Stage 3: Visibility & Observation Bounding ✅

**Visibility System**
- [x] Field-of-view calculation (10-tile radius)
- [x] `obs.visible_tiles` bounded to FOV
- [x] `obs.visible_entities` bounded to FOV
- [x] FOV visualization in viewer (clear inside, gray outside)
- [x] Agents only see terrain and entities within FOV
- [x] Last action result feedback in observations
- [ ] Line-of-sight through walls (future: raycasting) - Currently circular FOV

## Stage 4: Action Space Expansion

**Additional Actions**
- [ ] `attack` action + validation
- [ ] `forage` action + validation
- [ ] `eat` action + validation
- [ ] `talk` action + validation
- [ ] `edit_prompt` action (notes only)

**Action Validation**
- [x] Illegal action → replaced with `wait`
- [x] Reject duplicate actions
- [x] Reject stale turn_id
- [x] Return `{ok: false, error: "..."}` for invalid submissions

## Stage 5: Agent Runner MVP (Python) ✅

**SSE Client**
- [x] Subscribe to `/stream/agent?agent_id=X`
- [x] Parse observation events
- [x] Turn synchronization logic

**Memory System** ✅
- [x] Base prompt (immutable) - personality-based
- [x] Memory tracking (locations visited, entities seen, events)
- [ ] Personal Notes (mutable via `edit_prompt`) - TODO

**Decision Loop** ✅
- [x] Heuristic/random policy (stub)
- [x] LLM adapter interface design ✨
- [x] DeepSeek v3 integration ✨
- [x] Mock LLM for testing
- [x] 5 personalities: explorer, survivor, aggressive, cooperative, cautious
- [x] Ensure exactly one action per turn
- [x] Timeout handling + retries
- [x] Telemetry emission (obs/decision/result phases)

**Integration Test**
- [x] Runner plays N turns unattended without desync
- [x] LLM agents make intelligent decisions
- [x] Agents forage when hungry
- [x] Agents navigate around walls

## Stage 6: Browser Viewer MVP ✅

**SSE Client**
- [x] Subscribe to `/stream/public`
- [x] Handle `snapshot` event on connect
- [x] Handle `delta` events per turn
- [x] Mid-session join test
- [x] Surveillance stream for agent telemetry ✨

**Rendering**
- [x] DCSS-style tile grid (actual DCSS tiles)
- [x] Viewport-based rendering (1000×1000 map support)
- [x] Camera controls (drag, arrow keys, zoom +/-)
- [x] Render entities on map (agents, plants, meat, bones)
- [x] Agent stats panel with HP/energy bars
- [x] Event log display
- [x] Hover tooltips for entities
- [x] Surveillance panel with agent list ✨
- [x] Agent log panel showing reasoning/decisions ✨
- [x] FOV visualization (10-tile radius) ✨
- [x] Click agents to focus and see their telemetry ✨

## Stage 7: Game Mechanics - Energy, Food, Combat ✅ (Mostly Complete)

**Energy System** ✅
- [x] Energy starts at 100, counts down each turn
- [x] Death at energy = 0
- [x] Display energy in observations
- [x] Changed terminology from "hunger" to "energy"

**Food & Items** ✅
- [x] Plants spawn at startup (50 initial, grows to 500 max)
- [x] Plant growth system (30% chance per turn)
- [x] Forage action (+20 energy from plants, +50 from meat)
- [x] Corpses drop meat at death location
- [x] Meat decays to bones after 20 turns (0 nutrition)
- [x] Bones decay to dust after 50 turns
- [x] Items rendered in viewer (green circle = plant, red square = meat, gray X = bones)
- [x] Forage must be within 1 tile radius

**Combat System** ⏳
- [ ] `attack` action implementation
- [ ] Damage calculation
- [ ] Death handling (already done: death → meat corpse)
- [ ] Public combat log events
- [ ] Recent combat events in observations

## Stage 8: Determinism, Logging & Replay

**Logging**
- [ ] Action log per turn
- [ ] Resolution log per turn
- [ ] Replay-sufficient format

**Determinism Tests**
- [ ] Fixed seed + scripted actions → identical deltas
- [ ] Two runs produce equivalent canonical logs
- [ ] Document RNG usage points

## Stage 9: Security & Operations

**Security**
- [ ] Agent authentication tokens
- [ ] Rate limiting on `POST /act`
- [ ] Input validation for all action arguments
- [ ] No client authority over world state

**Operations**
- [x] Local development setup docs
- [ ] Deployment notes
- [ ] Environment configuration
- [x] Health check endpoints

## Future Extensions (Post-MVP)

- [ ] Reputation system
- [ ] Alliance contracts
- [ ] Trading system
- [ ] Inventory system
- [ ] Species diversity
- [ ] Multi-world shards
- [ ] Replay export

---

## Progress Notes

### [2026-02-12 Late Evening] - Plant Growth System + LLM Integration Complete

**Completed:**
- ✅ Plant growth system fully implemented
  - Dynamic plant spawning (30% chance per turn)
  - Max capacity 500 plants, starts with 50
  - Plants grow at random valid floor tiles
  - Logged with plant count tracking
- ✅ Food ecosystem fully functional
  - Plants: +20 energy, green circles in viewer
  - Meat (corpses): +50 energy, red squares, decay after 20 turns
  - Bones: 0 energy, gray X, decay after 50 turns
  - Forage action works within 1-tile radius
- ✅ LLM agents working with DeepSeek v3
  - 5 personalities: explorer, survivor, aggressive, cooperative, cautious
  - Agents make intelligent decisions based on observations
  - Memory system tracks locations, entities, events
  - Telemetry streaming with obs/decision/result phases
- ✅ Surveillance system
  - Real-time agent telemetry in viewer
  - Agent log panel shows reasoning and token counts
  - Click agents to focus and see their thinking
  - FOV visualization (clear inside, gray outside)
- ✅ Wall collision feedback
  - Agents receive detailed feedback on failed moves
  - Last action result shown in observations
  - Prompts tell agents to try different directions

**System Status:**
- Three agents (scout explorer, nomad cooperative, warden cautious) running successfully
- Energy system working (countdown from 100 to 0)
- Plant growth confirmed (3 plants grew in ~20 turns)
- Agents foraging when energy gets low
- Death → meat → bones → dust progression verified
- Viewer on port 8081 (port 8080 was taken by Docker/Airflow)

**What's Working:**
```bash
# Start everything
export DEEPSEEK_API_KEY="your-key"
./start-demo.sh

# Run LLM agents
uv run agent-llm --agent-id scout --personality explorer
uv run agent-llm --agent-id nomad --personality cooperative
uv run agent-llm --agent-id warden --personality cautious

# View at http://localhost:8081
# Click agent in sidebar to see their thinking
```

**Next Priority:**
1. Combat system (`attack` action + damage calculation)
2. Agent communication (`talk` action)
3. Agent notes (`edit_prompt` action)
4. Determinism tests

### [2026-02-12 Evening] - Large Map + Viewport System

**Completed:**
- ✅ 1000×1000 ASCII map generation with procedural dungeons
- ✅ Map loading from file (shared/map.txt) with 50 rooms + corridors
- ✅ Viewport-based rendering (only visible tiles rendered)
- ✅ Camera system with pan (click & drag, arrow keys)
- ✅ Zoom controls (+/- buttons)
- ✅ Agent following system (auto-tracks selected agent)
- ✅ Surveillance panel showing all agents with stats
- ✅ Click agents in sidebar to follow them
- ✅ Dynamic spawn point finding on map load
- ✅ Canvas auto-sizing to fill available screen space

**Technical Details:**
- Map file: 978KB, 1000×1000 tiles (~6% floor, 94% walls)
- Viewport culling for performance (60 FPS even with huge map)
- Camera constraints to prevent going off-map
- Real-time agent tracking with smooth camera following
- Agent list with HP/hunger/position in surveillance panel

### [2026-02-12 Morning] - Initial MVP Implementation

**Completed:**
- ✅ Monorepo structure established (server/, runner/, viewer/, shared/)
- ✅ World server MVP with turn-based loop, SSE streaming, and action validation
- ✅ Python agent runner with random walk heuristic
- ✅ Browser viewer with actual DCSS tile rendering
- ✅ Full integration: agents can connect, move around, and viewer updates in real-time
- ✅ Hunger system with starvation damage
- ✅ Quick-start script (./start-demo.sh)

**Architecture Decisions:**
- Node.js for world server (as per spec)
- Monorepo with clear separation of concerns
- Vanilla JS + Canvas for viewer (lightweight, fast)
- Stub-first approach for agent AI (heuristic → LLM later)

**Current MVP Features:**
- 1000×1000 procedurally generated map from ASCII file
- Dynamic agent spawn points in valid floor locations
- Turn-based simulation (1 second per turn, 800ms action timeout)
- SSE streaming for public world state and private agent observations
- Movement with collision detection
- Hunger decay and starvation
- Real-time DCSS tile rendering with viewport
- Health bars, event log, stats panel
- Surveillance panel with agent tracking

**How to Test What's Built:**
```bash
# 1. Start the entire system
./start-demo.sh

# 2. Open browser to http://localhost:8080 and click "Connect"

# 3. In new terminals, start agents:
uv run agent --agent-id scout
uv run agent --agent-id nomad
uv run agent --agent-id warden

# You should see:
# - Agents moving around randomly in the viewer
# - Turn counter incrementing
# - Health bars showing HP/hunger
# - Event log updating
# - Agents eventually dying from starvation (hunger → 0 → HP loss)
```

**Current System Status:**
- ✅ **WORKING**: All three components communicate via SSE/HTTP
- ✅ **WORKING**: Agents spawn, move, collide with walls
- ✅ **WORKING**: Viewer renders DCSS tiles from Nov-2015 tileset
- ✅ **WORKING**: Hunger decrements, starvation causes death
- ⚠️ **LIMITED**: Agents use random walk only (no LLM yet)
- ⚠️ **LIMITED**: Full visibility (no line-of-sight yet)

**Technical Details:**
- Server runs on port 3000 (GET /stream/public, /stream/agent, POST /act)
- Viewer runs on port 8080 (static file server)
- Agents connect via agent_id (scout, nomad, warden pre-spawned)
- Turn loop: 1000ms per turn, 800ms action timeout
- Map: 25x18 tiles, seeded RNG (seed=42)

**Next Priority Tasks:**

1. **Combat System** (Stage 7 - partial)
   - Add `attack` action validation
   - Implement damage calculation
   - Add death → corpse drops
   - Emit combat events to public stream

2. **Food/Items System** (Stage 7 - partial)
   - Add Item entity type (food, corpses)
   - Implement `forage` action (spawn low-nutrition item)
   - Implement `eat` action (consume item, restore hunger)
   - Add decay timers to items

3. **Visibility System** (Stage 3 - remaining)
   - Implement proper line-of-sight calculation
   - Limit obs.visible_tiles to agent's FOV
   - Limit obs.visible_entities to visible range
   - Test: agents in different rooms see different things

4. **LLM Integration** (Stage 5 - remaining)
   - Design LLM adapter interface
   - Integrate DeepSeek v3 API
   - Add base prompt + personal notes architecture
   - Allow `edit_prompt` to modify notes

5. **Determinism & Logging** (Stage 8)
   - Log all actions + resolutions per turn
   - Add replay file export
   - Write determinism test (same seed → same results)

**Known Limitations:**
- No authentication/security yet
- No rate limiting on /act endpoint
- No proper LOS (agents see entire map)
- No combat yet (agents can't interact)
- No food (agents will always starve eventually)
- Agent AI is purely random

**Files to Edit for Next Steps:**
- `server/src/world.js` - Add combat, items, visibility
- `runner/main.py` - Add LLM integration
- `shared/schemas.json` - Extend action types
- Tests needed in all components

