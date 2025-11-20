#!/bin/sh

# Start Caddy in the background
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# Start Node Server in the background
cd /app/server
node ./bin/www &
NODE_PID=$!

# Loop to check if processes are running
while kill -0 $CADDY_PID 2>/dev/null && kill -0 $NODE_PID 2>/dev/null; do
    sleep 1
done

# If we get here, one of them exited.
echo "One of the processes exited."
exit 1
