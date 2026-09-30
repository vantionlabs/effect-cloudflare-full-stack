# A mention picker, so handles are not guesses

Status: needs-triage

`ResolveMentions` matches `@handle` against the local part of a member's email, case-insensitively. It works
and it is a guess: `alice@a.com` and `alice@b.com` in one organization both match `@alice`.

## Why it is not built

The fix is not a better regular expression. Discord's answer is a picker that inserts an opaque id, so the
message text carries the identity rather than something resembling it — which makes this a UI feature with a
wire format, not a parsing improvement.

## What it needs before building

- A member search endpoint. `ResolveMentions` already reads `member` joined to `"user"`; a picker needs the
  same query exposed, with a prefix filter.
- A body format that survives editing: `<@user_id>` or similar, rendered back to a name at display time. Note
  what that costs — the stored body stops being what the author typed, so the verbatim-quoting instinct that
  runs through this codebase applies here too.
- A migration path for existing bodies, which contain bare handles. Probably none: leave them resolved as they
  are, since mentions are stored rather than re-parsed.
