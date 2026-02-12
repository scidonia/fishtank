# Fish Tank - Quick Reference

## Start Everything

```bash
./start-demo.sh
```

Then:
1. Open http://localhost:8080
2. Click "Connect"
3. Run agents: `uv run agent --agent-id scout`

## Stop Everything

```bash
./stop-all.sh
```

Or press `Ctrl+C` in the terminal running `start-demo.sh`

## Common Commands

**Check if running:**
```bash
curl http://localhost:3000/health
lsof -i:3000  # World server
lsof -i:8080  # Viewer
```

**View logs:**
```bash
tail -f /tmp/fishtank-server.log
tail -f /tmp/fishtank-viewer.log
```

**Run multiple agents:**
```bash
uv run agent --agent-id scout &
uv run agent --agent-id nomad &
uv run agent --agent-id warden &
uv run agent --agent-id a3 &
```

**Regenerate map:**
```bash
cd shared
python3 generate_map.py
cd ..
```

## Viewer Controls

**Mouse:**
- Click & Drag → Pan camera
- Hover → Show tooltips

**Keyboard:**
- Arrow Keys → Move camera

**Buttons:**
- `+` / `-` → Zoom
- "Follow Agent" → Auto-track first agent
- Click agent in sidebar → Follow that agent

## Port Issues

If you get "Address already in use":

```bash
./stop-all.sh
```

Manual cleanup:
```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

## File Locations

**Key Files:**
- `server/src/world.js` - World simulation
- `runner/main.py` - Agent runner
- `viewer/viewer.js` - Viewer with viewport
- `shared/map.txt` - 1000×1000 map

**Documentation:**
- `README.md` - Full documentation
- `WHERE_WE_ARE.txt` - Quick status
- `STATUS.md` - Comprehensive status
- `DEVELOPMENT_CHECKLIST.md` - Progress tracker

**Scripts:**
- `./start-demo.sh` - Start everything
- `./stop-all.sh` - Stop everything
- `shared/generate_map.py` - Generate new map

## API Endpoints

**SSE Streams:**
- `http://localhost:3000/stream/public` - Public world state
- `http://localhost:3000/stream/agent?agent_id=X` - Private observations

**Actions:**
- `http://localhost:3000/act` - Submit agent action (POST)

**Health:**
- `http://localhost:3000/health` - Server health check

## Quick Debugging

**Server not starting:**
```bash
cd server && npm install
```

**Agent not starting:**
```bash
uv sync
```

**Tiles not loading:**
```bash
ls viewer/tiles/floor/
ls viewer/tiles/wall/
ls viewer/tiles/entities/
```

**Map not found:**
```bash
ls -lh shared/map.txt
cd shared && python3 generate_map.py
```

## Next Steps

See `DEVELOPMENT_CHECKLIST.md` for implementation roadmap.

**Priority features:**
1. Combat system
2. Food/items
3. Line-of-sight
4. LLM integration
