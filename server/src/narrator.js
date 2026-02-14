import axios from 'axios';

export class Narrator {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.enabled = !!this.apiKey;
        this.recentNarrations = []; // Keep last 50 narrations
        this.maxRecentNarrations = 50;
        
        if (!this.enabled) {
            console.warn('⚠️  Narrator disabled (DEEPSEEK_API_KEY not set)');
        } else {
            console.log('✓ Narrator enabled');
        }
    }
    
    /**
     * Generate a narrative summary of a turn's events
     * @param {number} turnId - Turn number
     * @param {Array} events - Public events from the turn
     * @param {Array} agentActions - Agent actions this turn
     * @returns {Promise<string>} - Narrative text or null if disabled
     */
    async narrateTurn(turnId, events, agentActions) {
        if (!this.enabled) {
            return null;
        }
        
        // Build context from events
        const context = this.buildContext(turnId, events, agentActions);
        
        // If nothing interesting happened, skip narration
        if (context.trim().length < 20) {
            return null;
        }
        
        const prompt = `You are a narrator for an AI agent simulation called Fish Tank. Based on the following events from Turn ${turnId}, write a brief, engaging 1-2 sentence narrative that captures the most interesting moments.

Be dramatic and literary. Focus on conflict, cooperation, discovery, or survival. Use vivid language.

EVENTS:
${context}

Write a compelling 1-2 sentence narrative (max 150 characters):`;

        try {
            const response = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat', // Can use deepseek-reasoner for faster/cheaper
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 80,
                    temperature: 0.8,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 5000, // 5 second timeout
                }
            );
            
            const narrative = response.data.choices[0].message.content.trim();
            
            // Store for later retrieval
            this.recentNarrations.push({
                turn: turnId,
                text: narrative,
                timestamp: Date.now()
            });
            
            // Trim old narrations
            if (this.recentNarrations.length > this.maxRecentNarrations) {
                this.recentNarrations = this.recentNarrations.slice(-this.maxRecentNarrations);
            }
            
            return narrative;
            
        } catch (error) {
            console.error(`Narrator error (turn ${turnId}):`, error.message);
            return null;
        }
    }
    
    /**
     * Build context string from turn events
     */
    buildContext(turnId, events, agentActions) {
        const lines = [];
        
        // Safety check
        if (!events || !Array.isArray(events)) {
            events = [];
        }
        
        // Combat events
        const combatEvents = events.filter(e => e.type === 'combat');
        if (combatEvents.length > 0) {
            lines.push('COMBAT:');
            combatEvents.forEach(event => {
                lines.push(`  - ${event.message}`);
            });
        }
        
        // Death events
        const deathEvents = events.filter(e => e.type === 'death');
        if (deathEvents.length > 0) {
            lines.push('DEATHS:');
            deathEvents.forEach(event => {
                lines.push(`  - ${event.message}`);
            });
        }
        
        // Talk events (sample a few interesting ones)
        const talkEvents = events.filter(e => e.type === 'talk');
        if (talkEvents.length > 0) {
            lines.push('COMMUNICATION:');
            // Sample up to 3 messages
            talkEvents.slice(0, 3).forEach(event => {
                lines.push(`  - ${event.message}`);
            });
        }
        
        // Agent action summary (only interesting actions)
        if (agentActions && agentActions.length > 0) {
            const interestingActions = agentActions.filter(a => 
                ['attack', 'mate', 'give'].includes(a.action?.type)
            );
            
            if (interestingActions.length > 0) {
                lines.push('ACTIONS:');
                interestingActions.forEach(a => {
                    const actor = a.agent?.id || 'unknown';
                    const action = a.action?.type || 'unknown';
                    const target = a.action?.args?.target_id || a.action?.args?.partner_id;
                    
                    if (target) {
                        lines.push(`  - ${actor}: ${action} -> ${target}`);
                    } else {
                        lines.push(`  - ${actor}: ${action}`);
                    }
                });
            }
        }
        
        return lines.join('\n');
    }
    
    /**
     * Get recent narrations
     */
    getRecentNarrations(limit = 20) {
        return this.recentNarrations.slice(-limit);
    }
}
