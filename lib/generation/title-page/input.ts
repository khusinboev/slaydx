import type { FormValues } from "../../types";
import { tashkentYear } from "../tashkent-year";
import {
  TITUL_APPROVER_ROLES,
  TITUL_CHECKER_LABELS,
  TITUL_LAB_KINDS,
  TITUL_LAYOUTS_OF,
  TITUL_LIMITS,
  TITUL_MINISTRIES,
  isTitulLang,
  isTitulLayout,
  isTitulWorkType,
  type TitulInput,
  type TitulLayoutId,
  type TitulWorkType,
} from "./types";

/**
 * Form values -> normalized `TitulInput` — the ONE reader of the form (the
 * engine, the form's draft restore and the probe test all go through here).
 * Pure and isomorphic. Unknown enum values fall to the default, texts are
 * whitespace-collapsed and cut to `TITUL_LIMITS`; nothing throws.
 */

/** Form field ids — the same strings as the `FormValues` keys and the `data-field` probes. */
export const TITUL_FIELD_IDS = [
  "workType",
  "layout",
  "lang",
  "ministry",
  "ministryCustom",
  "university",
  "faculty",
  "department",
  "subject",
  "topic",
  "author",
  "group",
  "course",
  "direction",
  "directionCode",
  "supervisor",
  "supervisorRole",
  "checkerLabel",
  "approverRole",
  "approver",
  "reviewer",
  "udk",
  "specialityCode",
  "speciality",
  "labKind",
  "labNumber",
  "city",
  "year",
  "border",
] as const satisfies readonly (keyof TitulInput)[];
export type TitulFieldId = (typeof TITUL_FIELD_IDS)[number];

const line = (v: unknown, max: number): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

function pick<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  const s = String(v ?? "");
  return (list as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** The default layout of a work type (the first offered one). */
export function defaultTitulLayout(type: TitulWorkType): TitulLayoutId {
  return TITUL_LAYOUTS_OF[type][0]!;
}

/** The layout actually used: the asked one when it is offered for the type, else the type's default. */
export function titulLayoutFor(type: TitulWorkType, layout: unknown): TitulLayoutId {
  return isTitulLayout(layout) && TITUL_LAYOUTS_OF[type].includes(layout) ? layout : defaultTitulLayout(type);
}

/** Border default: on for the owner's `classic` sample, off for the others. */
export const titulBorderDefault = (layout: TitulLayoutId): boolean => layout === "classic";

function bool(v: unknown, fallback: boolean): boolean {
  if (v === true || v === "true" || v === "1" || v === 1 || v === "on") return true;
  if (v === false || v === "false" || v === "0" || v === 0 || v === "off") return false;
  return fallback;
}

function year(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= TITUL_LIMITS.yearMin && n <= TITUL_LIMITS.yearMax ? n : tashkentYear();
}

export function titulInputFromValues(values: FormValues): TitulInput {
  const workType = isTitulWorkType(values.workType) ? values.workType : "coursework";
  const layout = titulLayoutFor(workType, values.layout);
  const L = TITUL_LIMITS;
  return {
    workType,
    layout,
    lang: isTitulLang(values.lang) ? values.lang : "uz",
    ministry: pick(values.ministry, TITUL_MINISTRIES, "oliy"),
    // The custom ministry may have two lines (a second ministry line, as at TATU).
    ministryCustom: String(values.ministryCustom ?? "")
      .split(/\r?\n/)
      .map((l) => line(l, L.ministryCustom))
      .filter(Boolean)
      .slice(0, 2)
      .join("\n"),
    university: line(values.university, L.university),
    faculty: line(values.faculty, L.faculty),
    department: line(values.department, L.department),
    subject: line(values.subject, L.subject),
    topic: line(values.topic, L.topic),
    author: line(values.author, L.name),
    group: line(values.group, L.group),
    course: line(values.course, L.course).replace(/[^0-9]/g, ""),
    direction: line(values.direction, L.direction),
    directionCode: line(values.directionCode, L.directionCode),
    supervisor: line(values.supervisor, L.name),
    supervisorRole: line(values.supervisorRole, L.role),
    checkerLabel: pick(values.checkerLabel, TITUL_CHECKER_LABELS, "accepted"),
    approverRole: pick(values.approverRole, TITUL_APPROVER_ROLES, "dean"),
    approver: line(values.approver, L.name),
    reviewer: line(values.reviewer, L.name + L.role),
    udk: line(values.udk, L.udk),
    specialityCode: line(values.specialityCode, L.specialityCode),
    speciality: line(values.speciality, L.speciality),
    labKind: pick(values.labKind, TITUL_LAB_KINDS, "lab"),
    labNumber: line(values.labNumber, L.labNumber).replace(/[^0-9]/g, ""),
    city: line(values.city, L.city),
    year: year(values.year),
    border: bool(values.border, titulBorderDefault(layout)),
  };
}

/** `TitulInput` -> the values the form sends (the inverse of `titulInputFromValues` for a normalized input). */
export function encodeTitulValues(input: TitulInput): FormValues {
  const out: FormValues = {};
  for (const id of TITUL_FIELD_IDS) out[id] = input[id];
  return out;
}

/**
 * Fields that change the page for this type × layout — the form draws ONLY
 * these («bezak maydon yo'q»), and the probe test changes each of them and
 * expects the plan to change. `workType`, `layout`, `lang`, `ministry`,
 * `topic`, `city`, `year`, `border` act everywhere.
 */
export function titulFieldsOf(type: TitulWorkType, layout: TitulLayoutId, ministry: string): readonly TitulFieldId[] {
  const out: TitulFieldId[] = ["workType", "layout", "lang", "ministry"];
  if (ministry === "custom") out.push("ministryCustom");
  out.push("university");
  if (layout !== "dissertation") out.push("faculty");
  out.push("department");
  if (layout === "classic" || layout === "mavzusida" || layout === "right-block") out.push("subject");
  out.push("topic", "author");
  if (layout !== "dissertation") out.push("group", "course");
  if (layout === "right-block" || layout === "bmi-official") out.push("direction", "directionCode");
  out.push("supervisor", "supervisorRole");
  if (layout === "classic" || layout === "mavzusida" || layout === "right-block") out.push("checkerLabel");
  if (layout === "bmi-official") out.push("approverRole", "approver", "reviewer");
  if (layout === "dissertation") out.push("udk", "specialityCode", "speciality");
  if (type === "lab") out.push("labKind", "labNumber");
  out.push("city", "year", "border");
  return out;
}
