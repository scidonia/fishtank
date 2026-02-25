#!/usr/bin/env python3
"""
Extract metrics from completed Fish Tank experiments
Shows: murders, children born, and average lifespan
"""

import sys
import sqlite3
from pathlib import Path
import json

DB_PATH = Path(__file__).parent / "data" / "fishtank_worlds.db"


def get_latest_run_metrics():
    """Get metrics from the most recent run"""
    if not DB_PATH.exists():
        print(f"❌ Database not found: {DB_PATH}")
        return None

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get latest run
    cursor.execute("""
        SELECT * FROM runs 
        ORDER BY start_time DESC 
        LIMIT 1
    """)
    run = cursor.fetchone()

    if not run:
        print("❌ No runs found in database")
        conn.close()
        return None

    run_id = run["run_id"]

    # Get agent lifespans for this run
    cursor.execute(
        """
        SELECT 
            agent_id,
            birth_turn,
            death_turn,
            death_cause,
            parents
        FROM agent_lifespans 
        WHERE run_id = ?
        ORDER BY birth_turn
    """,
        (run_id,),
    )

    agents = cursor.fetchall()

    conn.close()

    # Calculate metrics
    total_murders = run["total_murders"]
    total_births = run["total_births"]
    total_turns = run["total_turns"]

    # Calculate average lifespan (only for dead agents)
    lifespans = []
    for agent in agents:
        if agent["death_turn"] is not None:
            lifespan = agent["death_turn"] - agent["birth_turn"]
            lifespans.append(lifespan)

    avg_lifespan = sum(lifespans) / len(lifespans) if lifespans else 0

    # Count initial agents vs children
    initial_agents = [a for a in agents if not a["parents"] or a["parents"] == "[]"]
    children = [a for a in agents if a["parents"] and a["parents"] != "[]"]

    return {
        "run_id": run_id,
        "total_turns": total_turns,
        "total_murders": total_murders,
        "total_births": total_births,
        "initial_agents": len(initial_agents),
        "children_born": len(children),
        "total_agents": len(agents),
        "dead_agents": len(lifespans),
        "alive_agents": len(agents) - len(lifespans),
        "average_lifespan": round(avg_lifespan, 1),
        "all_lifespans": lifespans,
        "world_summary": run["world_summary"],
    }


def get_all_runs():
    """Get summary of all runs"""
    if not DB_PATH.exists():
        print(f"❌ Database not found: {DB_PATH}")
        return []

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            run_id,
            total_turns,
            total_murders,
            total_births,
            total_deaths
        FROM runs 
        ORDER BY start_time DESC
    """)

    runs = cursor.fetchall()
    conn.close()

    return [dict(row) for row in runs]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        print("📊 All experiment runs:\n")
        runs = get_all_runs()
        for run in runs:
            print(f"  {run['run_id']}")
            print(f"    Turns: {run['total_turns']}")
            print(f"    Murders: {run['total_murders']}")
            print(f"    Births: {run['total_births']}")
            print(f"    Deaths: {run['total_deaths']}")
            print()
    else:
        print("📊 Latest experiment metrics:\n")
        metrics = get_latest_run_metrics()

        if not metrics:
            sys.exit(1)

        print(f"🆔 Run ID: {metrics['run_id']}")
        print(f"⏱️  Total Turns: {metrics['total_turns']}")
        print()
        print(f"🔪 Murders: {metrics['total_murders']}")
        print(f"👶 Children Born: {metrics['children_born']}")
        print(f"📈 Average Lifespan: {metrics['average_lifespan']} turns")
        print()
        print(f"👥 Population:")
        print(f"   Initial agents: {metrics['initial_agents']}")
        print(f"   Total agents ever: {metrics['total_agents']}")
        print(f"   Currently alive: {metrics['alive_agents']}")
        print(f"   Dead: {metrics['dead_agents']}")
        print()

        if metrics["world_summary"]:
            print(f"📝 World Summary:")
            print(f"   {metrics['world_summary']}")
            print()

        # Show lifespan distribution
        if metrics["all_lifespans"]:
            lifespans = sorted(metrics["all_lifespans"])
            print(f"📊 Lifespan Distribution:")
            print(f"   Min: {min(lifespans)} turns")
            print(f"   Max: {max(lifespans)} turns")
            print(f"   Median: {lifespans[len(lifespans) // 2]} turns")
            print()


if __name__ == "__main__":
    main()
