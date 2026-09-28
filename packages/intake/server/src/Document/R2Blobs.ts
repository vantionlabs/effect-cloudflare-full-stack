/**
 * The R2 adapter for `Blobs`.
 *
 * Takes a single bucket rather than the Worker's whole `Env`. That is the slice declaring what it
 * actually needs: this package has no business being able to reach Hyperdrive or the queue, and a
 * narrow requirement is also what lets the eval harness substitute one object store.
 */
import { Blobs, type BlobsService, keyFor } from "@ea/intake-domain/Document"
import { Context, Effect, Layer } from "effect"

/**
 * The bucket this slice writes documents to.
 *
 * A `Context.Service` with no default, deliberately: a default value for "where documents are
 * stored" is a bug that compiles.
 */
export class DocumentBucket extends Context.Service<DocumentBucket, R2Bucket>()(
  "intake/DocumentBucket"
) {}

export const BlobsR2: Layer.Layer<Blobs, never, DocumentBucket> = Layer.effect(Blobs)(
  Effect.map(DocumentBucket, (bucket) => ({
    put: ({ bytes, contentType, documentId, filename, orgId }) =>
      Effect.map(
        Effect.promise(() =>
          bucket.put(keyFor(orgId, documentId), bytes as unknown as ArrayBuffer, {
            httpMetadata: { contentType },
            // The original filename is metadata, never part of the key — see keyFor.
            customMetadata: { filename, organizationId: orgId }
          })
        ),
        () => keyFor(orgId, documentId)
      ),

    get: (key) =>
      Effect.flatMap(
        Effect.promise(() => bucket.get(key)),
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
