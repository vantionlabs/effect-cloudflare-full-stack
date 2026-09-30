# Whatever invites a member must set one of OUR roles

Status: ready-for-human

Found by a runtime test while building the write endpoints, and the product half of it is a decision rather than
a fix.

## What was wrong in the code, and is now fixed

`resolveIdentity` did `role as MemberRole` — a **cast**. better-auth owns the `member.role` column and **its
default value is `member`**, which is not in our closed set (`owner`, `reviewer`, `viewer`). The cast let that
string reach `Identity`, whose constructor threw, so the caller got a **500 with an empty body** on every
authenticated request and nothing said why.

It decodes now, and an unrecognised role is treated as no session, which answers 401. Two alternatives were
worse: dying (a server fault reported for a membership problem) and mapping `member` onto one of ours, which
would be inventing an authorisation — exactly what a closed role set exists to prevent.

## What is still open, and needs a person

**A member invited through better-auth's own flow gets role `member` and is now refused with 401 everywhere.**
That is correct behaviour for an undefined role and useless behaviour for a product. Nobody has hit it because
the only path that creates members today is organization creation, which makes the creator an `owner`.

So: whatever invites a second person has to write one of our roles. Three ways, and the choice is a product one:

- **Set the role at invitation time**, and expose only our three in whatever UI does the inviting. Simplest, and
  keeps one vocabulary.
- **Configure better-auth's roles** to be ours, so its default cannot be something we do not recognise. Better
  if it can be done without patching — worth checking whether the organization plugin accepts a role list.
- **Map `member` to `viewer`** on read. Cheapest and the one to resist: it decides that an unconfigured
  invitation grants read access to an organization's decisions, which is a permissions decision made by a
  default rather than by a person.

Whichever is chosen, it wants a test with a second member — `harness.signedInAs` exists now and writes the
membership row directly for exactly this reason.
