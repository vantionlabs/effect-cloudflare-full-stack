# Agents that wait: invoice reminders, quote follow-ups

Status: needs-triage
Type: task
Blocked by: an ADR update

A per-invoice agent wakes on the due date and DRAFTS a payment reminder for a person to send; a sent quote chases
itself after 7 days. ADR-0025 gives waiting to Workflows (`waitForEvent`), so first decide — in an ADR — whether
`schedule()` on an agent is the better owner for per-record timers.
