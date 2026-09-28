#!/usr/bin/env bash
#
# Post-deploy smoke test. Shared by staging and production so they cannot drift.
#
# A deploy that returns 200 but reports `degraded` has lost pgvector or Dutch stemming,
# which breaks retrieval SILENTLY: rail 1 turns every missed clause into `needs_human`, so
# the queue fills with work a human must do while the service looks healthy. That is worth
# failing a deploy over.
set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url>}"

for attempt in 1 2 3 4 5; do
  if body=$(curl -fsS --max-time 20 "$BASE/api/v1/health"); then
    break
  fi
  echo "attempt $attempt/5 failed; the Worker may still be propagating"
  sleep 5
done

if [ -z "${body:-}" ]; then
  echo "✗ health endpoint never responded at $BASE"
  exit 1
fi

echo "$body"

if ! grep -q '"status":"ok"' <<<"$body"; then
  echo "✗ health is not ok — see the database block above"
  exit 1
fi

# Assert the capabilities individually so the failure names itself rather than just "degraded".
grep -q '"dutch_stemming":true' <<<"$body" || { echo "✗ Dutch stemming unavailable"; exit 1; }
grep -q '"pgvector_version":"' <<<"$body" || { echo "✗ pgvector unavailable"; exit 1; }

echo "✓ $BASE is healthy"
