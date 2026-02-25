# Experiment: no-prompt-1

## Goal
Test agent behavior with **minimal personality prompting** to establish baseline metrics for:
- Number of murders (combat deaths)
- Number of children (offspring created via mating)
- Average lifespan (turns survived)

## Configuration

- **Agents**: 10 agents with Greek letter names (alpha, beta, gamma, etc.)
- **Personalities**: Mixed personalities for trait diversity, but NO custom starting prompts
- **Duration**: 500 turns
- **World name**: Run will be auto-named (e.g., `run-2024-02-15-abc123`)

Note: Currently the codebase doesn't support custom world names. Each run is automatically named with timestamp + random ID.

## Files Created

1. **no-prompt-1.yaml** - Configuration file
2. **run-no-prompt-1.sh** - Startup script
3. **extract_metrics.py** - Metrics extraction tool

## How to Run

### Prerequisites
```bash
export DEEPSEEK_API_KEY="your-api-key-here"
```

### Start Experiment
```bash
./run-no-prompt-1.sh
```

This will:
1. Start the world server
2. Launch 10 agents with the configuration
3. Run for 500 turns (auto-stops)

### Monitor Progress
```bash
# Check current turn
curl http://localhost:3000/health

# Watch server logs
tail -f /tmp/fishtank-no-prompt-1-server.log

# Watch specific agent
tail -f /tmp/alpha.log
```

### Stop Early (if needed)
```bash
./stop-all.sh
```

## Extract Results

After the experiment completes (or stops):

```bash
# Show latest run metrics
python extract_metrics.py

# Show all runs
python extract_metrics.py --all
```

### Expected Output
```
📊 Latest experiment metrics:

🆔 Run ID: run-2024-02-15-abc123
⏱️  Total Turns: 500

🔪 Murders: 12
👶 Children Born: 3
📈 Average Lifespan: 287.5 turns

👥 Population:
   Initial agents: 10
   Total agents ever: 13
   Currently alive: 6
   Dead: 7

📊 Lifespan Distribution:
   Min: 45 turns
   Max: 500 turns
   Median: 312 turns
```

## What "No Prompting" Means

Agents receive:
- ✅ **Game mechanics** (movement, combat, foraging, etc.)
- ✅ **Personality traits** (numerical values: aggression, curiosity, etc.)
- ❌ **NO starting goals** (no "explore the map", "help others", etc.)
- ❌ **NO behavioral guidance** (no "you are curious", "you avoid risks", etc.)

The agents must figure out their own goals and strategies purely from:
1. Game mechanics description
2. Numerical trait values (e.g., "Aggression: 0.8")
3. Observations of the world

## Database Location

All experimental data is stored in:
```
data/fishtank_worlds.db
```

Tables:
- **runs** - Experiment metadata and aggregate stats
- **events** - Turn-by-turn events (attacks, births, deaths)
- **agent_lifespans** - Individual agent birth/death records

## Troubleshooting

**Server won't start:**
```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill old processes
pkill -9 node
```

**Agents not connecting:**
```bash
# Check server health
curl http://localhost:3000/health

# Check agent logs
ls -la /tmp/*.log
```

**API key issues:**
```bash
# Verify key is set
echo $DEEPSEEK_API_KEY

# Test with mock LLM instead
# Edit no-prompt-1.yaml and set: use_mock: true
```

## Next Steps

After collecting baseline metrics from this experiment, you can:

1. **Compare with prompted runs** - Run same agents with strong personality prompts
2. **Vary population size** - Test with 5, 15, 20 agents
3. **Change world size** - Modify map dimensions
4. **Adjust survival parameters** - Change energy decay, food availability

## Notes

- The narrator is disabled to reduce overhead
- Real-time viewer available at `http://127.0.0.1:8081` (requires separate viewer server)
- Each run gets a unique ID - you cannot set custom names (limitation of current codebase)
