#!/bin/bash
# Startup script for no-prompt-1 experiment
# Run agents with minimal personality guidance

set -e

echo "🧪 Starting no-prompt-1 experiment"
echo "   Goal: Measure murders, children, and lifespan with minimal prompting"
echo ""

# Check if DeepSeek API key is set
if [ -z "$DEEPSEEK_API_KEY" ]; then
    echo "❌ ERROR: DEEPSEEK_API_KEY environment variable not set"
    echo "   Please set it with: export DEEPSEEK_API_KEY='your-key'"
    exit 1
fi

# Start the server in background
echo "🌍 Starting world server..."
MAX_TURNS=500 node server/src/index.js > /tmp/fishtank-no-prompt-1-server.log 2>&1 &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# Wait for server to be ready
echo "   Waiting for server to start..."
sleep 3

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ ERROR: Server failed to start"
    echo "   Check logs: tail -f /tmp/fishtank-no-prompt-1-server.log"
    exit 1
fi

echo "   ✓ Server ready"
echo ""

# Launch agents from config
echo "🐟 Launching agents..."
python launcher.py --config no-prompt-1.yaml

echo ""
echo "🎯 Experiment running!"
echo "   Config: no-prompt-1.yaml"
echo "   Max turns: 500"
echo "   Server log: /tmp/fishtank-no-prompt-1-server.log"
echo "   Agent logs: /tmp/*.log"
echo ""
echo "📊 To check progress:"
echo "   curl http://localhost:3000/health"
echo ""
echo "🛑 To stop experiment:"
echo "   ./stop-all.sh"
echo ""
echo "📈 After experiment completes, extract metrics with:"
echo "   python -c 'from server.src.worldLogger import WorldLogger; import json; wl = WorldLogger(); runs = wl.getAllRuns(); print(json.dumps(runs[0], indent=2))'"
