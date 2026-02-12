#!/bin/bash
# Stop all Fish Tank processes and free up ports

echo "🛑 Stopping Fish Tank..."

# Kill by process name
pkill -f "node src/index.js" 2>/dev/null && echo "✓ Killed node server" || echo "  No node server running"
pkill -f "python -m http.server 8080" 2>/dev/null && echo "✓ Killed viewer server" || echo "  No viewer server running"

# Kill by port (more aggressive)
if lsof -ti:3000 > /dev/null 2>&1; then
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    echo "✓ Freed port 3000"
fi

if lsof -ti:8080 > /dev/null 2>&1; then
    lsof -ti:8080 | xargs kill -9 2>/dev/null
    echo "✓ Freed port 8080"
fi

echo ""
echo "All processes stopped. Ports 3000 and 8080 are now free."
