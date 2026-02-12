// Fish Tank Viewer - SSE Client with Viewport
const SERVER_URL = 'http://localhost:3000';

class WorldViewer {
    constructor() {
        this.canvas = document.getElementById('world-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.eventSource = null;
        this.worldState = null;
        this.tileSize = 32;
        
        // Viewport/Camera
        this.camera = { x: 0, y: 0 };
        this.followAgent = null;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        
        // Surveillance
        this.surveillanceEventSource = null;
        this.focusedAgentId = null;
        
        // Preload tiles
        this.tiles = {
            floor: [],
            wall: [],
            entities: {}
        };
        this.tilesLoaded = false;
        this.loadTiles();
        
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.setupEventListeners();
        this.startRenderLoop();
    }
    
    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width - 40; // Account for padding
        this.canvas.height = window.innerHeight - 200;
        
        if (this.worldState) {
            this.render();
        }
    }
    
    async loadTiles() {
        // Load floor tiles (0-7, only 8 variants available)
        for (let i = 0; i < 8; i++) {
            const img = new Image();
            img.src = `tiles/floor/grey_dirt_b_${i}.png`;
            this.tiles.floor.push(img);
        }
        
        // Load wall tiles (0-8, only 9 variants available)
        for (let i = 0; i < 9; i++) {
            const img = new Image();
            img.src = `tiles/wall/stone_black_marked${i}.png`;
            this.tiles.wall.push(img);
        }
        
        // Load entity sprites
        const entities = ['agent', 'rabbit', 'deer'];
        for (const entity of entities) {
            const img = new Image();
            img.src = `tiles/entities/${entity}.png`;
            this.tiles.entities[entity] = img;
        }
        
        // Wait for all to load
        await Promise.all([
            ...this.tiles.floor.map(img => new Promise(r => { img.onload = r; img.onerror = r; })),
            ...this.tiles.wall.map(img => new Promise(r => { img.onload = r; img.onerror = r; })),
            ...Object.values(this.tiles.entities).map(img => new Promise(r => { img.onload = r; img.onerror = r; }))
        ]);
        
        this.tilesLoaded = true;
        console.log('✓ Tiles loaded');
    }
    
    setupEventListeners() {
        // Connection
        document.getElementById('connect-btn').addEventListener('click', () => {
            if (this.eventSource) {
                this.disconnect();
            } else {
                this.connect();
            }
        });
        
        // Mouse controls for panning
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
        this.canvas.addEventListener('mouseleave', () => {
            this.handleMouseUp();
            this.hideTooltip();
        });
        
        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('zoom-out').addEventListener('click', () => this.zoom(0.8));
        
        // Follow agent toggle
        document.getElementById('follow-agent').addEventListener('click', () => {
            if (this.followAgent) {
                this.followAgent = null;
                document.getElementById('follow-agent').textContent = 'Follow Agent';
            } else {
                // Follow first agent
                const agent = this.worldState?.entities?.find(e => e.type === 'agent');
                if (agent) {
                    this.followAgent = agent.id;
                    document.getElementById('follow-agent').textContent = 'Free Camera';
                    this.centerOnAgent(agent);
                }
            }
        });
        
        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            const step = 5;
            if (e.key === 'ArrowUp') this.camera.y -= step;
            if (e.key === 'ArrowDown') this.camera.y += step;
            if (e.key === 'ArrowLeft') this.camera.x -= step;
            if (e.key === 'ArrowRight') this.camera.x += step;
        });
    }
    
    handleMouseDown(e) {
        this.isDragging = true;
        this.followAgent = null; // Stop following when dragging
        document.getElementById('follow-agent').textContent = 'Follow Agent';
        this.dragStart = {
            x: e.clientX + this.camera.x,
            y: e.clientY + this.camera.y
        };
    }
    
    handleMouseMove(e) {
        if (this.isDragging) {
            this.camera.x = this.dragStart.x - e.clientX;
            this.camera.y = this.dragStart.y - e.clientY;
            this.constrainCamera();
        } else {
            this.updateTooltip(e);
        }
    }
    
    handleMouseUp() {
        this.isDragging = false;
    }
    
    zoom(factor) {
        this.tileSize = Math.max(16, Math.min(64, this.tileSize * factor));
    }
    
    constrainCamera() {
        if (!this.worldState) return;
        
        const maxX = Math.max(0, this.worldState.map[0].length * this.tileSize - this.canvas.width);
        const maxY = Math.max(0, this.worldState.map.length * this.tileSize - this.canvas.height);
        
        this.camera.x = Math.max(0, Math.min(maxX, this.camera.x));
        this.camera.y = Math.max(0, Math.min(maxY, this.camera.y));
    }
    
    centerOnAgent(agent) {
        if (!agent) return;
        
        const [x, y] = agent.pos;
        this.camera.x = x * this.tileSize - this.canvas.width / 2 + this.tileSize / 2;
        this.camera.y = y * this.tileSize - this.canvas.height / 2 + this.tileSize / 2;
        this.constrainCamera();
    }
    
    connect() {
        console.log('Attempting to connect to:', `${SERVER_URL}/stream/public`);
        this.eventSource = new EventSource(`${SERVER_URL}/stream/public`);
        
        this.eventSource.addEventListener('snapshot', (e) => {
            console.log('Snapshot event received');
            const data = JSON.parse(e.data);
            this.handleSnapshot(data);
        });
        
        this.eventSource.addEventListener('delta', (e) => {
            const data = JSON.parse(e.data);
            this.handleDelta(data);
        });
        
        this.eventSource.addEventListener('public', (e) => {
            const data = JSON.parse(e.data);
            this.handlePublicEvent(data);
        });
        
        this.eventSource.onopen = () => {
            console.log('SSE connection opened');
            this.updateConnectionStatus(true);
        };
        
        this.eventSource.onerror = (err) => {
            console.error('SSE connection error:', err);
            this.updateConnectionStatus(false);
            this.disconnect();
        };
    }
    
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        // Close surveillance stream too
        if (this.surveillanceEventSource) {
            this.surveillanceEventSource.close();
            this.surveillanceEventSource = null;
        }
        this.focusedAgentId = null;
        
        this.updateConnectionStatus(false);
    }
    
    updateConnectionStatus(connected) {
        const status = document.getElementById('status');
        const btn = document.getElementById('connect-btn');
        
        if (connected) {
            status.textContent = 'Connected';
            status.classList.add('connected');
            btn.textContent = 'Disconnect';
        } else {
            status.textContent = 'Disconnected';
            status.classList.remove('connected');
            btn.textContent = 'Connect';
        }
    }
    
    handleSnapshot(data) {
        console.log('Snapshot received:', data.map?.length, 'x', data.map?.[0]?.length);
        console.log('Entities:', data.entities?.length);
        this.worldState = data;
        
        // Center camera on first agent
        if (data.entities && data.entities.length > 0) {
            const firstAgent = data.entities.find(e => e.type === 'agent');
            if (firstAgent) {
                console.log('Centering on agent:', firstAgent.id, 'at', firstAgent.pos);
                this.centerOnAgent(firstAgent);
                this.followAgent = firstAgent.id;
                document.getElementById('follow-agent').textContent = 'Free Camera';
            }
        }
        
        this.updateStats();
        this.updateSurveillance();
        console.log('Calling initial render...');
        this.render();
    }
    
    handleDelta(data) {
        if (!this.worldState) return;
        
        if (data.turn_id) this.worldState.turn_id = data.turn_id;
        if (data.entities) this.worldState.entities = data.entities;
        if (data.map) this.worldState.map = data.map;
        
        this.updateStats();
        this.updateSurveillance();
    }
    
    handlePublicEvent(data) {
        this.addEventToLog(data);
    }
    
    startRenderLoop() {
        const loop = () => {
            if (this.worldState) {
                // Follow agent if enabled
                if (this.followAgent) {
                    const agent = this.worldState.entities?.find(e => e.id === this.followAgent);
                    if (agent) {
                        this.centerOnAgent(agent);
                    }
                }
                
                this.render();
            }
            requestAnimationFrame(loop);
        };
        loop();
    }
    
    render() {
        if (!this.worldState) {
            console.log('Render skipped: no world state');
            return;
        }
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Calculate visible tile range
        const startTileX = Math.floor(this.camera.x / this.tileSize);
        const startTileY = Math.floor(this.camera.y / this.tileSize);
        const endTileX = Math.ceil((this.camera.x + this.canvas.width) / this.tileSize);
        const endTileY = Math.ceil((this.camera.y + this.canvas.height) / this.tileSize);
        
        // Render visible map tiles
        for (let ty = startTileY; ty <= endTileY; ty++) {
            if (ty < 0 || ty >= this.worldState.map.length) continue;
            
            const row = this.worldState.map[ty];
            for (let tx = startTileX; tx <= endTileX; tx++) {
                if (tx < 0 || tx >= row.length) continue;
                
                const tile = row[tx];
                this.renderTile(tx, ty, tile);
            }
        }
        
        // Render visible entities
        if (this.worldState.entities) {
            for (const entity of this.worldState.entities) {
                const [ex, ey] = entity.pos;
                if (ex >= startTileX && ex <= endTileX && ey >= startTileY && ey <= endTileY) {
                    this.renderEntity(entity);
                }
            }
        }
        
        // Render FOV for focused agent
        if (this.focusedAgentId) {
            this.renderFOV();
        }
        
        // Update camera info
        document.getElementById('camera-info').textContent = 
            `${Math.floor(this.camera.x / this.tileSize)}, ${Math.floor(this.camera.y / this.tileSize)}`;
    }
    
    renderTile(x, y, tile) {
        const px = x * this.tileSize - this.camera.x;
        const py = y * this.tileSize - this.camera.y;
        
        if (!this.tilesLoaded) {
            const colors = {
                '#': '#666',
                '.': '#333',
                ' ': '#000',
            };
            this.ctx.fillStyle = colors[tile] || '#444';
            this.ctx.fillRect(px, py, this.tileSize, this.tileSize);
            return;
        }
        
        if (tile === '#') {
            const variant = (x * 7 + y * 13) % this.tiles.wall.length;
            this.ctx.drawImage(this.tiles.wall[variant], px, py, this.tileSize, this.tileSize);
        } else if (tile === '.') {
            const variant = (x * 3 + y * 5) % this.tiles.floor.length;
            this.ctx.drawImage(this.tiles.floor[variant], px, py, this.tileSize, this.tileSize);
        } else {
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(px, py, this.tileSize, this.tileSize);
        }
    }
    
    renderEntity(entity) {
        const [x, y] = entity.pos;
        const px = x * this.tileSize - this.camera.x;
        const py = y * this.tileSize - this.camera.y;
        
        if (this.tilesLoaded && this.tiles.entities[entity.type]) {
            this.ctx.drawImage(this.tiles.entities[entity.type], px, py, this.tileSize, this.tileSize);
        } else {
            const colors = {
                'agent': '#4fc3f7',
                'rabbit': '#ffeb3b',
                'deer': '#ff9800',
            };
            
            const cx = px + this.tileSize / 2;
            const cy = py + this.tileSize / 2;
            
            this.ctx.fillStyle = colors[entity.type] || '#fff';
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, this.tileSize / 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        if (entity.hp !== undefined) {
            this.renderHealthBar(px + this.tileSize / 2, py + 2, entity.hp, 100);
        }
    }
    
    renderHealthBar(x, y, hp, maxHp) {
        const barWidth = this.tileSize - 4;
        const barHeight = 4;
        const fillWidth = (hp / maxHp) * barWidth;
        
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
        
        const hpColor = hp > 50 ? '#4caf50' : hp > 25 ? '#ff9800' : '#f44336';
        this.ctx.fillStyle = hpColor;
        this.ctx.fillRect(x - barWidth / 2, y, fillWidth, barHeight);
    }
    
    renderFOV() {
        if (!this.worldState || !this.worldState.entities) return;
        
        // Find the focused agent
        const agent = this.worldState.entities.find(e => e.id === this.focusedAgentId);
        if (!agent) return;
        
        const [agentX, agentY] = agent.pos;
        const fovRadius = 10; // 10 tile radius
        
        // Draw semi-transparent overlay on everything
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Clear the FOV circle (make it visible)
        const centerPx = agentX * this.tileSize - this.camera.x + this.tileSize / 2;
        const centerPy = agentY * this.tileSize - this.camera.y + this.tileSize / 2;
        const radiusPx = fovRadius * this.tileSize;
        
        // Use destination-out to "cut out" the FOV circle
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        this.ctx.beginPath();
        this.ctx.arc(centerPx, centerPy, radiusPx, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Reset composite operation
        this.ctx.globalCompositeOperation = 'source-over';
        
        // Draw FOV circle outline
        this.ctx.strokeStyle = '#4fc3f7';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(centerPx, centerPy, radiusPx, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Draw agent highlight
        this.ctx.strokeStyle = '#ff9800';
        this.ctx.lineWidth = 3;
        const agentPx = agentX * this.tileSize - this.camera.x;
        const agentPy = agentY * this.tileSize - this.camera.y;
        this.ctx.strokeRect(agentPx, agentPy, this.tileSize, this.tileSize);
    }
    
    updateTooltip(e) {
        if (this.isDragging) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + this.camera.x;
        const mouseY = e.clientY - rect.top + this.camera.y;
        
        const tileX = Math.floor(mouseX / this.tileSize);
        const tileY = Math.floor(mouseY / this.tileSize);
        
        if (!this.worldState || !this.worldState.entities) return;
        
        const entity = this.worldState.entities.find(e => e.pos[0] === tileX && e.pos[1] === tileY);
        
        if (entity) {
            this.showTooltip(e.clientX, e.clientY, entity);
        } else {
            this.hideTooltip();
        }
    }
    
    showTooltip(x, y, entity) {
        const tooltip = document.getElementById('hover-info');
        tooltip.style.display = 'block';
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
        tooltip.innerHTML = `
            <strong>${entity.type}</strong> (${entity.id})<br>
            HP: ${entity.hp}<br>
            ${entity.hunger !== undefined ? `Hunger: ${entity.hunger}` : ''}
        `;
    }
    
    hideTooltip() {
        document.getElementById('hover-info').style.display = 'none';
    }
    
    updateStats() {
        if (!this.worldState) return;
        
        document.getElementById('turn-id').textContent = this.worldState.turn_id || 0;
        document.getElementById('agent-count').textContent = 
            this.worldState.entities?.filter(e => e.type === 'agent').length || 0;
        document.getElementById('map-size').textContent = 
            `${this.worldState.map[0].length}×${this.worldState.map.length}`;
    }
    
    updateSurveillance() {
        if (!this.worldState) return;
        
        const agentList = document.getElementById('agent-list');
        const agents = this.worldState.entities?.filter(e => e.type === 'agent') || [];
        
        agentList.innerHTML = agents.map(agent => {
            const isFocused = this.focusedAgentId === agent.id;
            const isFollowing = this.followAgent === agent.id;
            return `
                <div class="agent-item ${isFocused ? 'active' : ''}" data-agent-id="${agent.id}">
                    <strong>${agent.id}</strong> ${isFocused ? '👁️' : ''}<br>
                    Position: ${agent.pos[0]}, ${agent.pos[1]}<br>
                    HP: ${agent.hp} | Hunger: ${agent.hunger}
                </div>
            `;
        }).join('');
        
        // Add click handlers
        document.querySelectorAll('.agent-item').forEach(item => {
            item.addEventListener('click', () => {
                const agentId = item.dataset.agentId;
                const agent = agents.find(a => a.id === agentId);
                if (agent) {
                    // Set focused agent for surveillance
                    this.setFocusedAgent(agentId);
                    
                    // Also follow camera
                    this.followAgent = agentId;
                    this.centerOnAgent(agent);
                    document.getElementById('follow-agent').textContent = 'Free Camera';
                    this.updateSurveillance();
                }
            });
        });
    }
    
    setFocusedAgent(agentId) {
        // Close existing surveillance stream
        if (this.surveillanceEventSource) {
            this.surveillanceEventSource.close();
            this.surveillanceEventSource = null;
        }
        
        // Clear log if switching agents
        if (this.focusedAgentId !== agentId) {
            const logList = document.getElementById('agent-log-list');
            logList.innerHTML = '';
        }
        
        this.focusedAgentId = agentId;
        
        // Open new surveillance stream
        const url = `${SERVER_URL}/stream/surveillance?agent_id=${agentId}`;
        this.surveillanceEventSource = new EventSource(url);
        
        this.surveillanceEventSource.addEventListener('snapshot', (e) => {
            const data = JSON.parse(e.data);
            // Display recent telemetry
            for (const event of data.events || []) {
                this.displayAgentLog(event);
            }
        });
        
        this.surveillanceEventSource.addEventListener('telemetry', (e) => {
            const data = JSON.parse(e.data);
            this.displayAgentLog(data);
        });
        
        this.surveillanceEventSource.onerror = () => {
            console.error('Surveillance stream error for', agentId);
        };
        
        console.log(`Surveillance stream opened for ${agentId}`);
    }
    
    displayAgentLog(event) {
        const logList = document.getElementById('agent-log-list');
        const logEntry = document.createElement('div');
        
        const phase = event.phase || 'unknown';
        logEntry.className = `log-entry ${phase} ${event.ok === false ? 'failed' : ''}`;
        
        let content = '';
        
        if (phase === 'obs') {
            content = `
                <div class="log-phase">📡 Turn ${event.turn_id}</div>
                <div class="log-stats">HP: ${event.health} | Hunger: ${event.hunger} | Visible: ${event.visible_entity_count}</div>
            `;
        } else if (phase === 'decision') {
            content = `
                <div class="log-phase">🧠 Decision</div>
                ${event.reasoning ? `<div class="log-reasoning">"${event.reasoning}"</div>` : ''}
                <div class="log-action">→ ${event.action.type} ${JSON.stringify(event.action.args)}</div>
                <div class="log-stats">Prompt: ${event.prompt_chars} chars | Response: ${event.response_chars} chars</div>
            `;
        } else if (phase === 'result') {
            if (event.ok) {
                content = `<div class="log-phase">✓ Action Accepted</div>`;
            } else {
                content = `
                    <div class="log-phase">✗ Action Rejected</div>
                    <div class="log-error">${event.error}</div>
                `;
            }
        }
        
        logEntry.innerHTML = content;
        
        // Add to top of log
        logList.insertBefore(logEntry, logList.firstChild);
        
        // Keep only last 100 entries
        while (logList.children.length > 100) {
            logList.removeChild(logList.lastChild);
        }
    }
    
    addEventToLog(event) {
        const eventList = document.getElementById('event-list');
        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        
        if (event.type) {
            eventItem.classList.add(event.type);
        }
        
        eventItem.textContent = event.message || JSON.stringify(event);
        
        eventList.insertBefore(eventItem, eventList.firstChild);
        
        while (eventList.children.length > 50) {
            eventList.removeChild(eventList.lastChild);
        }
    }
}

// Initialize viewer
const viewer = new WorldViewer();
