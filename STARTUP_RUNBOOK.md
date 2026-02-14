# Fish Tank - Startup Runbook

## Quick Start (Recommended)

```bash
cd /home/gavin/dev/Scidonia/fishtank
./start-demo.sh
```

Then open: **http://localhost:8081**

This starts:
- World server on port 3000
- Viewer on port 8081
- No agents (spawn them manually as needed)

## Manual Startup (Full Control)

### 1. Start World Server

```bash
cd /home/gavin/dev/Scidonia/fishtank/server
npm start > /tmp/fishtank-server.log 2>&1 &

# Verify it's running
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

### 2. Start Viewer

```bash
cd /home/gavin/dev/Scidonia/fishtank/viewer
python -m http.server 8081 > /tmp/fishtank-viewer.log 2>&1 &
```

Open browser: **http://localhost:8081**

### 3. Start Narrator (Optional but Recommended)

```bash
cd /home/gavin/dev/Scidonia/fishtank
export DEEPSEEK_API_KEY="your-api-key"
uv run python runner/narrator_agent.py > /tmp/narrator.log 2>&1 &
```

### 4. Launch Agents

**Option A: Launch Multiple Agents from YAML**

```bash
cd /home/gavin/dev/Scidonia/fishtank
export DEEPSEEK_API_KEY="your-api-key"
uv run python launcher.py --config agents.yaml
```

Available configs:
- `agents.yaml` - 10 diverse agents (default demo)
- `breeding_test.yaml` - 2 agents with explicit mating instructions
- `breeding_agents.yaml` - Older config (use `breeding_test.yaml` instead)

**Option B: Launch Single Agent Manually**

```bash
export DEEPSEEK_API_KEY="your-api-key"
uv run python runner/main_llm.py --agent-id scout --personality explorer
```

Personalities: `explorer`, `survivor`, `aggressive`, `cooperative`, `cautious`, `breeder`

**Option C: Mock LLM (No API Key)**

```bash
uv run python runner/main_llm.py --agent-id test1 --personality explorer --use-mock
```

## Port Configuration

| Service | Port | URL |
|---------|------|-----|
| World Server | 3000 | http://localhost:3000 |
| Viewer | 8081 | http://localhost:8081 |

**Note:** Port 8080 is avoided due to Airflow conflict.

## Log Files

| Component | Log Location |
|-----------|--------------|
| World Server | `/tmp/fishtank-server.log` |
| Viewer | `/tmp/fishtank-viewer.log` |
| Narrator | `/tmp/narrator.log` |
| Agents | `/tmp/<agent-id>.log` (e.g., `/tmp/adam.log`, `/tmp/scout.log`) |

### Viewing Logs

```bash
# Watch server logs
tail -f /tmp/fishtank-server.log

# Watch narrator logs
tail -f /tmp/narrator.log

# Watch specific agent logs
tail -f /tmp/adam.log
```

## Troubleshooting

### 1. Viewer Shows "Loading runs..." Forever

**Symptom:** Archaeology panel stuck on "Loading runs..."

**Causes:**
- Server not running
- JavaScript errors in browser console

**Fix:**
```bash
# Check server is running
curl http://localhost:3000/health

# Check browser console (F12) for errors
# Look for failed fetch to /api/runs

# Restart server
cd /home/gavin/dev/Scidonia/fishtank/server
npm start
```

### 2. No Narratives Appearing (Narrator Panel Empty)

**Symptom:** Narrator panel shows no text after 10+ turns

**Causes:**
- Narrator not running
- Narrator can't connect to DeepSeek API
- Agents are timing out (no interesting events to narrate)

**Fix:**
```bash
# Check narrator is running
ps aux | grep narrator_agent

# Check narrator logs
tail -f /tmp/narrator.log
# Look for:
# - "✓ Connected to event stream" (good)
# - "Connection refused" (server not ready)
# - "Timeout" (DeepSeek API issue)

# Check server logs for agent activity
tail -f /tmp/fishtank-server.log | grep -E "talk|give|attack|mate|death"

# If no agent events, agents might be timing out
tail -f /tmp/scout.log
# Look for "Timeout waiting for LLM response"

# Restart narrator
pkill -f narrator_agent
export DEEPSEEK_API_KEY="your-key"
uv run python runner/narrator_agent.py &
```

### 3. Agent Log Empty When Clicking Agent

**Symptom:** Click on agent in viewer, Agent Log panel shows no data

**Causes:**
- Surveillance stream not connecting
- Agent not making decisions (timeout)
- Server not streaming telemetry

**Fix:**
```bash
# Open browser console (F12)
# Look for: "SSE surveillance connected for agent: <agent-id>"
# Or errors like: "EventSource failed"

# Check if agent is running
ps aux | grep <agent-id>

# Check agent's own logs
tail -f /tmp/<agent-id>.log

# Verify surveillance endpoint works
curl "http://localhost:3000/stream/surveillance?agent_id=scout"
# Should stream events, press Ctrl+C to stop

# Restart agent if needed
pkill -f "main_llm.*scout"
export DEEPSEEK_API_KEY="your-key"
uv run python runner/main_llm.py --agent-id scout --personality explorer
```

### 4. DeepSeek API Timeouts

**Symptom:** Agents frequently timeout, logs show "Timeout waiting for LLM response"

**Causes:**
- DeepSeek API is slow or rate-limited
- Network issues
- Invalid API key

**Fix:**
```bash
# Verify API key is set
echo $DEEPSEEK_API_KEY

# Test API directly
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "test"}]
  }'

# If API is down, use mock LLM temporarily
uv run python launcher.py --config agents.yaml --use-mock
```

### 5. Port 8081 Already in Use

**Symptom:** `python -m http.server 8081` fails with "Address already in use"

**Fix:**
```bash
# Find what's using port 8081
lsof -i:8081

# Kill the process
kill <PID>

# Or kill all http.server processes
pkill -f "http.server.*8081"
```

### 6. Mating Never Happens

**Symptom:** Running `breeding_test.yaml`, agents never mate

**Possible Causes:**
- Agents not adjacent (must be exactly 1 tile apart)
- One or both agents have < 20 energy
- Agents don't understand mating mechanics (not using `starting_prompt`)

**Diagnosis:**
```bash
# Watch narrator logs for coordination attempts
tail -f /tmp/narrator.log | grep -E "talk|mate|💕"

# Watch agent logs for mate actions
tail -f /tmp/adam.log | grep mate
tail -f /tmp/eve.log | grep mate

# Check server logs for mate attempts
tail -f /tmp/fishtank-server.log | grep mate

# Watch viewer - are agents moving toward each other?
# - Click on adam, check Agent Log for reasoning
# - Click on eve, check Agent Log for reasoning
```

**Fixes:**
- Ensure `breeding_test.yaml` is using `starting_prompt` field (not `custom_prompt`)
- Verify agents have 20+ energy when attempting to mate
- Check positions - agents must be diagonal or orthogonally adjacent
- Try adding more explicit coordination in starting_prompt

### 7. Server Won't Start (Port 3000 in Use)

**Symptom:** `npm start` fails, "Port 3000 is already in use"

**Fix:**
```bash
# Find what's using port 3000
lsof -i:3000

# Kill it
kill <PID>

# Or use stop-all script
./stop-all.sh
```

## Complete Shutdown

```bash
cd /home/gavin/dev/Scidonia/fishtank
./stop-all.sh

# If that doesn't work, manual cleanup:
pkill -f "node src/index.js"
pkill -f "http.server.*8081"
pkill -f "narrator_agent"
pkill -f "main_llm"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8081 | xargs kill -9 2>/dev/null || true
```

## Testing Mating Feature

**Step-by-step mating test:**

```bash
# 1. Stop everything
./stop-all.sh

# 2. Start server
cd server && npm start > /tmp/fishtank-server.log 2>&1 &
sleep 3

# 3. Start viewer
cd ../viewer && python -m http.server 8081 > /tmp/fishtank-viewer.log 2>&1 &
sleep 2

# 4. Start narrator
cd ..
export DEEPSEEK_API_KEY="your-key"
uv run python runner/narrator_agent.py > /tmp/narrator.log 2>&1 &
sleep 2

# 5. Launch breeding test agents
uv run python launcher.py --config breeding_test.yaml

# 6. Watch for mating
tail -f /tmp/narrator.log | grep -E "💕|mate|birth|offspring"

# 7. Open viewer
# http://localhost:8081
# Watch for:
# - Adam and eve moving toward each other
# - Talk messages coordinating
# - Narrator announcing mating event
# - New agent appearing on map (offspring)
```

**Success indicators:**
- Narrator log shows: "💕 adam mates with eve"
- Server log shows: "Agent adam performing action: mate"
- New agent appears on map with name like "Adameve" or "Eveadam"
- Narrator describes the birth event

## Verifying System Health

```bash
# Run this to check all components
cd /home/gavin/dev/Scidonia/fishtank

# 1. Server health
curl -s http://localhost:3000/health | grep ok && echo "✓ Server OK" || echo "✗ Server DOWN"

# 2. Viewer accessible
curl -s http://localhost:8081 | grep -q "<title>" && echo "✓ Viewer OK" || echo "✗ Viewer DOWN"

# 3. Narrator running
pgrep -f narrator_agent > /dev/null && echo "✓ Narrator running" || echo "✗ Narrator not running"

# 4. Agents running
pgrep -f main_llm > /dev/null && echo "✓ Agents running" || echo "✗ No agents running"

# 5. Recent activity
tail -5 /tmp/fishtank-server.log
```

## Configuration Files

### Agent YAML Configuration

All configs support these fields:

```yaml
use_mock: false  # true = mock LLM (no API key needed), false = DeepSeek API
narrator: true   # Start narrator automatically
agents:
  - id: agent_name           # Unique agent ID
    personality: explorer    # Personality type
    starting_prompt: |       # Optional: Override default personality prompt
      Custom instructions...
      Explain actions, goals, strategies.
```

**Available Personalities:**
- `explorer` - Explores map, discovers new areas
- `survivor` - Focuses on staying alive, finding food
- `aggressive` - Attacks others, dominates territory  
- `cooperative` - Helps others, shares resources
- `cautious` - Avoids risks, hides from threats
- `breeder` - Seeks partners to reproduce

### Custom Starting Prompts

The `starting_prompt` field lets you give agents specific instructions that override their personality defaults. This is used on turn 1 via the `edit_prompt` action.

**Example:** Give an explorer agent specific coordinates to reach:

```yaml
agents:
  - id: scout
    personality: explorer
    starting_prompt: |
      MISSION: Reach coordinates [50, 50] and report what you find.
      
      STRATEGY:
      1. Move steadily toward [50, 50]
      2. Forage when energy < 30
      3. Report interesting entities via talk action
      4. Avoid combat unless necessary
```

## Environment Variables

```bash
# Required for LLM agents
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxx"

# Optional: Override server URL (default: http://localhost:3000)
export FISH_TANK_SERVER="http://localhost:3000"
```

## Useful Commands Reference

```bash
# Quick restart everything
./stop-all.sh && ./start-demo.sh

# Launch single agent with custom prompt
uv run python runner/main_llm.py \
  --agent-id custom1 \
  --personality explorer \
  --starting-prompt "Find food and share with others"

# Watch all logs at once (requires tmux)
tmux new-session \; \
  split-window -h \; \
  split-window -v \; \
  select-pane -t 0 \; \
  send-keys 'tail -f /tmp/fishtank-server.log' C-m \; \
  select-pane -t 1 \; \
  send-keys 'tail -f /tmp/narrator.log' C-m \; \
  select-pane -t 2 \; \
  send-keys 'tail -f /tmp/adam.log' C-m

# Count active agents
pgrep -f main_llm | wc -l

# List all agent processes
ps aux | grep main_llm | grep -v grep
```

## Next Steps After Startup

Once everything is running:

1. **Open Viewer:** http://localhost:8081
2. **Verify Connection:** 
   - World View should show agents moving
   - Turn counter should increment every few seconds
3. **Check Narrator:** Should see narratives appearing in Narrator panel every 3-10 turns
4. **Inspect Agents:** Click on any agent to see their Agent Log in the sidebar
5. **Browse History:** Use Archaeology panel to load previous runs

## Known Issues

1. **DeepSeek API can be slow** - Agents may timeout waiting for responses (60s timeout)
2. **Narrator delay** - May take 5-10 turns for first narrative if agents timeout frequently
3. **Archaeology loading** - Takes 5-10 seconds to load runs on first click
4. **SSE reconnection** - If server restarts, viewer needs manual page refresh

## Support

For issues not covered here:
1. Check server logs: `tail -f /tmp/fishtank-server.log`
2. Check browser console (F12 → Console tab)
3. Check agent logs: `tail -f /tmp/<agent-id>.log`
4. Check narrator logs: `tail -f /tmp/narrator.log`

Look for ERROR or WARN messages in any log file.
