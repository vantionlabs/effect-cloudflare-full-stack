/**
 * One labelled text input bound to a TanStack Form field — the shape every auth form repeats.
 *
 * `disabled` is the caller's `!hydrated`, and it is not optional on purpose: these inputs are controlled by form
 * state, so anything typed into the server-rendered HTML before hydration is discarded the moment React re-renders
 * from a state that is still empty. See `login-page.tsx`.
 */
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** The part of a TanStack Form field API this component uses. Method syntax keeps it assignable from the real one. */
export interface TextFieldApi {
  readonly name: string
  readonly state: { readonly value: string }
  handleBlur(): void
  handleChange(value: string): void
}

export function TextField(props: {
  readonly field: TextFieldApi
  readonly label: string
  readonly type: "text" | "email" | "password"
  readonly autoComplete: string
  readonly disabled: boolean
}) {
  const { field } = props
  return (
    <Field>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={props.type}
        autoComplete={props.autoComplete}
        required
        disabled={props.disabled}
        value={field.state.value}
        onBlur={() => field.handleBlur()}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    </Field>
  )
}
