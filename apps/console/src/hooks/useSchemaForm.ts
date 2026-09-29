/**
 * `useForm`, with validation derived from an Effect `Schema`.
 *
 * **Why this exists rather than `@lucas-barake/effect-form`.** That library is the natural fit and PLAN.md
 * names it, but every published version — including `0.26.0-beta.5` — peers on `effect: ^3.19.15` while
 * this repo is on `4.0.0-rc.118`, and its atom peers are `@effect-atom/atom-react` rather than the
 * `@effect/atom-react` used here. Installing it puts two Effect majors in one bundle, which breaks fiber
 * and Context identity in ways that surface as impossible bugs.
 *
 * **Why no community adapter either.** Effect 4 ships the bridge itself: `Schema.toStandardSchemaV1`
 * produces a Standard Schema v1 value, and TanStack Form accepts Standard Schema natively. So the whole
 * integration is one function call, and there is no third package to keep in step with either side.
 *
 * What this hook adds over calling `useForm` directly is that the CONVERSION happens in one place. A
 * `toStandardSchemaV1` at every call site is the kind of detail that gets copied with the wrong options,
 * and `parseOptions` in particular changes behaviour: forms want every error at once, not the first.
 */
import { useForm } from "@tanstack/react-form"
import { Schema } from "effect"
import { useMemo } from "react"

export interface SchemaFormOptions<A> {
  /** The schema the form's values must satisfy. Also the source of the field types. */
  readonly schema: Schema.Codec<A, any>
  readonly defaultValues: A
  readonly onSubmit: (value: A) => Promise<void> | void
}

export const useSchemaForm = <A>(options: SchemaFormOptions<A>) => {
  /*
   * Memoised on the schema, because `toStandardSchemaV1` builds a new object each call and TanStack Form
   * treats a changed validator as a reason to re-validate. Without this the form revalidates on every
   * render, which is invisible until a field has an async check and it fires in a loop.
   */
  const standard = useMemo(
    () =>
      Schema.toStandardSchemaV1(options.schema as never, {
        /*
         * `errors: "all"`, not the default first-error-wins.
         *
         * A form should tell somebody everything that is wrong in one pass. Stopping at the first issue
         * means a user fixes the email, resubmits, and only then learns about the password — which is the
         * behaviour that makes people abandon forms.
         */
        parseOptions: { errors: "all" }
      }),
    [options.schema]
  )

  return useForm({
    defaultValues: options.defaultValues,
    /*
     * `onSubmit` rather than `onChange` as the gate.
     *
     * Validating every keystroke marks a field invalid while it is still being typed — an email is
     * incomplete for as long as it takes to write one. TanStack Form still exposes per-field state, so a
     * field that has been touched and blurred can show its own error; what this controls is what BLOCKS.
     */
    validators: { onSubmit: standard },
    onSubmit: async ({ value }) => {
      await options.onSubmit(value)
    }
  })
}
