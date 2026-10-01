/**
 * The manuals the assistant can search, and a way to add one.
 *
 * Uploading is the `Intake.upload` RPC as a mutation — a thing the person DOES — with the file's bytes; indexing
 * then runs on the queue, so a new manual is searchable shortly rather than instantly, and the note says so.
 *
 * The list is server-rendered (the route's loader dehydrates it); a skeleton shows only if the browser has to fetch
 * it itself, and a refresh after an upload keeps the current list on screen while the new one loads.
 */
import { Notice } from "@/components/feedback/notice"
import { SkeletonText } from "@/components/feedback/skeleton"
import { Panel } from "@/components/layout/page"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatDay } from "@/lib/format"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { FileText, Upload } from "lucide-react"
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
      setUploadNote(`${file.name} is geüpload. Het is doorzoekbaar zodra het is verwerkt, meestal binnen een minuut.`)
      refreshDocuments()
      return
    }
    setUploadNote(describeFailure(exit, {
      UnsupportedDocument:
        `${file.name} is geen bestandsformaat dat we kunnen lezen. Probeer een PDF, Word-document of tekstbestand.`
    }))
  }

  return (
    <Panel className="flex flex-col gap-3">
      {documents._tag === "Failure"
        ? <Notice tone="error">De lijst met documenten kon niet worden geladen.</Notice>
        : documents._tag === "Initial"
        ? <SkeletonText lines={3} label="Documenten laden" />
        : documents.value.length === 0
        ? (
          <p className="text-[13px] text-ink-2">
            Nog geen documentatie. Upload handleidingen, schema's of servicebulletins (PDF, Word of tekst); daarna kunt
            u er hierboven vragen over stellen.
          </p>
        )
        : (
          <ul className="flex flex-col text-[13px]" aria-label="Documenten">
            {documents.value.map((document) => (
              <li
                key={document.documentId}
                className="flex items-center justify-between gap-4 border-b border-line-soft py-2 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                  <span className="truncate text-ink">{document.filename}</span>
                </span>
                <span className="tabular shrink-0 text-ink-3">{formatDay(document.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-btn hover:bg-inset has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-accent">
        <Upload className="size-3.5" aria-hidden />
        {uploading ? "Bezig met uploaden…" : "Document uploaden"}
        <span className="sr-only">Documentatie uploaden</span>
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
