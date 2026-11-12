import type { AcademicDoc } from "../types";
import { planTitlePage, titulRuns } from "./layout";
import { xmlSafeText } from "../xml";
import { TITUL_LIMITS, type TitulModel } from "./types";

/**
 * In-place edits of a «Titul» page (isomorphic: the viewer applies them
 * optimistically, the server re-applies them in `commitDocOps`).
 *
 * One op: `{ op: "text", id, value }` — the text of the run `id` becomes
 * `value`; `value: null` removes the edit (back to the generated text).
 * `id` must be a run of the page as generated WITHOUT edits, so a request can
 * neither invent keys (the stored model stays bounded) nor touch a field that
 * is not on this page.
 */

export type TitulOp = { op: "text"; id: string; value: string | null };

/** Absolute ceiling of one run's text; each run is first clamped to its own field's limit (`titulEditLimit`). */
export const TITUL_EDIT_MAX = 300;

const L = TITUL_LIMITS;
/** Room for the fixed words a generated run adds around the field («… fakulteti», «по дисциплине «…»», «(…-kurs, … guruhi)»). */
const AROUND = 30;

/**
 * The longest text an edit may give a run — the field's form limit (plus the fixed words of that run), so one
 * viewer edit cannot make the page longer than the form could: `tests/titul-docx` renders every run at this limit
 * on a maximal page and still gets ONE A4 sheet.
 */
const RUN_LIMITS: Record<string, number> = {
  ministry: L.ministryCustom,
  university: L.university,
  faculty: L.faculty + AROUND,
  department: L.department + AROUND,
  subject: L.subject + AROUND,
  heading: 40,
  topic: L.topic,
  "topic.value": L.topic,
  topicPhrase: 20,
  "author.value": L.name,
  "author.student": L.course + L.group + AROUND,
  "author.note": L.course + L.group + AROUND,
  "author.direction": L.direction + L.directionCode + AROUND,
  "supervisor.value": L.name,
  "supervisor.role": L.role,
  "supervisor.note": L.role + 2,
  "approve.value": L.name,
  "approve.title": Math.max(L.faculty, L.department) + AROUND,
  "approve.date": 40,
  "reviewer.value": L.name + L.role,
  "udk.value": L.udk,
  purpose: L.speciality + L.specialityCode + 90,
  manuscript: 30,
  cityYear: L.city + 10,
};
/** Labels and other fixed words («Bajardi:», «Himoyaga ruxsat etilsin», «________»). */
const LABEL_LIMIT = 30;

export function titulEditLimit(id: string): number {
  const own = Object.prototype.hasOwnProperty.call(RUN_LIMITS, id) ? RUN_LIMITS[id]! : id.startsWith("ministry.") ? L.ministryCustom : LABEL_LIMIT;
  return Math.min(own, TITUL_EDIT_MAX);
}

type Ok = { ok: true; doc: AcademicDoc };
type Fail = { ok: false; error: string; at: number };

/** Run ids a user may edit on this model's page. */
export function titulEditableIds(model: TitulModel): Set<string> {
  return new Set(titulRuns(planTitlePage({ input: model.input, overrides: {} })).map((r) => r.id));
}

/** Typed / pasted text: XML-forbidden characters out (`xmlSafeText`), one line, cut to the run's own limit. */
const clean = (id: string, v: string) =>
  xmlSafeText(v).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, titulEditLimit(id)).trim();

export function applyTitulOps(doc: AcademicDoc, ops: TitulOp[]): Ok | Fail {
  const model = doc.titul;
  if (!model) return { ok: false, error: "Titul modeli yo‘q", at: 0 };
  const ids = titulEditableIds(model);
  const overrides = { ...model.overrides };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op !== "text" || !ids.has(op.id)) return { ok: false, error: "Bu matnni tahrirlab bo‘lmaydi", at: i };
    if (op.value === null) delete overrides[op.id];
    else overrides[op.id] = clean(op.id, op.value);
  }
  return { ok: true, doc: { ...doc, titul: { ...model, overrides } } };
}

/** The ops that undo `ops` on `doc` (applied in reverse order). */
export function inverseTitulOps(doc: AcademicDoc, ops: TitulOp[]): TitulOp[] {
  const cur = { ...(doc.titul?.overrides ?? {}) };
  const out: TitulOp[] = [];
  for (const op of ops) {
    const had = Object.prototype.hasOwnProperty.call(cur, op.id);
    out.unshift({ op: "text", id: op.id, value: had ? cur[op.id]! : null });
    if (op.value === null) delete cur[op.id];
    else cur[op.id] = op.value;
  }
  return out;
}

/** PATCH body -> typed ops (the shape only; `applyTitulOps` checks the ids against the page). */
export function parseTitulOps(raw: unknown): { ok: true; ops: TitulOp[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  const ops: TitulOp[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return { ok: false, error: "Noto'g'ri operatsiya" };
    const o = r as Record<string, unknown>;
    if (o.op !== "text" || typeof o.id !== "string" || !/^[a-zA-Z]+(\.[a-zA-Z0-9]+)?$/.test(o.id) || o.id.length > 40) {
      return { ok: false, error: "Noto'g'ri operatsiya" };
    }
    if (o.value !== null && typeof o.value !== "string") return { ok: false, error: "Noto'g'ri operatsiya" };
    if (typeof o.value === "string" && o.value.length > TITUL_EDIT_MAX * 2) return { ok: false, error: "Matn juda uzun" };
    ops.push({ op: "text", id: o.id, value: o.value as string | null });
  }
  return { ok: true, ops };
}
