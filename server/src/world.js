// World Server - Authoritative simulation
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';
import { WorldLogger } from './worldLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorldServer {
    constructor({ seed = 42, mapFile = null }) {
        this.seed = seed;
        this.rng = this.createSeededRNG(seed);
        
        this.turnId = 0;
        this.running = false;
        this.turnInterval = 1000; // ms per turn
        
        // Initialize world logger for persistence
        this.logger = new WorldLogger();
        
        // Load map from file or generate
        if (mapFile) {
            this.map = this.loadMapFromFile(mapFile);
        } else {
            this.map = this.generateMap(25, 18);
        }
        
        this.width = this.map[0].length;
        this.height = this.map.length;
        
        // Log world metadata
        this.logger.updateRunMetadata({
            seed: this.seed,
            mapWidth: this.width,
            mapHeight: this.height
        });
        
        // World state
        this.entities = [];
        this.actionQueue = new Map(); // agentId -> {action, args}
        
        // Track explored tiles for statistics
        this.exploredTiles = new Set(); // Set of "x,y" strings
        
        // Telemetry storage (ring buffer per agent)
        this.telemetryByAgent = new Map(); // agentId -> array of events
        this.maxTelemetryEvents = 200;
        
        // Communication storage (messages visible to nearby agents)
        this.recentMessages = []; // {turn, agentId, pos, message, range}
        this.maxRecentMessages = 50;
        
        // Combat events storage (visible to nearby agents)
        this.recentCombatEvents = []; // {turn, attackerId, targetId, damage, pos, range, type: 'attack'|'death'}
        this.maxRecentCombatEvents = 50;
        
        // SSE clients
        this.publicClients = new Map();
        this.agentClients = new Map(); // agentId -> Map(clientId -> callback)
        this.surveillanceClients = new Map(); // agentId -> Map(clientId -> callback)
        
        // Find spawn points in the map (floor tiles)
        const spawnPoints = this.findSpawnPoints(15);
        
        // Initialize world with 10 agents at valid spawn points
        // Spawn agents close together for easier interaction
        const agentNames = [
            'scout', 'nomad', 'warden', 'seeker', 'ranger',
            'guardian', 'explorer', 'hunter', 'gatherer', 'builder'
        ];
        
        if (spawnPoints.length >= 10) {
            // Spawn first agent
            this.spawnAgent(agentNames[0], spawnPoints[0].x, spawnPoints[0].y);
            const spawnedPositions = [[spawnPoints[0].x, spawnPoints[0].y]];
            
            // Spawn remaining 9 agents nearby
            let agentsSpawned = 1;
            for (let attempts = 0; attempts < 300 && agentsSpawned < 10; attempts++) {
                const dx = Math.floor(this.rng() * 12) - 6; // -6 to +5
                const dy = Math.floor(this.rng() * 12) - 6;
                const x = spawnPoints[0].x + dx;
                const y = spawnPoints[0].y + dy;
                
                // Check valid floor tile and not already occupied
                const occupied = spawnedPositions.some(([ox, oy]) => ox === x && oy === y);
                if (x >= 0 && x < this.width && y >= 0 && y < this.height &&
                    this.map[y] && this.map[y][x] === '.' && !occupied) {
                    
                    this.spawnAgent(agentNames[agentsSpawned], x, y);
                    console.log(`  ${agentNames[agentsSpawned]} spawned ${Math.abs(dx)}+${Math.abs(dy)} tiles from scout`);
                    spawnedPositions.push([x, y]);
                    agentsSpawned++;
                }
            }
            
            // Fallback to distant spawn points if needed
            for (let i = agentsSpawned; i < 10 && i < spawnPoints.length; i++) {
                this.spawnAgent(agentNames[i], spawnPoints[i].x, spawnPoints[i].y);
                console.log(`  ${agentNames[i]} spawned at distant point`);
            }
        } else {
            console.warn('Not enough spawn points found, spawning agents at available points');
            for (let i = 0; i < Math.min(10, spawnPoints.length); i++) {
                this.spawnAgent(agentNames[i], spawnPoints[i].x, spawnPoints[i].y);
            }
        }
        
        // Spawn initial food sources (plants)
        this.spawnFoodSources(25000); // Start with 25000 plants (2.5% density on 1000x1000 map)
        
        // Plant growth tracking
        this.maxPlants = 30000; // Maximum plants on map (3% density)
        this.plantGrowthRate = 1.0; // 100% chance per turn to spawn a new plant (always grow if under max)
        
        // Spawn animals
        this.spawnAnimals(50, 15); // 50 rabbits, 15 deer (further reduced to balance food)
    }
    
    loadMapFromFile(filePath) {
        try {
            const fullPath = join(__dirname, '..', '..', filePath);
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').filter(line => line.length > 0);
            console.log(`✓ Loaded map from ${filePath}: ${lines.length} rows × ${lines[0].length} columns`);
            return lines;
        } catch (err) {
            console.error(`Failed to load map from ${filePath}:`, err.message);
            console.log('Falling back to generated map');
            return this.generateMap(25, 18);
        }
    }
    
    findSpawnPoints(count) {
        const points = [];
        let attempts = 0;
        const maxAttempts = 1000;
        
        while (points.length < count && attempts < maxAttempts) {
            const x = Math.floor(this.rng() * this.width);
            const y = Math.floor(this.rng() * this.height);
            
            // Check if it's a floor tile and not too close to edges
            if (this.map[y] && this.map[y][x] === '.' && 
                x > 1 && x < this.width - 2 && y > 1 && y < this.height - 2) {
                // Check if not too close to other spawn points
                const tooClose = points.some(p => 
                    Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 10
                );
                
                if (!tooClose) {
                    points.push({ x, y });
                }
            }
            attempts++;
        }
        
        return points;
    }
    
    createSeededRNG(seed) {
        // Simple seeded RNG (mulberry32)
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    
    generateMap(width, height) {
        // Start with all floor
        const map = [];
        for (let y = 0; y < height; y++) {
            let row = '';
            for (let x = 0; x < width; x++) {
                // Border walls
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    row += '#';
                } else {
                    row += '.';
                }
            }
            map.push(row);
        }
        
        // Add scattered wall clusters (not narrow corridors)
        const numClusters = Math.floor((width * height) / 10000); // Fewer clusters
        
        for (let i = 0; i < numClusters; i++) {
            const cx = Math.floor(this.rng() * (width - 20)) + 10;
            const cy = Math.floor(this.rng() * (height - 20)) + 10;
            const clusterSize = Math.floor(this.rng() * 8) + 3; // 3-10 tiles
            
            // Create wall cluster with irregular shape
            for (let dy = -clusterSize; dy <= clusterSize; dy++) {
                for (let dx = -clusterSize; dx <= clusterSize; dx++) {
                    const x = cx + dx;
                    const y = cy + dy;
                    
                    if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        // Only place walls in roughly circular cluster
                        if (dist < clusterSize && this.rng() < 0.6) {
                            const row = map[y];
                            map[y] = row.substring(0, x) + '#' + row.substring(x + 1);
                        }
                    }
                }
            }
        }
        
        return map;
    }
    
    spawnAgent(id, x, y, parents = null) {
        // Generate random appearance
        const gender = this.rng() > 0.5 ? 'male' : 'female';
        const skinTones = ['#ffc9a3', '#d9a574', '#a67c52', '#6d4c3d', '#3d2817'];
        const hairColors = ['#1a1a1a', '#3d2817', '#6d4c3d', '#a67c52', '#d4af37', '#cd7f32'];
        const shirtColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff'];
        const pantsColors = ['#1a1a1a', '#3d3d3d', '#0000aa', '#8b4513', '#2f4f4f'];
        
        const appearance = {
            gender,
            skinTone: skinTones[Math.floor(this.rng() * skinTones.length)],
            hairColor: hairColors[Math.floor(this.rng() * hairColors.length)],
            shirtColor: shirtColors[Math.floor(this.rng() * shirtColors.length)],
            pantsColor: pantsColors[Math.floor(this.rng() * pantsColors.length)],
        };
        
        // Start with 2-3 food items in inventory
        const startingFood = [];
        const foodCount = 2 + Math.floor(this.rng() * 2); // 2-3 items
        for (let i = 0; i < foodCount; i++) {
            startingFood.push({
                type: 'plant',
                energy: 20
            });
        }
        
        this.entities.push({
            id,
            type: 'agent',
            pos: [x, y],
            hp: 100,
            energy: 100,
            inventory: startingFood, // Array of {type: 'plant'|'meat', energy: number}
            prompt: '', // Persistent prompt (always shown, edited with edit_prompt)
            notes: '', // Private notes (only shown on read_notes action, edited with edit_notes)
            appearance, // Visual appearance for rendering
            parents, // Array of parent IDs if this agent was born from mating
        });
        this.broadcastPublic({ type: 'spawn', message: `Agent ${id} spawned` });
    }
    
    spawnFoodSources(count) {
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 10;
        
        while (spawned < count && attempts < maxAttempts) {
            const x = Math.floor(this.rng() * this.width);
            const y = Math.floor(this.rng() * this.height);
            
            // Only spawn on floor tiles
            if (this.map[y] && this.map[y][x] === '.') {
                // Check no entity already there
                const occupied = this.entities.some(e => e.pos[0] === x && e.pos[1] === y);
                
                if (!occupied) {
                    this.entities.push({
                        id: `plant_${spawned}`,
                        type: 'plant',
                        pos: [x, y],
                        energy: 20, // How much energy this plant provides
                    });
                    spawned++;
                }
            }
            attempts++;
        }
        
        console.log(`✓ Spawned ${spawned} plants`);
    }
    
    spawnAnimals(rabbitCount, deerCount) {
        let rabbitsSpawned = 0;
        let deerSpawned = 0;
        let attempts = 0;
        const maxAttempts = (rabbitCount + deerCount) * 10;
        
        while ((rabbitsSpawned < rabbitCount || deerSpawned < deerCount) && attempts < maxAttempts) {
            const x = Math.floor(this.rng() * this.width);
            const y = Math.floor(this.rng() * this.height);
            
            // Only spawn on floor tiles
            if (this.map[y] && this.map[y][x] === '.') {
                // Check no entity already there
                const occupied = this.entities.some(e => e.pos[0] === x && e.pos[1] === y);
                
                if (!occupied) {
                    // Spawn rabbit if needed
                    if (rabbitsSpawned < rabbitCount && this.rng() < 0.7) {
                        this.entities.push({
                            id: `rabbit_${rabbitsSpawned}`,
                            type: 'rabbit',
                            pos: [x, y],
                            hp: 20,
                            maxHp: 20,
                            energy: 50, // Hunger clock (0 = starving)
                            fov: 12, // 12 tile field of view (increased to find food better)
                        });
                        rabbitsSpawned++;
                    }
                    // Spawn deer if needed
                    else if (deerSpawned < deerCount) {
                        this.entities.push({
                            id: `deer_${deerSpawned}`,
                            type: 'deer',
                            pos: [x, y],
                            hp: 80,
                            maxHp: 80,
                            energy: 60, // Hunger clock
                            fov: 15, // 15 tile field of view (increased to find food better)
                        });
                        deerSpawned++;
                    }
                }
            }
            attempts++;
        }
        
        console.log(`✓ Spawned ${rabbitsSpawned} rabbits, ${deerSpawned} deer`);
    }
    
    start() {
        if (this.running) return;
        this.running = true;
        this.runTurnLoop();
    }
    
    async runTurnLoop() {
        while (this.running) {
            await this.executeTurn();
            await this.sleep(this.turnInterval);
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async executeTurn() {
        this.turnId++;
        this.logger.updateTurnCount(this.turnId);
        console.log(`[Turn ${this.turnId}] Starting`);
        
        // Get agents in initiative order (deterministic by ID)
        const agents = this.entities
            .filter(e => e.type === 'agent' && e.hp > 0)
            .sort((a, b) => a.id.localeCompare(b.id));
        
        // Send observations to all agents
        for (const agent of agents) {
            const obs = this.computeObservation(agent);
            this.broadcastToAgent(agent.id, { type: 'obs', data: obs });
        }
        
        // Wait for all agents to respond (or timeout)
        const maxWaitTime = 10000; // 10 second safety timeout
        const pollInterval = 50; // Check every 50ms
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            // Check if all agents have responded
            const allResponded = agents.every(agent => this.actionQueue.has(agent.id));
            
            if (allResponded) {
                const elapsed = Date.now() - startTime;
                console.log(`  All agents responded in ${elapsed}ms`);
                break;
            }
            
            await this.sleep(pollInterval);
        }
        
        if (Date.now() - startTime >= maxWaitTime) {
            console.log(`  ⚠️  Timeout waiting for agents`);
        }
        
        // Get animals that can act (alive animals)
        const animals = this.entities
            .filter(e => (e.type === 'rabbit' || e.type === 'deer') && e.hp > 0)
            .sort((a, b) => a.id.localeCompare(b.id));
        
        // Compute animal actions (server-side AI)
        for (const animal of animals) {
            const action = this.computeAnimalAction(animal);
            this.actionQueue.set(animal.id, action);
        }
        
        // Process actions SIMULTANEOUSLY for both agents and animals
        // First, collect all action results in parallel
        const allActors = [...agents, ...animals];
        const actionPromises = allActors.map(async (actor) => {
            const action = this.actionQueue.get(actor.id);
            if (action) {
                const result = await this.applyActionSimulated(actor, action);
                return { agent: actor, action, result };
            } else {
                if (actor.type === 'agent') {
                    console.log(`  ${actor.id}: wait (no action)`);
                }
                return { agent: actor, action: { type: 'wait' }, result: { success: true, message: 'Waited' } };
            }
        });
        
        const actionResults = await Promise.all(actionPromises);
        
        // Reconcile conflicts (e.g., two agents moving to same tile)
        this.reconcileConflicts(actionResults);
        
        // Apply final results to world state
        for (const { agent, action, result } of actionResults) {
            agent.lastActionResult = result;
            this.actionQueue.delete(agent.id);
        }
        
        // Track explored tiles for agents
        for (const agent of agents) {
            const key = `${agent.pos[0]},${agent.pos[1]}`;
            this.exploredTiles.add(key);
        }
        this.logger.updateExploredTiles(this.exploredTiles.size);
        
        // Apply world effects
        this.applyEnergyDecay();
        this.applyPlantGrowth();
        
        // Broadcast delta
        this.broadcastDelta();
    }
    
    computeObservation(agent) {
        const [agentX, agentY] = agent.pos;
        const fovRadius = 10;
        
        // Get visible tiles in FOV (10 tile radius)
        const visibleTiles = [];
        for (let dy = -fovRadius; dy <= fovRadius; dy++) {
            for (let dx = -fovRadius; dx <= fovRadius; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= fovRadius) {
                    const x = agentX + dx;
                    const y = agentY + dy;
                    if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
                        visibleTiles.push({
                            pos: [x, y],
                            tile: this.map[y][x],
                            relative: [dx, dy]
                        });
                    }
                }
            }
        }
        
        // Get visible entities in FOV
        const visibleEntities = this.entities
            .filter(e => {
                if (e.id === agent.id) return false;
                const [ex, ey] = e.pos;
                const dx = ex - agentX;
                const dy = ey - agentY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                return dist <= fovRadius;
            })
            .map(e => {
                const entity = {
                    id: e.id,
                    type: e.type,
                    pos: e.pos,
                };
                // Only include hp for entities that have it (not plants)
                if (e.hp !== undefined) {
                    entity.hp = e.hp;
                    entity.maxHp = e.maxHp; // Include maxHp for proper health bar scaling
                }
                // Include appearance for agents
                if (e.type === 'agent' && e.appearance) {
                    entity.appearance = e.appearance;
                }
                return entity;
            });
        
        // Get messages heard by this agent (within hearing range)
        const heardMessages = this.recentMessages.filter(msg => {
            const dx = Math.abs(msg.pos[0] - agentX);
            const dy = Math.abs(msg.pos[1] - agentY);
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance <= msg.range && msg.agentId !== agent.id; // Don't include own messages
        }).map(msg => ({
            turn: msg.turn,
            speaker: msg.agentId,
            message: msg.message,
        }));
        
        // Get combat events witnessed by this agent (within range)
        const witnessedCombat = this.recentCombatEvents.filter(event => {
            const dx = Math.abs(event.pos[0] - agentX);
            const dy = Math.abs(event.pos[1] - agentY);
            const distance = Math.sqrt(dx * dx + dy * dy);
            // Can witness if within range, and either:
            // - You're involved (attacker or target), OR
            // - You're a bystander within range
            const isInvolved = event.attackerId === agent.id || event.targetId === agent.id;
            return distance <= event.range || isInvolved;
        }).map(event => {
            if (event.type === 'attack') {
                return `⚔️ ${event.attackerId} attacked ${event.targetId} for ${event.damage} damage (${event.targetHp} HP remaining)`;
            } else if (event.type === 'death') {
                return `💀 ${event.targetId} was killed by ${event.attackerId}!`;
            }
            return `Unknown event`;
        });
        
        return {
            turn_id: this.turnId,
            agent_id: agent.id,
            position: agent.pos,
            health: agent.hp,
            energy: agent.energy,
            inventory: agent.inventory || [], // Array of {type, energy}
            prompt: agent.prompt || '', // Agent's persistent prompt (always shown)
            visible_tiles: visibleTiles,
            visible_entities: visibleEntities,
            heard_messages: heardMessages, // Messages from nearby agents
            last_action_result: agent.lastActionResult || null,
            recent_events: witnessedCombat, // Combat events witnessed
            action_space: [
                { type: 'move', args: { dir: ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] } },
                { type: 'forage', args: {} },
                { type: 'eat', args: {} },
                { type: 'give', args: { target_id: 'agent_id', item_index: 0 } },
                { type: 'attack', args: { target_id: 'agent_id' } },
                { type: 'talk', args: { message: 'text' } },
                { type: 'mate', args: { partner_id: 'agent_id' } },
                { type: 'edit_prompt', args: { text: 'persistent reminder' } },
                { type: 'edit_notes', args: { text: 'private notes' } },
                { type: 'read_notes', args: {} },
                { type: 'read_prompt', args: {} },
                { type: 'wait', args: {} },
            ],
        };
    }
    
    computeAnimalAction(animal) {
        // Simple AI: wander when no food visible, eat when food nearby, attack when starving
        // IMPORTANT: Animals never choose a move direction that leads into a wall.
        const [animalX, animalY] = animal.pos;
        const fovRadius = animal.fov || 6;
        const isStarving = animal.energy < 20; // Low energy threshold

        const allDirs = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];
        const getWalkableDirs = () => {
            return allDirs.filter(dir => {
                const [dx, dy] = this.getDirDelta(dir);
                const nx = animalX + dx;
                const ny = animalY + dy;
                return (
                    ny >= 0 && ny < this.height &&
                    nx >= 0 && nx < this.width &&
                    this.map[ny] && this.map[ny][nx] === '.'
                );
            });
        };

        // Get visible entities within FOV
        const visibleEntities = this.entities.filter(e => {
            if (e.id === animal.id) return false;
            const [ex, ey] = e.pos;
            const dx = ex - animalX;
            const dy = ey - animalY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return dist <= fovRadius;
        });

        // Check for adjacent entities (within 1 tile for action)
        const adjacentEntities = visibleEntities.filter(e => {
            const [ex, ey] = e.pos;
            const dx = Math.abs(ex - animalX);
            const dy = Math.abs(ey - animalY);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
        });

        // STARVING: Attack anything adjacent (agents, other animals)
        if (isStarving) {
            const targets = adjacentEntities.filter(e =>
                (e.type === 'agent' || e.type === 'rabbit' || e.type === 'deer') && e.hp > 0
            );
            if (targets.length > 0) {
                const target = targets[0];
                return { type: 'attack', args: { target_id: target.id } };
            }
        }

        // Check for adjacent food to forage
        const adjacentFood = adjacentEntities.filter(e => e.type === 'plant' || e.type === 'meat');
        if (adjacentFood.length > 0) {
            return { type: 'forage', args: {} };
        }

        // Find food in FOV
        let targetFood = null;

        if (animal.type === 'rabbit') {
            // Rabbits: herbivores, seek plants
            const plants = visibleEntities.filter(e => e.type === 'plant');
            if (plants.length > 0) {
                targetFood = plants[0]; // Move toward closest plant
            }
        } else if (animal.type === 'deer') {
            // Deer: omnivores, prefer meat > plants
            const meat = visibleEntities.filter(e => e.type === 'meat');
            const rabbits = visibleEntities.filter(e => e.type === 'rabbit' && e.hp > 0);
            const plants = visibleEntities.filter(e => e.type === 'plant');

            if (meat.length > 0) {
                targetFood = meat[0];
            } else if (rabbits.length > 0 && animal.energy < 40) {
                // Hunt rabbits when moderately hungry
                targetFood = rabbits[0];
            } else if (plants.length > 0) {
                targetFood = plants[0];
            }
        }

        // Move toward target food if found, but never into a wall
        if (targetFood) {
            const [tx, ty] = targetFood.pos;
            const dx = tx - animalX;
            const dy = ty - animalY;

            // Candidate directions (best-first)
            const preferredDirs = [];
            if (dy < 0) preferredDirs.push('N');
            if (dy > 0) preferredDirs.push('S');
            if (dx > 0) preferredDirs.push('E');
            if (dx < 0) preferredDirs.push('W');

            // Prefer diagonal if both components exist
            if (dx > 0 && dy < 0) preferredDirs.unshift('NE');
            if (dx < 0 && dy < 0) preferredDirs.unshift('NW');
            if (dx > 0 && dy > 0) preferredDirs.unshift('SE');
            if (dx < 0 && dy > 0) preferredDirs.unshift('SW');

            const walkableDirs = new Set(getWalkableDirs());
            for (const dir of preferredDirs) {
                if (walkableDirs.has(dir)) {
                    return { type: 'move', args: { dir } };
                }
            }

            // If direct path is blocked by walls, fall back to any walkable direction
            const fallbackDirs = Array.from(walkableDirs);
            if (fallbackDirs.length > 0) {
                const dir = fallbackDirs[Math.floor(this.rng() * fallbackDirs.length)];
                return { type: 'move', args: { dir } };
            }

            return { type: 'wait', args: {} };
        }

        // No food visible: random wander (excluding directions that lead into walls)
        const walkable = getWalkableDirs();
        if (walkable.length === 0) {
            return { type: 'wait', args: {} };
        }
        const randomDir = walkable[Math.floor(this.rng() * walkable.length)];
        return { type: 'move', args: { dir: randomDir } };
    }
    
    submitAction(agentId, turnId, type, args) {
        // Validate turn
        if (turnId !== this.turnId) {
            return { ok: false, error: `Invalid turn_id (expected ${this.turnId}, got ${turnId})` };
        }
        
        // Validate agent exists
        const agent = this.entities.find(e => e.id === agentId);
        if (!agent) {
            return { ok: false, error: 'Agent not found' };
        }
        
        // Validate action type
        if (!['move', 'wait', 'forage', 'eat', 'give', 'attack', 'talk', 'mate', 'edit_prompt', 'edit_notes', 'read_notes', 'read_prompt'].includes(type)) {
            return { ok: false, error: 'Invalid action type' };
        }
        
        // Check if already submitted for this turn
        if (this.actionQueue.has(agentId)) {
            return { ok: false, error: 'Action already submitted for this turn' };
        }
        
        // Queue action
        this.actionQueue.set(agentId, { type, args });
        console.log(`  ${agentId}: ${type} ${JSON.stringify(args)}`);
        
        return { ok: true };
    }
    
    async applyActionSimulated(agent, action) {
        // Simulate action without modifying world state
        // Returns the intended result and any side effects to apply later
        
        if (action.type === 'move') {
            const dir = action.args.dir;
            const [x, y] = agent.pos;
            const [dx, dy] = this.getDirDelta(dir);
            const newX = x + dx;
            const newY = y + dy;
            
            // Store intended move for conflict resolution
            return {
                success: true,
                type: 'move',
                intendedPos: [newX, newY],
                originalPos: [x, y],
                message: `Moving ${dir}`
            };
        } else if (action.type === 'forage') {
            return { success: true, type: 'forage', ...this.handleForage(agent) };
        } else if (action.type === 'eat') {
            return { success: true, type: 'eat', ...this.handleEat(agent) };
        } else if (action.type === 'give') {
            return { success: true, type: 'give', ...this.handleGive(agent, action.args.target_id, action.args.item_index) };
        } else if (action.type === 'attack') {
            return { success: true, type: 'attack', ...this.handleAttack(agent, action.args.target_id) };
        } else if (action.type === 'talk') {
            return { success: true, type: 'talk', ...this.handleTalk(agent, action.args.message) };
        } else if (action.type === 'mate') {
            // Mate is async - handle it here
            return { success: true, type: 'mate', ...(await this.handleMate(agent, action.args.partner_id)) };
        } else if (action.type === 'edit_prompt') {
            return { success: true, type: 'edit_prompt', ...this.handleEditPrompt(agent, action.args.text) };
        } else if (action.type === 'edit_notes') {
            return { success: true, type: 'edit_notes', ...this.handleEditNotes(agent, action.args.text) };
        } else if (action.type === 'read_notes') {
            return { success: true, type: 'read_notes', ...this.handleReadNotes(agent) };
        } else if (action.type === 'read_prompt') {
            return { success: true, type: 'read_prompt', ...this.handleReadPrompt(agent) };
        } else {
            return { success: true, type: 'wait', message: 'Waited' };
        }
    }
    
    reconcileConflicts(actionResults) {
        // Simultaneous movement resolution with exchanges:
        // - If destinations are unique and (a) empty, or (b) occupied by an entity that is also moving away,
        //   allow the whole chain to move (including swaps and longer chains).
        // - If multiple entities target the same destination, block all of those moves (collision).

        const moves = [];
        const moveById = new Map();
        const destKeyToMoves = new Map();

        for (const { agent, action, result } of actionResults) {
            if (result.type !== 'move' || !result.intendedPos) continue;

            const [newX, newY] = result.intendedPos;
            const destKey = `${newX},${newY}`;

            const move = { agent, action, result, destKey, destX: newX, destY: newY };
            moves.push(move);
            moveById.set(agent.id, move);

            if (!destKeyToMoves.has(destKey)) destKeyToMoves.set(destKey, []);
            destKeyToMoves.get(destKey).push(move);
        }

        // 1) Hard invalidation: wall / out of bounds
        const candidates = new Set(moves);
        for (const move of moves) {
            const { destX: newX, destY: newY } = move;
            if (
                newY < 0 || newY >= this.height ||
                newX < 0 || newX >= this.width ||
                this.map[newY][newX] === '#'
            ) {
                move.result.success = false;
                move.result.reason = 'wall';
                move.result.message = 'Blocked by wall';
                delete move.result.intendedPos;
                candidates.delete(move);
                console.log(`  ${move.agent.id}: blocked by wall`);
            }
        }

        // 2) Collisions: multiple movers to same destination
        for (const [destKey, destMoves] of destKeyToMoves.entries()) {
            const active = destMoves.filter(m => candidates.has(m));
            if (active.length > 1) {
                console.log(`  ⚠️  Movement conflict at ${destKey}: ${active.map(m => m.agent.id).join(', ')}`);
                for (const move of active) {
                    move.result.success = false;
                    move.result.reason = 'collision';
                    move.result.message = `Movement blocked - collision with ${active.filter(m => m.agent.id !== move.agent.id).map(m => m.agent.id).join(', ')}`;
                    delete move.result.intendedPos;
                    candidates.delete(move);
                }
            }
        }

        // Helper: find current occupant at a tile (ignoring the querying mover)
        const entityAt = (x, y, ignoreId = null) => this.entities.find(e => e.pos[0] === x && e.pos[1] === y && e.id !== ignoreId);

        // 3) Iteratively prune moves that want to enter a tile occupied by a non-moving entity
        // (We keep moves that enter tiles occupied by another *candidate mover*, enabling exchanges/chains.)
        let changed = true;
        while (changed) {
            changed = false;
            for (const move of Array.from(candidates)) {
                const occupant = entityAt(move.destX, move.destY, move.agent.id);
                if (!occupant) continue; // empty destination

                const occupantMove = moveById.get(occupant.id);
                if (!occupantMove || !candidates.has(occupantMove)) {
                    // Occupant isn't moving away, so this move can't happen
                    move.result.success = false;
                    move.result.reason = 'entity';
                    move.result.message = `Blocked by ${occupant.type}`;
                    delete move.result.intendedPos;
                    candidates.delete(move);
                    changed = true;
                    // Keep logs quieter for mass moves; uncomment if needed
                    // console.log(`  ${move.agent.id}: blocked by entity`);
                }
            }
        }

        // 4) Apply remaining moves simultaneously
        const newPositions = new Map();
        for (const move of candidates) {
            newPositions.set(move.agent.id, [move.destX, move.destY]);
        }

        for (const move of candidates) {
            const newPos = newPositions.get(move.agent.id);
            move.agent.pos = newPos;
            move.result.message = `Moved to [${newPos[0]},${newPos[1]}]`;
            console.log(`  ${move.agent.id}: moved from [${move.result.originalPos}] -> [${newPos[0]},${newPos[1]}]`);
        }
    }

    async applyAction(agent, action) {
        if (action.type === 'move') {
            const result = this.handleMove(agent, action.args.dir);
            // Store result for agent to see in next observation
            agent.lastActionResult = result;
        } else if (action.type === 'forage') {
            const result = this.handleForage(agent);
            agent.lastActionResult = result;
        } else if (action.type === 'attack') {
            const result = this.handleAttack(agent, action.args.target_id);
            agent.lastActionResult = result;
        } else if (action.type === 'talk') {
            const result = this.handleTalk(agent, action.args.message);
            agent.lastActionResult = result;
        } else if (action.type === 'edit_prompt') {
            const result = this.handleEditPrompt(agent, action.args.text);
            agent.lastActionResult = result;
        } else if (action.type === 'edit_notes') {
            const result = this.handleEditNotes(agent, action.args.text);
            agent.lastActionResult = result;
        } else if (action.type === 'mate') {
            const result = await this.handleMate(agent, action.args.partner_id);
            agent.lastActionResult = result;
        } else if (action.type === 'read_notes') {
            const result = this.handleReadNotes(agent);
            agent.lastActionResult = result;
        } else if (action.type === 'read_prompt') {
            const result = this.handleReadPrompt(agent);
            agent.lastActionResult = result;
        } else {
            agent.lastActionResult = { success: true, message: 'Waited' };
        }
    }
    
    getDirDelta(direction) {
        const dirMap = {
            'N': [0, -1],
            'S': [0, 1],
            'E': [1, 0],
            'W': [-1, 0],
            'NE': [1, -1],
            'NW': [-1, -1],
            'SE': [1, 1],
            'SW': [-1, 1],
        };
        return dirMap[direction] || [0, 0];
    }
    
    handleMove(agent, direction) {
        const [x, y] = agent.pos;
        const [dx, dy] = this.getDirDelta(direction);
        const newX = x + dx;
        const newY = y + dy;
        
        // Check bounds
        if (newX < 0 || newX >= this.width || newY < 0 || newY >= this.height) {
            console.log(`  ${agent.id}: blocked by bounds`);
            return { success: false, reason: 'out_of_bounds', message: 'Hit map boundary' };
        }
        
        // Check wall collision
        if (this.map[newY][newX] === '#') {
            console.log(`  ${agent.id}: blocked by wall at [${newX},${newY}]`);
            return { success: false, reason: 'wall', message: `Wall at [${newX},${newY}]` };
        }
        
        // Check entity collision
        const blocked = this.entities.some(e => 
            e.id !== agent.id && e.pos[0] === newX && e.pos[1] === newY
        );
        
        if (blocked) {
            console.log(`  ${agent.id}: blocked by entity`);
            return { success: false, reason: 'entity', message: 'Another entity is blocking the way' };
        } else {
            agent.pos = [newX, newY];
            console.log(`  ${agent.id}: moved from [${x},${y}] -> [${newX},${newY}]`);
            return { success: true, message: `Moved ${direction} to [${newX},${newY}]` };
        }
    }
    
    handleForage(agent) {
        const [agentX, agentY] = agent.pos;
        const forageRadius = 1; // Can forage 1 tile away
        
        // Look for food sources within forage radius (plants or meat)
        const nearbyFood = this.entities.filter(e => {
            if (!['plant', 'meat'].includes(e.type)) return false;
            const [px, py] = e.pos;
            const dx = Math.abs(px - agentX);
            const dy = Math.abs(py - agentY);
            return dx <= forageRadius && dy <= forageRadius;
        });
        
        if (nearbyFood.length > 0) {
            // Prioritize meat (more energy), then plants
            const food = nearbyFood.find(f => f.type === 'meat') || nearbyFood[0];
            const foodAmount = food.energy || 20;
            const foodType = food.type;
            
            // Add to inventory instead of eating immediately
            if (!agent.inventory) agent.inventory = [];
            agent.inventory.push({
                type: foodType,
                energy: foodAmount
            });
            
            // Remove the food from world
            const foodIndex = this.entities.indexOf(food);
            if (foodIndex > -1) {
                this.entities.splice(foodIndex, 1);
            }
            
            console.log(`  ${agent.id}: foraged ${foodType} at [${food.pos}] +${foodAmount} energy to inventory (${agent.inventory.length} items)`);
            this.broadcastPublic({
                type: 'forage',
                message: `${agent.id} foraged ${foodType} (stored in inventory)`
            });
            return { success: true, message: `Foraged ${foodType}! Added to inventory (+${foodAmount} energy when eaten)` };
        } else {
            console.log(`  ${agent.id}: foraged but no food nearby`);
            return { success: false, reason: 'no_food', message: 'No food nearby to forage' };
        }
    }
    
    handleEat(agent) {
        // Eat the first item in inventory
        if (!agent.inventory || agent.inventory.length === 0) {
            console.log(`  ${agent.id}: eat failed - inventory empty`);
            return { success: false, reason: 'empty_inventory', message: 'No food in inventory' };
        }
        
        const food = agent.inventory.shift(); // Remove first item
        const oldEnergy = agent.energy;
        agent.energy = Math.min(100, agent.energy + food.energy);
        const gained = agent.energy - oldEnergy;
        
        console.log(`  ${agent.id}: ate ${food.type} +${gained} energy (${oldEnergy} → ${agent.energy})`);
        this.broadcastPublic({
            type: 'eat',
            message: `${agent.id} ate ${food.type} (+${gained} energy)`
        });
        return { success: true, message: `Ate ${food.type}! +${gained} energy (${agent.inventory.length} items remaining)` };
    }
    
    handleGive(agent, targetId, itemIndex = 0) {
        // Find target agent
        const target = this.entities.find(e => e.id === targetId);
        
        if (!target) {
            console.log(`  ${agent.id}: give failed - target ${targetId} not found`);
            return { success: false, reason: 'no_target', message: `Target ${targetId} not found` };
        }
        
        if (target.type !== 'agent') {
            console.log(`  ${agent.id}: give failed - can only give to agents`);
            return { success: false, reason: 'invalid_target', message: 'Can only give to other agents' };
        }
        
        // Check range (must be adjacent)
        const [agentX, agentY] = agent.pos;
        const [targetX, targetY] = target.pos;
        const dx = Math.abs(targetX - agentX);
        const dy = Math.abs(targetY - agentY);
        
        if (dx > 1 || dy > 1) {
            console.log(`  ${agent.id}: give failed - target too far (${dx},${dy})`);
            return { success: false, reason: 'out_of_range', message: 'Target must be adjacent (1 tile away)' };
        }
        
        // Check inventory
        if (!agent.inventory || agent.inventory.length === 0) {
            console.log(`  ${agent.id}: give failed - inventory empty`);
            return { success: false, reason: 'empty_inventory', message: 'No food in inventory to give' };
        }
        
        if (itemIndex >= agent.inventory.length) {
            console.log(`  ${agent.id}: give failed - invalid item index ${itemIndex}`);
            return { success: false, reason: 'invalid_index', message: `Item index ${itemIndex} not in inventory` };
        }
        
        // Transfer item
        const item = agent.inventory.splice(itemIndex, 1)[0];
        if (!target.inventory) target.inventory = [];
        target.inventory.push(item);
        
        console.log(`  ${agent.id}: gave ${item.type} (+${item.energy}) to ${target.id}`);
        this.broadcastPublic({
            type: 'give',
            message: `${agent.id} gave ${item.type} to ${target.id}`
        });
        return { success: true, message: `Gave ${item.type} (+${item.energy} energy) to ${target.id}` };
    }
    
    handleAttack(attacker, targetId) {
        // Find target entity
        const target = this.entities.find(e => e.id === targetId);
        
        if (!target) {
            console.log(`  ${attacker.id}: attack failed - target ${targetId} not found`);
            return { success: false, reason: 'no_target', message: `Target ${targetId} not found` };
        }
        
        // Can attack agents and animals (entities with hp), but not plants/meat/bones
        if (!['agent', 'rabbit', 'deer'].includes(target.type)) {
            console.log(`  ${attacker.id}: attack failed - cannot attack ${target.type}`);
            return { success: false, reason: 'invalid_target', message: `Cannot attack ${target.type}` };
        }
        
        // Check if target is already dead
        if (target.hp <= 0) {
            console.log(`  ${attacker.id}: attack failed - target already dead`);
            return { success: false, reason: 'target_dead', message: 'Target is already dead' };
        }
        
        // Check range (must be within 1 tile, like forage)
        const [attackerX, attackerY] = attacker.pos;
        const [targetX, targetY] = target.pos;
        const dx = Math.abs(targetX - attackerX);
        const dy = Math.abs(targetY - attackerY);
        const attackRange = 1;
        
        if (dx > attackRange || dy > attackRange) {
            console.log(`  ${attacker.id}: attack failed - target too far (${dx},${dy})`);
            return { success: false, reason: 'out_of_range', message: `Target is too far away (range: ${attackRange} tile)` };
        }
        
        // Hit chance based on attacker type (animals have low success)
        let hitChance = 1.0; // Agents always hit
        if (attacker.type === 'rabbit') {
            hitChance = 0.20; // 20% chance
        } else if (attacker.type === 'deer') {
            hitChance = 0.35; // 35% chance
        }
        
        // Roll for hit
        if (this.rng() > hitChance) {
            console.log(`  ${attacker.id}: attack missed!`);
            return { success: false, reason: 'miss', message: `Attack missed!` };
        }
        
        // Calculate damage (base damage + some randomness)
        const baseDamage = 10;
        const variance = Math.floor(this.rng() * 6) - 2; // -2 to +3
        const damage = Math.max(1, baseDamage + variance); // Minimum 1 damage
        
        // Apply damage
        const oldHp = target.hp;
        target.hp = Math.max(0, target.hp - damage);
        
        // Log attack to database
        this.logger.logAttack(this.turnId, attacker.id, target.id, damage, target.hp, target.pos);
        
        console.log(`  ${attacker.id}: attacked ${target.id} for ${damage} damage (${oldHp} → ${target.hp} HP)`);
        
        // Store combat event for nearby agents to witness
        const combatEvent = {
            turn: this.turnId,
            attackerId: attacker.id,
            targetId: target.id,
            damage: damage,
            targetHp: target.hp,
            pos: [...attacker.pos], // Position where attack occurred
            range: 10, // Agents within 10 tiles can witness
            type: 'attack'
        };
        
        this.recentCombatEvents.push(combatEvent);
        
        // Keep only recent combat events
        if (this.recentCombatEvents.length > this.maxRecentCombatEvents) {
            this.recentCombatEvents = this.recentCombatEvents.slice(-this.maxRecentCombatEvents);
        }
        
        // Broadcast combat event
        this.broadcastPublic({
            type: 'combat',
            message: `${attacker.id} attacked ${target.id} for ${damage} damage! (${target.hp} HP remaining)`
        });
        
        // Check if target died from attack
        if (target.hp <= 0) {
            console.log(`  ${target.id}: died from combat`);
            
            // Log death to database (only for agents, not animals)
            if (target.type === 'agent') {
                this.logger.logDeath(this.turnId, target.id, 'combat', target.pos, true);
            }
            
            // Store death event
            const deathEvent = {
                turn: this.turnId,
                attackerId: attacker.id,
                targetId: target.id,
                pos: [...target.pos],
                range: 10,
                type: 'death'
            };
            
            this.recentCombatEvents.push(deathEvent);
            
            this.broadcastPublic({
                type: 'death',
                message: `${target.id} was killed by ${attacker.id}!`
            });
            
            // Convert killed entity to meat corpse
            const corpseId = `corpse_${target.id}`;
            const meatEnergy = target.type === 'rabbit' ? 30 : (target.type === 'deer' ? 100 : 50);
            const meat = {
                id: corpseId,
                type: 'meat',
                pos: target.pos,
                energy: meatEnergy,
                decayTimer: 20,
                originalEntity: target.id,
                killedBy: attacker.id,
            };
            
            // Remove dead entity
            const targetIndex = this.entities.indexOf(target);
            if (targetIndex > -1) {
                this.entities.splice(targetIndex, 1);
            }
            
            // Add meat corpse
            this.entities.push(meat);
            console.log(`  ${corpseId}: spawned at [${meat.pos}] (+${meatEnergy} energy)`);
            
            return { 
                success: true, 
                message: `Attacked ${targetId} for ${damage} damage! ${targetId} died!`,
                killed: true
            };
        }
        
        return { 
            success: true, 
            message: `Attacked ${targetId} for ${damage} damage (${target.hp} HP remaining)` 
        };
    }
    
    handleTalk(agent, message) {
        // Validate message
        if (!message || typeof message !== 'string') {
            console.log(`  ${agent.id}: talk failed - no message provided`);
            return { success: false, reason: 'no_message', message: 'No message provided' };
        }
        
        // Truncate long messages
        const maxLength = 200;
        const originalLength = message.length;
        const wasTruncated = originalLength > maxLength;
        const truncatedMessage = wasTruncated 
            ? message.substring(0, maxLength) + '...' 
            : message;
        
        // Store message with position and turn info
        const talkEvent = {
            turn: this.turnId,
            agentId: agent.id,
            pos: [...agent.pos], // Copy position
            message: truncatedMessage,
            range: 10, // Agents within 10 tiles can hear
        };
        
        this.recentMessages.push(talkEvent);
        
        // Keep only recent messages
        if (this.recentMessages.length > this.maxRecentMessages) {
            this.recentMessages = this.recentMessages.slice(-this.maxRecentMessages);
        }
        
        console.log(`  ${agent.id}: said "${truncatedMessage}"${wasTruncated ? ' (TRUNCATED)' : ''}`);
        
        // Broadcast to public stream
        this.broadcastPublic({
            type: 'talk',
            message: `${agent.id}: "${truncatedMessage}"`
        });
        
        const resultMessage = wasTruncated
            ? `Said: "${truncatedMessage}" (TRUNCATED from ${originalLength} to ${maxLength} chars)`
            : `Said: "${truncatedMessage}"`;
        
        return { 
            success: true, 
            message: resultMessage,
            truncated: wasTruncated,
            max_length: maxLength,
            original_length: originalLength,
            stored_length: truncatedMessage.length
        };
    }
    
    handleEditPrompt(agent, text) {
        // Validate text
        if (text === undefined || text === null) {
            console.log(`  ${agent.id}: edit_prompt failed - no text provided`);
            return { success: false, reason: 'no_text', message: 'No text provided' };
        }
        
        // Convert to string and truncate if too long
        const maxLength = 300;
        const textStr = String(text);
        const originalLength = textStr.length;
        const wasTruncated = originalLength > maxLength;
        const truncatedText = wasTruncated 
            ? textStr.substring(0, maxLength) + '...' 
            : textStr;
        
        // Update agent's prompt (always displayed)
        const oldPrompt = agent.prompt || '';
        agent.prompt = truncatedText;
        
        console.log(`  ${agent.id}: updated prompt (${oldPrompt.length} -> ${truncatedText.length} chars)${wasTruncated ? ' (TRUNCATED)' : ''}`);
        
        const resultMessage = wasTruncated
            ? `Updated persistent prompt (TRUNCATED from ${originalLength} to ${maxLength} chars)`
            : `Updated persistent prompt (${truncatedText.length} characters)`;
        
        return { 
            success: true, 
            message: resultMessage,
            truncated: wasTruncated,
            max_length: maxLength,
            original_length: originalLength,
            stored_length: truncatedText.length
        };
    }
    
    handleEditNotes(agent, text) {
        // Validate text
        if (text === undefined || text === null) {
            console.log(`  ${agent.id}: edit_notes failed - no text provided`);
            return { success: false, reason: 'no_text', message: 'No text provided' };
        }
        
        // Convert to string and truncate if too long
        const maxLength = 1000;
        const textStr = String(text);
        const originalLength = textStr.length;
        const wasTruncated = originalLength > maxLength;
        const truncatedText = wasTruncated 
            ? textStr.substring(0, maxLength) + '...' 
            : textStr;
        
        // Update agent's notes (only visible when read)
        const oldNotes = agent.notes || '';
        agent.notes = truncatedText;
        
        console.log(`  ${agent.id}: updated notes (${oldNotes.length} -> ${truncatedText.length} chars)${wasTruncated ? ' (TRUNCATED)' : ''}`);
        
        const resultMessage = wasTruncated
            ? `Wrote to private notes (TRUNCATED from ${originalLength} to ${maxLength} chars)`
            : `Wrote to private notes (${truncatedText.length} characters)`;
        
        return { 
            success: true, 
            message: resultMessage,
            truncated: wasTruncated,
            max_length: maxLength,
            original_length: originalLength,
            stored_length: truncatedText.length
        };
    }
    
    handleReadNotes(agent) {
        // Return current notes (will be shown in last_action_result)
        const notes = agent.notes || '';
        
        console.log(`  ${agent.id}: read notes (${notes.length} chars)`);
        
        return { 
            success: true, 
            message: `Your notes: ${notes || '(empty)'}`,
            notes: notes
        };
    }
    
    handleReadPrompt(agent) {
        // Return current prompt (will be shown in last_action_result)
        const prompt = agent.prompt || '';
        
        console.log(`  ${agent.id}: read prompt (${prompt.length} chars)`);
        
        return { 
            success: true, 
            message: `Your current prompt: ${prompt || '(empty)'}`,
            prompt: prompt
        };
    }
    
    async handleMate(agent, partnerId) {
        // Find partner entity
        const partner = this.entities.find(e => e.id === partnerId);
        
        if (!partner) {
            console.log(`  ${agent.id}: mate failed - partner ${partnerId} not found`);
            return { success: false, reason: 'no_partner', message: `Partner ${partnerId} not found` };
        }
        
        // Only agents can mate
        if (partner.type !== 'agent') {
            console.log(`  ${agent.id}: mate failed - can only mate with other agents`);
            return { success: false, reason: 'invalid_partner', message: 'Can only mate with other agents' };
        }
        
        // Check if partner is dead
        if (partner.hp <= 0) {
            console.log(`  ${agent.id}: mate failed - partner is dead`);
            return { success: false, reason: 'partner_dead', message: 'Partner is dead' };
        }
        
        // Check range (must be within 1 tile, adjacent)
        const [agentX, agentY] = agent.pos;
        const [partnerX, partnerY] = partner.pos;
        const dx = Math.abs(partnerX - agentX);
        const dy = Math.abs(partnerY - agentY);
        const mateRange = 1;
        
        if (dx > mateRange || dy > mateRange) {
            console.log(`  ${agent.id}: mate failed - partner too far (${dx},${dy})`);
            return { success: false, reason: 'out_of_range', message: `Partner is too far away (range: ${mateRange} tile)` };
        }
        
        // Mating costs 20 energy for each parent
        const matingCost = 20;
        if (agent.energy < matingCost) {
            console.log(`  ${agent.id}: mate failed - insufficient energy (${agent.energy}/${matingCost})`);
            return { success: false, reason: 'insufficient_energy', message: `Mating costs ${matingCost} energy, you only have ${agent.energy}` };
        }
        
        if (partner.energy < matingCost) {
            console.log(`  ${agent.id}: mate failed - partner has insufficient energy`);
            return { success: false, reason: 'partner_low_energy', message: `Partner needs ${matingCost} energy to mate` };
        }
        
        // Deduct energy from both parents
        agent.energy -= matingCost;
        partner.energy -= matingCost;
        
        // Generate child ID
        const childId = `child_${agent.id}_${partner.id}_${this.turnId}`;
        
        // Find a nearby spawn location (adjacent to parents)
        let spawnX = null;
        let spawnY = null;
        const spawnAttempts = [
            [agentX + 1, agentY],
            [agentX - 1, agentY],
            [agentX, agentY + 1],
            [agentX, agentY - 1],
            [agentX + 1, agentY + 1],
            [agentX - 1, agentY - 1],
            [agentX + 1, agentY - 1],
            [agentX - 1, agentY + 1],
        ];
        
        for (const [x, y] of spawnAttempts) {
            if (x >= 0 && x < this.width && y >= 0 && y < this.height &&
                this.map[y] && this.map[y][x] === '.' &&
                !this.entities.some(e => e.pos[0] === x && e.pos[1] === y)) {
                spawnX = x;
                spawnY = y;
                break;
            }
        }
        
        if (spawnX === null) {
            console.log(`  ${agent.id}: mate failed - no space for offspring`);
            // Refund energy since mating failed
            agent.energy += matingCost;
            partner.energy += matingCost;
            return { success: false, reason: 'no_space', message: 'No adjacent space for offspring' };
        }
        
        // Fuse prompts from parents (if they have any)
        const fusedPrompt = this.fusePrompts(agent.prompt, partner.prompt);
        
        // Generate a personality-based name for the offspring
        const childName = await this.generateOffspringName(agent.id, partner.id, fusedPrompt);
        
        // Spawn the offspring with generated name
        this.spawnAgent(childName, spawnX, spawnY, [agent.id, partner.id]);
        
        // Set the child's fused prompt
        const child = this.entities.find(e => e.id === childName);
        if (child && fusedPrompt) {
            child.prompt = fusedPrompt;
        }
        
        console.log(`  ${agent.id}: mated with ${partner.id}, offspring ${childName} born at [${spawnX},${spawnY}]`);
        this.broadcastPublic({
            type: 'mate',
            message: `${agent.id} and ${partner.id} created offspring ${childName}`
        });
        
        // Log birth to database
        this.logger.logBirth(this.turnId, childName, [agent.id, partner.id], [spawnX, spawnY]);
        
        return { 
            success: true, 
            message: `Mated with ${partner.id}! Offspring ${childName} born. (-${matingCost} energy)`,
            child_id: childName
        };
    }
    
    fusePrompts(prompt1, prompt2) {
        // If neither parent has a prompt, return empty
        if (!prompt1 && !prompt2) return '';
        
        // If only one parent has a prompt, use it
        if (!prompt1) return prompt2;
        if (!prompt2) return prompt1;
        
        // Both parents have prompts - create a fusion
        // Simple approach: combine key phrases/concepts
        const words1 = prompt1.split(/\s+/).filter(w => w.length > 3);
        const words2 = prompt2.split(/\s+/).filter(w => w.length > 3);
        
        // Take important words from both (max 20 words, 200 chars)
        const combinedWords = [];
        const maxWords = 20;
        const step = Math.ceil(Math.max(words1.length, words2.length) / maxWords * 2);
        
        for (let i = 0; i < maxWords / 2 && i * step < words1.length; i++) {
            combinedWords.push(words1[i * step]);
        }
        for (let i = 0; i < maxWords / 2 && i * step < words2.length; i++) {
            combinedWords.push(words2[i * step]);
        }
        
        let fused = `Inherited traits: ${combinedWords.join(' ')}`;
        
        // Truncate to 300 chars (prompt limit)
        if (fused.length > 300) {
            fused = fused.substring(0, 297) + '...';
        }
        
        return fused;
    }
    
    async generateOffspringName(parent1Id, parent2Id, fusedPrompt) {
        // Get DeepSeek API key from environment
        const apiKey = process.env.DEEPSEEK_API_KEY;
        
        // Fallback to simple naming if no API key
        if (!apiKey) {
            console.log('  No DEEPSEEK_API_KEY set, using fallback naming');
            return `child_${parent1Id}_${parent2Id}_${Date.now() % 10000}`;
        }
        
        try {
            // Create a prompt for DeepSeek to generate a personality-based name
            const prompt = `You are naming a newborn agent in a survival simulation game.

Parent 1: ${parent1Id}
Parent 2: ${parent2Id}
Inherited traits: ${fusedPrompt || 'None (new personality)'}

Generate a single appropriate name (lowercase, no spaces, 4-12 characters) that reflects the child's inherited personality traits. The name should be evocative and meaningful.

Examples: scout, warden, seeker, hunter, guardian, nomad, healer, mystic, sage, rogue

Respond with ONLY the name, nothing else.`;

            const response = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 20,
                    temperature: 0.8,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 3000, // 3 second timeout
                }
            );
            
            const generatedName = response.data.choices[0].message.content.trim().toLowerCase();
            
            // Validate the name (must be 4-12 chars, alphanumeric+underscore only)
            if (/^[a-z0-9_]{4,12}$/.test(generatedName)) {
                console.log(`  Generated offspring name: ${generatedName}`);
                return generatedName;
            } else {
                console.log(`  Generated invalid name "${generatedName}", using fallback`);
                return `child_${parent1Id}_${parent2Id}_${Date.now() % 10000}`;
            }
        } catch (error) {
            console.error('  Failed to generate name with DeepSeek:', error.message);
            return `child_${parent1Id}_${parent2Id}_${Date.now() % 10000}`;
        }
    }
    
    applyEnergyDecay() {
        const deadEntities = [];
        
        for (const entity of this.entities) {
            // Apply energy decay to agents and animals
            if (entity.type === 'agent' || entity.type === 'rabbit' || entity.type === 'deer') {
                entity.energy = Math.max(0, entity.energy - 1);
                
                // Immediate death at 0 energy
                if (entity.energy === 0) {
                    console.log(`  ${entity.id}: died of starvation`);
                    
                    // Log death to database (only for agents, not animals)
                    if (entity.type === 'agent') {
                        this.logger.logDeath(this.turnId, entity.id, 'starvation', entity.pos, false);
                    }
                    
                    this.broadcastPublic({ 
                        type: 'death', 
                        message: `${entity.id} died of starvation` 
                    });
                    deadEntities.push(entity);
                }
                
                // Passive HP regeneration (if alive and not at max HP)
                // Agents and animals regenerate +1 HP per turn if energy > 50
                if (entity.hp > 0 && entity.hp < 100 && entity.energy > 50) {
                    const oldHp = entity.hp;
                    entity.hp = Math.min(100, entity.hp + 1);
                    
                    // Log regeneration occasionally (every 5 turns or when fully healed)
                    if (entity.hp === 100 || this.turnId % 5 === 0) {
                        console.log(`  ${entity.id}: regenerated HP (${oldHp} → ${entity.hp})`);
                    }
                }
            }
        }
        
        // Convert dead entities to meat
        for (const deadEntity of deadEntities) {
            // Determine meat energy based on entity type
            let meatEnergy = 50; // Default for agents
            if (deadEntity.type === 'rabbit') {
                meatEnergy = 30; // Small animal
            } else if (deadEntity.type === 'deer') {
                meatEnergy = 100; // Large animal
            }
            
            const corpseId = `corpse_${deadEntity.id}`;
            const meat = {
                id: corpseId,
                type: 'meat',
                pos: deadEntity.pos,
                energy: meatEnergy,
                decayTimer: 20, // Rots after 20 turns
                originalEntity: deadEntity.id,
            };
            
            // Remove dead entity
            const entityIndex = this.entities.indexOf(deadEntity);
            if (entityIndex > -1) {
                this.entities.splice(entityIndex, 1);
            }
            
            // Add meat corpse
            this.entities.push(meat);
            console.log(`  ${corpseId}: spawned at [${meat.pos}] (+${meatEnergy} energy)`);
        }
        
        // Decay meat and bones
        this.applyCorpseDecay();
    }
    
    applyCorpseDecay() {
        const rottedMeat = [];
        
        for (const entity of this.entities) {
            if (entity.type === 'meat' || entity.type === 'bones') {
                entity.decayTimer--;
                
                if (entity.decayTimer <= 0) {
                    if (entity.type === 'meat') {
                        // Meat turns to bones
                        console.log(`  ${entity.id}: rotted to bones`);
                        entity.type = 'bones';
                        entity.energy = 0; // Bones have no nutrition
                        entity.decayTimer = 50; // Bones last 50 turns before disappearing
                    } else if (entity.type === 'bones') {
                        // Bones disappear
                        console.log(`  ${entity.id}: crumbled to dust`);
                        rottedMeat.push(entity);
                    }
                }
            }
        }
        
        // Remove completely decayed bones
        for (const entity of rottedMeat) {
            const index = this.entities.indexOf(entity);
            if (index > -1) {
                this.entities.splice(index, 1);
            }
        }
    }
    
    applyPlantGrowth() {
        // Count current plants
        const plantCount = this.entities.filter(e => e.type === 'plant').length;
        
        // Only grow if under max capacity
        if (plantCount < this.maxPlants) {
            // Random chance to spawn a plant this turn
            if (this.rng() < this.plantGrowthRate) {
                // Try to find a valid floor tile
                let attempts = 0;
                const maxAttempts = 10;
                
                while (attempts < maxAttempts) {
                    const x = Math.floor(this.rng() * this.width);
                    const y = Math.floor(this.rng() * this.height);
                    
                    // Check if it's a floor tile
                    if (this.map[y] && this.map[y][x] === '.') {
                        // Check if tile is not occupied by any entity
                        const occupied = this.entities.some(e => e.pos[0] === x && e.pos[1] === y);
                        
                        if (!occupied) {
                            const plantId = `plant_t${this.turnId}_${attempts}`;
                            this.entities.push({
                                id: plantId,
                                type: 'plant',
                                pos: [x, y],
                                energy: 20, // Plants provide 20 energy when foraged
                            });
                            console.log(`  ${plantId}: grew at [${x},${y}] (total plants: ${plantCount + 1}/${this.maxPlants})`);
                            break;
                        }
                    }
                    attempts++;
                }
                
                if (attempts >= maxAttempts) {
                    // Failed to find spot (rare, only log occasionally)
                    if (this.turnId % 20 === 0) {
                        console.log(`  Plant growth: failed to find empty floor tile after ${maxAttempts} attempts`);
                    }
                }
            }
        }
    }
    
    getSnapshot() {
        return {
            turn_id: this.turnId,
            map: this.map,
            entities: this.entities,
        };
    }
    
    broadcastDelta() {
        const delta = {
            turn_id: this.turnId,
            entities: this.entities,
        };
        
        this.publicClients.forEach(callback => {
            callback({ type: 'delta', data: delta });
        });
    }
    
    broadcastPublic(event) {
        this.publicClients.forEach(callback => {
            callback({ type: 'public', data: event });
        });
    }
    
    broadcastToAgent(agentId, event) {
        const clients = this.agentClients.get(agentId);
        if (clients) {
            clients.forEach(callback => {
                callback(event);
            });
        }
    }
    
    registerPublicClient(callback) {
        const id = Math.random().toString(36);
        this.publicClients.set(id, callback);
        return id;
    }
    
    unregisterPublicClient(id) {
        this.publicClients.delete(id);
    }
    
    registerAgentClient(agentId, callback) {
        if (!this.agentClients.has(agentId)) {
            this.agentClients.set(agentId, new Map());
        }
        const id = Math.random().toString(36);
        this.agentClients.get(agentId).set(id, callback);
        return id;
    }
    
    unregisterAgentClient(agentId, clientId) {
        const clients = this.agentClients.get(agentId);
        if (clients) {
            clients.delete(clientId);
        }
    }
    
    // Telemetry and surveillance methods
    storeTelemetry(agentId, event) {
        if (!this.telemetryByAgent.has(agentId)) {
            this.telemetryByAgent.set(agentId, []);
        }
        
        const events = this.telemetryByAgent.get(agentId);
        events.push({
            ...event,
            timestamp: Date.now(),
        });
        
        // Ring buffer: keep only last N events
        if (events.length > this.maxTelemetryEvents) {
            events.shift();
        }
        
        // Broadcast to surveillance clients
        this.broadcastToSurveillance(agentId, { type: 'telemetry', data: event });
    }
    
    getSurveillanceSnapshot(agentId) {
        // Find the agent to include their current prompt and notes
        const agent = this.entities.find(e => e.id === agentId && e.type === 'agent');
        
        return {
            agent_id: agentId,
            events: this.telemetryByAgent.get(agentId) || [],
            prompt: agent ? agent.prompt : '',
            notes: agent ? agent.notes : '',
        };
    }
    
    registerSurveillanceClient(agentId, callback) {
        if (!this.surveillanceClients.has(agentId)) {
            this.surveillanceClients.set(agentId, new Map());
        }
        const id = Math.random().toString(36);
        this.surveillanceClients.get(agentId).set(id, callback);
        return id;
    }
    
    unregisterSurveillanceClient(agentId, clientId) {
        const clients = this.surveillanceClients.get(agentId);
        if (clients) {
            clients.delete(clientId);
        }
    }
    
    broadcastToSurveillance(agentId, event) {
        const clients = this.surveillanceClients.get(agentId);
        if (clients) {
            clients.forEach(callback => {
                callback(event);
            });
        }
    }
}
