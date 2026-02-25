const AUTH0_DOMAIN = window.FISHTANK_CONFIG?.auth0Domain || 'your-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = window.FISHTANK_CONFIG?.auth0ClientId || '';
const API = window.FISHTANK_CONFIG?.serverUrl || '';
const TILE_BASE = 'tiles/entities/';

let auth0Client = null;
let currentUser = null;
let serverUser = null;
let currentRun = null;
let myBets = [];
let bettingActiveTab = 'bet';
let bettingSseSource = null;
let metaInterval = null;

// ── Entry point (called once when Betting tab is first opened) ─────────────────

async function initBetting() {
    const auth0Available = await window._auth0Promise;
    if (!auth0Available) {
        const el = document.getElementById('loading');
        if (el) el.innerHTML = '<p style="color:#aaa;padding:2rem">Betting requires a secure (HTTPS) connection.</p>';
        return;
    }
    auth0Client = await auth0.createAuth0Client({
        domain: AUTH0_DOMAIN,
        clientId: AUTH0_CLIENT_ID,
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
        authorizationParams: {
            redirect_uri: window.location.origin + '/betting.html',
            audience: `https://${AUTH0_DOMAIN}/api/v2/`,
            scope: 'openid profile email',
        },
    });

    // Handle redirect callback after login
    if (window.location.search.includes('code=') || window.location.search.includes('error=')) {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const isAuthenticated = await auth0Client.isAuthenticated();

    if (isAuthenticated) {
        currentUser = await auth0Client.getUser();
        await onLoggedIn();
    } else {
        showLoginPrompt();
    }
}

// ── Auth ───────────────────────────────────────────────────────────────────────

async function bettingLogin() {
    await auth0Client.loginWithRedirect();
}

async function bettingLogout() {
    await auth0Client.logout({ logoutParams: { returnTo: window.location.origin + '/betting.html' } });
}

function showLoginPrompt() {
    document.getElementById('login-prompt').style.display = 'block';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('login-btn').style.display = 'inline-block';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('user-info').textContent = '';
}

// ── After login ────────────────────────────────────────────────────────────────

async function onLoggedIn() {
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'inline-block';
    document.getElementById('user-info').textContent = currentUser.name || currentUser.email || '';
    document.getElementById('login-prompt').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const token = await getToken();
    const res = await apiFetch('/api/user', {
        method: 'POST',
        body: JSON.stringify({
            display_name: currentUser.name || currentUser.nickname || currentUser.email,
            email: currentUser.email,
        }),
    }, token);
    if (res.ok) serverUser = await res.json();

    await refreshAll();

    if (!metaInterval) metaInterval = setInterval(refreshMeta, 30000);
    connectBettingSSE();
}

async function getToken() {
    return auth0Client.getTokenSilently();
}

// ── Data loading ───────────────────────────────────────────────────────────────

async function refreshAll() {
    await Promise.all([
        loadCurrentRun(),
        loadServerUser(),
        bettingActiveTab === 'history' ? loadHistory() : Promise.resolve(),
        bettingActiveTab === 'leaderboard' ? loadLeaderboard() : Promise.resolve(),
    ]);
    renderPointsBanner();
    if (bettingActiveTab === 'bet') renderAgentsGrid();
}

async function refreshMeta() {
    await Promise.all([
        loadServerUser(),
        loadMyBets(),
        bettingActiveTab === 'history' ? loadHistory() : Promise.resolve(),
        bettingActiveTab === 'leaderboard' ? loadLeaderboard() : Promise.resolve(),
    ]);
    renderPointsBanner();
}

async function loadServerUser() {
    try {
        const token = await getToken();
        const res = await apiFetch('/api/user', {}, token);
        if (res.ok) serverUser = await res.json();
    } catch (_) {}
}

async function loadMyBets() {
    try {
        const token = await getToken();
        const res = await apiFetch('/api/betting/mybets', {}, token);
        if (res.ok) myBets = await res.json();
    } catch (_) {}
}

async function loadCurrentRun() {
    try {
        const res = await apiFetch('/api/betting/current');
        if (res.ok) {
            currentRun = await res.json();
            await loadMyBets();
        }
    } catch (_) {}
}

async function loadHistory() {
    try {
        const token = await getToken();
        const res = await apiFetch('/api/betting/history', {}, token);
        if (!res.ok) return;
        const bets = await res.json();
        const tbody = document.getElementById('history-tbody');
        tbody.innerHTML = bets.map(b => {
            const potential = b.amount * b.competitor_count;
            const status = b.resolved_at === null
                ? `<span class="pending">Pending</span>`
                : b.won ? `<span class="won">Won</span>` : `<span class="lost">Lost</span>`;
            const payout = b.payout !== null ? `+${b.payout}` : '—';
            const shortRun = b.run_id.slice(4, 19);
            return `<tr>
                <td title="${b.run_id}">${shortRun}</td>
                <td>${b.agent_id}</td>
                <td>${b.amount}</td>
                <td>${b.competitor_count}</td>
                <td>${potential}×</td>
                <td>${status}</td>
                <td class="${b.won ? 'won' : b.resolved_at ? 'lost' : ''}">${payout}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="7" style="color:#4a7a9b;text-align:center;padding:24px">No bets yet</td></tr>';
    } catch (_) {}
}

async function loadLeaderboard() {
    try {
        const res = await apiFetch('/api/betting/leaderboard');
        if (!res.ok) return;
        const rows = await res.json();
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = rows.map((r, i) => {
            const isMe = serverUser && r.user_id === serverUser.user_id;
            return `<div class="leaderboard-row ${isMe ? 'me' : ''}">
                <div class="rank">#${i + 1}</div>
                <div class="lb-name">${escHtml(r.display_name || r.user_id)}</div>
                <div class="lb-record">${r.wins}W / ${r.total_bets - r.wins}L</div>
                <div class="lb-points">${r.points} pts</div>
            </div>`;
        }).join('') || '<div style="color:#4a7a9b;padding:24px;text-align:center">No players yet</div>';
    } catch (_) {}
}

// ── SSE ────────────────────────────────────────────────────────────────────────

function connectBettingSSE() {
    if (bettingSseSource) bettingSseSource.close();
    bettingSseSource = new EventSource(`${API}/stream/public`);

    bettingSseSource.addEventListener('snapshot', e => applySnapshot(JSON.parse(e.data)));
    bettingSseSource.addEventListener('delta', e => applyDelta(JSON.parse(e.data)));

    bettingSseSource.onerror = () => {
        if (bettingSseSource && bettingSseSource.readyState === EventSource.CLOSED) {
            bettingSseSource = null;
            setTimeout(connectBettingSSE, 3000);
        }
    };
}

function applySnapshot(snap) {
    if (!currentRun) currentRun = { agents: [] };
    currentRun.turn = snap.turn_id ?? currentRun.turn;
    const agents = (snap.entities || []).filter(e => e.type === 'agent');
    currentRun.agents = agents.map(entityToAgent);
    currentRun.alive_count = currentRun.agents.length;
    renderPointsBanner();
    if (bettingActiveTab === 'bet') renderAgentsGrid();
}

function applyDelta(delta) {
    if (!currentRun) return;
    if (delta.turn_id !== undefined) {
        currentRun.turn = delta.turn_id;
        renderPointsBanner();
    }
    if (!delta.entities) return;

    const incoming = delta.entities.filter(e => e.type === 'agent');
    const incomingIds = new Set(incoming.map(e => e.id));
    let structuralChange = false;

    // Remove dead agents
    const before = currentRun.agents.length;
    currentRun.agents = currentRun.agents.filter(a => incomingIds.has(a.id));
    if (currentRun.agents.length !== before) structuralChange = true;

    // Update / add
    for (const e of incoming) {
        const idx = currentRun.agents.findIndex(a => a.id === e.id);
        const updated = entityToAgent(e);
        if (idx === -1) {
            currentRun.agents.push(updated);
            structuralChange = true;
        } else {
            Object.assign(currentRun.agents[idx], updated);
            if (bettingActiveTab === 'bet') updateAgentCard(currentRun.agents[idx]);
        }
    }

    currentRun.alive_count = currentRun.agents.length;
    if (structuralChange && bettingActiveTab === 'bet') renderAgentsGrid();
}

function entityToAgent(e) {
    return {
        id: e.id, avatar: e.avatar, generation: e.generation, parents: e.parents,
        hp: e.hp, energy: e.energy, prompt: e.prompt || '',
        inventory: (e.inventory || []).length, pos: e.pos,
    };
}

// ── Bayesian odds ─────────────────────────────────────────────────────────────

/**
 * Compute HP-weighted win probability for each agent (Bayesian prior).
 * Returns a Map of agentId -> probability (0-1).
 */
function computeOdds(agents) {
    const totalHp = agents.reduce((s, a) => s + Math.max(0, a.hp ?? 0), 0);
    const odds = new Map();
    for (const a of agents) {
        odds.set(a.id, totalHp > 0 ? Math.max(0, a.hp ?? 0) / totalHp : 1 / agents.length);
    }
    return odds;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function renderPointsBanner() {
    const pd = document.getElementById('points-display');
    const ri = document.getElementById('run-info');
    if (pd) pd.textContent = serverUser ? serverUser.points : '—';
    if (ri && currentRun) {
        ri.innerHTML = `Run: <span style="color:#7cb9e8">${currentRun.run_id ? currentRun.run_id.slice(4, 19) : '—'}</span><br>` +
            `Turn: ${currentRun.turn ?? '?'} &nbsp;|&nbsp; Survivors: ${currentRun.alive_count ?? '?'}`;
    }
}

function renderAgentsGrid() {
    if (!currentRun) return;
    const focused = document.activeElement;
    if (focused && focused.tagName === 'INPUT' && focused.id && focused.id.startsWith('amt-')) return;
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    const betMap = new Map(myBets.map(b => [b.agent_id, b]));
    const aliveIds = new Set(currentRun.agents.map(a => a.id));
    const odds = computeOdds(currentRun.agents);

    // Build a children map so we can tell if an agent already has live children
    const childrenAlive = new Map(); // agentId -> count of alive children
    for (const a of currentRun.agents) {
        if (a.parents) {
            for (const pid of a.parents) {
                childrenAlive.set(pid, (childrenAlive.get(pid) || 0) + 1);
            }
        }
    }

    grid.innerHTML = currentRun.agents.map(agent => {
        const existingBet = betMap.get(agent.id);
        const avatarSrc = `${TILE_BASE}${(agent.avatar || agent.id).replace(/\.png$/i, '')}.png`;
        const gen = agent.generation > 0 ? `gen ${agent.generation}` : 'gen 0';
        const hpPct = Math.max(0, Math.min(100, agent.hp ?? 100));
        const enPct = Math.max(0, Math.min(100, agent.energy ?? 100));
        const hpCol = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
        const enCol = enPct > 50 ? '#4fc3f7' : enPct > 25 ? '#ff9800' : '#f44336';
        const pct = ((odds.get(agent.id) || 0) * 100).toFixed(1);
        const oddsCol = pct >= 20 ? '#4caf50' : pct >= 8 ? '#ffd54f' : '#f44336';

        const liveChildren = childrenAlive.get(agent.id) || 0;
        let parentNote = '';
        if (liveChildren > 0) {
            parentNote = `<div class="odds-note">Already a parent — children don't count</div>`;
        } else if (agent.generation === 0 || agent.parents) {
            // Could still have children in future
            parentNote = `<div class="odds-note">Future children split this bet</div>`;
        }

        return `<div class="agent-card${existingBet ? ' already-bet' : ''}" id="card-${agent.id}">
            ${existingBet ? `<div class="bet-badge">Bet: ${existingBet.amount}pts</div>` : ''}
            <div class="avatar-wrap"><img src="${avatarSrc}" onerror="this.style.display='none'" alt="${agent.id}"></div>
            <div class="agent-name">${escHtml(agent.id)}</div>
            <div class="agent-meta">${gen}${agent.parents ? ' · born' : ''}</div>
            <div class="agent-bars">
                <div class="bar-row">
                    <span class="bar-label">HP</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${hpPct}%;background:${hpCol}"></div></div>
                    <span class="bar-val">${agent.hp ?? '?'}</span>
                </div>
                <div class="bar-row">
                    <span class="bar-label">EN</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${enPct}%;background:${enCol}"></div></div>
                    <span class="bar-val">${agent.energy ?? '?'}</span>
                </div>
            </div>
            <div class="agent-inv">Inventory: ${agent.inventory ?? 0} items</div>
            ${agent.prompt
                ? `<div class="agent-prompt">${escHtml(agent.prompt)}</div>`
                : `<div class="agent-prompt no-prompt">No prompt set</div>`}
            <div class="odds" style="color:${oddsCol}">${pct}% chance</div>
            ${parentNote}
            ${existingBet ? '' : `
                <div class="bet-form">
                    <input type="number" id="amt-${agent.id}" min="1" max="${serverUser ? serverUser.points : 100}" value="10" placeholder="pts">
                    <button class="primary" onclick="placeBet('${agent.id}')">Bet</button>
                </div>`}
        </div>`;
    }).join('') || '<div style="color:#4a7a9b;padding:40px;text-align:center;grid-column:1/-1">No survivors in current run</div>';
}

function updateAgentCard(agent) {
    const card = document.getElementById(`card-${agent.id}`);
    if (!card) { renderAgentsGrid(); return; }

    const hpPct = Math.max(0, Math.min(100, agent.hp ?? 100));
    const enPct = Math.max(0, Math.min(100, agent.energy ?? 100));
    const hpCol = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
    const enCol = enPct > 50 ? '#4fc3f7' : enPct > 25 ? '#ff9800' : '#f44336';

    const bars = card.querySelectorAll('.bar-row');
    if (bars[0]) {
        bars[0].querySelector('.bar-fill').style.cssText = `width:${hpPct}%;background:${hpCol}`;
        bars[0].querySelector('.bar-val').textContent = agent.hp ?? '?';
    }
    if (bars[1]) {
        bars[1].querySelector('.bar-fill').style.cssText = `width:${enPct}%;background:${enCol}`;
        bars[1].querySelector('.bar-val').textContent = agent.energy ?? '?';
    }
    const inv = card.querySelector('.agent-inv');
    if (inv) inv.textContent = `Inventory: ${agent.inventory ?? 0} items`;
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function placeBet(agentId) {
    const input = document.getElementById(`amt-${agentId}`);
    const amount = parseInt(input ? input.value : 10);
    if (!amount || amount < 1) return bettingShowStatus('Enter a valid amount', 'error');

    const token = await getToken();
    const res = await apiFetch('/api/betting/bet', {
        method: 'POST',
        body: JSON.stringify({ agent_id: agentId, amount }),
    }, token);

    const data = await res.json();
    if (!res.ok) return bettingShowStatus(data.error || 'Bet failed', 'error');

    bettingShowStatus(`Bet placed on ${agentId} for ${amount} pts`, 'success');
    await refreshAll();
}

// ── Inner tabs ─────────────────────────────────────────────────────────────────

function bettingSwitchTab(name) {
    bettingActiveTab = name;
    document.querySelectorAll('#app .tabs .tab-btn').forEach((t, i) => {
        t.classList.toggle('active', ['bet', 'history', 'leaderboard'][i] === name);
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'history') loadHistory();
    if (name === 'leaderboard') loadLeaderboard();
}

// ── Utilities ──────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}, token = null) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API}${path}`, { ...options, headers });
}

function bettingShowStatus(msg, type = 'info') {
    const el = document.getElementById('status-msg');
    if (!el) return;
    el.innerHTML = `<div class="msg ${type}">${escHtml(msg)}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Boot
initBetting().catch(err => {
    const el = document.getElementById('loading');
    if (el) el.textContent = 'Failed to initialise: ' + err.message;
    console.error(err);
});
