#!/usr/bin/env python3
"""
Fish Tank Launcher - Spawn agents from a config file

Usage:
    fishtank-launcher                    # Use default config (agents.yaml)
    fishtank-launcher --config myconfig.yaml
"""

import shutil
import subprocess
import time
import json
import argparse
import sys
import os
import threading
import urllib.request
from pathlib import Path
import yaml


def _find_binary(name: str) -> str:
    """Find an installed binary, preferring the same bin dir as this interpreter."""
    # When installed as a Nix package (or any venv), sibling scripts live in
    # the same bin dir as the Python interpreter.
    sibling = Path(sys.executable).parent / name
    if sibling.exists():
        return str(sibling)
    # Fall back to PATH lookup (dev shell, local install, etc.)
    found = shutil.which(name)
    if found:
        return found
    raise FileNotFoundError(
        f"Cannot find '{name}' binary. "
        "Make sure the fishtank-runner package is installed."
    )


class AgentLauncher:
    def __init__(self, server_url="http://localhost:3000"):
        self.server_url = server_url
        self.processes = []
        self.project_root = Path(__file__).parent.parent.resolve()
        self.log_dir = Path("/tmp")

    def spawn_agent(self, agent_id, avatar=None, starting_prompt=None, use_mock=False):
        """Spawn a single agent process.

        Args:
            agent_id: Unique agent ID
            avatar: Custom avatar sprite filename stem (optional)
            starting_prompt: Initial persistent prompt (optional)
            use_mock: Use mock LLM instead of DeepSeek
        """
        log_file = self.log_dir / f"{agent_id}.log"

        cmd = [
            _find_binary("agent-llm"),
            "--agent-id",
            agent_id,
            "--server-url",
            self.server_url,
        ]

        if avatar:
            cmd.extend(["--avatar", avatar])

        if starting_prompt:
            cmd.extend(["--starting-prompt", starting_prompt])

        if use_mock:
            cmd.append("--use-mock")

        display_name = agent_id
        if avatar:
            display_name += f" [{avatar}]"
        print(f"  🐟 Spawning {display_name}...")

        with open(log_file, "w") as f:
            process = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)

        self.processes.append(
            {
                "pid": process.pid,
                "agent_id": agent_id,
                "avatar": avatar,
                "starting_prompt": starting_prompt,
                "log_file": str(log_file),
            }
        )

        return process

    def spawn_narrator(self):
        """Spawn the narrator agent."""
        log_file = self.log_dir / "narrator.log"

        cmd = [_find_binary("fishtank-narrator")]

        print(f"  📖 Spawning narrator...")

        with open(log_file, "w") as f:
            process = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)

        self.processes.append(
            {
                "pid": process.pid,
                "agent_id": "narrator",
                "avatar": None,
                "starting_prompt": None,
                "log_file": str(log_file),
            }
        )

        return process

    def spawn_from_config(self, config_path):
        """Spawn agents from a YAML config file."""
        config_path = Path(config_path)

        with open(config_path, "r") as f:
            if config_path.suffix in [".yaml", ".yml"]:
                config = yaml.safe_load(f)
            elif config_path.suffix == ".json":
                config = json.load(f)
            else:
                raise ValueError(f"Unsupported config format: {config_path.suffix}")

        agents = config.get("agents", [])
        use_mock = config.get("use_mock", False)
        max_turns = config.get("max_turns")
        enable_narrator = config.get("narrator", True)

        print(f"\n🚀 Launching {len(agents)} agents from {config_path}...")
        if max_turns:
            print(f"⏰ Run will end after {max_turns} turns")

        if enable_narrator:
            self.spawn_narrator()
            time.sleep(1)

        for agent_config in agents:
            agent_id = agent_config["id"]
            avatar = agent_config.get("avatar")
            starting_prompt = agent_config.get("starting_prompt")

            self.spawn_agent(agent_id, avatar, starting_prompt, use_mock)
            time.sleep(0.5)

        return len(agents), max_turns

    def watch_for_births(self, use_mock=False):
        """Background thread: listen to public SSE stream and spawn runners for born children."""
        url = f"{self.server_url}/stream/public"
        print(f"  👶 Birth watcher started (listening on {url})")
        while True:
            try:
                req = urllib.request.Request(
                    url, headers={"Accept": "text/event-stream"}
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    event_type = None
                    for raw in resp:
                        line = raw.decode("utf-8").rstrip("\n").rstrip("\r")
                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("data:") and event_type == "public":
                            try:
                                data = json.loads(line[5:].strip())
                                if data.get("type") == "mate" and data.get("child_id"):
                                    child_id = data["child_id"]
                                    already_running = any(
                                        p["agent_id"] == child_id
                                        for p in self.processes
                                    )
                                    if not already_running:
                                        print(
                                            f"\n  👶 New child born: {child_id} — spawning runner"
                                        )
                                        self.spawn_agent(child_id, use_mock=use_mock)
                            except (json.JSONDecodeError, KeyError):
                                pass
                        elif line == "":
                            event_type = None
            except Exception as e:
                print(f"  ⚠️  Birth watcher connection lost ({e}), retrying in 5s...")
                time.sleep(5)

    def start_birth_watcher(self, use_mock=False):
        """Start the birth watcher in a daemon thread."""
        t = threading.Thread(
            target=self.watch_for_births, args=(use_mock,), daemon=True
        )
        t.start()
        return t

    def save_manifest(self):
        """Save agent manifest to file."""
        manifest_path = self.log_dir / "fishtank_agents.json"
        with open(manifest_path, "w") as f:
            json.dump(
                {"server_url": self.server_url, "agents": self.processes}, f, indent=2
            )
        print(f"\n📋 Agent manifest saved to: {manifest_path}")

    def print_summary(self):
        """Print summary of spawned agents."""
        print(f"\n✅ Launched {len(self.processes)} agents:")
        for proc in self.processes:
            agent_display = proc["agent_id"]
            if proc.get("avatar"):
                agent_display += f" [{proc['avatar']}]"
            print(f"  {agent_display}")
        print(f"\n📁 Logs directory: {self.log_dir}")
        print(f"\n🌐 Server: {self.server_url}")
        print(f"   Viewer: http://127.0.0.1:8081")


def main():
    parser = argparse.ArgumentParser(
        description="Launch Fish Tank agents from a config file",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python launcher.py
  python launcher.py --config my_agents.yaml
  python launcher.py --use-mock
        """,
    )

    parser.add_argument(
        "--config",
        type=str,
        default="agents.yaml",
        help="Path to agent config YAML/JSON file (default: agents.yaml)",
    )
    parser.add_argument(
        "--server-url",
        type=str,
        default="http://localhost:3000",
        help="World server URL (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--use-mock", action="store_true", help="Use mock LLM instead of DeepSeek API"
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        help="Maximum turns before ending run (omit for unlimited)",
    )

    args = parser.parse_args()

    launcher = AgentLauncher(server_url=args.server_url)

    result = launcher.spawn_from_config(args.config)
    num_agents, config_max_turns = result

    max_turns = args.max_turns or config_max_turns
    if max_turns:
        os.environ["MAX_TURNS"] = str(max_turns)
        print(f"\n⏰ MAX_TURNS set to {max_turns}")

    launcher.save_manifest()
    launcher.print_summary()

    launcher.start_birth_watcher(use_mock=args.use_mock)
    print(f"\n👶 Birth watcher active — born children will get runners automatically")
    print(f"\n⚡ Press Ctrl+C to stop watching (agents will continue running)")
    print(f"   To kill all agents: pkill -9 -f 'main_llm.py'")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n👋 Launcher exiting (agents still running)")


if __name__ == "__main__":
    main()
