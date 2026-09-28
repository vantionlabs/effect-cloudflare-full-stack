#!/usr/bin/env bash
#
# Interim infrastructure management, standing in for alchemy.run.ts until Alchemy supports
# effect rc.118 (see docs/runbooks/PatchingEffectDeps.md).
#
# This is not a step backwards from IaC: the desired state is declared here and in
# apps/worker/wrangler.jsonc, both committed and reviewable. What it lacks versus Alchemy is
# typed bindings and a real dependency graph — not reproducibility.
#
#   ./scripts/infra.sh plan     # default: report current vs desired, create nothing
#   ./scripts/infra.sh apply    # create what is missing (idempotent)
#
# `plan` is read-only and safe to run at any time. `apply` COSTS MONEY — a PlanetScale
# cluster bills daily from creation until deletion.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-plan}"
W="bunx wrangler"

# ─── desired state ────────────────────────────────────────────────────────────────────────
HYPERDRIVE_NAME="effect-ai-pg"
R2_BUCKET="effect-ai-documents"
KV_NAMESPACE="effect-ai-sessions"
QUEUE_NAME="effect-ai-events"
QUEUE_DLQ="effect-ai-events-dlq"

blue() { printf "\033[34m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
amber() { printf "\033[33m%s\033[0m\n" "$1"; }

exists() { # exists <list-command> <name>
  eval "$1" 2>/dev/null | grep -qF "$2"
}

report() { # report <label> <name> <found>
  if [ "$3" = "yes" ]; then green "  ✓ $1 '$2' exists"; else amber "  + $1 '$2' would be CREATED"; fi
}

blue "Cloudflare account:"
$W whoami 2>/dev/null | grep -E "^│ .*│ [0-9a-f]{32}" || true
echo

blue "Desired state vs current:"

R2_FOUND=no;  exists "$W r2 bucket list" "$R2_BUCKET"   && R2_FOUND=yes
KV_FOUND=no;  exists "$W kv namespace list" "$KV_NAMESPACE" && KV_FOUND=yes
Q_FOUND=no;   exists "$W queues list" "$QUEUE_NAME"     && Q_FOUND=yes
DLQ_FOUND=no; exists "$W queues list" "$QUEUE_DLQ"      && DLQ_FOUND=yes
HD_FOUND=no;  exists "$W hyperdrive list" "$HYPERDRIVE_NAME" && HD_FOUND=yes

report "R2 bucket"       "$R2_BUCKET"     "$R2_FOUND"
report "KV namespace"    "$KV_NAMESPACE"  "$KV_FOUND"
report "Queue"           "$QUEUE_NAME"    "$Q_FOUND"
report "Queue (DLQ)"     "$QUEUE_DLQ"     "$DLQ_FOUND"
report "Hyperdrive"      "$HYPERDRIVE_NAME" "$HD_FOUND"

echo
if [ "$HD_FOUND" = "no" ]; then
  amber "Hyperdrive needs a Postgres to point at. Create the PlanetScale cluster FIRST —"
  amber "from the Cloudflare dashboard so it bills to this account — then set DATABASE_URL"
  amber "and re-run. PS-5 single node is \$5/mo and bills daily from creation."
fi

if [ "$MODE" != "apply" ]; then
  echo
  blue "plan only — nothing was created. Run './scripts/infra.sh apply' to create the above."
  exit 0
fi

# ─── apply ────────────────────────────────────────────────────────────────────────────────
echo
blue "Applying. Each step is idempotent; existing resources are left untouched."

[ "$R2_FOUND"  = yes ] || $W r2 bucket create "$R2_BUCKET"
[ "$KV_FOUND"  = yes ] || $W kv namespace create "$KV_NAMESPACE"
[ "$DLQ_FOUND" = yes ] || $W queues create "$QUEUE_DLQ"
[ "$Q_FOUND"   = yes ] || $W queues create "$QUEUE_NAME" --dead-letter-queue "$QUEUE_DLQ"

if [ "$HD_FOUND" = no ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    amber "Skipping Hyperdrive: DATABASE_URL is not set."
    amber "  DATABASE_URL='postgresql://…' ./scripts/infra.sh apply"
  else
    # Direct connection string, not a pooled one: Hyperdrive does the pooling, and pooler
    # transaction mode would break @effect/sql-pg's named prepared statements.
    $W hyperdrive create "$HYPERDRIVE_NAME" --connection-string="$DATABASE_URL"
  fi
fi

echo
green "Done. Copy the printed ids into apps/worker/wrangler.jsonc, then commit them."
