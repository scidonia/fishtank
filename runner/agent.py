"""Agent personality and behavior system."""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from enum import Enum


class AgentPersonality(Enum):
    """Predefined agent personalities."""

    EXPLORER = "explorer"
    SURVIVOR = "survivor"
    AGGRESSIVE = "aggressive"
    COOPERATIVE = "cooperative"
    CAUTIOUS = "cautious"


@dataclass
class AgentConfig:
    """Configuration for an agent's personality and behavior."""

    agent_id: str
    personality: AgentPersonality
    species: str = "human"

    # Personality traits (0.0 to 1.0)
    aggression: float = 0.5
    curiosity: float = 0.5
    sociability: float = 0.5
    caution: float = 0.5

    # Goals and motivations
    primary_goal: str = "survive"
    secondary_goals: List[str] = field(default_factory=list)

    # Relationships
    allies: List[str] = field(default_factory=list)
    enemies: List[str] = field(default_factory=list)

    @classmethod
    def from_personality(
        cls, agent_id: str, personality: AgentPersonality
    ) -> "AgentConfig":
        """Create config from predefined personality."""
        configs = {
            AgentPersonality.EXPLORER: cls(
                agent_id=agent_id,
                personality=personality,
                aggression=0.2,
                curiosity=0.9,
                sociability=0.6,
                caution=0.4,
                primary_goal="explore the entire map",
                secondary_goals=["find interesting locations", "meet other agents"],
            ),
            AgentPersonality.SURVIVOR: cls(
                agent_id=agent_id,
                personality=personality,
                aggression=0.3,
                curiosity=0.4,
                sociability=0.5,
                caution=0.8,
                primary_goal="stay alive as long as possible",
                secondary_goals=["find food", "avoid danger", "build safe zones"],
            ),
            AgentPersonality.AGGRESSIVE: cls(
                agent_id=agent_id,
                personality=personality,
                aggression=0.9,
                curiosity=0.5,
                sociability=0.3,
                caution=0.2,
                primary_goal="dominate the world",
                secondary_goals=["eliminate threats", "control resources"],
            ),
            AgentPersonality.COOPERATIVE: cls(
                agent_id=agent_id,
                personality=personality,
                aggression=0.1,
                curiosity=0.6,
                sociability=0.9,
                caution=0.5,
                primary_goal="help others survive",
                secondary_goals=["make friends", "share resources", "protect allies"],
            ),
            AgentPersonality.CAUTIOUS: cls(
                agent_id=agent_id,
                personality=personality,
                aggression=0.2,
                curiosity=0.3,
                sociability=0.4,
                caution=0.9,
                primary_goal="avoid all risks",
                secondary_goals=["find safe hiding spots", "scout carefully"],
            ),
        }
        return configs[personality]


@dataclass
class AgentMemory:
    """Agent's memory and knowledge."""

    # Spatial memory
    visited_locations: List[tuple] = field(default_factory=list)
    known_food_locations: List[tuple] = field(default_factory=list)
    known_danger_zones: List[tuple] = field(default_factory=list)

    # Entity memory
    known_agents: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    known_creatures: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    # Event memory (last N events)
    recent_events: List[str] = field(default_factory=list)
    max_events: int = 20

    # Action history (last N actions with results)
    recent_actions: List[Dict[str, Any]] = field(default_factory=list)
    max_actions: int = 10

    # Personal notes (mutable by agent)
    notes: str = ""

    def add_event(self, event: str) -> None:
        """Add event to memory, keeping only recent ones."""
        self.recent_events.append(event)
        if len(self.recent_events) > self.max_events:
            self.recent_events = self.recent_events[-self.max_events :]

    def add_action(
        self, action: str, args: Dict[str, Any], result: str, turn: int
    ) -> None:
        """Add action to history, keeping only recent ones."""
        self.recent_actions.append(
            {"turn": turn, "action": action, "args": args, "result": result}
        )
        if len(self.recent_actions) > self.max_actions:
            self.recent_actions = self.recent_actions[-self.max_actions :]

    def add_location(self, x: int, y: int) -> None:
        """Remember a visited location."""
        loc = (x, y)
        if loc not in self.visited_locations:
            self.visited_locations.append(loc)

    def remember_agent(self, agent_id: str, info: Dict[str, Any]) -> None:
        """Remember information about another agent."""
        if agent_id not in self.known_agents:
            self.known_agents[agent_id] = {}
        self.known_agents[agent_id].update(info)

    def get_summary(self) -> str:
        """Get a summary of agent's memory for prompt."""
        parts = []

        if self.visited_locations:
            parts.append(f"Visited {len(self.visited_locations)} locations")

        if self.known_agents:
            parts.append(f"Know about {len(self.known_agents)} other agents")

        if self.known_food_locations:
            parts.append(f"Know {len(self.known_food_locations)} food locations")

        if self.known_danger_zones:
            parts.append(f"Aware of {len(self.known_danger_zones)} danger zones")

        if self.recent_events:
            parts.append(f"Recent events: {', '.join(self.recent_events[-5:])}")

        if self.notes:
            parts.append(f"Personal notes: {self.notes}")

        return "\n".join(parts) if parts else "No significant memories yet"


def get_base_prompt(config: AgentConfig) -> str:
    """Get the immutable base prompt for an agent."""
    personality_descriptions = {
        AgentPersonality.EXPLORER: "You are curious and adventurous, always seeking new areas to discover.",
        AgentPersonality.SURVIVOR: "You are practical and cautious, focused on staying alive.",
        AgentPersonality.AGGRESSIVE: "You are bold and confrontational, seeking to dominate.",
        AgentPersonality.COOPERATIVE: "You are friendly and helpful, preferring collaboration.",
        AgentPersonality.CAUTIOUS: "You are careful and risk-averse, avoiding danger at all costs.",
    }

    return f"""You are {config.agent_id}, a {config.species} in a survival world.

PERSONALITY: {personality_descriptions[config.personality]}

TRAITS:
- Aggression: {config.aggression:.1f} (how likely to fight)
- Curiosity: {config.curiosity:.1f} (how likely to explore)
- Sociability: {config.sociability:.1f} (how likely to interact with others)
- Caution: {config.caution:.1f} (how careful you are)

PRIMARY GOAL: {config.primary_goal}
SECONDARY GOALS: {", ".join(config.secondary_goals) if config.secondary_goals else "None"}

RELATIONSHIPS:
- Allies: {", ".join(config.allies) if config.allies else "None yet"}
- Enemies: {", ".join(config.enemies) if config.enemies else "None yet"}

GAME RULES:
1. You can only perform ONE action per turn
2. You need food to survive (energy decreases each turn, starvation at 0)
3. You can see entities and terrain around you within 10 tile radius (FOV)
4. You can move in 8 directions: N, S, E, W, NE, NW, SE, SW
5. Available actions: move, forage, attack, talk, mate, edit_prompt, edit_notes, read_notes, read_prompt, wait
   - move: Move in a direction (requires "dir" arg) - can be blocked by walls/entities
   - forage: Search for food nearby (within 1 tile). Plants give +20 energy, meat gives +50 energy.
   - attack: Attack another agent (requires "target_id" arg) - must be within 1 tile, deals ~10 damage
   - talk: Say something to nearby agents (requires "message" arg) - heard within 10 tiles
   - mate: Create offspring with another agent (requires "partner_id" arg) - must be within 1 tile, costs 40 energy for each parent, offspring inherits fused traits
   - edit_prompt: Set a persistent reminder (requires "text" arg) - always shown in observations
   - edit_notes: Write private notes (requires "text" arg) - only shown when you read_notes
   - read_notes: Read your private notes - use this to recall detailed information you've written
   - read_prompt: Read your current persistent prompt
   - wait: Do nothing this turn

OUTPUT FORMAT:
You must respond with a JSON object containing your decision:
{{
    "action": "move|forage|attack|talk|mate|edit_prompt|edit_notes|read_notes|read_prompt|wait",
    "args": {{"dir": "N"}} or {{"target_id": "a2"}} or {{"message": "text"}} or {{"text": "text"}} or {{}},
    "reasoning": "Brief explanation of your decision"
}}

Example valid responses:
- {{"action": "move", "args": {{"dir": "NE"}}, "reasoning": "Exploring northeast"}}
- {{"action": "forage", "args": {{}}, "reasoning": "Searching for food, energy low"}}
- {{"action": "attack", "args": {{"target_id": "a2"}}, "reasoning": "Defending territory"}}
- {{"action": "talk", "args": {{"message": "Let's cooperate!"}}, "reasoning": "Proposing alliance"}}
- {{"action": "mate", "args": {{"partner_id": "a2"}}, "reasoning": "Creating offspring with ally"}}
- {{"action": "edit_prompt", "args": {{"text": "Primary goal: Find food source"}}, "reasoning": "Setting persistent reminder"}}
- {{"action": "edit_notes", "args": {{"text": "a2 is friendly, wants to cooperate. Saw plant at [100,50]"}}, "reasoning": "Recording agent reputation and discoveries"}}
- {{"action": "read_notes", "args": {{}}, "reasoning": "Checking what I know about other agents"}}
- {{"action": "wait", "args": {{}}, "reasoning": "Observing the area"}}

IMPORTANT: 
- When energy is below 30, you should prioritize foraging!
- If your last action failed (hit a wall/entity), try a different direction!
- You can see walls in your FOV - avoid moving into them!
- Attack range is only 1 tile (adjacent). Move close before attacking!
- Mating costs 40 energy for each parent (very expensive) - only mate when you have plenty of energy!
- Mating creates a new agent offspring that inherits traits from both parents!
- Consider your personality: aggressive agents attack enemies, cooperative agents avoid combat!

Make decisions that align with your personality and goals.
"""


def get_observation_prompt(obs: Dict[str, Any], memory: AgentMemory) -> str:
    """Format observation into a prompt."""
    visible_entities = obs.get("visible_entities", [])
    visible_tiles = obs.get("visible_tiles", [])
    recent_events = obs.get("recent_events", [])
    last_action = obs.get("last_action_result")

    prompt = f"""CURRENT SITUATION (Turn {obs["turn_id"]}):

STATUS:
- Position: {obs.get("position", "unknown")}
- Health: {obs["health"]}/100
- Energy: {obs.get("energy", obs.get("hunger", 100))}/100 {"⚠️ CRITICAL!" if obs.get("energy", obs.get("hunger", 100)) < 20 else ""}

"""

    # Show last action result
    if last_action:
        if last_action.get("success"):
            prompt += f"LAST ACTION: ✓ {last_action.get('message', 'Success')}\n"
        else:
            prompt += f"LAST ACTION: ✗ FAILED - {last_action.get('message', 'Failed')} (reason: {last_action.get('reason', 'unknown')})\n"
            prompt += "  → You need to try a different action/direction!\n"
        prompt += "\n"

    # Show recent action history
    if memory.recent_actions:
        prompt += "RECENT ACTION HISTORY (last 5 actions):\n"
        for action_record in memory.recent_actions[-5:]:
            turn = action_record["turn"]
            action = action_record["action"]
            args = action_record["args"]
            result = action_record["result"]

            # Format args compactly
            args_str = ""
            if args:
                if "dir" in args:
                    args_str = f" {args['dir']}"
                elif "message" in args:
                    msg = (
                        args["message"][:40] + "..."
                        if len(args["message"]) > 40
                        else args["message"]
                    )
                    args_str = f' "{msg}"'
                elif "target_id" in args:
                    args_str = f" → {args['target_id']}"

            prompt += f"  Turn {turn}: {action}{args_str} - {result}\n"
        prompt += "\n"

    # Create ASCII map of visible area
    if visible_tiles:
        # Build a grid of what the agent can see
        # FOV is 10 tile radius, so 21x21 grid (-10 to +10)
        fov_size = 21
        fov_center = 10
        grid = [[" " for _ in range(fov_size)] for _ in range(fov_size)]

        # Fill in tiles
        for tile in visible_tiles:
            rel_x, rel_y = tile["relative"]
            grid_x = fov_center + rel_x
            grid_y = fov_center + rel_y
            if 0 <= grid_x < fov_size and 0 <= grid_y < fov_size:
                grid[grid_y][grid_x] = tile["tile"]

        # Mark agent's position
        grid[fov_center][fov_center] = "@"

        # Mark visible entities on the map
        agent_pos = obs.get("position", [0, 0])
        for entity in visible_entities:
            ex, ey = entity["pos"]
            rel_x = ex - agent_pos[0]
            rel_y = ey - agent_pos[1]
            grid_x = fov_center + rel_x
            grid_y = fov_center + rel_y
            if 0 <= grid_x < fov_size and 0 <= grid_y < fov_size:
                entity_type = entity["type"]
                if entity_type == "agent":
                    grid[grid_y][grid_x] = "A"
                elif entity_type == "plant":
                    grid[grid_y][grid_x] = "p"
                elif entity_type == "meat":
                    grid[grid_y][grid_x] = "m"
                elif entity_type == "bones":
                    grid[grid_y][grid_x] = "b"

        # Convert grid to string (show central 11x11 area for clarity)
        prompt += f"VISIBLE AREA (your FOV, 11x11 central view):\n"
        prompt += "Legend: @ = You, # = Wall, . = Floor, A = Agent, p = Plant, m = Meat, b = Bones\n"
        start = 5  # Show from -5 to +5 (11x11)
        end = 16
        for y in range(start, end):
            row = "".join(grid[y][start:end])
            prompt += f"  {row}\n"
        prompt += "\n"

    prompt += "VISIBLE ENTITIES:\n"
    if visible_entities:
        for entity in visible_entities:
            entity_type = entity["type"]
            entity_id = entity["id"]
            entity_pos = entity["pos"]

            # Calculate distance from agent's position
            agent_pos = obs.get("position", [0, 0])
            dx = abs(entity_pos[0] - agent_pos[0])
            dy = abs(entity_pos[1] - agent_pos[1])
            distance = max(dx, dy)  # Chebyshev distance (grid distance)

            if entity_type == "plant":
                forageable = (
                    "✓ CAN FORAGE"
                    if distance <= 1
                    else f"too far (distance: {distance})"
                )
                prompt += f"  - {entity_type} ({entity_id}) at position {entity_pos} [{forageable}] [+20 energy]\n"
            elif entity_type == "meat":
                forageable = (
                    "✓ CAN FORAGE"
                    if distance <= 1
                    else f"too far (distance: {distance})"
                )
                prompt += f"  - {entity_type} ({entity_id}) at position {entity_pos} [{forageable}] [+50 energy]\n"
            elif entity_type == "bones":
                prompt += f"  - {entity_type} ({entity_id}) at position {entity_pos} [remains, no nutrition]\n"
            else:
                # Agent entity
                entity_hp = entity.get("hp", "?")
                attackable = (
                    "✓ CAN ATTACK!" if distance <= 1 else f"distance: {distance} tiles"
                )
                prompt += f"  - {entity_type} ({entity_id}) at {entity_pos}, HP: {entity_hp} [{attackable}]\n"
    else:
        prompt += "  - No other entities visible\n"

    if recent_events:
        prompt += f"\nRECENT EVENTS:\n"
        for event in recent_events:
            prompt += f"  - {event}\n"

    # Show heard messages from nearby agents
    heard_messages = obs.get("heard_messages", [])
    if heard_messages:
        prompt += f"\nHEARD MESSAGES (from nearby agents):\n"
        for msg in heard_messages:
            prompt += f'  - Turn {msg["turn"]}, {msg["speaker"]}: "{msg["message"]}"\n'

    # Show agent's persistent prompt (always displayed)
    agent_prompt = obs.get("prompt", "")
    if agent_prompt:
        prompt += f"\nYOUR PERSISTENT PROMPT:\n{agent_prompt}\n"

    prompt += f"\nYOUR MEMORY:\n{memory.get_summary()}\n"

    prompt += f"\nWhat is your next action? Respond with JSON."

    return prompt
