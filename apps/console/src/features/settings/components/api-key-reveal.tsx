/**
 * A key just created, shown the ONE time it can be: better-auth stores only a hash, so after this panel closes
 * nobody — not us, not the person who made it — can read it again. The panel says so plainly, offers copy, and shows
 * the first call to make with it.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import CodeBlock from "@/components/primitives/CodeBlock"
import { popIn } from "@/lib/motion"

export function ApiKeyReveal(props: { readonly name: string; readonly secret: string; readonly onDone: () => void }) {
  // Client-only: this panel exists only after a create in the browser, so `window` is always there.
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return (
    <div
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-raised"
      style={popIn("top center")}
      data-testid="api-key-reveal"
      role="region"
      aria-label={`Nieuwe sleutel: ${props.name}`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-[14px] font-semibold text-ink">Sleutel „{props.name}” is aangemaakt</h3>
        <Notice>
          Kopieer hem nu en bewaar hem op een veilige plek: hij wordt hierna niet meer getoond. Ben je hem kwijt, maak
          dan een nieuwe aan en trek deze in.
        </Notice>
      </div>
      <CodeBlock
        filename="API-sleutel"
        className="max-w-none"
        lines={[props.secret]}
        labels={{ copy: "Kopiëren", copied: "Gekopieerd" }}
      />
      <CodeBlock
        filename="Eerste aanroep"
        className="max-w-none"
        lines={[`curl ${origin}/api/v1/me \\`, `  -H "x-api-key: ${props.secret}"`]}
        labels={{ copy: "Kopiëren", copied: "Gekopieerd" }}
      />
      <div>
        <Button variant="secondary" size="sm" onClick={props.onDone}>Ik heb hem bewaard</Button>
      </div>
    </div>
  )
}
