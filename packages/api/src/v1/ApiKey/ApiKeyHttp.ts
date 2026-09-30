/** The transport edge for key management. */
import { ApiKeyNotFoundV1 } from "@ea/modules/iam/domain/ApiKey"
import { IssueApiKey, ListApiKeys, RevokeApiKey } from "@ea/modules/iam/use-cases/ApiKey"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { page } from "../Page.ts"
import { serve, serveForTenant } from "../Serve.ts"

export const ApiKeyHttp = HttpApiBuilder.group(
  ApiV1,
  "api_keys",
  (handlers) =>
    handlers
      // `serve`: issuing records who created the key, so this needs the person and not only the tenant.
      .handle("issue", ({ payload }) => serve(IssueApiKey({ name: payload.name })))
      .handle("list", ({ query }) =>
        Effect.gen(function*() {
          const limit = clampPageSize(query.limit)
          const keys = yield* serveForTenant(ListApiKeys({ limit }))
          /*
           * No cursor is offered: an organization has a handful of keys, and `next_cursor` is always null here.
           * The shape stays a page because every collection in this API is one — a client's pagination loop
           * should not need to know which collections are small.
           */
          return page(keys, limit, (key) => [key.createdAt, key.id])
        }))
      .handle("revoke", ({ params }) =>
        Effect.flatMap(
          serveForTenant(RevokeApiKey({ apiKeyId: params.apiKeyId })),
          (revoked) =>
            revoked === null
              ? Effect.fail(new ApiKeyNotFoundV1({ api_key_id: params.apiKeyId }))
              : Effect.succeed({ apiKeyId: revoked })
        ))
)
