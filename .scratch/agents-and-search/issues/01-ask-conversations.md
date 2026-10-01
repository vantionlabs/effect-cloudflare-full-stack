# Conversations in "Ask the docs"

Status: claimed
Type: task

Wire the console to `Assistant.ask` / `Assistant.history` (Agents SDK, one Durable Object per conversation): a
conversation list, resume by id, follow-up questions with the history in view, citations per answer. Uses
Beautiful UI's ChatComposer shell and StreamingText layout (demo replies and word replay removed — answers arrive
whole and verified). Server-render the history; skeletons for client loads. Dutch copy.

Done when: a person asks, follows up, reloads, and the conversation is still there; e2e covers it.
