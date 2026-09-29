/**
 * Object storage for document bytes, as a port.
 *
 * A port rather than reaching for the R2 binding directly, for one concrete reason: the eval
 * harness runs in Node against fixtures on disk and must exercise the same use case. A use case
 * that imported `R2Bucket` would be untestable outside a Worker.
 *
 * Key construction lives here too, with the port rather than with the adapter, because tenancy in
 * object storage *is* the key: R2 has no row-level security, so the prefix is the only isolation
 * there is, and it must not vary by adapter.
 */
import type { OrgId } from "@ea/modules/shared/domain/Identity"
import { Context, type Effect } from "effect"
import type { DocumentId } from "./Document.ts"

export interface BlobsService {
  /** Stores bytes and returns the key they were written under. */
  readonly put: (input: {
    readonly orgId: OrgId
    readonly documentId: DocumentId
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
export const keyFor = (orgId: OrgId, documentId: DocumentId): string => `${orgId}/${documentId}`
