# Fish Tank - Quick Reference

## 🚀 Start Everything

```bash
cd /home/gavin/dev/Scidonia/fishtank
export DEEPSEEK_API_KEY="your-key"
./start-demo.sh
```

Then:
1. Open **http://localhost:8081**
2. Run agents: `uv run python launcher.py --config agents.yaml`

## 🛑 Stop Everything

```bash
./stop-all.sh
```

## 🐟 Launch Agents

```bash
# Multiple agents from config
uv run python launcher.py --config agents.yaml

# Single agent with LLM
uv run python runner/main_llm.py --agent-id scout --personality explorer

# Mock LLM (no API key needed)
uv run python runner/main_llm.py --agent-id test --personality explorer --use-mock
```

## 💕 Test Mating

```bash
./stop-all.sh
cd server && npm start &
cd ../viewer && python -m http.server 8081 &
cd .. && uv run python runner/narrator_agent.py &
sleep 5
uv run python launcher.py --config breeding_test.yaml

# Watch for mating events
tail -f /tmp/narrator.log | grep -E "💕|mate"
```

## 📋 View Logs

```bash
tail -f /tmp/fishtank-server.log  # Server
tail -f /tmp/narrator.log         # Narrator  
tail -f /tmp/adam.log              # Specific agent
```

## 🔍 Health Check

```bash
curl http://localhost:3000/health           # Server
curl http://localhost:8081                  # Viewer
pgrep -f narrator_agent && echo "Running"   # Narrator
pgrep -f main_llm | wc -l                   # Agent count
```

## 🎮 Personalities

| Personality | Goal | Traits |
|-------------|------|--------|
| `explorer` | Explore map | High curiosity, low aggression |
| `survivor` | Stay alive | Practical, finds food |
| `aggressive` | Dominate | High aggression, attacks |
| `cooperative` | Help others | High sociability, shares |
| `cautious` | Avoid risks | High caution, defensive |
| `breeder` | Reproduce | Seeks partners, mates |

## 📊 Ports

| Service | Port | URL |
|---------|------|-----|
| Server | 3000 | http://localhost:3000 |
| Viewer | 8081 | http://localhost:8081 |

## 🐛 Quick Fixes

```bash
# Server not responding
cd server && npm start

# Port in use
lsof -i:3000 | grep node | awk '{print $2}' | xargs kill

# Viewer not loading
pkill -f "http.server.*8081"
cd viewer && python -m http.server 8081 &

# No narratives
pkill -f narrator_agent
uv run python runner/narrator_agent.py &

# Agent timeout
# Check: tail -f /tmp/<agent-id>.log
# Solution: Wait or restart agent
```

## 📁 Config Files

- `agents.yaml` - 10 diverse agents (default)
- `breeding_test.yaml` - 2 agents for mating test
- `test_agents.yaml` - Simple test config

## 🔑 Environment

```bash
# Required for real LLM
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxx"

# Optional
export FISH_TANK_SERVER="http://localhost:3000"
```

## 🎯 Mating Requirements

1. Both agents **adjacent** (1 tile apart)
2. Both have **20+ energy**
3. Use action: `{"action": "mate", "args": {"partner_id": "other_id"}}`

## 📝 Custom Agent

```bash
uv run python runner/main_llm.py \
  --agent-id myagent \
  --personality explorer \
  --starting-prompt "Your custom instructions here"
```

## 📚 Full Documentation

- `STARTUP_RUNBOOK.md` - Complete operational guide
- `AGENTS.md` - Agent system documentation
- `SESSION_SUMMARY.md` - Recent changes
- `DEVELOPMENT_CHECKLIST.md` - Implementation status
- `README.md` - Project overview
