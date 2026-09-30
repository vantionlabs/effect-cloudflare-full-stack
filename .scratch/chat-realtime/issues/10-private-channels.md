# Private channels

Status: needs-triage

Today every channel is visible to everybody in the organization, and `ListRooms` says so by not filtering.

## Why it is not built

Because membership is a second authorization model, and this codebase has exactly one — the organization seam
in `Db.scoped` (ADR-0014), checked statically. A per-room member list means every message read, every reaction,
every unread count gains a second predicate that nothing currently verifies.

## What it needs before building

- A `room_members` table, and a rule for what happens to messages when somebody is removed: they stay
  readable to the rest, which means the room is the boundary rather than the message.
- An extension to the tenancy test suite. ADR-0014's suite is keyed on `keyof StoreService` so a new method
  without a cross-tenant case fails to compile; private rooms need the equivalent for cross-MEMBER access, or
  the check silently covers half of what matters.
- A decision on whether a decision thread can be private. It probably cannot: the argument about why something
  was approved is exactly what an auditor needs, so a private one would be a hole in the product's claim.
