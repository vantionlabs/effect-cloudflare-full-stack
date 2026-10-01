/**
 * better-auth's refusals on the settings screens, in Dutch — by CODE, with the shared auth messages as fallback.
 *
 * Settings-specific wording first: "already a member" reads differently when you are inviting someone than when you
 * are accepting (`features/auth/api/auth-errors.ts` words it for the invitee). Anything unmapped falls through to the
 * shared map, then to better-auth's own message.
 */
import { type AuthError, authErrorMessage } from "@/features/auth/api/auth-errors"

const MESSAGES: Readonly<Record<string, string>> = {
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: "Alleen eigenaren en beheerders kunnen mensen uitnodigen.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: "Die rol mag je niet toekennen.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "Deze persoon is al lid van de organisatie.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    "Deze persoon is al uitgenodigd. Verstuur de uitnodiging opnieuw vanuit de lijst hieronder.",
  INVITATION_LIMIT_REACHED: "Het maximum aantal openstaande uitnodigingen is bereikt. Trek er eerst een in.",
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: "Het maximum aantal leden is bereikt.",
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: "Alleen eigenaren en beheerders kunnen uitnodigingen intrekken.",
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: "Je mag de rol van dit lid niet wijzigen.",
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: "Je mag dit lid niet verwijderen.",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    "Een organisatie heeft altijd minstens één eigenaar. Maak eerst iemand anders eigenaar.",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
    "Een organisatie heeft altijd minstens één eigenaar. Maak eerst iemand anders eigenaar.",
  MEMBER_NOT_FOUND: "Dit lid bestaat niet meer. De lijst is ververst.",
  INVITATION_NOT_FOUND: "Deze uitnodiging bestaat niet meer. De lijst is ververst.",
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: "Alleen eigenaren en beheerders kunnen de organisatie wijzigen.",
  ROLE_NOT_FOUND: "Die rol bestaat niet. Kies beheerder, beoordelaar of lezer.",
  KEY_NOT_FOUND: "Deze sleutel bestaat niet meer. De lijst is ververst."
}

export const settingsErrorMessage = (error: AuthError | null | undefined, fallback: string): string => {
  const mapped = error?.code === undefined ? undefined : MESSAGES[error.code]
  return mapped ?? authErrorMessage(error, fallback)
}
