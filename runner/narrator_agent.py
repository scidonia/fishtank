#!/usr/bin/env python3
"""
Narrator Agent - Generates narrative summaries of each turn

The narrator observes public events and generates dramatic 1-2 sentence summaries.
Automatically reconnects on disconnect and handles world resets.
"""

import argparse
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
        self.turn_events = []
        self.last_turn = 0

        if not self.api_key:
            console.print(
                "[red]WARNING: DEEPSEEK_API_KEY not set - using fallback narration[/red]"
            )

    def reset_state(self):
        """Reset narrator state for a new world run."""
        self.turn_events = []
        self.last_turn = 0
        console.print("[yellow]🔄 Narrator reset for new world run[/yellow]")

    def connect_once(self):
        """Connect to public event stream and process until disconnected."""
        console.print(
            f"[cyan]Narrator connecting to {self.server_url}/stream/public[/cyan]"
        )

        with httpx.stream(
            "GET", f"{self.server_url}/stream/public", timeout=None
        ) as response:
            console.print("[green]✓ Connected to world server[/green]")

            current_event = {"type": None, "data": ""}

            for line in response.iter_lines():
                line = line.strip()

                if not line:
                    if current_event["type"] and current_event["data"]:
                        self.handle_event(current_event["type"], current_event["data"])
                    current_event = {"type": None, "data": ""}

                elif line.startswith("event:"):
                    current_event["type"] = line.split(":", 1)[1].strip()

                elif line.startswith("data:"):
                    data_line = line.split(":", 1)[1].strip()
                    if current_event["data"]:
                        current_event["data"] += "\n" + data_line
                    else:
                        current_event["data"] = data_line

    def connect(self):
        """Connect with automatic reconnection and backoff."""
        backoff = 3
        while True:
            try:
                self.connect_once()
                # Stream ended cleanly — reconnect immediately
                console.print("[yellow]Stream ended, reconnecting...[/yellow]")
                backoff = 3
            except KeyboardInterrupt:
                raise
            except Exception as e:
                console.print(f"[red]Connection error: {e}[/red]")
                console.print(f"[yellow]Reconnecting in {backoff}s...[/yellow]")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def handle_event(self, event_type, data_str):
        """Handle incoming SSE events."""
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            console.print(f"[red]Failed to parse JSON: {data_str[:100]}[/red]")
            return

        if event_type == "snapshot":
            new_turn = data.get("turn_id", 0)
            console.print(f"[yellow]📸 Snapshot received - Turn {new_turn}[/yellow]")
            # A turn-0 snapshot means the world just reset
            if new_turn == 0 and self.last_turn > 0:
                if self.turn_events:
                    self.generate_narrative(self.last_turn, self.turn_events)
                self.reset_state()
            else:
                self.last_turn = new_turn

        elif event_type == "reset":
            # World has reset — flush any pending narrative and clear state
            # (sent on both public and agent streams)
            if self.turn_events:
                self.generate_narrative(self.last_turn, self.turn_events)
            self.reset_state()

        elif event_type == "public":
            message = data.get("message", "")
            event_summary = data.get("type", "unknown")
            event_turn = data.get("turn", 0)

            # Skip animal noise
            if ("rabbit_" in message or "deer_" in message) and event_summary in [
                "forage",
                "death",
            ]:
                return

            # Don't re-process our own narration
            if event_summary == "narrative":
                return

            if event_summary == "mate":
                console.print(f"[green]💕 {message[:100]}[/green]")

            # New turn — flush previous turn's narrative
            if event_turn > self.last_turn:
                if self.last_turn > 0 and self.turn_events:
                    console.print(
                        f"[magenta]📝 Generating narrative for turn {self.last_turn} "
                        f"({len(self.turn_events)} events)[/magenta]"
                    )
                    try:
                        self.generate_narrative(self.last_turn, self.turn_events)
                    except Exception as e:
                        console.print(f"[red]Narrative generation error: {e}[/red]")

                console.print(f"[blue]⏭  New turn: {event_turn}[/blue]")
                self.last_turn = event_turn
                self.turn_events = []

            console.print(
                f"[dim]📢 T{event_turn} {event_summary}: {message[:50]}[/dim]"
            )
            self.turn_events.append(data)

    def generate_narrative(self, turn, events):
        """Generate narrative summary for a turn."""
        console.print(f"\n[bold cyan]Turn {turn}[/bold cyan] - {len(events)} events")

        context = self.build_context(events)
        if not context.strip():
            return

        if self.api_key:
            narrative = self.generate_with_llm(turn, context)
        else:
            narrative = self.generate_fallback(events)

        if narrative:
            self.submit_narrative(turn, narrative)
            console.print(
                Panel(narrative, title=f"[bold]Turn {turn}[/bold]", border_style="cyan")
            )

    def build_context(self, events):
        """Build context string from events."""
        lines = []
        combat = [e for e in events if e.get("type") == "combat"]
        deaths = [e for e in events if e.get("type") == "death"]
        talks = [e for e in events if e.get("type") == "talk"]

        if combat:
            lines.append("COMBAT:")
            for e in combat[:3]:
                lines.append(f"  - {e.get('message', '')}")
        if deaths:
            lines.append("DEATHS:")
            for e in deaths:
                lines.append(f"  - {e.get('message', '')}")
        if talks:
            lines.append("COMMUNICATION:")
            for e in talks[:3]:
                lines.append(f"  - {e.get('message', '')}")

        return "\n".join(lines)

    def generate_with_llm(self, turn, context):
        """Generate narrative using DeepSeek API."""
        prompt = (
            f"You are a narrator for an AI agent simulation called Fish Tank. "
            f"Based on the following events from Turn {turn}, write a brief, engaging "
            f"1-2 sentence narrative that captures the most interesting moments.\n\n"
            f"Be dramatic and literary. Focus on conflict, cooperation, discovery, or survival. "
            f"Use vivid language.\n\nEVENTS:\n{context}\n\n"
            f"Write a compelling 1-2 sentence narrative (max 200 characters):"
        )

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
            return response.json()["choices"][0]["message"]["content"].strip()

        except Exception as e:
            console.print(f"[red]Narrator API error: {e}[/red]")
            return None

    def generate_fallback(self, events):
        """Generate simple fallback narrative without LLM."""
        combat = len([e for e in events if e.get("type") == "combat"])
        deaths = len([e for e in events if e.get("type") == "death"])
        talks = len([e for e in events if e.get("type") == "talk"])

        if combat > 0 and deaths > 0:
            return f"Violence erupted with {combat} attacks, leaving {deaths} fallen."
        elif combat > 0:
            return f"Tension flared as {combat} aggressive acts disturbed the peace."
        elif talks > 5:
            return f"A chorus of {talks} voices filled the air."
        elif talks > 0:
            return f"Peaceful dialogue: {talks} messages exchanged."
        return None

    def submit_narrative(self, turn, text):
        """Submit narrative to server for broadcast."""
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
    parser = argparse.ArgumentParser(description="Fish Tank Narrator Agent")
    parser.add_argument(
        "--server-url",
        default=os.getenv("FISH_TANK_SERVER", "http://localhost:3000"),
        help="World server URL (default: http://localhost:3000)",
    )
    args = parser.parse_args()

    console.print(
        Panel.fit(
            "[bold cyan]Fish Tank Narrator[/bold cyan]\n"
            "Observing events and generating narrative summaries",
            border_style="cyan",
        )
    )

    narrator = NarratorAgent(server_url=args.server_url)

    try:
        narrator.connect()
    except KeyboardInterrupt:
        console.print("\n[yellow]Narrator shutting down[/yellow]")


if __name__ == "__main__":
    main()
