/**
 * The address customers send quote requests to. Each email to it becomes a draft quote in Sales, for a person to
 * check and approve before anything is sent back.
 *
 * The address is a capability — whoever knows it can put a request in this inbox — so rotating it is one click for an
 * owner or admin, and the old one stops accepting mail at once. While the deployment has no receiving domain
 * configured, the page says so and shows the token, which already works in local testing.
 */
import { Button } from "@/components/atoms/Button"
import { Shimmer } from "@/components/atoms/Shimmer"
import { Notice } from "@/components/feedback/notice"
import { SkeletonText } from "@/components/feedback/skeleton"
import CodeBlock from "@/components/primitives/CodeBlock"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { formatMoment } from "@/lib/format"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { INBOUND_ADDRESS_KEY, inboundAddressAtom, rotateInboundAddressAtom } from "../api/inbound-atoms.ts"
import { ConfirmAction } from "./confirm-action.tsx"

const FAILURES = {
  InboundAddressForbidden: "Alleen eigenaren en beheerders kunnen het adres aanmaken of vervangen."
}

export function InboundAddress(props: { readonly manage: boolean }) {
  const hydrated = useHydrated()
  const address = useAtomValue(inboundAddressAtom)
  const rotate = useAtomSet(rotateInboundAddressAtom, { mode: "promiseExit" })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()

  const run = async () => {
    setBusy(true)
    setProblem(undefined)
    const exit = await rotate({ payload: {}, reactivityKeys: [INBOUND_ADDRESS_KEY] })
    if (Exit.isFailure(exit)) setProblem(describeFailure(exit, FAILURES))
    setBusy(false)
  }

  if (address._tag === "Initial") return <SkeletonText lines={2} label="Adres wordt geladen" />
  if (address._tag === "Failure") return <Notice tone="error">Het adres kon niet worden geladen.</Notice>
  const current = address.value

  return (
    <div className="flex flex-col gap-3">
      {current === null
        ? (
          <p className="text-[13px] text-ink-2">
            Er is nog geen adres. {props.manage
              ? "Maak er een aan en geef het aan je klanten, of stuur aanvragen er zelf naartoe door."
              : "Een eigenaar of beheerder kan er een aanmaken."}
          </p>
        )
        : (
          <>
            {current.address === null
              ? (
                <Notice>
                  Er is nog geen e-maildomein ingesteld voor deze omgeving. Zodra een domein met Cloudflare Email
                  Routing naar effect-ai wijst, wordt dit het adres:{" "}
                  <span className="font-mono">{current.token}@…</span>
                </Notice>
              )
              : null}
            <CodeBlock
              filename="Adres voor offerteaanvragen"
              className="max-w-none"
              lines={[current.address ?? current.token]}
              labels={{ copy: "Kopiëren", copied: "Gekopieerd" }}
            />
            <p className="text-[12px] text-ink-3" data-testid="inbound-token" data-token={current.token}>
              Aangemaakt op {formatMoment(current.createdAt)}.
            </p>
          </>
        )}
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {!props.manage ? null : current === null
        ? (
          <div>
            <Button variant="primary" size="sm" disabled={!hydrated || busy} onClick={run}>
              {busy ? <Shimmer>Aanmaken…</Shimmer> : "Adres aanmaken"}
            </Button>
          </div>
        )
        : (
          <ConfirmAction
            label={busy ? "Vervangen…" : "Nieuw adres"}
            confirmLabel="Ja, vervang het adres"
            accessibleLabel="Het adres voor offerteaanvragen vervangen"
            disabled={!hydrated || busy}
            onConfirm={run}
          />
        )}
    </div>
  )
}
