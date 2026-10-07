import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_HINT,
  FIELD_MAX,
  PROFILE_FIELDS,
  PROFILE_STEPS,
  SETTINGS_STEPS,
  STEP_FIELDS,
  formatPhone,
  identityLine,
  isProfileStepId,
  nextStep,
  profileHref,
  profilePatch,
  rowHint,
  shortName,
  stepCompletion,
  stepIndex,
} from "../components/profile/profile-model.ts";

/**
 * Profile model (redesign W4): step order, completion, row hints, PATCH filter.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `profilePatch` copies every draft key (no allowlist) → «only allowlisted keys»;
 *   2. `nextStep` of the last flow step returns the first step instead of "home" → «step order»;
 *   3. `rowHint` for oqish ignores the university (always n/5) → «oqish hint»;
 *   4. `shortName` keeps the words before «nomidagi» → «acronym».
 */

// Server allowlist (app/api/users/me/route.ts) — `language` is allowed but never edited here.
const SERVER_ALLOWLIST = [
  "name", "language", "university", "faculty", "department", "group", "course",
  "author", "subject", "teacher", "city", "position", "organization",
];

test("fields: every edited key is server-allowlisted and appears in exactly one step", () => {
  for (const k of PROFILE_FIELDS) assert.ok(SERVER_ALLOWLIST.includes(k), k);
  const inSteps = Object.values(STEP_FIELDS).flatMap((fs) => fs.map((f) => f.key));
  assert.deepEqual([...inSteps].sort(), [...PROFILE_FIELDS].sort());
  assert.equal(new Set(inSteps).size, inSteps.length);
  assert.deepEqual(STEP_FIELDS.shaxsiy.map((f) => f.key), ["name", "author", "city"]);
  assert.deepEqual(STEP_FIELDS.oqish.map((f) => f.key), ["university", "faculty", "department", "group", "course"]);
  assert.deepEqual(STEP_FIELDS.ish.map((f) => f.key), ["position", "organization", "subject", "teacher"]);
});

test("profilePatch: only allowlisted string keys, clipped to the server limit", () => {
  const out = profilePatch({
    name: "Ali",
    balance: 999_999,
    isAdmin: true,
    points: "100",
    phone: "+998901234567",
    city: "x".repeat(FIELD_MAX + 50),
    course: 3,
  });
  assert.deepEqual(Object.keys(out).sort(), ["city", "name"]);
  assert.equal(out.name, "Ali");
  assert.equal(out.city!.length, FIELD_MAX);
  assert.deepEqual(profilePatch({}), {});
});

test("step order: 4-step flow, last returns home, xavfsizlik outside the flow", () => {
  assert.deepEqual([...SETTINGS_STEPS], ["shaxsiy", "oqish", "ish", "korinish"]);
  assert.deepEqual([...PROFILE_STEPS], ["shaxsiy", "oqish", "ish", "korinish", "xavfsizlik"]);
  assert.equal(nextStep("shaxsiy"), "oqish");
  assert.equal(nextStep("oqish"), "ish");
  assert.equal(nextStep("ish"), "korinish");
  assert.equal(nextStep("korinish"), "home");
  assert.equal(nextStep("xavfsizlik"), "home");
  assert.equal(stepIndex("shaxsiy"), 0);
  assert.equal(stepIndex("korinish"), 3);
  assert.equal(stepIndex("xavfsizlik"), -1);
  assert.equal(profileHref("home"), "/uz/profile");
  assert.equal(profileHref("oqish"), "/uz/profile/oqish");
  assert.ok(isProfileStepId("ish"));
  assert.ok(!isProfileStepId("ledger"));
  assert.ok(!isProfileStepId(null));
});

test("completion: counts non-blank fields of the step", () => {
  assert.deepEqual(stepCompletion({ name: "Ali", author: "  ", city: "Toshkent" }, "shaxsiy"), { filled: 2, total: 3 });
  assert.deepEqual(stepCompletion({}, "oqish"), { filled: 0, total: 5 });
  assert.deepEqual(stepCompletion({ position: "o'qituvchi", subject: "Tarix" }, "ish"), { filled: 2, total: 4 });
  assert.deepEqual(stepCompletion({ name: "Ali" }, "korinish"), { filled: 0, total: 0 });
});

test("row hints: shaxsiy n/3, oqish university short name, ish organisation/position, korinish theme label", () => {
  assert.equal(rowHint("shaxsiy", { name: "Ali", author: "Aliyev Ali", city: "" }), "2/3");
  assert.equal(rowHint("shaxsiy", { name: "", author: "", city: "" }), EMPTY_HINT);
  assert.equal(rowHint("oqish", { university: "Toshkent davlat pedagogika universiteti" }), "TDPU");
  assert.equal(rowHint("oqish", { university: "", faculty: "Tarix", course: "3" }), "2/5");
  assert.equal(rowHint("oqish", {}), EMPTY_HINT);
  assert.equal(rowHint("ish", { organization: "45-umumta'lim maktabi", position: "o'qituvchi" }), "45-umumta'lim…");
  assert.equal(rowHint("ish", { organization: "", position: "o'qituvchi" }), "o'qituvchi");
  assert.equal(rowHint("ish", { subject: "Tarix" }), "1/4");
  assert.equal(rowHint("korinish", {}, "Avto"), "Avto");
  assert.equal(rowHint("xavfsizlik", { name: "Ali" }), "");
});

test("shortName: short kept, long → acronym, «nomidagi» prefix dropped, single long word cut", () => {
  assert.equal(shortName("TATU"), "TATU");
  assert.equal(shortName("  Samarqand   DU "), "Samarqand DU");
  assert.equal(shortName("Toshkent davlat pedagogika universiteti"), "TDPU");
  assert.equal(shortName("Nizomiy nomidagi Toshkent davlat pedagogika universiteti"), "TDPU");
  assert.equal(shortName("Toshkent axborot texnologiyalari universiteti"), "TATU");
  assert.equal(shortName("O'zbekiston Milliy universiteti"), "OMU");
  assert.equal(shortName("Toshkentkimyotexnologiya"), "Toshkentkimyo…");
});

test("phone and identity line", () => {
  assert.equal(formatPhone("998901234567"), "+998 90 123 45 67");
  assert.equal(formatPhone("+998 90 111-22-33"), "+998 90 111 22 33");
  assert.equal(formatPhone(null), "");
  assert.equal(identityLine({ username: "ali_dev", phone: "998901234567" }), "@ali_dev · +998 90 123 45 67");
  assert.equal(identityLine({ username: null, phone: "998901112233" }), "+998 90 111 22 33");
  assert.equal(identityLine({ username: null, phone: null }), "");
});
