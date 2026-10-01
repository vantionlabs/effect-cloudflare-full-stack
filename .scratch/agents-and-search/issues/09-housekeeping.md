# Housekeeping found while checking the account

Status: needs-triage
Type: task

- Production still runs the build from before 2026-10-01 16:00: deployed API keys are refused (fixed in 2a5b47798)
  until production is deployed again. Deploying it is the user's call.
- `draft-worker` is deployed in the account and is not this project's. Delete only if the user confirms.
- Rotate the Neon and PlanetScale passwords that appeared in chat.
- The observability MCP cannot list cron events (they carry no requestId); use grouped calculations instead.
