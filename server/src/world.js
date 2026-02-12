// World Server - Authoritative simulation
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorldServer {
    constructor({ seed = 42, mapFile = null }) {
        this.seed = seed;
        this.rng = this.createSeededRNG(seed);
        
        this.turnId = 0;
        this.running = false;
        this.turnInterval = 1000; // ms per turn
        
        // Load map from file or generate
        if (mapFile) {
            this.map = this.loadMapFromFile(mapFile);
        } else {
            this.map = this.generateMap(25, 18);
        }
        
        this.width = this.map[0].length;
        this.height = this.map.length;
        
        // World state
        this.entities = [];
        this.actionQueue = new Map(); // agentId -> {action, args}
        
        // Telemetry storage (ring buffer per agent)
        this.telemetryByAgent = new Map(); // agentId -> array of events
        this.maxTelemetryEvents = 200;
        
        // Communication storage (messages visible to nearby agents)
        this.recentMessages = []; // {turn, agentId, pos, message, range}
        this.maxRecentMessages = 50;
        
        // SSE clients
        this.publicClients = new Map();
        this.agentClients = new Map(); // agentId -> Map(clientId -> callback)
        this.surveillanceClients = new Map(); // agentId -> Map(clientId -> callback)
        
        // Find spawn points in the map (floor tiles)
        const spawnPoints = this.findSpawnPoints(5);
        
        // Initialize world with 4 agents at valid spawn points
        // Spawn agents close together for easier interaction
        if (spawnPoints.length >= 4) {
            this.spawnAgent('scout', spawnPoints[0].x, spawnPoints[0].y);
            
            // Find nearby valid floor tiles for other agents (within 5 tiles of scout)
            let nomadSpawned = false;
            let wardenSpawned = false;
            let seekerSpawned = false;
            const spawnedPositions = [[spawnPoints[0].x, spawnPoints[0].y]];
            
            for (let attempts = 0; attempts < 150 && (!nomadSpawned || !wardenSpawned || !seekerSpawned); attempts++) {
                const dx = Math.floor(this.rng() * 10) - 5; // -5 to +4
                const dy = Math.floor(this.rng() * 10) - 5;
                const x = spawnPoints[0].x + dx;
                const y = spawnPoints[0].y + dy;
                
                // Check valid floor tile and not already occupied
                const occupied = spawnedPositions.some(([ox, oy]) => ox === x && oy === y);
                if (x >= 0 && x < this.width && y >= 0 && y < this.height &&
                    this.map[y] && this.map[y][x] === '.' && !occupied) {
                    
                    if (!nomadSpawned) {
                        this.spawnAgent('nomad', x, y);
                        console.log(`  nomad spawned ${Math.abs(dx)}+${Math.abs(dy)} tiles from scout`);
                        spawnedPositions.push([x, y]);
                        nomadSpawned = true;
                    } else if (!wardenSpawned) {
                        this.spawnAgent('warden', x, y);
                        console.log(`  warden spawned ${Math.abs(dx)}+${Math.abs(dy)} tiles from scout`);
                        spawnedPositions.push([x, y]);
                        wardenSpawned = true;
                    } else if (!seekerSpawned) {
                        this.spawnAgent('seeker', x, y);
                        console.log(`  seeker spawned ${Math.abs(dx)}+${Math.abs(dy)} tiles from scout`);
                        spawnedPositions.push([x, y]);
                        seekerSpawned = true;
                    }
                }
            }
            
            // Fallback to distant spawn points if needed
            if (!nomadSpawned) {
                this.spawnAgent('nomad', spawnPoints[1].x, spawnPoints[1].y);
            }
            if (!wardenSpawned) {
                this.spawnAgent('warden', spawnPoints[2].x, spawnPoints[2].y);
            }
            if (!seekerSpawned) {
                this.spawnAgent('seeker', spawnPoints[3].x, spawnPoints[3].y);
            }
        } else {
            console.warn('Not enough spawn points found, using fallback positions');
            this.spawnAgent('scout', 5, 5);
            this.spawnAgent('nomad', 8, 7);
            this.spawnAgent('warden', 6, 9);
            this.spawnAgent('seeker', 7, 11);
        }
        
        // Spawn initial food sources (plants)
        this.spawnFoodSources(5000); // Start with 5000 plants (0.5% density on 1000x1000 map)
        
        // Plant growth tracking
        this.maxPlants = 5000; // Maximum plants on map (0.5% density)
        this.plantGrowthRate = 0.8; // 80% chance per turn to spawn a new plant
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
        
        this.entities.push({
            id,
            type: 'agent',
            pos: [x, y],
            hp: 100,
            energy: 100,
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
        
        // Process actions SIMULTANEOUSLY
        // First, collect all action results in parallel
        const actionPromises = agents.map(async (agent) => {
            const action = this.actionQueue.get(agent.id);
            if (action) {
                const result = await this.applyActionSimulated(agent, action);
                return { agent, action, result };
            } else {
                console.log(`  ${agent.id}: wait (no action)`);
                return { agent, action: { type: 'wait' }, result: { success: true, message: 'Waited' } };
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
        
        return {
            turn_id: this.turnId,
            agent_id: agent.id,
            position: agent.pos,
            health: agent.hp,
            energy: agent.energy,
            prompt: agent.prompt || '', // Agent's persistent prompt (always shown)
            visible_tiles: visibleTiles,
            visible_entities: visibleEntities,
            heard_messages: heardMessages, // Messages from nearby agents
            last_action_result: agent.lastActionResult || null,
            recent_events: [],
            action_space: [
                { type: 'move', args: { dir: ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] } },
                { type: 'forage', args: {} },
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
        if (!['move', 'wait', 'forage', 'attack', 'talk', 'mate', 'edit_prompt', 'edit_notes', 'read_notes', 'read_prompt'].includes(type)) {
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
        // Find movement conflicts - multiple agents trying to move to same tile
        const movementsByDestination = new Map();
        
        for (const { agent, action, result } of actionResults) {
            if (result.type === 'move' && result.intendedPos) {
                const key = `${result.intendedPos[0]},${result.intendedPos[1]}`;
                if (!movementsByDestination.has(key)) {
                    movementsByDestination.set(key, []);
                }
                movementsByDestination.get(key).push({ agent, action, result });
            }
        }
        
        // Resolve conflicts
        for (const [posKey, movements] of movementsByDestination.entries()) {
            if (movements.length > 1) {
                // Multiple agents trying to move to same tile - BOUNCE all of them
                console.log(`  ⚠️  Movement conflict at ${posKey}: ${movements.map(m => m.agent.id).join(', ')}`);
                
                for (const movement of movements) {
                    movement.result.success = false;
                    movement.result.reason = 'collision';
                    movement.result.message = `Movement blocked - collision with ${movements.filter(m => m.agent.id !== movement.agent.id).map(m => m.agent.id).join(', ')}`;
                    delete movement.result.intendedPos; // Don't move
                }
            } else if (movements.length === 1) {
                // Single agent moving - check if destination is valid
                const movement = movements[0];
                const [newX, newY] = movement.result.intendedPos;
                
                // Check wall
                if (newY < 0 || newY >= this.height || newX < 0 || newX >= this.width ||
                    this.map[newY][newX] === '#') {
                    movement.result.success = false;
                    movement.result.reason = 'wall';
                    movement.result.message = 'Blocked by wall';
                    delete movement.result.intendedPos;
                    console.log(`  ${movement.agent.id}: blocked by wall`);
                    continue;
                }
                
                // Check entity at destination (not moving)
                const entityAtDest = this.entities.find(e => 
                    e.pos[0] === newX && e.pos[1] === newY && 
                    e.id !== movement.agent.id
                );
                
                if (entityAtDest) {
                    movement.result.success = false;
                    movement.result.reason = 'entity';
                    movement.result.message = `Blocked by ${entityAtDest.type}`;
                    delete movement.result.intendedPos;
                    console.log(`  ${movement.agent.id}: blocked by entity`);
                    continue;
                }
                
                // Valid move - apply it now
                movement.agent.pos = [newX, newY];
                movement.result.message = `Moved to [${newX},${newY}]`;
                console.log(`  ${movement.agent.id}: moved from [${movement.result.originalPos}] -> [${newX},${newY}]`);
            }
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
            
            agent.energy = Math.min(100, agent.energy + foodAmount);
            
            // Remove the food from world
            const foodIndex = this.entities.indexOf(food);
            if (foodIndex > -1) {
                this.entities.splice(foodIndex, 1);
            }
            
            console.log(`  ${agent.id}: foraged ${foodType} at [${food.pos}] +${foodAmount} energy (now ${agent.energy})`);
            this.broadcastPublic({
                type: 'forage',
                message: `${agent.id} foraged ${foodType} (+${foodAmount} energy)`
            });
            return { success: true, message: `Foraged ${foodType}! +${foodAmount} energy` };
        } else {
            console.log(`  ${agent.id}: foraged but no food nearby`);
            return { success: false, reason: 'no_food', message: 'No food nearby to forage' };
        }
    }
    
    handleAttack(agent, targetId) {
        // Find target entity
        const target = this.entities.find(e => e.id === targetId);
        
        if (!target) {
            console.log(`  ${agent.id}: attack failed - target ${targetId} not found`);
            return { success: false, reason: 'no_target', message: `Target ${targetId} not found` };
        }
        
        // Only agents can be attacked (no attacking plants/meat/bones)
        if (target.type !== 'agent') {
            console.log(`  ${agent.id}: attack failed - can only attack other agents`);
            return { success: false, reason: 'invalid_target', message: 'Can only attack other agents' };
        }
        
        // Check if target is already dead
        if (target.hp <= 0) {
            console.log(`  ${agent.id}: attack failed - target already dead`);
            return { success: false, reason: 'target_dead', message: 'Target is already dead' };
        }
        
        // Check range (must be within 1 tile, like forage)
        const [agentX, agentY] = agent.pos;
        const [targetX, targetY] = target.pos;
        const dx = Math.abs(targetX - agentX);
        const dy = Math.abs(targetY - agentY);
        const attackRange = 1;
        
        if (dx > attackRange || dy > attackRange) {
            console.log(`  ${agent.id}: attack failed - target too far (${dx},${dy})`);
            return { success: false, reason: 'out_of_range', message: `Target is too far away (range: ${attackRange} tile)` };
        }
        
        // Calculate damage (base damage + some randomness)
        const baseDamage = 10;
        const variance = Math.floor(this.rng() * 6) - 2; // -2 to +3
        const damage = Math.max(1, baseDamage + variance); // Minimum 1 damage
        
        // Apply damage
        const oldHp = target.hp;
        target.hp = Math.max(0, target.hp - damage);
        
        console.log(`  ${agent.id}: attacked ${target.id} for ${damage} damage (${oldHp} → ${target.hp} HP)`);
        
        // Broadcast combat event
        this.broadcastPublic({
            type: 'combat',
            message: `${agent.id} attacked ${target.id} for ${damage} damage! (${target.hp} HP remaining)`
        });
        
        // Check if target died from attack
        if (target.hp <= 0) {
            console.log(`  ${target.id}: died from combat`);
            this.broadcastPublic({
                type: 'death',
                message: `${target.id} was killed by ${agent.id}!`
            });
            
            // Convert killed agent to meat corpse
            const corpseId = `corpse_${target.id}`;
            const meat = {
                id: corpseId,
                type: 'meat',
                pos: target.pos,
                energy: 50,
                decayTimer: 20,
                originalAgent: target.id,
                killedBy: agent.id,
            };
            
            // Remove dead agent
            const targetIndex = this.entities.indexOf(target);
            if (targetIndex > -1) {
                this.entities.splice(targetIndex, 1);
            }
            
            // Add meat corpse
            this.entities.push(meat);
            console.log(`  ${corpseId}: spawned at [${meat.pos}]`);
            
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
        const truncatedMessage = message.length > maxLength 
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
        
        console.log(`  ${agent.id}: said "${truncatedMessage}"`);
        
        // Broadcast to public stream
        this.broadcastPublic({
            type: 'talk',
            message: `${agent.id}: "${truncatedMessage}"`
        });
        
        return { 
            success: true, 
            message: `Said: "${truncatedMessage}"` 
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
        const truncatedText = textStr.length > maxLength 
            ? textStr.substring(0, maxLength) + '...' 
            : textStr;
        
        // Update agent's prompt (always displayed)
        const oldPrompt = agent.prompt || '';
        agent.prompt = truncatedText;
        
        console.log(`  ${agent.id}: updated prompt (${oldPrompt.length} -> ${truncatedText.length} chars)`);
        
        return { 
            success: true, 
            message: `Updated persistent prompt (${truncatedText.length} characters)` 
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
        const truncatedText = textStr.length > maxLength 
            ? textStr.substring(0, maxLength) + '...' 
            : textStr;
        
        // Update agent's notes (only visible when read)
        const oldNotes = agent.notes || '';
        agent.notes = truncatedText;
        
        console.log(`  ${agent.id}: updated notes (${oldNotes.length} -> ${truncatedText.length} chars)`);
        
        return { 
            success: true, 
            message: `Wrote to private notes (${truncatedText.length} characters)` 
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
        
        // Mating is VERY energy expensive (costs 40 energy for each parent)
        const matingCost = 40;
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
        const deadAgents = [];
        
        for (const entity of this.entities) {
            if (entity.type === 'agent') {
                entity.energy = Math.max(0, entity.energy - 1);
                
                // Immediate death at 0 energy
                if (entity.energy === 0) {
                    console.log(`  ${entity.id}: died of starvation`);
                    this.broadcastPublic({ 
                        type: 'death', 
                        message: `Agent ${entity.id} died of starvation` 
                    });
                    deadAgents.push(entity);
                }
            }
        }
        
        // Convert dead agents to meat
        for (const deadAgent of deadAgents) {
            const corpseId = `corpse_${deadAgent.id}`;
            const meat = {
                id: corpseId,
                type: 'meat',
                pos: deadAgent.pos,
                energy: 50, // Meat provides 50 energy
                decayTimer: 20, // Rots after 20 turns
                originalAgent: deadAgent.id,
            };
            
            // Remove dead agent
            const agentIndex = this.entities.indexOf(deadAgent);
            if (agentIndex > -1) {
                this.entities.splice(agentIndex, 1);
            }
            
            // Add meat corpse
            this.entities.push(meat);
            console.log(`  ${corpseId}: spawned at [${meat.pos}]`);
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
