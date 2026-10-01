# Model usage: why the free quota ran out, and how tests stop spending it

Status: needs-triage
Type: task

Measured 2026-10-01 from the AI Gateway logs (uncached, successful calls that day): production gateway 204, dev 94,
staging 0 — about 300 calls × 35–55 neurons (Llama 3.3 70B, ~1k input tokens) ≈ 13,000 neurons, over the free
10,000/day. Error 4006 from Workers AI ("used up your daily free allocation") until the user upgrades to Workers Paid.

Where it went:

- The browser suite calls the REAL model in ~10 of 39 tests; an Insights question is a 2–4 call tool loop, an Ask
  question up to 4. Full suite ran ~6× today, plus four forks running their AI specs and screenshot scripts.
- CI runs the same suite on every push — from GitHub's US runners (LAX in the logs) — and **through the PRODUCTION
  gateway**, because `preview:e2e` builds from the top-level wrangler config (the same mistake fixed for local dev).
- The gateway's 1-hour cache absorbed many repeats; that is also why some AI tests kept passing after the quota went.

Production meaning: on the free plan, ~200 language-model calls a day — one person's 50–70 questions — exhausts it.

Do:

1. Default the browser suite to the scripted model (free, deterministic); tag the ~10 real-model specs and run them
   on a schedule or before a production deploy.
2. Point CI's e2e build at the dev gateway (`AI_GATEWAY`/`CLOUDFLARE_AI_GATEWAY`).
3. Later, measured: a smaller model for single-step jobs (an email to a quote), the 70B where answers carry citations.
