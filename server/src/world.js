// World Server - Authoritative simulation
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
        
        // SSE clients
        this.publicClients = new Map();
        this.agentClients = new Map(); // agentId -> Map(clientId -> callback)
        this.surveillanceClients = new Map(); // agentId -> Map(clientId -> callback)
        
        // Find spawn points in the map (floor tiles)
        const spawnPoints = this.findSpawnPoints(5);
        
        // Initialize world with some agents at valid spawn points
        if (spawnPoints.length >= 2) {
            this.spawnAgent('a1', spawnPoints[0].x, spawnPoints[0].y);
            this.spawnAgent('a2', spawnPoints[1].x, spawnPoints[1].y);
        } else {
            console.warn('Not enough spawn points found, using fallback positions');
            this.spawnAgent('a1', 5, 5);
            this.spawnAgent('a2', 15, 10);
        }
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
        const map = [];
        for (let y = 0; y < height; y++) {
            let row = '';
            for (let x = 0; x < width; x++) {
                // Border walls
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    row += '#';
                } 
                // Random interior walls
                else if (this.rng() < 0.15) {
                    row += '#';
                }
                // Floor
                else {
                    row += '.';
                }
            }
            map.push(row);
        }
        return map;
    }
    
    spawnAgent(id, x, y) {
        this.entities.push({
            id,
            type: 'agent',
            pos: [x, y],
            hp: 100,
            hunger: 100,
        });
        this.broadcastPublic({ type: 'spawn', message: `Agent ${id} spawned` });
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
        
        // Process actions
        for (const agent of agents) {
            const action = this.actionQueue.get(agent.id);
            if (action) {
                this.applyAction(agent, action);
                this.actionQueue.delete(agent.id);
            } else {
                // Default to wait
                console.log(`  ${agent.id}: wait (no action)`);
            }
        }
        
        // Apply world effects
        this.applyHungerDecay();
        
        // Broadcast delta
        this.broadcastDelta();
    }
    
    computeObservation(agent) {
        // For MVP, give full visibility (we'll add LOS later)
        const visibleEntities = this.entities
            .filter(e => e.id !== agent.id)
            .map(e => ({
                id: e.id,
                type: e.type,
                pos: e.pos,
                hp: e.hp,
            }));
        
        return {
            turn_id: this.turnId,
            agent_id: agent.id,
            health: agent.hp,
            hunger: agent.hunger,
            visible_tiles: this.map,
            visible_entities: visibleEntities,
            recent_events: [],
            action_space: [
                { type: 'move', args: { dir: ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] } },
                { type: 'forage', args: {} },
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
        if (!['move', 'wait', 'forage'].includes(type)) {
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
    
    applyAction(agent, action) {
        if (action.type === 'move') {
            this.handleMove(agent, action.args.dir);
        } else if (action.type === 'forage') {
            this.handleForage(agent);
        }
        // wait does nothing
    }
    
    handleMove(agent, direction) {
        const [x, y] = agent.pos;
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
        
        const [dx, dy] = dirMap[direction] || [0, 0];
        const newX = x + dx;
        const newY = y + dy;
        
        // Check bounds
        if (newX < 0 || newX >= this.width || newY < 0 || newY >= this.height) {
            return;
        }
        
        // Check wall collision
        if (this.map[newY][newX] === '#') {
            return;
        }
        
        // Check entity collision
        const blocked = this.entities.some(e => 
            e.id !== agent.id && e.pos[0] === newX && e.pos[1] === newY
        );
        
        if (!blocked) {
            agent.pos = [newX, newY];
        }
    }
    
    handleForage(agent) {
        // Simple foraging: 50% chance to find food, restores 10-30 hunger
        const success = this.rng() < 0.5;
        
        if (success) {
            const foodAmount = Math.floor(this.rng() * 20) + 10; // 10-30
            agent.hunger = Math.min(100, agent.hunger + foodAmount);
            console.log(`  ${agent.id}: foraged +${foodAmount} hunger (now ${agent.hunger})`);
            this.broadcastPublic({
                type: 'forage',
                message: `${agent.id} found food (+${foodAmount} hunger)`
            });
        } else {
            console.log(`  ${agent.id}: foraged but found nothing`);
        }
    }
    
    applyHungerDecay() {
        for (const entity of this.entities) {
            if (entity.type === 'agent') {
                entity.hunger = Math.max(0, entity.hunger - 1);
                
                // Starvation damage
                if (entity.hunger === 0) {
                    entity.hp = Math.max(0, entity.hp - 1);
                    if (entity.hp === 0) {
                        this.broadcastPublic({ 
                            type: 'death', 
                            message: `Agent ${entity.id} died of starvation` 
                        });
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
        return {
            agent_id: agentId,
            events: this.telemetryByAgent.get(agentId) || [],
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
