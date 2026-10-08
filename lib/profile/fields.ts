/**
 * Profile (redesign W4): the pure model behind the index rows and the step
 * pages — step order, the fields of each step, completion counts, the value
 * hints on the right of each row and the PATCH payload filter.
 *
 * Shared by the web profile (`components/profile/*`, re-exported from
 * `components/profile/profile-model.ts`), the server writer
 * (`lib/server/profile.ts updateProfile`) and the bot's «Profilim»
 * (`lib/server/bot/profile.ts`) — one field list, one limit.
 *
 * No React here, so `tests/profile-model.test.mts` locks it directly.
 */
import type { ServerUser } from "../api-client";

/**
 * The writer fields the profile edits. Exactly the server allowlist
 * (`EDITABLE_FIELDS`, used by `PATCH /api/users/me` and the bot) minus
 * `language`, which only the bot's «Til» screen edits. Anything else in a
 * draft never reaches the request.
 */
export const PROFILE_FIELDS = [
  "name",
  "author",
  "city",
  "university",
  "faculty",
  "department",
  "group",
  "course",
  "position",
  "organization",
  "subject",
  "teacher",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileValues = Pick<ServerUser, ProfileField>;

/** The server rejects longer values (`route.ts`: strings ≤ 200). */
export const FIELD_MAX = 200;

/** The «Sozlamalar» group: one flow, a 4-segment progress bar, «Saqlash va keyingisi». */
export const SETTINGS_STEPS = ["shaxsiy", "oqish", "ish", "korinish"] as const;
/** Every step route `/uz/profile/<id>`; `xavfsizlik` sits in «Hisob», outside the flow. */
export const PROFILE_STEPS = [...SETTINGS_STEPS, "xavfsizlik"] as const;

export type ProfileStepId = (typeof PROFILE_STEPS)[number];
export type FieldStepId = Exclude<ProfileStepId, "korinish" | "xavfsizlik">;
/** Where a profile control asks to go: a step, or back to the index. */
export type ProfileTarget = ProfileStepId | "home";

export function isProfileStepId(value: string | null | undefined): value is ProfileStepId {
  return (PROFILE_STEPS as readonly string[]).includes(value ?? "");
}

export function profileHref(target: ProfileTarget): string {
  return target === "home" ? "/uz/profile" : `/uz/profile/${target}`;
}

export const STEP_META: Record<ProfileStepId, { title: string; lead: string }> = {
  shaxsiy: {
    title: "Shaxsiy ma'lumotlar",
    lead: "Ism va muallif har yangi ishning titul sahifasiga o'zi yoziladi.",
  },
  oqish: {
    title: "O'qish joyi",
    lead: "Kurs ishi, referat va mustaqil ish titulida shu ma'lumotlar chiqadi.",
  },
  ish: {
    title: "Ish joyi",
    lead: "Slayd, dars rejasi va maqolada muallif lavozimi va tashkiloti sifatida ishlatiladi.",
  },
  korinish: {
    title: "Ko'rinish",
    lead: "Ilova qaysi rangda ko'rinsin.",
  },
  xavfsizlik: {
    title: "Xavfsizlik va chiqish",
    lead: "Hisobingizga kirilgan qurilmalar va chiqish.",
  },
};

export type FieldSpec = {
  key: ProfileField;
  label: string;
  helper?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric";
};

export const STEP_FIELDS: Record<FieldStepId, readonly FieldSpec[]> = {
  shaxsiy: [
    { key: "name", label: "Ism", helper: "Profilda va salomlashishda ko'rinadi.", placeholder: "Masalan: Dilnoza", autoComplete: "given-name" },
    {
      key: "author",
      label: "Muallif (F.I.Sh)",
      helper: "Titul sahifasiga muallif sifatida yoziladi.",
      placeholder: "Masalan: Karimova Dilnoza Akmalovna",
      autoComplete: "name",
    },
    { key: "city", label: "Shahar", helper: "Titul sahifasining pastida yoziladi.", placeholder: "Toshkent", autoComplete: "address-level2" },
  ],
  oqish: [
    { key: "university", label: "Universitet", placeholder: "Masalan: Toshkent davlat pedagogika universiteti", autoComplete: "organization" },
    { key: "faculty", label: "Fakultet", placeholder: "Masalan: Tarix fakulteti" },
    { key: "department", label: "Kafedra", placeholder: "Masalan: Jahon tarixi kafedrasi" },
    { key: "group", label: "Guruh", placeholder: "Masalan: 301-guruh" },
    { key: "course", label: "Kurs", helper: "Faqat raqam ham bo'ladi: 3", placeholder: "Masalan: 3", inputMode: "numeric" },
  ],
  ish: [
    { key: "position", label: "Lavozim", placeholder: "Masalan: tarix fani o'qituvchisi", autoComplete: "organization-title" },
    { key: "organization", label: "Tashkilot (maktab, markaz)", placeholder: "Masalan: 45-umumta'lim maktabi", autoComplete: "organization" },
    { key: "subject", label: "Fan", helper: "Dars rejasi, test va talaba ishlarida fan nomi.", placeholder: "Masalan: Tarix" },
    {
      key: "teacher",
      label: "Ilmiy rahbar (o'qituvchi)",
      helper: "Talaba ishi titulida «Ilmiy rahbar» yoki «Tekshirdi» qatoriga yoziladi.",
      placeholder: "Masalan: Aliyev Jasur",
    },
  ],
};

export function isFieldStep(step: ProfileStepId): step is FieldStepId {
  return step in STEP_FIELDS;
}

/** Position in the 4-step flow (0-based), or -1 for `xavfsizlik`. */
export function stepIndex(step: ProfileStepId): number {
  return (SETTINGS_STEPS as readonly string[]).indexOf(step);
}

/** «Saqlash va keyingisi»: the next flow step; the last one (and `xavfsizlik`) returns to the index. */
export function nextStep(step: ProfileStepId): ProfileTarget {
  const i = stepIndex(step);
  if (i < 0 || i === SETTINGS_STEPS.length - 1) return "home";
  return SETTINGS_STEPS[i + 1]!;
}

const filled = (v: string | null | undefined) => (v ?? "").trim().length > 0;

/** Filled / total fields of a field step (0/0 for the others). */
export function stepCompletion(user: Partial<ProfileValues>, step: ProfileStepId): { filled: number; total: number } {
  if (!isFieldStep(step)) return { filled: 0, total: 0 };
  const fields = STEP_FIELDS[step];
  return { filled: fields.filter((f) => filled(user[f.key])).length, total: fields.length };
}

/** Lower-case words skipped by the acronym («Toshkent davlat …» → «TDPU», not «TDPUva»). */
const SKIP = new Set(["va", "nomidagi", "and", "of", "the", "for", "im.", "имени"]);

/**
 * A short label for a long organisation name (row hint): kept as is when it
 * fits, otherwise the acronym of its words — «Toshkent davlat pedagogika
 * universiteti» → «TDPU». A name before «nomidagi» is dropped («Nizomiy
 * nomidagi TDPU» → «TDPU»). A single long word or a numbered name
 * («45-umumta'lim maktabi») is cut with «…».
 */
export function shortName(value: string, max = 14): string {
  const s = value.trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  let words = s.split(" ");
  const at = words.findIndex((w) => w.toLowerCase() === "nomidagi");
  if (at >= 0 && at < words.length - 1) words = words.slice(at + 1);
  const significant = words
    .filter((w) => !SKIP.has(w.toLowerCase()))
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  // «45-maktab …» has no useful acronym: numbered names are cut instead.
  if (significant.length >= 2 && significant.every((w) => /^\p{L}/u.test(w))) {
    const acronym = significant.map((w) => w[0]!.toUpperCase()).join("");
    if (acronym.length <= max) return acronym;
  }
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export const EMPTY_HINT = "Kiritilmagan";

/**
 * The value hint on the right of an index row:
 *   - shaxsiy: «2/3» (filled of total), «Kiritilmagan» when empty;
 *   - oqish: the university's short name, else «n/5»;
 *   - ish: the organisation's short name, else the position, else «n/4»;
 *   - korinish: «Kun» / «Tun» / «Avto» (`themeLabel`);
 *   - xavfsizlik: none.
 */
export function rowHint(step: ProfileStepId, user: Partial<ProfileValues>, themeLabel = ""): string {
  if (step === "korinish") return themeLabel;
  if (step === "xavfsizlik") return "";
  const { filled: n, total } = stepCompletion(user, step);
  if (step === "oqish" && filled(user.university)) return shortName(user.university!);
  if (step === "ish") {
    if (filled(user.organization)) return shortName(user.organization!);
    if (filled(user.position)) return shortName(user.position!);
  }
  return n === 0 ? EMPTY_HINT : `${n}/${total}`;
}

/**
 * The PATCH body from a draft: only allowlisted string fields, each clipped
 * to the server's limit. Unknown keys (`balance`, `isAdmin`, …) never leave.
 */
export function profilePatch(draft: Record<string, unknown>): Partial<Record<ProfileField, string>> {
  const out: Partial<Record<ProfileField, string>> = {};
  for (const key of PROFILE_FIELDS) {
    const v = draft[key];
    if (typeof v === "string") out[key] = v.slice(0, FIELD_MAX);
  }
  return out;
}

/** `998901234567` / `+998 90 123-45-67` → «+998 90 123 45 67»; other shapes as given. */
export function formatPhone(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("998")) {
    return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  return phone ? (phone.startsWith("+") ? phone : `+${d || phone}`) : "";
}

/** The second line under the name: «@username», the phone, or both. */
export function identityLine(user: Pick<ServerUser, "username" | "phone">): string {
  const parts: string[] = [];
  if (user.username) parts.push(`@${user.username}`);
  const phone = formatPhone(user.phone);
  if (phone) parts.push(phone);
  return parts.join(" · ");
}

/* ───────────── Server allowlist + bot helpers (docs/bot/PLAN.md, B2) ───────────── */

/**
 * Bot interface languages (`users.language`). The web app stays Uzbek; the
 * column only drives the bot's texts. Anything else is never written.
 */
export const BOT_LANGUAGES = ["uz", "ru", "en"] as const;
export type BotLanguage = (typeof BOT_LANGUAGES)[number];

export function isBotLanguage(value: unknown): value is BotLanguage {
  return typeof value === "string" && (BOT_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Every column a user may change about themselves — `PATCH /api/users/me`
 * and the bot both go through `lib/server/profile.ts updateProfile` with this
 * list. `points`/`quota`/`balance`/`plan`/`phone` are never here: otherwise a
 * user could write themselves credit.
 */
export const EDITABLE_FIELDS = [...PROFILE_FIELDS, "language"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** NUL bytes stripped, outer spaces trimmed (the stored shape of every text field). */
export function cleanFieldValue(value: string): string {
  // Control and format characters (newlines, bidi overrides like U+202E) out — ZWNJ/ZWJ stay (emoji, scripts);
  // runs of whitespace become one space: a profile field is one line.
  return value
    .replace(/\0/g, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\u200c" || c === "\u200d" ? c : " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function isProfileField(value: unknown): value is ProfileField {
  return typeof value === "string" && (PROFILE_FIELDS as readonly string[]).includes(value);
}

/** The section (step) a field belongs to; `null` for an unknown key. */
export function fieldStep(field: string): FieldStepId | null {
  for (const step of Object.keys(STEP_FIELDS) as FieldStepId[]) {
    if (STEP_FIELDS[step].some((f) => f.key === field)) return step;
  }
  return null;
}

/** Filled share of all profile fields, 0–100 (the bot card's «Profil 70% to‘ldirilgan»). */
export function profileCompletion(user: Partial<ProfileValues>): number {
  const n = PROFILE_FIELDS.filter((k) => filled(user[k])).length;
  return Math.round((n / PROFILE_FIELDS.length) * 100);
}

/**
 * A phone for a chat card (a chat can be forwarded or seen over a shoulder):
 * the `formatPhone` shape with the middle digits hidden — «+998 90 ••• •• 67».
 * Any other shape keeps its first 4 and last 2 digits.
 */
export function maskPhone(phone: string | null | undefined): string {
  const shown = formatPhone(phone);
  if (!shown) return "";
  const total = shown.replace(/\D/g, "").length;
  const keepHead = shown.startsWith("+998 ") && total === 12 ? 5 : 4;
  let seen = 0;
  return shown.replace(/\d/g, (d) => {
    seen += 1;
    return seen <= keepHead || seen > total - 2 ? d : "•";
  });
}
