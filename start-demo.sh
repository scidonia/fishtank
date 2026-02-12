#!/bin/bash
# Quick start script for Fish Tank demo

set -e

echo "🐠 Fish Tank - Starting Demo"
echo "================================"
echo ""

# Kill any existing processes
echo "Cleaning up any existing processes..."
pkill -f "node src/index.js" 2>/dev/null || true
pkill -f "python -m http.server 8080" 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
sleep 1

# Start world server
echo "Starting world server on port 3000..."
cd server
npm start > /tmp/fishtank-server.log 2>&1 &
SERVER_PID=$!
cd ..

# Wait for server to be ready
echo "Waiting for server to be ready..."
for i in {1..10}; do
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "✓ Server is ready!"
        break
    fi
    sleep 1
done

# Start viewer HTTP server
echo "Starting viewer on port 8080..."
cd viewer
python -m http.server 8080 > /tmp/fishtank-viewer.log 2>&1 &
VIEWER_PID=$!
cd ..

echo ""
echo "✓ Fish Tank is running!"
echo ""
echo "═══════════════════════════════════════"
echo "  World Server: http://localhost:3000"
echo "  Viewer:       http://localhost:8080"
echo "═══════════════════════════════════════"
echo ""
echo "To run agents in new terminals:"
echo "  uv run agent --agent-id scout"
echo "  uv run agent --agent-id nomad"
echo "  uv run agent --agent-id warden"
echo ""
echo "Press Ctrl+C to stop all processes"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $SERVER_PID 2>/dev/null || true
    kill $VIEWER_PID 2>/dev/null || true
    pkill -f "node src/index.js" 2>/dev/null || true
    pkill -f "python -m http.server 8080" 2>/dev/null || true
    echo "✓ Stopped"
    exit 0
}

trap cleanup INT TERM

# Wait for interrupt
wait
