// The slice's error vocabulary, one file per error.
//
// A folder rather than a single `Errors.ts` because an error is part of a contract: it is named in a
// handler's `catchTag`, in a wire schema, and in the terminal-versus-retryable classification. One file per
// error means `rg --files packages/modules/shared/domain/Errors` is that vocabulary, and adding one is a new
// file in a diff rather than a line inside an existing list.
export * from "./DocumentNotFound.ts"
export * from "./EmailNotSent.ts"
export * from "./EventNotFound.ts"
export * from "./RailsRefused.ts"
export * from "./Terminal.ts"
export * from "./UnknownVertical.ts"
