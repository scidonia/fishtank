#!/usr/bin/env python3
"""
Fish Tank Launcher - Spawn agents with configurations

Usage:
    python launcher.py                    # Use default config
    python launcher.py --config myconfig.yaml
    python launcher.py --aggressive 2 --explorer 3 --cooperative 2
"""

import subprocess
import time
import json
import argparse
import sys
import os
from pathlib import Path
import yaml

# Default agent configurations
DEFAULT_CONFIGS = [
    # Aggressive agents
    {"id": "hunter", "personality": "aggressive", "avatar": "hunter.png"},
    {"id": "warrior", "personality": "aggressive"},
    # Explorer agents
    {"id": "scout", "personality": "explorer"},
    {"id": "nomad", "personality": "explorer"},
    {"id": "seeker", "personality": "explorer", "avatar": "seeker.png"},
    # Cooperative agents
    {"id": "builder", "personality": "cooperative"},
    {"id": "gatherer", "personality": "cooperative"},
    # Survivor agents
    {"id": "ranger", "personality": "survivor", "avatar": "ranger.png"},
    # Cautious agents
    {"id": "guardian", "personality": "cautious"},
    {"id": "warden", "personality": "cautious", "avatar": "warden.png"},
]

# Agent name pools for each personality
AGENT_NAMES = {
    "aggressive": [
        "hunter",
        "warrior",
        "slayer",
        "berserker",
        "reaper",
        "savage",
        "titan",
        "destroyer",
    ],
    "explorer": [
        "scout",
        "nomad",
        "seeker",
        "wanderer",
        "pathfinder",
        "voyager",
        "pioneer",
        "adventurer",
    ],
    "cooperative": [
        "builder",
        "gatherer",
        "helper",
        "ally",
        "friend",
        "caretaker",
        "healer",
        "diplomat",
    ],
    "survivor": [
        "ranger",
        "hermit",
        "loner",
        "prepper",
        "hoarder",
        "strategist",
        "tactician",
        "planner",
    ],
    "cautious": [
        "guardian",
        "warden",
        "sentinel",
        "watchman",
        "sentry",
        "protector",
        "defender",
        "vigilant",
    ],
}


class AgentLauncher:
    def __init__(self, server_url="http://localhost:3000"):
        self.server_url = server_url
        self.processes = []
        self.project_root = Path(__file__).parent.resolve()
        self.log_dir = Path("/tmp")

    def spawn_agent(
        self, agent_id, personality, avatar=None, starting_prompt=None, use_mock=False
    ):
        """Spawn a single agent process

        Args:
            agent_id: Unique agent ID
            personality: Agent personality type
            avatar: Custom avatar sprite filename (optional)
            starting_prompt: Initial persistent prompt (optional)
            use_mock: Use mock LLM instead of DeepSeek
        """
        log_file = self.log_dir / f"{agent_id}.log"

        cmd = [
            "uv",
            "run",
            "python",
            str(self.project_root / "runner" / "main_llm.py"),
            "--agent-id",
            agent_id,
            "--personality",
            personality,
            "--server-url",
            self.server_url,
        ]

        # TODO: Add support for avatar and starting_prompt once implemented in main_llm.py
        # if avatar:
        #     cmd.extend(["--avatar", avatar])
        # if starting_prompt:
        #     cmd.extend(["--starting-prompt", starting_prompt])

        if use_mock:
            cmd.append("--use-mock")

        display_name = f"{agent_id} ({personality})"
        if avatar:
            display_name += f" [{avatar}]"
        print(f"  🐟 Spawning {display_name}...")

        with open(log_file, "w") as f:
            process = subprocess.Popen(
                cmd, stdout=f, stderr=subprocess.STDOUT, cwd=str(self.project_root)
            )

        self.processes.append(
            {
                "pid": process.pid,
                "agent_id": agent_id,
                "personality": personality,
                "avatar": avatar,
                "starting_prompt": starting_prompt,
                "log_file": str(log_file),
            }
        )

        return process

    def spawn_narrator(self):
        """Spawn the narrator agent"""
        log_file = self.log_dir / "narrator.log"

        cmd = [
            "uv",
            "run",
            "python",
            str(self.project_root / "runner" / "narrator_agent.py"),
        ]

        print(f"  📖 Spawning narrator...")

        with open(log_file, "w") as f:
            process = subprocess.Popen(
                cmd, stdout=f, stderr=subprocess.STDOUT, cwd=str(self.project_root)
            )

        self.processes.append(
            {
                "pid": process.pid,
                "agent_id": "narrator",
                "personality": "narrator",
                "avatar": None,
                "starting_prompt": None,
                "log_file": str(log_file),
            }
        )

        return process

    def spawn_from_config(self, config_path):
        """Spawn agents from a YAML config file"""
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
        enable_narrator = config.get("narrator", True)  # Enabled by default

        print(f"\n🚀 Launching {len(agents)} agents from {config_path}...")
        if max_turns:
            print(f"⏰ Run will end after {max_turns} turns")

        # Spawn narrator first if enabled
        if enable_narrator:
            self.spawn_narrator()
            time.sleep(1)

        for agent_config in agents:
            agent_id = agent_config["id"]
            personality = agent_config["personality"]
            avatar = agent_config.get("avatar")
            starting_prompt = agent_config.get("starting_prompt")

            self.spawn_agent(agent_id, personality, avatar, starting_prompt, use_mock)
            time.sleep(0.5)  # Stagger spawns

        return len(agents), max_turns

    def spawn_from_counts(self, counts, use_mock=False):
        """Spawn agents based on personality counts"""
        print(f"\n🚀 Launching agents...")

        agent_num = 0
        used_names = set()

        for personality, count in counts.items():
            if count <= 0:
                continue

            name_pool = AGENT_NAMES.get(personality, [])

            for i in range(count):
                # Pick a unique name from the pool
                if i < len(name_pool):
                    base_name = name_pool[i]
                else:
                    base_name = f"{personality}{i + 1}"

                # Ensure uniqueness
                agent_id = base_name
                suffix = 2
                while agent_id in used_names:
                    agent_id = f"{base_name}{suffix}"
                    suffix += 1

                used_names.add(agent_id)
                self.spawn_agent(agent_id, personality, use_mock=use_mock)
                time.sleep(0.5)  # Stagger spawns
                agent_num += 1

        return agent_num

    def spawn_default(self, use_mock=False):
        """Spawn default agent configuration"""
        print(
            f"\n🚀 Launching default configuration ({len(DEFAULT_CONFIGS)} agents)..."
        )

        for agent_config in DEFAULT_CONFIGS:
            agent_id = agent_config["id"]
            personality = agent_config["personality"]
            avatar = agent_config.get("avatar")

            self.spawn_agent(agent_id, personality, avatar=avatar, use_mock=use_mock)
            time.sleep(0.5)  # Stagger spawns

        return len(DEFAULT_CONFIGS)

    def save_manifest(self):
        """Save agent manifest to file"""
        manifest_path = self.log_dir / "fishtank_agents.json"
        with open(manifest_path, "w") as f:
            json.dump(
                {"server_url": self.server_url, "agents": self.processes}, f, indent=2
            )

        print(f"\n📋 Agent manifest saved to: {manifest_path}")

    def print_summary(self):
        """Print summary of spawned agents"""
        print(f"\n✅ Launched {len(self.processes)} agents:")

        # Group by personality
        by_personality = {}
        for proc in self.processes:
            personality = proc["personality"]
            if personality not in by_personality:
                by_personality[personality] = []

            agent_display = proc["agent_id"]
            if proc.get("avatar"):
                agent_display += f" [{proc['avatar']}]"
            by_personality[personality].append(agent_display)

        for personality, agent_ids in sorted(by_personality.items()):
            print(f"  {personality:12s}: {', '.join(agent_ids)}")

        print(f"\n📁 Logs directory: {self.log_dir}")
        print(f"   Example: tail -f {self.log_dir}/scout.log")
        print(f"\n🌐 Server: {self.server_url}")
        print(f"   Viewer: http://127.0.0.1:8081")


def create_example_config(output_path):
    """Create an example config file"""

    # Create YAML format
    example_yaml = """# Fish Tank Agent Configuration
# Spawn agents with specific personalities, avatars, and starting prompts

use_mock: false  # Set to true to use mock LLM (no API key needed)
max_turns: 100  # Optional: end run after N turns (omit for unlimited)

agents:
  # Aggressive agents - seek to dominate and attack
  - id: hunter
    personality: aggressive
    avatar: hunter.png  # Custom sprite (optional)
    starting_prompt: |  # Initial persistent prompt (optional)
      I am the hunter. My goal is to eliminate all threats and establish dominance.
      I will be strategic in my attacks and remember my victories.
  
  - id: warrior
    personality: aggressive
    # No custom avatar - will use default paper doll rendering
  
  # Explorer agents - curious and adventurous
  - id: scout
    personality: explorer
    starting_prompt: |
      I am scout, an explorer driven by curiosity. My mission is to map the entire world
      and document everything I discover. I will seek out new territories and meet other agents.
  
  - id: nomad
    personality: explorer
  
  - id: seeker
    personality: explorer
    avatar: seeker.png
  
  # Cooperative agents - help others and share resources
  - id: builder
    personality: cooperative
    starting_prompt: |
      I am builder, dedicated to helping others survive. I will share resources, protect
      the weak, and work towards building a thriving community.
  
  - id: gatherer
    personality: cooperative
  
  # Survivor agents - practical and focused on staying alive
  - id: ranger
    personality: survivor
    avatar: ranger.png
    starting_prompt: |
      I am ranger, a pragmatic survivor. My priority is to stay alive by maintaining
      high energy, avoiding unnecessary risks, and keeping detailed survival notes.
  
  # Cautious agents - avoid risks and scout carefully
  - id: guardian
    personality: cautious
  
  - id: warden
    personality: cautious
    avatar: warden.png
    starting_prompt: |
      I am warden, the vigilant protector. I will carefully scout areas before moving,
      avoid all combat, and find safe hiding spots to observe the world.

# Available personality types:
#   - aggressive:  High aggression (0.8), seeks to eliminate threats
#   - explorer:    High curiosity (0.9), explores the map
#   - cooperative: High sociability (0.9), helps others
#   - survivor:    Practical, focused on survival (caution 0.8)
#   - cautious:    Risk-averse, scouts carefully (caution 1.0)

# Available custom sprites (create your own in viewer/tiles/entities/):
#   - hunter.png, seeker.png, ranger.png, warden.png
#   - Or use agent ID: if id="mystic", will look for mystic.png

# Starting prompts:
#   - Set initial goals and personality
#   - Agents can update this with edit_prompt action
#   - Use | for multi-line text in YAML
"""

    with open(output_path, "w") as f:
        f.write(example_yaml)

    print(f"✓ Example config created: {output_path}")
    print(f"\nPersonality types:")
    print(f"  - aggressive:  High aggression, seeks to eliminate threats")
    print(f"  - explorer:    High curiosity, explores the map")
    print(f"  - cooperative: High sociability, helps others")
    print(f"  - survivor:    Practical, focused on survival")
    print(f"  - cautious:    Risk-averse, scouts carefully")
    print(f"\nCustom avatars: Place PNG sprites in viewer/tiles/entities/")


def main():
    parser = argparse.ArgumentParser(
        description="Launch Fish Tank agents with specified configurations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Launch default configuration (10 agents)
  python launcher.py
  
  # Launch from config file
  python launcher.py --config my_agents.yaml
  
  # Launch specific counts by personality
  python launcher.py --aggressive 2 --explorer 3 --cooperative 2
  
  # Use mock LLM (no API key needed)
  python launcher.py --use-mock
  
  # Create example config file
  python launcher.py --create-example-config agents.yaml
        """,
    )

    parser.add_argument(
        "--config", type=str, help="Path to agent config YAML/JSON file"
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

    # Personality count arguments
    parser.add_argument(
        "--aggressive", type=int, default=0, help="Number of aggressive agents"
    )
    parser.add_argument(
        "--explorer", type=int, default=0, help="Number of explorer agents"
    )
    parser.add_argument(
        "--cooperative", type=int, default=0, help="Number of cooperative agents"
    )
    parser.add_argument(
        "--survivor", type=int, default=0, help="Number of survivor agents"
    )
    parser.add_argument(
        "--cautious", type=int, default=0, help="Number of cautious agents"
    )

    # Run configuration
    parser.add_argument(
        "--max-turns",
        type=int,
        help="Maximum turns before ending run (omit for unlimited)",
    )

    # Utility
    parser.add_argument(
        "--create-example-config",
        type=str,
        help="Create an example config file and exit",
    )

    args = parser.parse_args()

    # Handle example config creation
    if args.create_example_config:
        create_example_config(args.create_example_config)
        return

    # Initialize launcher
    launcher = AgentLauncher(server_url=args.server_url)

    # Determine which spawning mode to use
    max_turns = args.max_turns
    if args.config:
        # Spawn from config file
        result = launcher.spawn_from_config(args.config)
        num_agents, config_max_turns = result
        # Config file max_turns overrides command line if present
        if config_max_turns is not None:
            max_turns = config_max_turns
    elif any(
        [args.aggressive, args.explorer, args.cooperative, args.survivor, args.cautious]
    ):
        # Spawn from personality counts
        counts = {
            "aggressive": args.aggressive,
            "explorer": args.explorer,
            "cooperative": args.cooperative,
            "survivor": args.survivor,
            "cautious": args.cautious,
        }
        num_agents = launcher.spawn_from_counts(counts, args.use_mock)
    else:
        # Spawn default configuration
        num_agents = launcher.spawn_default(args.use_mock)

    # Set MAX_TURNS environment variable if specified
    if max_turns:
        os.environ["MAX_TURNS"] = str(max_turns)
        print(f"\n⏰ MAX_TURNS set to {max_turns}")
        print(f"   Server must be restarted to apply this setting")
        print(
            f"   Or start server with: MAX_TURNS={max_turns} node server/src/index.js"
        )

    # Save manifest and print summary
    launcher.save_manifest()
    launcher.print_summary()

    print(f"\n⚡ Press Ctrl+C to stop watching (agents will continue running)")
    print(f"   To kill all agents: pkill -9 -f 'main_llm.py'")

    # Keep script alive to show it's monitoring
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n👋 Launcher exiting (agents still running)")


if __name__ == "__main__":
    main()
