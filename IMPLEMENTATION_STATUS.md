# Fish Tank - Public Project Implementation Status

## ✅ COMPLETED (Just Now)

### 1. Tile Size Increase
- **File:** `viewer/viewer.js:10`
- **Change:** Increased `tileSize` from 32px to 48px (50% larger)
- **Zoom range:** Updated from 16-64 to 24-96 pixels
- **Result:** Agents are now much more visible

### 2. Custom Agent Sprites  
- **Files:** `viewer/viewer.js:64, 465-469`
- **Added sprites:** warden.png, seeker.png, ranger.png (already in tiles/entities/)
- **Logic:** Agent-specific sprites take priority over generic "agent.png"
- **Fallback:** Paper doll rendering for agents without custom sprites
- **Result:** warden, seeker, and ranger now display with unique sprites

### 3. World Logger Database System
- **File:** `server/src/worldLogger.js` (NEW - 278 lines)
- **Database:** SQLite via better-sqlite3
- **Location:** `data/fishtank_worlds.db`
- **Package:** Installed better-sqlite3 to server dependencies

**Schema:**
- `runs` table: run_id, timestamps, counters (births, deaths, murders, tiles_explored, turns)
- `events` table: All game events (births, deaths, attacks) with turn, position, data
- `agent_lifespans` table: Birth/death records, parents, causes of death

**API Methods:**
- `logBirth(turn, agentId, parents, position)`
- `logDeath(turn, agentId, cause, position, wasKilled)`  
- `logAttack(turn, attackerId, targetId, damage, targetHp, position)`
- `updateExploredTiles(count)`
- `updateTurnCount(turn)`
- `endRun(summary)` - for LLM-generated summaries
- `getAllRuns()` - for archaeology viewer
- `getRunEvents(runId)`
- `getAgentLifespans(runId)`

## 🔄 IN PROGRESS

### 4. Integrate WorldLogger into WorldServer
**Next steps:**
1. Import WorldLogger in `server/src/world.js`
2. Instantiate logger in constructor: `this.logger = new WorldLogger()`
3. Add logging calls:
   - `handleMate()` → `logger.logBirth()`
   - `applyEnergyDecay()` deaths → `logger.logDeath()`  
   - `handleAttack()` → `logger.logAttack()`, track kills
   - `executeTurn()` → `logger.updateTurnCount()`
4. Track explored tiles (set of visited positions)
5. On server shutdown → `logger.endRun()`

### 5. Statistics Tracking
**Metrics to add:**
- **Area explored:** Track unique (x,y) positions visited by agents
- **Turns until extinction:** Already tracked as `total_turns`
- **Births:** Increment on successful `mate` action
- **Murders:** Track `attack` that causes death (hp → 0)

## ⏳ TODO

### 6. Test Mating Functionality
**Action items:**
- Lower mating cost further if needed (currently 20 energy)
- OR give agents more starting energy
- Document mating in `AGENTS.md`:
  - Requires adjacency (1 tile)
  - Costs 20 energy each parent
  - Child spawns adjacent
  - Child inherits fused prompts
- Create test scenario: 2 cooperative agents with high energy near each other

### 7. LLM World Summary Generation
**Implementation:**
- New file: `server/src/worldSummarizer.js`
- Uses DeepSeek API to generate narrative from:
  - Run stats (turns, births, deaths, murders)
  - Event log (key moments)
  - Agent lifespans (notable lives)
- Example prompt:
  ```
  You are a historian analyzing this world:
  - Lasted 1247 turns
  - 3 births, 13 deaths (5 murders)
  - 427 tiles explored
  
  Key events:
  [event log excerpt]
  
  Write a 3-paragraph narrative about what happened.
  ```
- Store result in `runs.world_summary`
- Call on `endRun()`

### 8. World Archaeology Viewer Tab
**UI Components needed:**
- New tab in `viewer/index.html`: "World" | "Actions" | "Archaeology"
- Archaeology tab shows:
  - **List of past runs** (fetch from `/api/runs`)
  - For each run: run_id, date, turns, births, deaths, summary excerpt
  - **Click to view details:**
    - Full statistics
    - LLM-generated summary
    - Event timeline (major events)
    - Agent lifespans table
    - Maybe: replay system (future)

**Server API endpoints needed:**
```javascript
// In server/src/index.js
app.get('/api/runs', (req, res) => {
  const runs = logger.getAllRuns();
  res.json(runs);
});

app.get('/api/runs/:runId', (req, res) => {
  const stats = logger.getRunStats();
  const events = logger.getRunEvents(req.params.runId);
  const agents = logger.getAgentLifespans(req.params.runId);
  res.json({ stats, events, agents });
});
```

## File Structure

```
server/
  src/
    world.js          (needs integration)
    worldLogger.js    (✅ complete)
    worldSummarizer.js (⏳ todo)
    index.js          (needs API routes)
  package.json        (✅ better-sqlite3 added)

data/
  fishtank_worlds.db  (created on first run)

viewer/
  viewer.js           (✅ tiles + sprites done)
  index.html          (needs archaeology tab)
  style.css           (needs archaeology styles)
  tiles/
    entities/
      warden.png      (✅ exists)
      seeker.png      (✅ exists)  
      ranger.png      (✅ exists)
```

## Priority Order

1. **Integrate WorldLogger** (30 min) - Critical for data collection
2. **Test current agents for eating** (10 min) - Verify survival works
3. **Test mating** (30 min) - Verify reproduction works, document
4. **Add API routes** (15 min) - Enable archaeology viewer
5. **Build archaeology UI** (60 min) - Main user-facing feature
6. **LLM summarizer** (45 min) - Narrative generation
7. **Polish** (30 min) - Styling, edge cases

## Testing Checklist

- [ ] Agents use `eat` action when energy < 60
- [ ] Agents survive >100 turns without dying
- [ ] Two agents successfully mate
- [ ] Offspring spawns with fused prompt
- [ ] Database records births/deaths correctly
- [ ] Archaeology tab displays past runs
- [ ] LLM generates coherent world summary
- [ ] Custom sprites render for warden/seeker/ranger

## Notes

- **Mating cost:** Currently 20 energy, may need adjustment
- **DeepSeek API:** Need key for summarizer (can use mock for testing)
- **Database location:** `data/fishtank_worlds.db` (gitignore this)
- **Run IDs:** Format `run-2026-02-13T14-30-45-abc123`
