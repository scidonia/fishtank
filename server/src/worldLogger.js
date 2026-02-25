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
        
        // Ensure data directory exists.
        // DATA_DIR env var lets deployments redirect the SQLite DB to a
        // writable state directory (e.g. /var/lib/fishtank) without needing
        // write access to the Nix store package path.
        const dataDir = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');
        try {
            mkdirSync(dataDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }
        
        const dbPath = join(dataDir, 'fishtank_worlds.db');
        this.db = new Database(dbPath);
        
        this.initDatabase();
        this.closeStaleRuns();
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
                map_height INTEGER,
                mating_cost INTEGER
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

            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,   -- Auth0 sub (e.g. "auth0|abc123")
                display_name TEXT,
                email TEXT,
                points INTEGER NOT NULL DEFAULT 100,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,          -- the agent being bet on
                amount INTEGER NOT NULL,
                competitor_count INTEGER NOT NULL, -- alive agents when bet was placed
                placed_at INTEGER NOT NULL,
                resolved_at INTEGER,
                won INTEGER,                      -- 1 = won, 0 = lost, NULL = pending
                payout INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(user_id),
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            );

            CREATE INDEX IF NOT EXISTS idx_bets_run ON bets(run_id);
            CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
        `);

        // Migrate: add mating_cost column if missing (for existing DBs)
        const columns = this.db.prepare(`PRAGMA table_info(runs)`).all();
        if (!columns.find(c => c.name === 'mating_cost')) {
            this.db.exec(`ALTER TABLE runs ADD COLUMN mating_cost INTEGER`);
        }
    }
    
    closeStaleRuns() {
        // Close any runs left open by a previous crash
        const result = this.db.prepare(
            `UPDATE runs SET end_time = ? WHERE end_time IS NULL`
        ).run(Date.now());
        if (result.changes > 0) {
            console.log(`⚠️  Closed ${result.changes} stale run(s) from previous crash`);
        }
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
        if (metadata.matingCost !== undefined) {
            updates.push('mating_cost = ?');
            params.push(metadata.matingCost);
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
    
    // ── User management ──────────────────────────────────────────────────────

    upsertUser(userId, displayName, email) {
        const existing = this.db.prepare(`SELECT user_id FROM users WHERE user_id = ?`).get(userId);
        if (existing) {
            this.db.prepare(`UPDATE users SET display_name = ?, email = ? WHERE user_id = ?`)
                .run(displayName, email, userId);
        } else {
            this.db.prepare(`INSERT INTO users (user_id, display_name, email, points, created_at) VALUES (?, ?, ?, 100, ?)`)
                .run(userId, displayName, email, Date.now());
        }
        return this.db.prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);
    }

    getUser(userId) {
        return this.db.prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);
    }

    // ── Betting ───────────────────────────────────────────────────────────────

    placeBet(userId, runId, agentId, amount, competitorCount) {
        const user = this.getUser(userId);
        if (!user) throw new Error('User not found');
        if (user.points < amount) throw new Error('Insufficient points');
        if (amount < 1) throw new Error('Bet amount must be at least 1');

        // Check user hasn't already bet on this agent in this run
        const existing = this.db.prepare(
            `SELECT id FROM bets WHERE user_id = ? AND run_id = ? AND agent_id = ?`
        ).get(userId, runId, agentId);
        if (existing) throw new Error('Already bet on this agent in this run');

        this.db.prepare(`UPDATE users SET points = points - ? WHERE user_id = ?`).run(amount, userId);
        const result = this.db.prepare(`
            INSERT INTO bets (user_id, run_id, agent_id, amount, competitor_count, placed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, runId, agentId, amount, competitorCount, Date.now());

        return { betId: result.lastInsertRowid, pointsRemaining: user.points - amount };
    }

    getBetsForRun(runId) {
        return this.db.prepare(`SELECT * FROM bets WHERE run_id = ?`).all(runId);
    }

    getUserBetsForRun(userId, runId) {
        return this.db.prepare(`SELECT * FROM bets WHERE user_id = ? AND run_id = ?`).all(userId, runId);
    }

    getUserBets(userId) {
        return this.db.prepare(`
            SELECT b.*, r.start_time, r.end_time, r.total_turns
            FROM bets b
            JOIN runs r ON b.run_id = r.run_id
            WHERE b.user_id = ?
            ORDER BY b.placed_at DESC
        `).all(userId);
    }

    /**
     * Resolve all pending bets for a run.
     * winningLineage: Set of agent IDs that are winners (survivors + their descendants).
     * Payout = amount * competitorCount (the odds when the bet was placed).
     */
    resolveBets(runId, winningLineage) {
        const bets = this.db.prepare(`SELECT * FROM bets WHERE run_id = ? AND resolved_at IS NULL`).all(runId);
        const now = Date.now();

        for (const bet of bets) {
            const won = winningLineage.has(bet.agent_id) ? 1 : 0;
            const payout = won ? bet.amount * bet.competitor_count : 0;

            this.db.prepare(`
                UPDATE bets SET resolved_at = ?, won = ?, payout = ? WHERE id = ?
            `).run(now, won, payout, bet.id);

            if (won && payout > 0) {
                this.db.prepare(`UPDATE users SET points = points + ? WHERE user_id = ?`)
                    .run(payout, bet.user_id);
            }
        }

        return bets.length;
    }

    getLeaderboard() {
        return this.db.prepare(`
            SELECT user_id, display_name, points,
                   (SELECT COUNT(*) FROM bets WHERE user_id = u.user_id AND won = 1) as wins,
                   (SELECT COUNT(*) FROM bets WHERE user_id = u.user_id AND resolved_at IS NOT NULL) as total_bets
            FROM users u
            ORDER BY points DESC
            LIMIT 50
        `).all();
    }

    close() {
        this.db.close();
    }
}
