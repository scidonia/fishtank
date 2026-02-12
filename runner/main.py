"""Fish Tank Agent Runner - LLM-powered agent client."""

import asyncio
import json
import sys
from typing import Any, Dict, Optional
from dataclasses import dataclass

import httpx
import typer
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.layout import Layout

app = typer.Typer()
console = Console()
error_console = Console(stderr=True, style="red")


@dataclass
class AgentConfig:
    """Configuration for an agent runner."""

    agent_id: str
    server_url: str = "http://localhost:3000"
    timeout: float = 0.5  # Time to decide action in seconds


class AgentRunner:
    """Agent runner that connects to the world server and plays the game."""

    def __init__(self, config: AgentConfig):
        self.config = config
        self.current_observation: Optional[Dict[str, Any]] = None
        self.turn_count: int = 0
        self.running: bool = False

    async def run(self) -> None:
        """Main agent loop."""
        console.print(f"[green]Starting agent {self.config.agent_id}[/green]")
        console.print(f"Connecting to {self.config.server_url}")

        self.running = True

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                await self.subscribe_to_observations(client)
        except KeyboardInterrupt:
            console.print("\n[yellow]Agent stopped by user[/yellow]")
        except Exception as e:
            error_console.print(f"Error: {e}")
            raise
        finally:
            self.running = False

    async def subscribe_to_observations(self, client: httpx.AsyncClient) -> None:
        """Subscribe to agent observation stream via SSE."""
        url = f"{self.config.server_url}/stream/agent?agent_id={self.config.agent_id}"

        console.print(f"[cyan]Subscribing to {url}[/cyan]")

        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Failed to connect: HTTP {response.status_code}")

            console.print("[green]✓ Connected to world server[/green]\n")

            event_type = None
            async for line in response.aiter_lines():
                if not self.running:
                    break

                line = line.strip()
                if not line:
                    continue

                # Parse SSE format
                if line.startswith("event:"):
                    event_type = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data = line.split(":", 1)[1].strip()

                    if event_type == "obs":
                        observation = json.loads(data)
                        await self.handle_observation(client, observation)

    async def handle_observation(
        self, client: httpx.AsyncClient, obs: Dict[str, Any]
    ) -> None:
        """Process an observation and submit an action."""
        self.current_observation = obs
        self.turn_count += 1

        turn_id = obs["turn_id"]
        health = obs["health"]
        hunger = obs["hunger"]

        # Display observation
        self.display_observation(obs)

        # Decide action (using simple heuristic for now)
        action = self.decide_action(obs)

        # Submit action
        await self.submit_action(client, turn_id, action)

    def decide_action(self, obs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Decide what action to take based on observation.

        For MVP, uses simple heuristic. Will be replaced with LLM later.
        """
        # Simple strategy: random walk
        import random

        directions = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"]

        # 80% chance to move, 20% chance to wait
        if random.random() < 0.8:
            return {"type": "move", "args": {"dir": random.choice(directions)}}
        else:
            return {"type": "wait", "args": {}}

    async def submit_action(
        self, client: httpx.AsyncClient, turn_id: int, action: Dict[str, Any]
    ) -> None:
        """Submit an action to the world server."""
        url = f"{self.config.server_url}/act"

        payload = {
            "agent_id": self.config.agent_id,
            "turn_id": turn_id,
            "type": action["type"],
            "args": action.get("args", {}),
        }

        try:
            response = await client.post(url, json=payload, timeout=1.0)
            result = response.json()

            if not result.get("ok"):
                error = result.get("error", "Unknown error")
                console.print(f"[red]  Action rejected: {error}[/red]")
        except Exception as e:
            error_console.print(f"Failed to submit action: {e}")

    def display_observation(self, obs: Dict[str, Any]) -> None:
        """Display the current observation in a nice format."""
        turn_id = obs["turn_id"]
        health = obs["health"]
        hunger = obs["hunger"]
        entities = obs["visible_entities"]

        status = (
            f"[bold cyan]Turn {turn_id}[/bold cyan] | HP: {health} | Hunger: {hunger}"
        )
        console.print(status)

        if entities:
            entity_list = ", ".join([f"{e['type']} {e['id']}" for e in entities[:3]])
            console.print(f"  Visible: {entity_list}")


@app.command()
def main(
    agent_id: str = typer.Option("a1", help="Agent ID to use"),
    server_url: str = typer.Option("http://localhost:3000", help="World server URL"),
) -> None:
    """
    Run a Fish Tank agent that connects to the world server.

    The agent will subscribe to observations and submit actions each turn.
    """
    config = AgentConfig(agent_id=agent_id, server_url=server_url)
    runner = AgentRunner(config)

    try:
        asyncio.run(runner.run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Shutting down...[/yellow]")
        sys.exit(0)


if __name__ == "__main__":
    app()
