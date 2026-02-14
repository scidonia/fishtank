// World Logger - SQLite persistence for Fish Tank worlds
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { WorldSummarizer } from './worldSummarizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorldLogger {
    constructor(runId = null) {
        this.runId = runId || this.generateRunId();
        this.summarizer = new WorldSummarizer();
        
        // Ensure data directory exists
        const dataDir = join(__dirname, '..', '..', 'data');
        try {
            mkdirSync(dataDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }
        
        const dbPath = join(dataDir, 'fishtank_worlds.db');
        this.db = new Database(dbPath);
        
        this.initDatabase();
        this.createRun();
        
        console.log(`✓ World Logger initialized: ${this.runId}`);
    }
    
    generateRunId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const random = Math.random().toString(36).substring(2, 8);
        return `run-${timestamp}-${random}`;
    }
    
    initDatabase() {
        // Create tables if they don't exist
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                total_turns INTEGER DEFAULT 0,
                total_births INTEGER DEFAULT 0,
                total_deaths INTEGER DEFAULT 0,
                total_murders INTEGER DEFAULT 0,
                tiles_explored INTEGER DEFAULT 0,
                world_summary TEXT,
                seed INTEGER,
                map_width INTEGER,
                map_height INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                turn INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                agent_id TEXT,
                target_id TEXT,
                position_x INTEGER,
                position_y INTEGER,
                data TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            );
            
            CREATE TABLE IF NOT EXISTS agent_lifespans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                birth_turn INTEGER NOT NULL,
                death_turn INTEGER,
                death_cause TEXT,
                parents TEXT,
                final_position_x INTEGER,
                final_position_y INTEGER,
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, turn);
            CREATE INDEX IF NOT EXISTS idx_agents_run ON agent_lifespans(run_id);
        `);
    }
    
    createRun() {
        const stmt = this.db.prepare(`
            INSERT INTO runs (run_id, start_time)
            VALUES (?, ?)
        `);
        stmt.run(this.runId, Date.now());
    }
    
    updateRunMetadata(metadata) {
        const updates = [];
        const params = [];
        
        if (metadata.seed !== undefined) {
            updates.push('seed = ?');
            params.push(metadata.seed);
        }
        if (metadata.mapWidth !== undefined) {
            updates.push('map_width = ?');
            params.push(metadata.mapWidth);
        }
        if (metadata.mapHeight !== undefined) {
            updates.push('map_height = ?');
            params.push(metadata.mapHeight);
        }
        
        if (updates.length > 0) {
            params.push(this.runId);
            const stmt = this.db.prepare(`
                UPDATE runs SET ${updates.join(', ')}
                WHERE run_id = ?
            `);
            stmt.run(...params);
        }
    }
    
    logEvent(turn, eventType, details = {}) {
        const stmt = this.db.prepare(`
            INSERT INTO events (run_id, turn, event_type, agent_id, target_id, position_x, position_y, data, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            this.runId,
            turn,
            eventType,
            details.agentId || null,
            details.targetId || null,
            details.x || null,
            details.y || null,
            JSON.stringify(details.data || {}),
            Date.now()
        );
    }
    
    logBirth(turn, agentId, parents, position) {
        this.logEvent(turn, 'birth', {
            agentId,
            data: { parents },
            x: position[0],
            y: position[1]
        });
        
        // Create agent lifespan record
        const stmt = this.db.prepare(`
            INSERT INTO agent_lifespans (run_id, agent_id, birth_turn, parents)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(this.runId, agentId, turn, JSON.stringify(parents || []));
        
        // Increment birth counter
        this.incrementCounter('total_births');
    }
    
    logDeath(turn, agentId, cause, position, wasKilled = false) {
        this.logEvent(turn, 'death', {
            agentId,
            data: { cause },
            x: position[0],
            y: position[1]
        });
        
        // Update agent lifespan
        const stmt = this.db.prepare(`
            UPDATE agent_lifespans
            SET death_turn = ?, death_cause = ?, final_position_x = ?, final_position_y = ?
            WHERE run_id = ? AND agent_id = ? AND death_turn IS NULL
        `);
        stmt.run(turn, cause, position[0], position[1], this.runId, agentId);
        
        // Increment counters
        this.incrementCounter('total_deaths');
        if (wasKilled) {
            this.incrementCounter('total_murders');
        }
    }
    
    logAttack(turn, attackerId, targetId, damage, targetHp, position) {
        this.logEvent(turn, 'attack', {
            agentId: attackerId,
            targetId,
            data: { damage, targetHp },
            x: position[0],
            y: position[1]
        });
    }
    
    updateExploredTiles(count) {
        const stmt = this.db.prepare(`
            UPDATE runs SET tiles_explored = ? WHERE run_id = ?
        `);
        stmt.run(count, this.runId);
    }
    
    updateTurnCount(turn) {
        const stmt = this.db.prepare(`
            UPDATE runs SET total_turns = ? WHERE run_id = ?
        `);
        stmt.run(turn, this.runId);
    }
    
    incrementCounter(counterName) {
        const stmt = this.db.prepare(`
            UPDATE runs SET ${counterName} = ${counterName} + 1 WHERE run_id = ?
        `);
        stmt.run(this.runId);
    }
    
    async endRun(summary = null) {
        // Generate summary if not provided
        if (!summary) {
            const runStats = this.getRunStats();
            const events = this.getRunEvents();
            const agents = this.getAgentLifespans();
            
            summary = await this.summarizer.generateSummary(runStats, events, agents);
        }
        
        const stmt = this.db.prepare(`
            UPDATE runs SET end_time = ?, world_summary = ? WHERE run_id = ?
        `);
        stmt.run(Date.now(), summary, this.runId);
        console.log(`✓ World run ended: ${this.runId}`);
    }
    
    getRunStats() {
        const stmt = this.db.prepare(`
            SELECT * FROM runs WHERE run_id = ?
        `);
        return stmt.get(this.runId);
    }
    
    getAllRuns() {
        const stmt = this.db.prepare(`
            SELECT * FROM runs ORDER BY start_time DESC
        `);
        return stmt.all();
    }
    
    getRunEvents(runId = null) {
        const stmt = this.db.prepare(`
            SELECT * FROM events WHERE run_id = ? ORDER BY turn, id
        `);
        return stmt.all(runId || this.runId);
    }
    
    getAgentLifespans(runId = null) {
        const stmt = this.db.prepare(`
            SELECT * FROM agent_lifespans WHERE run_id = ?
        `);
        return stmt.all(runId || this.runId);
    }
    
    close() {
        this.db.close();
    }
}
