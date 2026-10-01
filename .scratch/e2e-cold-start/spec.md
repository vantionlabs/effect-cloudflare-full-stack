# The browser suite pays a dev-server cost

One issue, logged 2026-10-01 after raising two Playwright budgets in an hour for the same underlying reason.
The suite runs against `vite dev`, which compiles routes on demand; CI is always cold. See `issues/01`.
