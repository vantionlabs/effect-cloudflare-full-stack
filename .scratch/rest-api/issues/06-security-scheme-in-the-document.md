# Declare the auth schemes in the OpenAPI document

Status: needs-triage

Key authentication works and is tested end to end, but **the generated OpenAPI document does not say the API
needs credentials**. A client reading `/api/v1/docs` sees endpoints with a 401 in their response list and nothing
explaining how to avoid it. The prose in the document's description says what to send, which is better than
nothing and worse than a machine-readable scheme — a generated client will not read prose.

## Why it was not done in the same pass

`HttpApiMiddleware.Service` takes a `security` config, and supplying it **changes the middleware's shape**: it
becomes security middleware whose implementation receives the decoded credential per scheme rather than reading
headers itself. `Authenticated` is the one seam every protected endpoint in every slice goes through, and
`AuthenticatedLive` had just been rewritten to combine two credentials — refactoring the most security-sensitive
type in the codebase twice in one pass, on a shape not yet verified against rc.118, is how a subtle
authentication bug gets shipped.

## What it needs

- Read `HttpApiSecurity` and `HttpApiMiddleware`'s security path in the vendored source, and confirm that TWO
  schemes on one middleware is expressible: an `apiKey` in a header, and a cookie. If only one is, the question
  becomes whether the cookie needs declaring at all — the console does not read the document.
- Keep the behaviour identical. The tests in `apps/worker/test/ApiKeyAuth.test.ts` are the contract, including
  the one that matters most: a presented-but-wrong key must not fall through to the session.
- Check what the scheme does to the 401s already in the document. A security scheme usually implies them, and
  two sources for the same fact will disagree eventually.
