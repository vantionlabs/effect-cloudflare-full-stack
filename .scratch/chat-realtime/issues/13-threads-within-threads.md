# Replies to a message

Status: wontfix

A message has no parent, so there are no sub-threads.

## Why not

The shape is available cheaply — a nullable `parent_message_id` — and the cost is not in the column. Every
read grows a tree, unread counting stops being a count, and "what did we decide" becomes a traversal. For a
review queue the flat thread IS the record: a short list of what people checked, in order, next to the
decision.

Marked `wontfix` rather than `needs-triage` because the alternative is already available and is better here:
if a conversation needs its own subject, it is a channel or another decision's thread, both of which exist.

Reopen if a real thread gets long enough that people cannot follow it — and bring the thread as evidence.
