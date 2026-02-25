import express from 'express';
import { WorldServer } from './world.js';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Initialize world server with large map
const MAX_TURNS = process.env.MAX_TURNS ? parseInt(process.env.MAX_TURNS) : 1000;
const MATING_COST = process.env.MATING_COST !== undefined ? parseInt(process.env.MATING_COST, 10) : 0;
const world = new WorldServer({ 
    seed: 42, 
    mapFile: 'shared/map.txt',
    maxTurns: MAX_TURNS,
    matingCost: MATING_COST,
});

// Auth0 JWT verification
const AUTH0_DOMAIN = 'your-tenant.eu.auth0.com';
const AUTH0_AUDIENCE = `https://${AUTH0_DOMAIN}/api/v2/`;

const jwks = jwksClient({
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
});

function getKey(header, callback) {
    jwks.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
    });
}

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing token' });
    }
    const token = authHeader.slice(7);
    jwt.verify(token, getKey, {
        algorithms: ['RS256'],
        issuer: `https://${AUTH0_DOMAIN}/`,
    }, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token', detail: err.message });
        req.user = decoded;
        next();
    });
}

if (MAX_TURNS) {
    console.log(`⏰ Run will end after ${MAX_TURNS} turns`);
}
console.log(`💕 Mating cost: ${MATING_COST} energy per parent`);

// SSE endpoint for public stream
app.get('/stream/public', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Send snapshot on connect
    const snapshot = world.getSnapshot();
    res.write(`event: snapshot\n`);
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    // Register client for deltas
    const clientId = world.registerPublicClient((event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    });

    req.on('close', () => {
        world.unregisterPublicClient(clientId);
    });
});

// SSE endpoint for agent-specific observations
app.get('/stream/agent', (req, res) => {
    const agentId = req.query.agent_id;
    
    if (!agentId) {
        return res.status(400).json({ error: 'agent_id required' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const clientId = world.registerAgentClient(agentId, (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    });

    req.on('close', () => {
        world.unregisterAgentClient(agentId, clientId);
    });
});

// Agent registration endpoint - spawns agent into world on demand
app.post('/register', (req, res) => {
    const { agent_id, avatar } = req.body;

    if (!agent_id) {
        return res.status(400).json({ error: 'agent_id required' });
    }

    const result = world.spawnAgent(agent_id, null, null, null, avatar || null);
    if (result === null) {
        // Already exists - that's fine, just reconnecting
        return res.json({ ok: true, status: 'already_exists' });
    }
    res.json({ ok: true, status: 'spawned' });
});

// Action submission endpoint
app.post('/act', (req, res) => {
    const { agent_id, turn_id, type, args } = req.body;

    if (!agent_id || turn_id === undefined || !type) {
        return res.json({ ok: false, error: 'Missing required fields' });
    }

    const result = world.submitAction(agent_id, turn_id, type, args || {});
    res.json(result);
});

// Telemetry submission endpoint
app.post('/telemetry', (req, res) => {
    const { agent_id, ...event } = req.body;
    
    if (!agent_id) {
        return res.status(400).json({ error: 'agent_id required' });
    }
    
    world.storeTelemetry(agent_id, event);
    res.json({ ok: true });
});

// SSE endpoint for agent surveillance (focused agent logs)
app.get('/stream/surveillance', (req, res) => {
    const agentId = req.query.agent_id;
    
    if (!agentId) {
        return res.status(400).json({ error: 'agent_id required' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Send snapshot of recent telemetry on connect
    const snapshot = world.getSurveillanceSnapshot(agentId);
    res.write(`event: snapshot\n`);
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    // Register client for new telemetry events
    const clientId = world.registerSurveillanceClient(agentId, (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    });

    req.on('close', () => {
        world.unregisterSurveillanceClient(agentId, clientId);
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', turn: world.turnId, paused: world.paused });
});

app.post('/pause', (req, res) => {
    world.pause();
    res.json({ ok: true, paused: true, turn: world.turnId });
});

app.post('/resume', (req, res) => {
    world.resume();
    res.json({ ok: true, paused: false, turn: world.turnId });
});

// Force end the current round and start a new one
app.post('/reset', async (req, res) => {
    console.log('\n🔁 Manual reset requested...');
    res.json({ ok: true, message: 'Resetting world...' });
    await world.logger.endRun().catch(err => console.error('Error ending run:', err));
    await world.resetWorld();
});

// Narrator submission endpoint
app.post('/narrate', (req, res) => {
    const { turn, text } = req.body;
    
    if (turn === undefined || !text) {
        return res.status(400).json({ error: 'Missing turn or text' });
    }
    
    // Broadcast narrative to all viewers with dedicated event type
    world.broadcastNarrative({
        turn,
        text
    });
    
    res.json({ ok: true });
});

// Archaeology API - Get all past runs
app.get('/api/runs', (req, res) => {
    try {
        const runs = world.logger.getAllRuns();
        res.json(runs);
    } catch (error) {
        console.error('Error fetching runs:', error);
        res.status(500).json({ error: 'Failed to fetch runs' });
    }
});

// Archaeology API - Get specific run details
app.get('/api/runs/:runId', (req, res) => {
    try {
        const { runId } = req.params;
        const events = world.logger.getRunEvents(runId);
        const agents = world.logger.getAgentLifespans(runId);
        res.json({ events, agents });
    } catch (error) {
        console.error('Error fetching run details:', error);
        res.status(500).json({ error: 'Failed to fetch run details' });
    }
});

// ── Betting API ───────────────────────────────────────────────────────────────

// Upsert user on login (called by frontend after Auth0 login)
app.post('/api/user', requireAuth, (req, res) => {
    try {
        const userId = req.user.sub;
        const displayName = req.body.display_name || req.user.name || req.user.email || userId;
        const email = req.user.email || req.body.email || null;
        const user = world.logger.upsertUser(userId, displayName, email);
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user profile + points
app.get('/api/user', requireAuth, (req, res) => {
    try {
        const user = world.logger.getUser(req.user.sub);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current run info + alive agents (for betting UI)
app.get('/api/betting/current', (req, res) => {
    try {
        const snapshot = world.getSnapshot();
        const aliveAgents = snapshot.entities
            .filter(e => e.type === 'agent')
            .map(e => ({
                id: e.id,
                avatar: e.avatar,
                generation: e.generation,
                parents: e.parents,
                hp: e.hp,
                energy: e.energy,
                prompt: e.prompt || '',
                inventory: (e.inventory || []).length,
                pos: e.pos,
            }));
        res.json({
            run_id: world.logger.runId,
            turn: world.turnId,
            alive_count: aliveAgents.length,
            agents: aliveAgents,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Place a bet
app.post('/api/betting/bet', requireAuth, (req, res) => {
    try {
        const { agent_id, amount } = req.body;
        if (!agent_id || !amount) return res.status(400).json({ error: 'agent_id and amount required' });

        const snapshot = world.getSnapshot();
        const aliveCount = snapshot.entities.filter(e => e.type === 'agent').length;
        const agentExists = snapshot.entities.some(e => e.id === agent_id && e.type === 'agent');
        if (!agentExists) return res.status(400).json({ error: 'Agent not found in current run' });

        const result = world.logger.placeBet(
            req.user.sub,
            world.logger.runId,
            agent_id,
            parseInt(amount),
            aliveCount
        );
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get user's bets for current run
app.get('/api/betting/mybets', requireAuth, (req, res) => {
    try {
        const bets = world.logger.getUserBetsForRun(req.user.sub, world.logger.runId);
        res.json(bets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user's full bet history
app.get('/api/betting/history', requireAuth, (req, res) => {
    try {
        const bets = world.logger.getUserBets(req.user.sub);
        res.json(bets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Leaderboard (public)
app.get('/api/betting/leaderboard', (req, res) => {
    try {
        res.json(world.logger.getLeaderboard());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🐠 Fish Tank Server running on http://localhost:${PORT}`);
    console.log(`   Public stream:     http://localhost:${PORT}/stream/public`);
    console.log(`   Agent stream:      http://localhost:${PORT}/stream/agent?agent_id=<id>`);
    console.log(`   Surveillance:      http://localhost:${PORT}/stream/surveillance?agent_id=<id>`);
    console.log(`   Telemetry submit:  POST http://localhost:${PORT}/telemetry`);
    
    // Start the turn loop
    world.start();
});

// Graceful shutdown handler
async function shutdown() {
    console.log('\n\nShutting down gracefully...');
    world.running = false; // Stop turn loop
    
    try {
        await world.logger.endRun();
        console.log('World run saved to database.');
    } catch (error) {
        console.error('Error saving world run:', error);
    }
    
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
    // Don't exit — log and continue. Most rejections are recoverable (network, LLM).
});

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
    // Exit — unknown state, better to restart cleanly.
    process.exit(1);
});
