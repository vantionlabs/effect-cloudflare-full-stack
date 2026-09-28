/**
 * Object storage, as a port with an R2 adapter.
 *
 * A port rather than reaching for the binding directly, for one concrete reason: the eval harness
 * runs in Node against fixtures on disk and must exercise the same use case. A use case that
 * imported `R2Bucket` would be untestable outside a Worker.
 *
 * Keys are deliberately org-prefixed. R2 has no row-level security, so tenancy here is a naming
 * convention enforced in one place — which is why key construction lives in this module and not
 * at call sites.
 */
import type { OrgId } from "@ea/shared-domain/iam"
import { Context, Effect, Layer } from "effect"
import { Bindings } from "../platform/Bindings.ts"

export interface BlobsService {
  /** Stores bytes and returns the key they were written under. */
  readonly put: (input: {
    readonly orgId: OrgId
    readonly documentId: string
    readonly filename: string
    readonly contentType: string
    readonly bytes: Uint8Array
  }) => Effect.Effect<string>

  readonly get: (key: string) => Effect.Effect<Uint8Array | null>
}

export class Blobs extends Context.Service<Blobs, BlobsService>()("intake/Blobs") {}

/**
 * The object key for a document.
 *
 * Org-first so a prefix listing can never span tenants, and document-id-based rather than
 * filename-based because filenames are attacker-controlled: two uploads called `invoice.pdf` must
 * not collide, and a name like `../../other-org/x` must not escape the prefix.
 */
const keyFor = (orgId: OrgId, documentId: string): string => `${orgId}/${documentId}`

export const BlobsLive: Layer.Layer<Blobs, never, Bindings> = Layer.effect(Blobs)(
  Effect.map(Bindings, (env) => ({
    put: ({ bytes, contentType, documentId, filename, orgId }) =>
      Effect.map(
        Effect.promise(() =>
          env.DOCUMENTS.put(keyFor(orgId, documentId), bytes as unknown as ArrayBuffer, {
            httpMetadata: { contentType },
            // The original filename is metadata, never part of the key — see keyFor.
            customMetadata: { filename, organizationId: orgId }
          })
        ),
        () => keyFor(orgId, documentId)
      ),

    get: (key) =>
      Effect.flatMap(
        Effect.promise(() => env.DOCUMENTS.get(key)),
        (object) =>
          object === null
            ? Effect.succeed(null)
            : Effect.map(
              Effect.promise(() => object.arrayBuffer()),
              (buffer) => new Uint8Array(buffer)
            )
      )
  } satisfies BlobsService))
)
