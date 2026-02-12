# Fish Tank Agentic World Architecture Specification

Version: 1.0\
Status: Draft\
Author: Fish Tank Project

------------------------------------------------------------------------

# 1. Overview

The Fish Tank is an agent-based simulation environment where LLM-powered
agents operate in a turn-based world rendered with DCSS-style tiles in
the browser.

The system consists of:

-   **World Server (Authoritative, Node.js)**
-   **Agent Runners (Any language, DeepSeek v3 initially)**
-   **Browser Viewer (SSE-based live renderer)**

The world operates in discrete turns. Each agent receives a bounded
observation and must respond with exactly one action per turn.

------------------------------------------------------------------------

# 2. Core Design Principles

1.  The **World Server is the single source of truth**.
2.  Agents are partially observable and cannot access global state.
3.  All communication from server → clients uses **Server-Sent Events
    (SSE)**.
4.  All agent actions are submitted via **HTTP POST**.
5.  The simulation must remain deterministic given a seed.
6.  Agents are time-boxed per turn.

------------------------------------------------------------------------

# 3. System Architecture

## 3.1 Components

### World Server (Node.js)

Responsible for: - Turn loop execution - Map and entity state - Combat,
hunger, food decay - Visibility calculations - Action validation - Event
streaming (SSE)

### Agent Runner

Responsible for: - Subscribing to private observation stream -
Maintaining lightweight memory - Calling DeepSeek v3 for decisions -
Submitting validated action via HTTP

### Browser Viewer

Responsible for: - Subscribing to public SSE stream - Rendering map and
entities - Displaying hover metadata - Rendering event log

------------------------------------------------------------------------

# 4. Communication Protocol

## 4.1 Server → Client: SSE

Endpoint:

GET /stream/public\
GET /stream/agent?agent_id=`<id>`{=html}

Event Types:

### snapshot

Full world state (used on connect or resync)

### delta

Incremental world update for a single turn

### public

Combat logs, speech, deaths, spawns

### obs (agent-only)

Private per-turn observation

------------------------------------------------------------------------

## 4.2 Client → Server: Action Submission

POST /act

Example:

``` json
{
  "agent_id": "a17",
  "turn_id": 1842,
  "type": "move",
  "args": { "dir": "NW" }
}
```

Response:

``` json
{ "ok": true }
```

If invalid:

``` json
{ "ok": false, "error": "Invalid action" }
```

------------------------------------------------------------------------

# 5. Turn Lifecycle

For each turn:

1.  Increment turn_id
2.  For each living agent in initiative order:
    -   Compute observation
    -   Emit obs event
    -   Await action (with timeout)
3.  Apply validated actions
4.  Resolve combat
5.  Apply hunger decay
6.  Process deaths and drops
7.  Emit delta and public events

Timeout default recommendation: 500ms--800ms per agent.

If timeout occurs → default action: wait.

------------------------------------------------------------------------

# 6. Observation Schema (obs event)

``` json
{
  "turn_id": 1842,
  "agent_id": "a17",
  "health": 73,
  "hunger": 42,
  "visible_tiles": [
    "########",
    "#..r....",
    "#..A...."
  ],
  "visible_entities": [
    {"id":"r12","type":"rabbit","pos":[3,1],"hp":6},
    {"id":"a03","type":"agent","pos":[2,2],"hp":51}
  ],
  "recent_events": [
    "You were hit for 3 damage."
  ],
  "action_space": [
    {"type":"move","args":{"dir":["N","S","E","W","NE","NW","SE","SW"]}},
    {"type":"attack","args":{"target_id":"string"}},
    {"type":"forage"},
    {"type":"eat","args":{"item_id":"string"}},
    {"type":"talk","args":{"target_id":"string","message":"string"}},
    {"type":"edit_prompt","args":{"delta":"string"}},
    {"type":"wait"}
  ]
}
```

------------------------------------------------------------------------

# 7. World State Model

## 7.1 Entities

Agents: - id - position - health - hunger - status_effects - species -
model

Food Animals: - id - position - health - behavior_profile

Items: - id - position - type - nutrition_value - decay_timer

------------------------------------------------------------------------

# 8. Actions

Supported action types:

-   move
-   attack
-   forage
-   eat
-   talk
-   edit_prompt
-   wait

Each action must be validated server-side.

Illegal actions → replaced with wait.

------------------------------------------------------------------------

# 9. Prompt Architecture

Each agent has:

Immutable Base Prompt: - Species behavior - Output formatting contract -
Safety constraints

Mutable Personal Notes: - Goals - Alliances - Threat list - Map memory

edit_prompt may only modify Personal Notes.

------------------------------------------------------------------------

# 10. Hunger and Survival Mechanics

-   Hunger decreases each turn.
-   At hunger = 0 → health decreases each turn.
-   Foraging yields low nutrition.
-   Hunting yields higher nutrition.
-   Corpses decay after N turns.
-   Items spoil after M turns.

------------------------------------------------------------------------

# 11. Determinism

The world server must:

-   Use a seeded RNG
-   Enforce strict initiative ordering
-   Reject duplicate actions
-   Log all actions and resolutions

------------------------------------------------------------------------

# 12. Viewer Requirements

The browser viewer must:

-   Render DCSS tile map
-   Support hover tooltips
-   Display agent stats
-   Render event log
-   Support mid-session join via snapshot event

------------------------------------------------------------------------

# 13. Future Extensions

Potential upgrades:

-   Reputation system
-   Alliance contracts
-   Trading system
-   Inventory system
-   Species diversity
-   Multi-world shards
-   Replay export

------------------------------------------------------------------------

# 14. Security Considerations

-   Agent authentication tokens required
-   Rate limiting on POST /act
-   Validation of all action arguments
-   No client authority over world state

------------------------------------------------------------------------

# 15. Deployment Model

Minimal Deployment:

-   1x Node.js World Server
-   N Agent Runner processes
-   Browser clients

Scaling:

-   Horizontal agent runners
-   Dedicated event relay
-   Persistent world storage

------------------------------------------------------------------------

End of Specification
