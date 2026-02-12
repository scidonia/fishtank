"""Fish Tank Agent Runner with LLM integration."""

import asyncio
import json
import sys
from typing import Any, Dict, Optional

import httpx
import typer
from rich.console import Console
from rich.panel import Panel

from runner.agent import (
    AgentConfig,
    AgentMemory,
    AgentPersonality,
    get_base_prompt,
    get_observation_prompt,
)
from runner.llm import LLMDecisionMaker, create_llm_provider

app = typer.Typer()
console = Console()
error_console = Console(stderr=True, style="red")


class LLMAgentRunner:
    """Agent runner with LLM-powered decision making."""

    def __init__(
        self,
        config: AgentConfig,
        server_url: str = "http://localhost:3000",
        use_mock_llm: bool = False,
        debug_prompts: bool = False,
    ):
        self.config = config
        self.server_url = server_url
        self.use_mock_llm = use_mock_llm
        self.debug_prompts = debug_prompts

        self.memory = AgentMemory()
        self.base_prompt = get_base_prompt(config)
        self.decision_maker: Optional[LLMDecisionMaker] = None

        self.current_observation: Optional[Dict[str, Any]] = None
        self.turn_count: int = 0
        self.running: bool = False

        # Track last submitted action for memory recording
        self.last_submitted_action: Optional[Dict[str, Any]] = None

    async def run(self) -> None:
        """Main agent loop."""
        console.print(
            Panel.fit(
                f"[bold green]{self.config.agent_id}[/bold green]\n"
                f"Personality: {self.config.personality.value}\n"
                f"Goal: {self.config.primary_goal}",
                title="Agent Starting",
            )
        )

        # Initialize LLM provider
        provider = await create_llm_provider(self.use_mock_llm)
        self.decision_maker = LLMDecisionMaker(provider)

        if self.use_mock_llm:
            console.print("[yellow]⚠️  Using mock LLM (heuristic decisions)[/yellow]")
        else:
            console.print("[green]✓ Using DeepSeek v3[/green]")

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
        url = f"{self.server_url}/stream/agent?agent_id={self.config.agent_id}"

        console.print(f"[cyan]Connecting to {url}[/cyan]")

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
        energy = obs.get(
            "energy", obs.get("hunger", 100)
        )  # Support both old and new format

        # Update memory
        self.update_memory(obs)

        # Display observation
        self.display_observation(obs)

        # Emit observation telemetry
        await self.emit_telemetry(
            client,
            {
                "phase": "obs",
                "turn_id": turn_id,
                "health": health,
                "energy": energy,
                "visible_entity_count": len(obs.get("visible_entities", [])),
            },
        )

        # Generate observation prompt
        obs_prompt = get_observation_prompt(obs, self.memory)

        # Debug: Always show ASCII map on first turn to verify it's working
        if turn_id <= 2 and "VISIBLE AREA" in obs_prompt:
            # Extract just the ASCII map section
            start_idx = obs_prompt.find("VISIBLE AREA")
            end_idx = obs_prompt.find("\n\n", start_idx)
            if start_idx != -1 and end_idx != -1:
                map_section = obs_prompt[start_idx:end_idx]
                console.print(f"\n[dim cyan]{map_section}[/dim cyan]\n")

        # Debug: Print full prompt if requested
        if self.debug_prompts:
            console.print("\n[bold cyan]═══ BASE PROMPT ═══[/bold cyan]")
            console.print(self.base_prompt)
            console.print("\n[bold cyan]═══ OBSERVATION PROMPT ═══[/bold cyan]")
            console.print(obs_prompt)
            console.print("[bold cyan]═══ END PROMPTS ═══[/bold cyan]\n")

        # Make decision using LLM
        try:
            decision = await self.decision_maker.decide(self.base_prompt, obs_prompt)

            reasoning = decision.get("reasoning", "No reasoning provided")
            console.print(f"[dim]💭 {reasoning}[/dim]")

            # Emit decision telemetry
            await self.emit_telemetry(
                client,
                {
                    "phase": "decision",
                    "turn_id": turn_id,
                    "action": {
                        "type": decision["action"],
                        "args": decision.get("args", {}),
                    },
                    "reasoning": reasoning,
                    "prompt_chars": len(self.base_prompt) + len(obs_prompt),
                    "response_chars": len(json.dumps(decision)),
                    "current_prompt": self.base_prompt,
                },
            )

            # Submit action
            await self.submit_action(client, turn_id, decision)

        except Exception as e:
            error_console.print(f"Decision error: {e}")
            # Fallback to wait
            await self.submit_action(client, turn_id, {"action": "wait", "args": {}})

    def update_memory(self, obs: Dict[str, Any]) -> None:
        """Update agent memory based on observation."""
        # Remember recent events
        for event in obs.get("recent_events", []):
            self.memory.add_event(event)

        # Remember visible entities
        for entity in obs.get("visible_entities", []):
            if entity["type"] == "agent":
                self.memory.remember_agent(
                    entity["id"],
                    {
                        "last_seen": obs["turn_id"],
                        "position": entity["pos"],
                        "hp": entity["hp"],
                    },
                )

        # Record last action result in history
        last_action_result = obs.get("last_action_result")

        if last_action_result and self.last_submitted_action:
            # Combine the submitted action details with the result
            action_type = self.last_submitted_action["action"]
            action_args = self.last_submitted_action["args"]
            success = last_action_result.get("success", False)
            message = last_action_result.get("message", "")
            reason = last_action_result.get("reason", "")

            # Format result string
            if success:
                result_str = f"✓ {message}"
            else:
                result_str = f"✗ {message} ({reason})"

            self.memory.add_action(
                action=action_type,
                args=action_args,
                result=result_str,
                turn=self.last_submitted_action["turn"],
            )

        if last_action_result and self.last_submitted_action:
            # Combine the submitted action details with the result
            action_type = self.last_submitted_action["action"]
            action_args = self.last_submitted_action["args"]
            success = last_action_result.get("success", False)
            message = last_action_result.get("message", "")
            reason = last_action_result.get("reason", "")

            # Format result string
            if success:
                result_str = f"✓ {message}"
            else:
                result_str = f"✗ {message} ({reason})"

            print(
                f"DEBUG: Adding action to memory: {action_type} at turn {self.last_submitted_action['turn']}",
                file=sys.stderr,
            )

            self.memory.add_action(
                action=action_type,
                args=action_args,
                result=result_str,
                turn=self.last_submitted_action["turn"],
            )

    async def submit_action(
        self, client: httpx.AsyncClient, turn_id: int, decision: Dict[str, Any]
    ) -> None:
        """Submit an action to the world server."""
        url = f"{self.server_url}/act"

        payload = {
            "agent_id": self.config.agent_id,
            "turn_id": turn_id,
            "type": decision["action"],
            "args": decision.get("args", {}),
        }

        # Store this action so we can match it with the result in next observation
        self.last_submitted_action = {
            "turn": turn_id,
            "action": decision["action"],
            "args": decision.get("args", {}),
        }

        try:
            response = await client.post(url, json=payload, timeout=1.0)
            result = response.json()

            if not result.get("ok"):
                error = result.get("error", "Unknown error")
                console.print(f"[red]  ✗ Action rejected: {error}[/red]")

                # Emit failure telemetry
                await self.emit_telemetry(
                    client,
                    {
                        "phase": "result",
                        "turn_id": turn_id,
                        "ok": False,
                        "error": error,
                    },
                )
            else:
                console.print(
                    f"[green]  ✓ {decision['action']} {decision.get('args', {})}[/green]"
                )

                # Emit success telemetry
                await self.emit_telemetry(
                    client, {"phase": "result", "turn_id": turn_id, "ok": True}
                )
        except Exception as e:
            error_console.print(f"Failed to submit action: {e}")
            await self.emit_telemetry(
                client,
                {"phase": "result", "turn_id": turn_id, "ok": False, "error": str(e)},
            )

    async def emit_telemetry(
        self, client: httpx.AsyncClient, event: Dict[str, Any]
    ) -> None:
        """Emit telemetry event to the server."""
        url = f"{self.server_url}/telemetry"

        payload = {"agent_id": self.config.agent_id, **event}

        try:
            await client.post(url, json=payload, timeout=1.0)
        except Exception as e:
            # Don't let telemetry errors crash the agent
            error_console.print(f"[dim]Telemetry error: {e}[/dim]")

    def display_observation(self, obs: Dict[str, Any]) -> None:
        """Display the current observation."""
        turn_id = obs["turn_id"]
        health = obs["health"]
        energy = obs.get(
            "energy", obs.get("hunger", 100)
        )  # Support both old and new format
        entities = obs["visible_entities"]

        # Health/energy indicators
        health_bar = "█" * (health // 10) + "░" * (10 - health // 10)
        energy_bar = "█" * (energy // 10) + "░" * (10 - energy // 10)

        status = (
            f"[bold cyan]Turn {turn_id}[/bold cyan]\n"
            f"HP: [{health_bar}] {health}/100\n"
            f"Energy: [{energy_bar}] {energy}/100"
        )

        console.print(Panel(status, style="blue"))

        if entities:
            entity_list = ", ".join([f"{e['type']} {e['id']}" for e in entities[:3]])
            console.print(f"  👁️  Visible: {entity_list}")


@app.command()
def main(
    agent_id: str = "scout",
    personality: str = "explorer",
    server_url: str = "http://localhost:3000",
    use_mock: bool = False,
) -> None:
    """
    Run a Fish Tank agent with LLM-powered decision making.

    Set DEEPSEEK_API_KEY environment variable to use real LLM.
    Otherwise, will use mock LLM with heuristic decisions.

    Args:
        agent_id: Agent ID to use
        personality: Agent personality (explorer, survivor, aggressive, cooperative, cautious)
        server_url: World server URL
        use_mock: Use mock LLM instead of DeepSeek
    """
    # Debug all parameters
    console.print(
        f"[dim]DEBUG: agent_id={repr(agent_id)}, personality type={type(personality)}, value={repr(personality)}[/dim]"
    )

    try:
        personality_enum = AgentPersonality(personality.lower())
    except (ValueError, AttributeError) as e:
        error_console.print(
            f"Invalid personality: {personality} (error: {e})\n"
            f"Valid options: explorer, survivor, aggressive, cooperative, cautious"
        )
        sys.exit(1)

    config = AgentConfig.from_personality(agent_id, personality_enum)
    runner = LLMAgentRunner(config, server_url, use_mock)

    try:
        asyncio.run(runner.run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Shutting down...[/yellow]")
        sys.exit(0)


if __name__ == "__main__":
    app()
