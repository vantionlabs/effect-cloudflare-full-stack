# A quota breach answers 401, and should answer 429

Status: ready-for-human — it changes the v1 contract, so it is a decision rather than a patch

## What happens

`apikey.requestCount` passes `rateLimitMax`, and the caller gets **401 Unauthorized**.

The chain:

1. The plugin signals a breach by THROWING `APIError TOO_MANY_REQUESTS`, code `RATE_LIMITED`, with
   `details.tryAgainIn`.
2. `SessionStore.verifyApiKey` wraps the call in `orNull`, so every refusal — wrong key, expired key,
   disabled key, **over quota** — collapses to `null`.
3. `apiKeyOwner` returns null and the `Authenticated` middleware answers `HttpApiError.Unauthorized`.

Pinned by a test in `apps/worker/test/ApiKeyAuth.test.ts`, asserted as it behaves so this fails when fixed.

## Why it matters more than it looks

A caller is told their credential is bad when it is fine. **"Fix your credentials" and "back off and retry"
have opposite remedies**, and the integrator this API exists for — a third-party internal tool — cannot tell
them apart. The likely outcome is someone regenerating a working key, or paging a human, instead of waiting.

`tryAgainIn` is already in the error the plugin throws, so a correct `Retry-After` is available and is being
discarded one layer below where it would be useful.

## Why it is not a patch

The fix is to add 429 to the `Authenticated` middleware's declared error, which changes the v1 OpenAPI
document. That is **additive** — a client handling 401 keeps working — but it is still a published contract
change, and the OpenAPI snapshot test will (correctly) fail and need updating.

It also means `verifyApiKey` must stop flattening every refusal to `null`: the quota breach has to survive
as a distinguishable outcome. The narrowest version is a tagged result, keeping `null` for "no", adding one
case for "over quota" — rather than widening the port to carry provider errors, which `SessionStore`'s
docstring deliberately avoids.

## Do not

Answer 429 from the cookie path. A session is not rate-limited this way, and inventing a shared status would
blur two unrelated mechanisms.
