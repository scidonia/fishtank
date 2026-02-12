# Fish Tank - Agent System

## Overview

Agents in Fish Tank have personalities, memories, and can make decisions using LLM (DeepSeek v3) or heuristics.

## Running Agents

### Simple Random Agent (No LLM)

```bash
uv run agent --agent-id a1
```

### LLM-Powered Agent

```bash
# Set your DeepSeek API key
export DEEPSEEK_API_KEY="your-api-key"

# Run with specific personality
uv run agent-llm --agent-id explorer1 --personality explorer

# Or use mock LLM for testing
uv run agent-llm --agent-id test1 --personality survivor --use-mock
```

## Agent Personalities

### Explorer
- **Goal**: Explore the entire map
- **Traits**: High curiosity, moderate sociability
- **Behavior**: Seeks new locations, meets other agents
- **Best for**: Discovering the world

### Survivor
- **Goal**: Stay alive as long as possible
- **Traits**: High caution, practical
- **Behavior**: Finds food, avoids danger, builds safe zones
- **Best for**: Long-term survival

### Aggressive
- **Goal**: Dominate the world
- **Traits**: High aggression, low caution
- **Behavior**: Eliminates threats, controls resources
- **Best for**: Combat scenarios

### Cooperative
- **Goal**: Help others survive
- **Traits**: High sociability, low aggression
- **Behavior**: Makes friends, shares resources, protects allies
- **Best for**: Team play

### Cautious
- **Goal**: Avoid all risks
- **Traits**: Very high caution, low curiosity
- **Behavior**: Finds hiding spots, scouts carefully
- **Best for**: Defensive play

## Agent Memory System

Agents remember:
- **Locations**: Where they've been
- **Entities**: Other agents and creatures they've seen
- **Events**: Recent things that happened
- **Notes**: Personal observations (mutable via `edit_prompt`)

## Command Options

```bash
uv run agent-llm --help

Options:
  --agent-id TEXT        Agent ID (default: a1)
  --personality TEXT     Personality type (default: explorer)
                         Options: explorer, survivor, aggressive, cooperative, cautious
  --server-url TEXT      World server URL (default: http://localhost:3000)
  --use-mock            Use mock LLM instead of DeepSeek API
```

## Examples

### Run Multiple Agents with Different Personalities

```bash
# Terminal 1: Explorer
export DEEPSEEK_API_KEY="your-key"
uv run agent-llm --agent-id scout --personality explorer

# Terminal 2: Survivor  
export DEEPSEEK_API_KEY="your-key"
uv run agent-llm --agent-id nomad --personality survivor

# Terminal 3: Cooperative
export DEEPSEEK_API_KEY="your-key"
uv run agent-llm --agent-id helper --personality cooperative
```

### Test with Mock LLM (No API Key Needed)

```bash
uv run agent-llm --agent-id test1 --personality explorer --use-mock
uv run agent-llm --agent-id test2 --personality aggressive --use-mock
```

## Agent Decision Making

### With LLM (DeepSeek v3)

1. Agent receives observation (turn, health, hunger, visible entities)
2. Observation is formatted into a prompt with personality and memory
3. LLM generates decision as JSON
4. Decision is validated and submitted to server

Example LLM prompt:
```
You are scout, a human in a survival world.
PERSONALITY: You are curious and adventurous...
TRAITS: Aggression: 0.2, Curiosity: 0.9...

CURRENT SITUATION (Turn 42):
STATUS: Health: 73/100, Hunger: 45/100
VISIBLE ENTITIES: agent (a2) at [15, 10], HP: 60

YOUR MEMORY: Visited 25 locations, Know about 1 other agents

What is your next action? Respond with JSON.
```

Expected response:
```json
{
    "action": "move",
    "args": {"dir": "NE"},
    "reasoning": "Moving northeast to explore new territory"
}
```

### Without LLM (Heuristic)

Simple rule-based decisions:
- Critical hunger → forage
- Low health → wait
- Otherwise → random movement

## Customizing Agents

### Create Custom Personality

Edit `runner/agent.py` and add to `AgentPersonality` enum and `from_personality` method:

```python
class AgentPersonality(Enum):
    # ... existing ...
    SCIENTIST = "scientist"

# In from_personality method:
AgentPersonality.SCIENTIST: cls(
    agent_id=agent_id,
    personality=personality,
    aggression=0.1,
    curiosity=1.0,
    sociability=0.7,
    caution=0.6,
    primary_goal="understand the world through experimentation",
    secondary_goals=["catalog all creatures", "map terrain types"]
),
```

### Modify Agent Prompts

Edit `runner/agent.py`, function `get_base_prompt()` to change how agents are instructed.

### Add New LLM Provider

Implement `LLMProvider` interface in `runner/llm.py`:

```python
class MyLLMProvider(LLMProvider):
    async def generate(self, prompt: str, system_prompt: str) -> str:
        # Your implementation
        pass
```

## Environment Variables

```bash
# Required for LLM agents
export DEEPSEEK_API_KEY="sk-..."

# Optional
export FISH_TANK_SERVER="http://localhost:3000"
```

## Troubleshooting

**"DEEPSEEK_API_KEY not set"**
- Set the environment variable or use `--use-mock` flag

**Agent makes no decisions**
- Check API key is valid
- Check network connection
- Try `--use-mock` to test without API

**JSON parse errors**
- LLM response format is incorrect
- Agent will fallback to `wait` action
- Check logs for actual LLM response

**Agent disconnects**
- Server might be down: `curl http://localhost:3000/health`
- Check server logs: `tail -f /tmp/fishtank-server.log`

## Next Steps

1. **Add more personalities** - Create specialized agent types
2. **Improve prompts** - Better instructions for LLMs
3. **Add learning** - Agents remember successful strategies
4. **Add communication** - Agents can talk to each other
5. **Add alliances** - Agents can form teams

See `DEVELOPMENT_CHECKLIST.md` for implementation roadmap.
