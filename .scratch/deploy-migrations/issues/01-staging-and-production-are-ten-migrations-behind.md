# Staging and production are ten migrations behind, and no deploy notices

Status: ready-for-human — the fix is written; it needs three secrets before it can run

Implemented (fix steps 2 and 3, folded together): `deploy.yml` migrates `dev`, `staging` and `production` before
their deploys and FAILS when the environment's `DATABASE_URL` secret is absent; `db:migrate` fails unless the
database records every migration in the manifest (proved on a throwaway database with one record row removed:
`24 recorded, 25 in this build`, exit 1). What remains is the human part: add `DATABASE_URL` (the Neon project's
DIRECT connection string) to the `dev`, `staging` and `production` GitHub environments. The first staging deploy
after that applies 16–25 to dev and staging; production catches up on its next dispatch.

## What is true (read 2026-10-01 from `effect_sql_migrations`, via the Neon MCP)

| database               | latest applied | missing |
| ---------------------- | -------------- | ------- |
| `effect-ai-production` | 15             | 16–25   |
| `effect-ai-staging`    | 15             | 16–25   |
| `effect-ai-dev`        | 22             | 23–25   |
| compose container      | 25             | —       |

Production confirmed table by table: no `apikey`, no `messages`, no `events.workflow_instance_id`. So in
production today **API-key authentication, chat, and the decide-queue handoff to the Workflow all fail** —
the last at the moment the consumer records the instance id. `usage_records` (0025) would join the list: once
the metering code deploys, every upload and every decision claim writes a meter row in its own transaction, so
without the table uploads fail outright.

## Why nothing caught it

`deploy.yml` has no migrate step, and the smoke test calls `/api/v1/health`, which touches none of these
tables. Every deploy has been green. Migrations reached staging and production by hand, and stopped at 15.

## Fix

1. Apply 16–25 to staging, then production: `DATABASE_URL=<that project's direct URL> bun run db:migrate`
   (the script prints the host first — read it).
2. Add a migrate step to `deploy.yml` before each Worker deploy, with per-environment `DATABASE_URL` secrets.
   Every migration is `if not exists`, and `effect_sql_migrations` records each once, so it is safe to run on
   every deploy.
3. Make the smoke test touch the schema — `db:verify` already reports the migration count; failing a deploy
   when it is behind the code's manifest would have caught this at 16.
