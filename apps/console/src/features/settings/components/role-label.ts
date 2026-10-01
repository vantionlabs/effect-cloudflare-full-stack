/** The roles in the words the interface uses, and the one sentence that is true about each. */
import { roleLabel } from "@/features/auth/api/auth-errors"

export { roleLabel }

/** Capitalised for table cells and pills. */
export const roleTitle = (role: string): string => {
  const label = roleLabel(role)
  return label.charAt(0).toUpperCase() + label.slice(1)
}
