/**
 * The manuals the assistant can search, and a way to add one.
 *
 * Uploading is the `Intake.upload` RPC as a mutation — a thing the person DOES — with the file's bytes; indexing
 * then runs on the queue, so a new manual is searchable shortly rather than instantly, and the note says so.
 */
import { Notice } from "@/components/feedback/notice"
import { Panel } from "@/components/layout/page"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatDay } from "@/lib/format"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { Upload } from "lucide-react"
import { useState } from "react"
import { knowledgeDocumentsAtom, uploadAtom } from "../api/knowledge-atoms.ts"

export function DocumentationPanel() {
  const documents = useAtomValue(knowledgeDocumentsAtom)
  const refreshDocuments = useAtomRefresh(knowledgeDocumentsAtom)
  // `promiseExit`, not `promise`: the Exit keeps the typed failure, so an unreadable format reads as one.
  const uploadDocument = useAtomSet(uploadAtom, { mode: "promiseExit" })
  const hydrated = useHydrated()
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | undefined>(undefined)

  const upload = async (file: File) => {
    setUploading(true)
    setUploadNote(undefined)
    const exit = await uploadDocument({
      payload: {
        filename: file.name,
        contentType: file.type,
        collection: "knowledge",
        bytes: new Uint8Array(await file.arrayBuffer())
      }
    })
    setUploading(false)
    if (Exit.isSuccess(exit)) {
      setUploadNote(`${file.name} uploaded. It becomes searchable once it has been indexed, usually within a minute.`)
      refreshDocuments()
      return
    }
    setUploadNote(describeFailure(exit, {
      UnsupportedDocument: `${file.name} is not a format that can be read. Try a PDF, Word document, or text file.`
    }))
  }

  return (
    <Panel className="flex flex-col gap-3">
      {documents._tag === "Failure"
        ? <Notice tone="error">The document list could not be loaded.</Notice>
        : documents._tag === "Initial"
        ? <p className="text-[13px] text-ink-2">Loading documentation…</p>
        : documents.value.length === 0
        ? <p className="text-[13px] text-ink-2">No documentation uploaded yet.</p>
        : (
          <ul className="flex flex-col text-[13px]" aria-label="Documents">
            {documents.value.map((document) => (
              <li
                key={document.documentId}
                className="flex justify-between gap-4 border-b border-line-soft py-2 last:border-b-0"
              >
                <span className="truncate text-ink">{document.filename}</span>
                <span className="tabular shrink-0 text-ink-3">{formatDay(document.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-btn hover:bg-inset has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-accent">
        <Upload className="size-3.5" aria-hidden />
        {uploading ? "Uploading…" : "Upload a document"}
        <span className="sr-only">Upload documentation</span>
        <input
          type="file"
          className="sr-only"
          disabled={!hydrated || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void upload(file)
            event.target.value = ""
          }}
        />
      </label>
      {uploadNote === undefined ? null : <p className="text-[13px] text-ink-2" role="status">{uploadNote}</p>}
    </Panel>
  )
}
