# Conversations in "Ask the docs"

Status: resolved
Type: task

Wire the console to `Assistant.ask` / `Assistant.history` (Agents SDK, one Durable Object per conversation): a
conversation list, resume by id, follow-up questions with the history in view, citations per answer. Uses
Beautiful UI's ChatComposer shell and StreamingText layout (demo replies and word replay removed — answers arrive
whole and verified). Server-render the history; skeletons for client loads. Dutch copy.

Done when: a person asks, follows up, reloads, and the conversation is still there; e2e covers it.

## Answer

Done in 2fea0dace: conversations per person with a list, follow-ups (last 4 turns as context, citations still
verified per run), sources kept per turn, index table (migration 0035), SSR thread. Fixed on the way:
Assistant.ask/history failed on every call (Schema.Class instances), and rpc/dehydrate dropped unmounted atoms.
