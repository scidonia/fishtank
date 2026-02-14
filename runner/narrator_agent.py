#!/usr/bin/env python3
"""
Narrator Agent - Generates narrative summaries of each turn

The narrator observes public events and generates dramatic 1-2 sentence summaries.
"""

import os
import sys
import time
import httpx
import json
from rich.console import Console
from rich.panel import Panel

console = Console()


class NarratorAgent:
    def __init__(self, server_url="http://localhost:3000"):
        self.server_url = server_url
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        self.turn_events = []  # Events from current turn
        self.last_turn = 0

        if not self.api_key:
            console.print(
                "[red]WARNING: DEEPSEEK_API_KEY not set - using fallback narration[/red]"
            )

    def connect(self):
        """Connect to public event stream"""
        console.print(
            f"[cyan]Narrator connecting to {self.server_url}/stream/public[/cyan]"
        )

        with httpx.stream(
            "GET", f"{self.server_url}/stream/public", timeout=None
        ) as response:
            console.print("[green]✓ Connected to world server[/green]")

            # SSE parsing with proper multi-line handling
            current_event = {"type": None, "data": ""}

            for line in response.iter_lines():
                line = line.strip()

                # Empty line signals end of message
                if not line:
                    if current_event["type"] and current_event["data"]:
                        self.handle_event(current_event["type"], current_event["data"])
                    # Reset for next message
                    current_event = {"type": None, "data": ""}

                elif line.startswith("event:"):
                    current_event["type"] = line.split(":", 1)[1].strip()

                elif line.startswith("data:"):
                    data_line = line.split(":", 1)[1].strip()
                    # Accumulate data (in case of multi-line data fields)
                    if current_event["data"]:
                        current_event["data"] += "\n" + data_line
                    else:
                        current_event["data"] = data_line

    def handle_event(self, event_type, data_str):
        """Handle incoming SSE events"""
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            console.print(f"[red]Failed to parse JSON: {data_str[:100]}[/red]")
            return

        if event_type == "snapshot":
            # Initial snapshot
            self.last_turn = data.get("turn_id", 0)
            console.print(
                f"[yellow]📸 Snapshot received - Turn {self.last_turn}[/yellow]"
            )

        elif event_type == "public":
            # Public event (talk, combat, death, etc.)
            event_summary = data.get("type", "unknown")
            event_turn = data.get("turn", 0)
            message = data.get("message", "")

            # Filter out animal events - only care about agent activities
            # Skip forage and death events from animals (rabbits, deer)
            if ("rabbit_" in message or "deer_" in message) and event_summary in [
                "forage",
                "death",
            ]:
                return  # Skip animal events, they're noise

            # Skip narrative events (our own output echoed back)
            if event_summary == "narrative":
                return  # Don't process our own narratives

            # Highlight mating events (important!)
            if event_summary == "mate":
                console.print(f"[green]💕 {message[:100]}[/green]")

            # Check if we've advanced to a new turn
            if event_turn > self.last_turn:
                # Generate narrative for previous turn before processing new turn events
                if self.last_turn > 0 and self.turn_events:
                    console.print(
                        f"[magenta]📝 Generating narrative for turn {self.last_turn} ({len(self.turn_events)} events)[/magenta]"
                    )
                    self.generate_narrative(self.last_turn, self.turn_events)

                # Advance to new turn
                console.print(f"[blue]⏭  New turn detected: {event_turn}[/blue]")
                self.last_turn = event_turn
                self.turn_events = []

            # Add event to current turn (agent events only)
            console.print(
                f"[dim]📢 T{event_turn} {event_summary}: {message[:50]}[/dim]"
            )
            self.turn_events.append(data)

    def generate_narrative(self, turn, events):
        """Generate narrative summary for a turn"""
        console.print(f"\n[bold cyan]Turn {turn}[/bold cyan] - {len(events)} events")

        # Build context
        context = self.build_context(events)

        if not context.strip():
            # Nothing interesting to narrate
            return

        # Generate with LLM or fallback
        if self.api_key:
            narrative = self.generate_with_llm(turn, context)
        else:
            narrative = self.generate_fallback(events)

        if narrative:
            # Submit narrative back to server
            self.submit_narrative(turn, narrative)

            # Display locally
            console.print(
                Panel(narrative, title=f"[bold]Turn {turn}[/bold]", border_style="cyan")
            )

    def build_context(self, events):
        """Build context string from events"""
        lines = []

        # Group by type
        combat = [e for e in events if e.get("type") == "combat"]
        deaths = [e for e in events if e.get("type") == "death"]
        talks = [e for e in events if e.get("type") == "talk"]

        if combat:
            lines.append("COMBAT:")
            for e in combat[:3]:  # Sample first 3
                lines.append(f"  - {e.get('message', '')}")

        if deaths:
            lines.append("DEATHS:")
            for e in deaths:
                lines.append(f"  - {e.get('message', '')}")

        if talks:
            lines.append("COMMUNICATION:")
            for e in talks[:3]:  # Sample first 3
                lines.append(f"  - {e.get('message', '')}")

        return "\n".join(lines)

    def generate_with_llm(self, turn, context):
        """Generate narrative using DeepSeek API"""
        prompt = f"""You are a narrator for an AI agent simulation called Fish Tank. Based on the following events from Turn {turn}, write a brief, engaging 1-2 sentence narrative that captures the most interesting moments.

Be dramatic and literary. Focus on conflict, cooperation, discovery, or survival. Use vivid language.

EVENTS:
{context}

Write a compelling 1-2 sentence narrative (max 200 characters):"""

        try:
            response = httpx.post(
                "https://api.deepseek.com/v1/chat/completions",
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 100,
                    "temperature": 0.8,
                },
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )
            response.raise_for_status()

            result = response.json()
            return result["choices"][0]["message"]["content"].strip()

        except Exception as e:
            console.print(f"[red]Narrator API error: {e}[/red]")
            return None

    def generate_fallback(self, events):
        """Generate simple fallback narrative without LLM"""
        combat = len([e for e in events if e.get("type") == "combat"])
        deaths = len([e for e in events if e.get("type") == "death"])
        talks = len([e for e in events if e.get("type") == "talk"])

        if combat > 0 and deaths > 0:
            return f"Violence erupted with {combat} attacks, leaving {deaths} fallen in the dust."
        elif combat > 0:
            return f"Tension flared as {combat} aggressive acts disturbed the peace."
        elif talks > 5:
            return f"A chorus of {talks} voices filled the air as agents communicated across the expanse."
        elif talks > 0:
            return f"Peaceful dialogue unfolded as {talks} messages were exchanged."
        else:
            return None

    def submit_narrative(self, turn, text):
        """Submit narrative to server for broadcast"""
        try:
            response = httpx.post(
                f"{self.server_url}/narrate",
                json={"turn": turn, "text": text},
                timeout=5.0,
            )
            response.raise_for_status()
        except Exception as e:
            console.print(f"[red]Failed to submit narrative: {e}[/red]")


def main():
    console.print(
        Panel.fit(
            "[bold cyan]Fish Tank Narrator[/bold cyan]\n"
            "Observing events and generating narrative summaries",
            border_style="cyan",
        )
    )

    narrator = NarratorAgent()

    try:
        narrator.connect()
    except KeyboardInterrupt:
        console.print("\n[yellow]Narrator shutting down[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    main()
