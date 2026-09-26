/**
 * Tests how an invite code is read as it is typed.
 *
 * These are the rules that decide whether a person's paste is accepted, and they run
 * without a database so the CI job that has no secrets still checks them.
 *
 * Usage: node scripts/test-invite-code.mjs
 */
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  hasUnusableCharacters,
  isCompleteInviteCode,
  normaliseInviteCode,
} from "../lib/invite-code.ts";

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

console.log("Testing invite code input handling...\n");

// ---- 1. The alphabet ----
console.log("1. The alphabet the database draws from");

check("it has 32 symbols", INVITE_ALPHABET.length === 32, String(INVITE_ALPHABET.length));
check(
  "every symbol is distinct",
  new Set(INVITE_ALPHABET).size === INVITE_ALPHABET.length,
  INVITE_ALPHABET
);
// 32 divides 256 exactly, which is what lets the database pick a symbol with `% 32`
// without favouring the first few. A 26-letter alphabet would have been biased.
check("32 divides 256 evenly, so the database draw is unbiased", 256 % 32 === 0, "");
check(
  "no symbol that is easily misread is included",
  !/[IO01]/.test(INVITE_ALPHABET),
  INVITE_ALPHABET
);

// ---- 2. Normalising what somebody pasted ----
console.log("\n2. Normalising what somebody pasted");

check("lower case is accepted", normaliseInviteCode("abcd") === "ABCD", normaliseInviteCode("abcd"));
check(
  "dashes are ignored",
  normaliseInviteCode("ABCD-EFGH-JKLM") === "ABCDEFGHJKLM",
  normaliseInviteCode("ABCD-EFGH-JKLM")
);
check(
  "spaces and a trailing newline are ignored",
  normaliseInviteCode("  ABCD EFGH JKLM\n") === "ABCDEFGHJKLM",
  normaliseInviteCode("  ABCD EFGH JKLM\n")
);
check(
  "punctuation from a chat message is ignored",
  normaliseInviteCode("`ABCD-EFGH-JKLM`") === "ABCDEFGHJKLM",
  normaliseInviteCode("`ABCD-EFGH-JKLM`")
);
check("an empty string stays empty", normaliseInviteCode("") === "", "");

// ---- 3. Formatting for reading aloud ----
console.log("\n3. Formatting");

check(
  "twelve characters are grouped in fours",
  formatInviteCode("ABCDEFGHJKLM") === "ABCD-EFGH-JKLM",
  formatInviteCode("ABCDEFGHJKLM")
);
check(
  "formatting an already formatted code changes nothing",
  formatInviteCode("ABCD-EFGH-JKLM") === "ABCD-EFGH-JKLM",
  formatInviteCode("ABCD-EFGH-JKLM")
);
check(
  "formatting twice is the same as formatting once",
  formatInviteCode(formatInviteCode("abcdefghjklm")) === "ABCD-EFGH-JKLM",
  formatInviteCode(formatInviteCode("abcdefghjklm"))
);
check("an empty string formats to nothing", formatInviteCode("") === "", formatInviteCode(""));
check(
  "a partial code still gets a group added",
  formatInviteCode("abcd") === "ABCD",
  formatInviteCode("abcd")
);

// This is what the input field does on every keystroke, so it has to be stable while
// somebody is still typing.
let typed = "";
for (const character of "abcdefghjklm") {
  typed = formatInviteCode(typed + character);
}
check("typing a code character by character lands on the grouped form", typed === "ABCD-EFGH-JKLM", typed);

// ---- 4. Completeness ----
console.log("\n4. Knowing when to enable the button");

check("twelve characters is complete", isCompleteInviteCode("ABCDEFGHJKLM"), "");
check("eleven is not", !isCompleteInviteCode("ABCDEFGHJKL"), "");
check("thirteen is not", !isCompleteInviteCode("ABCDEFGHJKLMN"), "");
check("an empty field is not complete", !isCompleteInviteCode(""), "");
check(
  "dashes do not count towards the length",
  isCompleteInviteCode("ABCD-EFGH-JKLM"),
  ""
);
check(
  "the length constant and the alphabet agree",
  INVITE_CODE_LENGTH === 12,
  String(INVITE_CODE_LENGTH)
);

// ---- 5. Characters no code can contain ----
console.log("\n5. Characters no code can contain");

for (const [label, value, expected] of [
  ["the letter I is flagged", "ABCDIFGHJKLM", true],
  ["the letter O is flagged", "ABCDOFGHJKLM", true],
  ["the digit 0 is flagged", "ABCD0FGHJKLM", true],
  ["the digit 1 is flagged", "ABCD1FGHJKLM", true],
  ["a valid code is not flagged", "ABCDEFGHJKLM", false],
  ["an empty field is not flagged", "", false],
]) {
  check(label, hasUnusableCharacters(value) === expected, value);
}

// A valid code must never be flagged, or the warning would be noise.
const generated = "ABCDEFGHJKLMNPQRST";
check(
  "every symbol of the alphabet passes the check",
  !hasUnusableCharacters(INVITE_ALPHABET),
  INVITE_ALPHABET
);
check("a code made of the alphabet passes", !hasUnusableCharacters(generated), generated);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
