# Fish Tank Development Checklist

This checklist tracks progress on implementing the Fish Tank Agentic World according to the architecture specification.

---

## 🎯 CURRENT STATUS - MVP WORKING!

**Last Updated:** 2026-02-12

### ✅ What Works Now
- **World Server**: Turn-based simulation with SSE streaming on port 3000
- **Agent Runner**: Python agents with random walk AI
- **Browser Viewer**: DCSS tile rendering on port 8080
- **Full Integration**: All components communicate properly
- **Game Mechanics**: Movement, collision, hunger, starvation death

### 🚀 Quick Start
```bash
./start-demo.sh              # Start server + viewer
uv run agent --agent-id a1   # Run agent in new terminal
```
Open http://localhost:8080 and click "Connect"

### 📈 Progress: Stages 0-6 Complete (60%)
- ✅ **Stage 0-2**: Architecture, contracts, world server MVP
- ✅ **Stage 3**: Basic visibility (full map, LOS pending)
- ✅ **Stage 4**: Core validation (combat pending)
- ✅ **Stage 5**: Agent runner MVP (LLM pending)
- ✅ **Stage 6**: Viewer with DCSS tiles
- ⏳ **Stage 7**: Hunger done, combat/food pending
- ⏳ **Stage 8**: Determinism tests pending
- ⏳ **Stage 9**: Security pending

### 🔧 Next Priority
1. Combat system (`attack` action)
2. Food/items (`forage`, `eat` actions)
3. Line-of-sight visibility
4. LLM integration (DeepSeek v3)

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

## Stage 3: Visibility & Observation Bounding

**Visibility System**
- [x] Line-of-sight / visibility calculation (MVP: full visibility)
- [x] `obs.visible_tiles` bounded output
- [x] `obs.visible_entities` bounded output
- [ ] Prevent global state leakage (future: proper LOS)
- [ ] Test: different rooms → different observations (future)

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

**Memory System**
- [ ] Base prompt (immutable) (future)
- [ ] Personal Notes (mutable via `edit_prompt`) (future)
- [x] Recent event buffer

**Decision Loop**
- [x] Heuristic/random policy (stub)
- [ ] LLM adapter interface design (future)
- [ ] DeepSeek v3 integration (future)
- [x] Ensure exactly one action per turn
- [x] Timeout handling + retries

**Integration Test**
- [x] Runner plays N turns unattended without desync

## Stage 6: Browser Viewer MVP ✅

**SSE Client**
- [x] Subscribe to `/stream/public`
- [x] Handle `snapshot` event on connect
- [x] Handle `delta` events per turn
- [x] Mid-session join test

**Rendering**
- [x] DCSS-style tile grid (actual DCSS tiles)
- [x] Render entities on map
- [x] Agent stats panel
- [x] Event log display
- [x] Hover tooltips for entities

## Stage 7: Game Mechanics - Hunger, Food, Combat

**Hunger System**
- [x] Hunger decrements each turn
- [x] Starvation damages HP when hunger = 0
- [x] Display hunger in observations

**Food & Items**
- [ ] Forage yields low nutrition items
- [ ] Hunting yields higher nutrition (corpses)
- [ ] Items have position and decay timer
- [ ] Corpses decay after N turns
- [ ] `eat` action consumes items

**Combat System**
- [ ] Combat resolution step in turn loop
- [ ] Damage calculation
- [ ] Death handling + corpse drops
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
uv run agent --agent-id a1
uv run agent --agent-id a2

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
- Agents connect via agent_id (a1, a2 pre-spawned)
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

