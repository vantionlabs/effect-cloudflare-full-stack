/**
 * Managing keys over the API.
 *
 * **These endpoints accept a key themselves**, because a key acts as a member and that member may manage keys.
 * That is consistent rather than accidental — the key has exactly the member's authority and no more — but it
 * does mean a key acting as an owner can mint another. The mitigation is to point a key at a least-privileged
 * member; the limitation, that nothing in `Identity` records WHICH door a request came through, is stated in
 * ADR-0022 and is what would have to change to forbid it.
 */
import { Authenticated } from "@ea/domain/Identity"
import { pageOf, wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { ApiKeySummary, IssuedApiKey } from "./ApiKey.ts"

/** Includes `key`, and is the only shape that ever does. */
export const IssuedApiKeyV1 = wireFrom(IssuedApiKey, ["id", "name", "key", "prefix", "createdAt"])

/** A key in a list: everything except the secret. */
export const ApiKeySummaryV1 = wireFrom(ApiKeySummary, [
  "id",
  "name",
  "prefix",
  "createdAt",
  "lastUsedAt",
  "revokedAt"
])

/** A key id that names nothing in the caller's organization. */
export class ApiKeyNotFoundV1 extends Schema.Error<ApiKeyNotFoundV1>(
  "ApiKeyNotFoundV1"
)({ _tag: Schema.tag("ApiKeyNotFoundV1"), api_key_id: Schema.String }, { httpApiStatus: 404 }) {}

const del = HttpApiEndpoint.make("DELETE")

export const ApiKeyGroup = HttpApiGroup.make("api_keys")
  .add(
    HttpApiEndpoint.post("issue", "/api-keys", {
      payload: wire({ name: Schema.String }),
      /** 201, and the one response in the whole API that carries a secret. */
      success: IssuedApiKeyV1.pipe(HttpApiSchema.status(201)),
      // No error: a key can always be issued for an organization the caller is already a member of.
      error: []
    })
  )
  .add(
    HttpApiEndpoint.get("list", "/api-keys", {
      query: { limit: Schema.optional(Schema.FiniteFromString) },
      success: pageOf(ApiKeySummaryV1)
    })
  )
  .add(
    /*
     * `DELETE` revokes; it does not remove the row.
     *
     * A key that signed a request a year ago has to stay explicable, so revocation is a timestamp. The method is
     * still right — to a caller the key is gone — and it is idempotent, which a second DELETE proves by
     * answering 200 rather than 404.
     */
    del("revoke", "/api-keys/:apiKeyId", {
      params: { apiKeyId: Schema.String },
      success: wire({ apiKeyId: Schema.String }),
      error: ApiKeyNotFoundV1
    })
  )
  .middleware(Authenticated)
