import express from 'express';
import { WorldServer } from './world.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Initialize world server with large map
const world = new WorldServer({ seed: 42, mapFile: 'shared/map.txt' });

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
    res.json({ status: 'ok', turn: world.turnId });
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
