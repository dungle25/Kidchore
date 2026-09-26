/**
 * Invite codes, as the person typing one sees them.
 *
 * Pure and free of React so the fiddly parts - what counts as a character, how a code is
 * grouped for reading aloud - can be tested from Node. The database normalises again on
 * its side; this is only about not making the person fight the input field.
 */

/** The characters the database generates. 32 of them, chosen to avoid misreading. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const INVITE_CODE_LENGTH = 12;

/**
 * Strips everything that cannot be part of a code and uppercases the rest.
 *
 * Codes arrive pasted out of a chat message, so they carry dashes, spaces, sometimes a
 * trailing newline, and often lower case. All of that is noise.
 */
export function normaliseInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Groups a code as XXXX-XXXX-XXXX.
 *
 * Twelve unbroken characters are hard to check at a glance, and harder to read out over
 * the phone to somebody who is typing it.
 */
export function formatInviteCode(raw: string): string {
  const clean = normaliseInviteCode(raw);
  const groups = clean.match(/.{1,4}/g);
  return groups ? groups.join("-") : "";
}

export function isCompleteInviteCode(raw: string): boolean {
  return normaliseInviteCode(raw).length === INVITE_CODE_LENGTH;
}

/**
 * True when the text contains a character no code can contain.
 *
 * The alphabet deliberately has no I, O, 0 or 1. Somebody reading a code off a screen
 * and typing O instead of nothing at all would otherwise get "mã không đúng" with no
 * hint about which character is the problem.
 */
export function hasUnusableCharacters(raw: string): boolean {
  const cleaned = normaliseInviteCode(raw);
  return [...cleaned].some((character) => !INVITE_ALPHABET.includes(character));
}
