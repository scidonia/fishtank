import axios from 'axios';

export class WorldSummarizer {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
    }
    
    /**
     * Generate a narrative summary of a world run using LLM
     * @param {Object} runStats - Statistics from the runs table
     * @param {Array} events - All events from the run
     * @param {Array} agents - Agent lifespan data
     * @returns {Promise<string>} - Generated narrative summary
     */
    async generateSummary(runStats, events, agents) {
        if (!this.apiKey) {
            console.warn('DEEPSEEK_API_KEY not set, skipping world summary generation');
            return null;
        }
        
        // Build context from data
        const context = this.buildContext(runStats, events, agents);
        
        const prompt = `You are a historian documenting the events of a simulated world called Fish Tank, where AI agents survive, cooperate, fight, and reproduce.

Given the following data about a completed world run, write a compelling 2-3 sentence narrative summary that captures the most interesting events and outcomes. Focus on drama, conflict, cooperation, and notable agent behaviors.

WORLD DATA:
${context}

Write a brief but engaging summary (2-3 sentences max) that tells the story of what happened in this world. Focus on the most dramatic or interesting events.`;

        try {
            const response = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 200,
                    temperature: 0.8,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000, // 10 second timeout
                }
            );
            
            const summary = response.data.choices[0].message.content.trim();
            console.log(`✓ Generated world summary: ${summary.substring(0, 80)}...`);
            return summary;
            
        } catch (error) {
            console.error('Failed to generate world summary:', error.message);
            return null;
        }
    }
    
    /**
     * Build a context string from run data
     */
    buildContext(runStats, events, agents) {
        const lines = [];
        
        // Basic stats
        lines.push(`Duration: ${runStats.total_turns} turns`);
        lines.push(`Map: ${runStats.map_width}x${runStats.map_height} (${runStats.tiles_explored} tiles explored)`);
        lines.push(`Births: ${runStats.total_births}, Deaths: ${runStats.total_deaths}, Murders: ${runStats.total_murders}`);
        lines.push('');
        
        // Event summary
        const attackEvents = events.filter(e => e.event_type === 'attack');
        const deathEvents = events.filter(e => e.event_type === 'death');
        const birthEvents = events.filter(e => e.event_type === 'birth');
        
        if (attackEvents.length > 0) {
            lines.push(`COMBAT: ${attackEvents.length} attacks recorded`);
            
            // Count attacks by aggressor
            const attackers = {};
            attackEvents.forEach(event => {
                attackers[event.agent_id] = (attackers[event.agent_id] || 0) + 1;
            });
            
            // Most aggressive agents
            const topAggressors = Object.entries(attackers)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
            
            topAggressors.forEach(([agent, count]) => {
                lines.push(`  - ${agent}: ${count} attacks`);
            });
            lines.push('');
        }
        
        if (deathEvents.length > 0) {
            lines.push(`DEATHS: ${deathEvents.length} total`);
            const combatDeaths = deathEvents.filter(e => {
                const data = JSON.parse(e.data);
                return data.wasKilled;
            });
            const starvationDeaths = deathEvents.length - combatDeaths.length;
            lines.push(`  - Combat: ${combatDeaths.length}`);
            lines.push(`  - Starvation: ${starvationDeaths}`);
            lines.push('');
        }
        
        if (birthEvents.length > 0) {
            lines.push(`BIRTHS: ${birthEvents.length} new agents born`);
            birthEvents.forEach(event => {
                const data = JSON.parse(event.data);
                lines.push(`  - ${event.agent_id} (parents: ${data.parents.join(', ')})`);
            });
            lines.push('');
        }
        
        // Agent lifespans
        if (agents.length > 0) {
            lines.push(`AGENT LIFESPANS:`);
            agents.forEach(agent => {
                const lifespan = agent.death_turn ? 
                    `${agent.death_turn - agent.birth_turn} turns (${agent.death_cause})` : 
                    'survived';
                lines.push(`  - ${agent.agent_id}: ${lifespan}`);
            });
        }
        
        return lines.join('\n');
    }
}
