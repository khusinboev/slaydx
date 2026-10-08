import type { SessionUser } from "../session";
import { formatPoints } from "../../referral";
import {
  FIELD_MAX,
  STEP_FIELDS,
  fieldStep,
  maskPhone,
  profileCompletion,
  shortName,
  type FieldStepId,
  type ProfileField,
} from "../../profile/fields";
import { cb } from "./codes";
import { FIELD_TEXT, fieldText, sectionKey, t, type Lang } from "./i18n";
import { appUrl, clip, esc, inlineButton, rows, tgEmoji, type IconKey, type Screen } from "./ui";

/**
 * «Profilim» screens (docs/bot/PLAN.md Q4, mockup screens 2–4): pure
 * renderers → `{ text, reply_markup }`. The card and the section views are
 * EDITED in place (one message), the «✅ Saqlandi» card is a new message
 * after the user's answer.
 *
 * Prompt design note: a message has ONE reply_markup — a ForceReply OR an
 * inline keyboard, never both. The mockup's prompt carries an inline
 * «✖️ Bekor qilish», so the prompt is the section message edited in place
 * with that button; the pending state (`state.ts`) makes the user's next
 * text the value, ForceReply is not needed for that.
 */

export type ProfileUser = Pick<
  SessionUser,
  | "id"
  | "name"
  | "phone"
  | "points"
  | "quota"
  | "balance"
  | "university"
  | "faculty"
  | "department"
  | "group"
  | "course"
  | "author"
  | "subject"
  | "teacher"
  | "city"
  | "position"
  | "organization"
>;

export const FIELD_ICONS: Record<ProfileField, IconKey> = {
  name: "name",
  author: "author",
  city: "city",
  university: "university",
  faculty: "faculty",
  department: "department",
  group: "group",
  course: "course",
  position: "position",
  organization: "organization",
  subject: "subject",
  teacher: "teacher",
};

export const SECTION_ICONS: Record<FieldStepId, IconKey> = { shaxsiy: "name", oqish: "study", ish: "work" };

const DASH = "—";
const v = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const shown = (s: string | null | undefined) => (v(s) ? `<b>${esc(v(s))}</b>` : DASH);

/** «TDPU · 3-kurs» — the study line of the card. */
export function studySummary(user: ProfileUser, lang: Lang): string {
  const course = v(user.course);
  const parts = [
    v(user.university) ? shortName(v(user.university)) : "",
    course ? (/^\d{1,2}$/.test(course) ? t(lang, "prof.course", { n: course }) : course) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** «Tarix o‘qituvchisi · 45-maktab» — the work line of the card. */
export function workSummary(user: ProfileUser): string {
  return [v(user.position), v(user.organization) ? shortName(v(user.organization), 24) : ""].filter(Boolean).join(" · ");
}

/** Total tanga as the web wallet shows it (`creditTotal`: points + quota + balance). */
export function creditTotal(user: Pick<ProfileUser, "points" | "quota" | "balance">): number {
  return (Number(user.points) || 0) + (Number(user.quota) || 0) + (Number(user.balance) || 0);
}

export function profileCard(user: ProfileUser, lang: Lang, inviteLink: string | null): Screen {
  const line = (icon: IconKey, label: string, value: string) => `${tgEmoji(icon)} ${label}: ${value || DASH}`;
  const study = studySummary(user, lang);
  const work = workSummary(user);
  const phone = maskPhone(user.phone);
  const text = [
    `${tgEmoji("profile")} <b>${t(lang, "prof.title")}</b>`,
    "",
    line("name", t(lang, "prof.name"), shown(user.name)),
    line("phone", t(lang, "prof.phone"), phone ? `<b>${esc(phone)}</b>` : ""),
    line("city", t(lang, "prof.city"), shown(user.city)),
    line("study", t(lang, "prof.study"), study ? `<b>${esc(study)}</b>` : ""),
    line("work", t(lang, "prof.work"), work ? `<b>${esc(work)}</b>` : ""),
    "",
    `<blockquote>${tgEmoji("wallet")} ${t(lang, "prof.money", {
      total: formatPoints(creditTotal(user)),
      star: tgEmoji("star"),
      points: formatPoints(user.points),
    })}\n${tgEmoji("save")} ${t(lang, "prof.complete", { p: profileCompletion(user) })}</blockquote>`,
    t(lang, "prof.lead"),
  ].join("\n");

  const wallet = appUrl("/uz/wallet");
  const full = appUrl("/uz/profile");
  return {
    text,
    reply_markup: rows(
      [
        inlineButton(SECTION_ICONS.shaxsiy, t(lang, "sec.shaxsiy"), { callback_data: cb.section("shaxsiy") }),
        inlineButton(SECTION_ICONS.oqish, t(lang, "sec.oqish"), { callback_data: cb.section("oqish") }),
      ],
      [
        inlineButton(SECTION_ICONS.ish, t(lang, "sec.ish"), { callback_data: cb.section("ish") }),
        wallet ? inlineButton("wallet", t(lang, "btn.wallet"), { web_app: { url: wallet } }) : null,
      ],
      [inviteLink ? inlineButton("link", t(lang, "btn.copyInvite"), { copy_text: { text: inviteLink.slice(0, 256) } }) : null],
      [inlineButton("lang", t(lang, "btn.lang"), { callback_data: cb.langMenu("p") })],
      [full ? inlineButton("app", t(lang, "btn.openFull"), { web_app: { url: full } }, "primary") : null],
    ),
  };
}

/** A field button: its label and the current value («Universitet · TDPU»). */
function fieldButtonLabel(user: ProfileUser, field: ProfileField, lang: Lang): string {
  const value = v(user[field]);
  const label = fieldText(lang, field, "label");
  // Long institution names read best as their acronym («TDPU»); other values are just cut.
  const short = field === "university" || field === "organization" ? shortName(value, 16) : clip(value, 22);
  return clip(`${label} · ${value ? short : DASH}`, 36);
}

export function sectionScreen(user: ProfileUser, step: FieldStepId, lang: Lang): Screen {
  const fields = STEP_FIELDS[step].map((f) => f.key);
  const text = [
    `${tgEmoji(SECTION_ICONS[step])} <b>${t(lang, sectionKey(step, "title"))}</b>`,
    `<i>${t(lang, sectionKey(step, "lead"))}</i>`,
    "",
    `<blockquote>${fields.map((f) => `${tgEmoji(FIELD_ICONS[f])} ${fieldText(lang, f, "label")}: ${shown(user[f])}`).join("\n")}</blockquote>`,
  ].join("\n");
  const buttons = fields.map((f) => inlineButton(FIELD_ICONS[f], fieldButtonLabel(user, f, lang), { callback_data: cb.edit(f) }));
  const pairs: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += 2) pairs.push(buttons.slice(i, i + 2));
  return {
    text,
    reply_markup: rows(...pairs, [inlineButton("back", t(lang, "btn.backProfile"), { callback_data: cb.profile() })]),
  };
}

export type InputError = { kind: "empty" } | { kind: "long"; length: number };

export function promptScreen(user: ProfileUser, field: ProfileField, lang: Lang, error?: InputError): Screen {
  const err = error
    ? `${tgEmoji("warn")} ${error.kind === "empty" ? t(lang, "err.empty") : t(lang, "err.long", { max: FIELD_MAX, n: error.length })}\n\n`
    : "";
  const text = [
    `${err}${tgEmoji(FIELD_ICONS[field])} <b>${fieldText(lang, field, "prompt")}</b>`,
    t(lang, "prompt.current", { v: shown(user[field]) }),
    `<i>${esc(t(lang, "prompt.example", { v: fieldText(lang, field, "example") }))}</i>`,
    "",
    `${tgEmoji("edit")} ${t(lang, "prompt.howto")}`,
  ].join("\n");
  return { text, reply_markup: rows([inlineButton("cancel", t(lang, "btn.cancel"), { callback_data: cb.cancel() }, "danger")]) };
}

export function savedScreen(field: ProfileField, value: string, lang: Lang): Screen {
  const step = fieldStep(field) ?? "shaxsiy";
  const text = [
    `${tgEmoji("save")} <b>${t(lang, "saved.title")}</b>`,
    `<blockquote>${tgEmoji(FIELD_ICONS[field])} ${fieldText(lang, field, "label")}: <b>${esc(value)}</b></blockquote>`,
    t(lang, sectionKey(step, "saved")),
  ].join("\n");
  return {
    text,
    reply_markup: rows([
      inlineButton(SECTION_ICONS[step], t(lang, sectionKey(step, "button")), { callback_data: cb.section(step) }),
      inlineButton("profile", t(lang, "prof.title"), { callback_data: cb.profile() }, "success"),
    ]),
  };
}

/** Every field has bot texts in all languages (compile-time via the Record; this is for tests). */
export const BOT_FIELDS = Object.keys(FIELD_TEXT) as ProfileField[];
