#!/usr/bin/env bash
# Hits the demo API in a loop so the Grafana dashboard has something to show.
# Run: bash scripts/generate-traffic.sh
# Stop: Ctrl-C

set -euo pipefail

API="${API:-http://localhost:3001}"
echo "Generating traffic against $API ... (Ctrl-C to stop)"

while true; do
  curl -s "$API/health"      > /dev/null
  curl -s "$API/users"       > /dev/null
  curl -s "$API/users/1"     > /dev/null
  curl -s "$API/users/2"     > /dev/null
  curl -s "$API/users/999"   > /dev/null   # 404
  curl -s "$API/users/abc"   > /dev/null   # 400
  curl -s "$API/slow"        > /dev/null & # background, variable latency
  sleep 0.5
done
