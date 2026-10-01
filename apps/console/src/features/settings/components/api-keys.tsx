/**
 * API keys for this person in this organization: what lets another system — the company's own software — call the
 * effect-ai API on their behalf. A key acts as the person who made it, with their role, in the organization named
 * in its metadata (checked against membership on every request, `AuthenticatedLive.ts`).
 */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay, formatMoment } from "@/lib/format"
import { useState } from "react"
import type { ApiKeyView } from "../api/settings-view.ts"
import { useSettingsAction } from "../api/use-settings-action.ts"
import { ApiKeyReveal } from "./api-key-reveal.tsx"
import { ConfirmAction } from "./confirm-action.tsx"

export function ApiKeys(props: { readonly keys: ReadonlyArray<ApiKeyView>; readonly organizationId: string }) {
  const hydrated = useHydrated()
  const create = useSettingsAction()
  const revoke = useSettingsAction()
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ readonly name: string; readonly secret: string } | undefined>(undefined)

  return (
    <div className="flex flex-col gap-3">
      <form
        method="post"
        className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
        onSubmit={async (event) => {
          event.preventDefault()
          const keyName = name.trim()
          const result = await create.run(
            () => authClient.apiKey.create({ name: keyName, metadata: { organizationId: props.organizationId } }),
            "De sleutel kon niet worden aangemaakt."
          )
          if (result !== undefined) {
            setCreated({ name: keyName, secret: (result as { readonly key: string }).key })
            setName("")
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-name">Naam van de sleutel</Label>
            <Input
              id="api-key-name"
              required
              maxLength={60}
              placeholder="Bijv. koppeling boekhouding"
              value={name}
              disabled={!hydrated}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button variant="primary" type="submit" disabled={!hydrated || create.busy || name.trim() === ""}>
            {create.busy ? "Aanmaken…" : "Sleutel aanmaken"}
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">
          Een sleutel werkt namens jou, met jouw rol, in deze organisatie. Geef hem een naam die zegt waar hij voor is,
          zodat je later weet welke je kunt intrekken.
        </p>
        {create.error === undefined ? null : <Notice tone="error">{create.error}</Notice>}
      </form>

      {created === undefined
        ? null
        : <ApiKeyReveal name={created.name} secret={created.secret} onDone={() => setCreated(undefined)} />}

      {revoke.error === undefined ? null : <Notice tone="error">{revoke.error}</Notice>}
      <DataTable
        caption="API-sleutels"
        rows={props.keys}
        rowKey={(key) => key.id}
        rowTestId="api-key"
        empty="Nog geen sleutels. Maak er hierboven een aan wanneer een ander systeem de API moet aanroepen."
        columns={[
          { key: "name", header: "Naam", cell: (key) => <span className="font-medium">{key.name}</span> },
          {
            key: "start",
            header: "Begint met",
            cell: (key) =>
              key.start === null ? "—" : <code className="font-mono text-[12px] text-ink-2">{key.start}…</code>
          },
          {
            key: "created",
            header: "Aangemaakt",
            className: "whitespace-nowrap",
            cell: (key) => formatDay(key.createdAt)
          },
          {
            key: "used",
            header: "Laatst gebruikt",
            className: "whitespace-nowrap",
            cell: (key) =>
              key.lastUsedAt === null ? <span className="text-ink-3">Nog niet</span> : formatMoment(key.lastUsedAt)
          },
          {
            key: "actions",
            header: <span className="sr-only">Acties</span>,
            align: "right",
            cell: (key) => (
              <ConfirmAction
                label="Intrekken"
                confirmLabel="Ja, intrekken"
                accessibleLabel={`Intrekken: ${key.name}`}
                disabled={!hydrated || revoke.busy}
                onConfirm={() =>
                  void revoke.run(
                    () => authClient.apiKey.delete({ keyId: key.id }),
                    "De sleutel kon niet worden ingetrokken."
                  )}
              />
            )
          }
        ]}
      />
    </div>
  )
}
