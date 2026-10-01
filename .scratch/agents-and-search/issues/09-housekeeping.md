# Housekeeping found while checking the account

Status: needs-triage
Type: task

- Production still runs the build from before 2026-10-01 16:00: deployed API keys are refused (fixed in 2a5b47798)
  until production is deployed again. Deploying it is the user's call.
- `draft-worker` is deployed in the account and is not this project's. Delete only if the user confirms.
- Rotate the Neon and PlanetScale passwords that appeared in chat.
- The observability MCP cannot list cron events (they carry no requestId); use grouped calculations instead.
- 2026-10-01: the account hit Workers AI's FREE daily allocation (10,000 neurons, error 4006) during testing.
  Production has the same cap: roughly 200 language-model calls a day, then every AI feature fails until 00:00 UTC.
  Upgrading to Workers Paid lifts it (usage billed per neuron beyond the included amount). The user's decision.
