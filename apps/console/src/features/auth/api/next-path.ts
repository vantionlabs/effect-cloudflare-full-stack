/**
 * The `next` search parameter, validated rather than read raw.
 *
 * `next` ends up in a redirect, and an unvalidated one is an open redirect — the classic phishing primitive. Only a
 * path is accepted, never an absolute URL, so `?next=https://evil.example` cannot send anyone off-site.
 */
export const validateNext = (search: Record<string, unknown>): { readonly next: string } => {
  const raw = typeof search["next"] === "string" ? search["next"] : "/"
  return { next: raw.startsWith("/") && !raw.startsWith("//") ? raw : "/" }
}
