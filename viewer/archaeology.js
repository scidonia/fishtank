// Archaeology - View past world runs

let selectedRunId = null;

// Format timestamp to readable date
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Ongoing';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Format duration in seconds
function formatDuration(startTime, endTime) {
    if (!endTime) return 'Ongoing';
    const durationMs = endTime - startTime;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Load all runs from the server
async function loadRuns() {
    try {
        const response = await fetch(`${SERVER_URL}/api/runs`);
        const runs = await response.json();
        
        const runsList = document.getElementById('archaeology-runs-list');
        runsList.innerHTML = '';
        
        if (runs.length === 0) {
            runsList.innerHTML = '<div class="no-runs">No world runs found. Start the server to create a new run.</div>';
            return;
        }
        
        // Sort by start time descending (newest first)
        runs.sort((a, b) => b.start_time - a.start_time);
        
        runs.forEach(run => {
            const runCard = document.createElement('div');
            runCard.className = 'archaeology-run-card';
            if (selectedRunId === run.run_id) {
                runCard.classList.add('selected');
            }
            
            const isOngoing = !run.end_time;
            const statusClass = isOngoing ? 'status-ongoing' : 'status-ended';
            const statusText = isOngoing ? '🟢 LIVE' : '⚫ ENDED';
            
            runCard.innerHTML = `
                <div class="run-header">
                    <span class="run-status ${statusClass}">${statusText}</span>
                    <span class="run-id">${run.run_id}</span>
                </div>
                <div class="run-stats">
                    <div class="stat">
                        <span class="stat-label">Turns:</span>
                        <span class="stat-value">${run.total_turns}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Births:</span>
                        <span class="stat-value">${run.total_births}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Deaths:</span>
                        <span class="stat-value">${run.total_deaths}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Murders:</span>
                        <span class="stat-value">${run.total_murders}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Explored:</span>
                        <span class="stat-value">${run.tiles_explored} tiles</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Mate cost:</span>
                        <span class="stat-value">${run.mating_cost ?? '?'} energy</span>
                    </div>
                </div>
                <div class="run-time">
                    <div>Started: ${formatTimestamp(run.start_time)}</div>
                    <div>Duration: ${formatDuration(run.start_time, run.end_time)}</div>
                </div>
                ${run.world_summary ? `<div class="run-summary">${run.world_summary}</div>` : ''}
            `;
            
            runCard.addEventListener('click', () => selectRun(run.run_id));
            runsList.appendChild(runCard);
        });
        
    } catch (error) {
        console.error('Failed to load runs:', error);
        document.getElementById('archaeology-runs-list').innerHTML = 
            '<div class="error">Failed to load runs. Is the server running?</div>';
    }
}

// Select a run and load its details
async function selectRun(runId) {
    selectedRunId = runId;
    
    // Update UI selection
    document.querySelectorAll('.archaeology-run-card').forEach(card => {
        card.classList.remove('selected');
        if (card.querySelector('.run-id').textContent === runId) {
            card.classList.add('selected');
        }
    });
    
    // Hide welcome message
    document.getElementById('archaeology-welcome').style.display = 'none';
    
    // Load run details
    await loadRunDetails(runId);
}

// Load detailed events for a specific run
async function loadRunDetails(runId) {
    try {
        const response = await fetch(`${SERVER_URL}/api/runs/${runId}`);
        const data = await response.json();
        
        const detailsPanel = document.getElementById('run-details-panel');
        detailsPanel.style.display = 'block';
        
        // Display events
        displayEvents(data.events);
        
        // Display agent lifespans
        displayAgentLifespans(data.agents);
        
    } catch (error) {
        console.error('Failed to load run details:', error);
        document.getElementById('run-details-panel').innerHTML = 
            '<div class="error">Failed to load run details.</div>';
    }
}

// Display events timeline
function displayEvents(events) {
    const eventsList = document.getElementById('run-events-list');
    eventsList.innerHTML = '';
    
    if (events.length === 0) {
        eventsList.innerHTML = '<div class="no-events">No events recorded for this run.</div>';
        return;
    }
    
    // Group events by turn
    const eventsByTurn = {};
    events.forEach(event => {
        if (!eventsByTurn[event.turn]) {
            eventsByTurn[event.turn] = [];
        }
        eventsByTurn[event.turn].push(event);
    });
    
    // Display events grouped by turn
    Object.keys(eventsByTurn).sort((a, b) => b - a).forEach(turn => {
        const turnGroup = document.createElement('div');
        turnGroup.className = 'turn-group';
        turnGroup.innerHTML = `<h4>Turn ${turn}</h4>`;
        
        eventsByTurn[turn].forEach(event => {
            const eventItem = document.createElement('div');
            eventItem.className = `event-item event-${event.event_type}`;
            
            if (event.event_type === 'attack') {
                const data = JSON.parse(event.data);
                eventItem.innerHTML = `
                    <span class="event-icon">⚔️</span>
                    <span class="event-text">
                        <strong>${event.agent_id}</strong> attacked <strong>${event.target_id}</strong> 
                        for ${data.damage} damage at [${event.position_x}, ${event.position_y}]
                        (${data.targetHp} HP remaining)
                    </span>
                `;
            } else if (event.event_type === 'death') {
                const data = JSON.parse(event.data);
                const icon = data.wasKilled ? '💀' : '☠️';
                const cause = data.wasKilled ? 'killed in combat' : 'died of starvation';
                eventItem.innerHTML = `
                    <span class="event-icon">${icon}</span>
                    <span class="event-text">
                        <strong>${event.agent_id}</strong> ${cause} at [${event.position_x}, ${event.position_y}]
                    </span>
                `;
            } else if (event.event_type === 'birth') {
                const data = JSON.parse(event.data);
                eventItem.innerHTML = `
                    <span class="event-icon">👶</span>
                    <span class="event-text">
                        <strong>${event.agent_id}</strong> was born at [${event.position_x}, ${event.position_y}]
                        (parents: ${data.parents.join(', ')})
                    </span>
                `;
            }
            
            turnGroup.appendChild(eventItem);
        });
        
        eventsList.appendChild(turnGroup);
    });
}

// Display agent lifespans
function displayAgentLifespans(agents) {
    const lifespansList = document.getElementById('run-lifespans-list');
    lifespansList.innerHTML = '';
    
    if (agents.length === 0) {
        lifespansList.innerHTML = '<div class="no-agents">No agent births/deaths recorded.</div>';
        return;
    }
    
    agents.forEach(agent => {
        const agentItem = document.createElement('div');
        agentItem.className = 'lifespan-item';
        
        const parents = agent.parents ? JSON.parse(agent.parents) : [];
        const parentText = parents.length > 0 ? `Parents: ${parents.join(', ')}` : 'Initial spawn';
        const deathText = agent.death_turn ? 
            `Died turn ${agent.death_turn} (${agent.death_cause})` : 
            'Still alive';
        const lifespan = agent.death_turn ? 
            `${agent.death_turn - agent.birth_turn} turns` : 
            'Ongoing';
        
        agentItem.innerHTML = `
            <div class="lifespan-header">
                <strong>${agent.agent_id}</strong>
                <span class="lifespan-duration">${lifespan}</span>
            </div>
            <div class="lifespan-details">
                <div>Born: Turn ${agent.birth_turn}</div>
                <div>${parentText}</div>
                <div>${deathText}</div>
                ${agent.final_position_x !== null ? 
                    `<div>Final position: [${agent.final_position_x}, ${agent.final_position_y}]</div>` : 
                    ''}
            </div>
        `;
        
        lifespansList.appendChild(agentItem);
    });
}

// Initialize archaeology viewer
function initArchaeology() {
    loadRuns();
    
    // Auto-refresh every 5 seconds if viewing ongoing run
    setInterval(() => {
        if (selectedRunId) {
            // Check if selected run is still ongoing
            loadRunDetails(selectedRunId);
        }
        loadRuns();
    }, 5000);
}

// Export for use in main HTML
window.initArchaeology = initArchaeology;
