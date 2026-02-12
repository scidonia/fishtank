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

    # Personal notes (mutable by agent)
    notes: str = ""

    def add_event(self, event: str) -> None:
        """Add event to memory, keeping only recent ones."""
        self.recent_events.append(event)
        if len(self.recent_events) > self.max_events:
            self.recent_events = self.recent_events[-self.max_events :]

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
2. You need food to survive (hunger decreases each turn, starvation at 0)
3. You can see entities and terrain around you
4. You can move in 8 directions: N, S, E, W, NE, NW, SE, SW
5. Available actions: move, forage, wait
   - move: Move in a direction (requires "dir" arg)
   - forage: Search for food (50% chance, restores 10-30 hunger)
   - wait: Do nothing this turn

OUTPUT FORMAT:
You must respond with a JSON object containing your decision:
{{
    "action": "move|forage|wait",
    "args": {{"dir": "N"}} or {{}},
    "reasoning": "Brief explanation of your decision"
}}

Example valid responses:
- {{"action": "move", "args": {{"dir": "NE"}}, "reasoning": "Exploring northeast"}}
- {{"action": "forage", "args": {{}}, "reasoning": "Searching for food, hunger low"}}
- {{"action": "wait", "args": {{}}, "reasoning": "Observing the area"}}

IMPORTANT: When hunger is below 30, you should prioritize foraging!

Make decisions that align with your personality and goals.
"""


def get_observation_prompt(obs: Dict[str, Any], memory: AgentMemory) -> str:
    """Format observation into a prompt."""
    visible_entities = obs.get("visible_entities", [])
    recent_events = obs.get("recent_events", [])

    prompt = f"""CURRENT SITUATION (Turn {obs["turn_id"]}):

STATUS:
- Health: {obs["health"]}/100
- Hunger: {obs["hunger"]}/100 {"⚠️ CRITICAL!" if obs["hunger"] < 20 else ""}

VISIBLE ENTITIES:
"""

    if visible_entities:
        for entity in visible_entities:
            prompt += f"  - {entity['type']} ({entity['id']}) at position {entity['pos']}, HP: {entity['hp']}\n"
    else:
        prompt += "  - No other entities visible\n"

    if recent_events:
        prompt += f"\nRECENT EVENTS:\n"
        for event in recent_events:
            prompt += f"  - {event}\n"

    prompt += f"\nYOUR MEMORY:\n{memory.get_summary()}\n"

    prompt += f"\nWhat is your next action? Respond with JSON."

    return prompt
