import type { AcademicDoc } from "../types";
import { planTitlePage, titulRuns } from "./layout";
import type { TitulModel } from "./types";

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

/** Longest text one run may hold (a whole topic plus room for a correction). */
export const TITUL_EDIT_MAX = 300;

type Ok = { ok: true; doc: AcademicDoc };
type Fail = { ok: false; error: string; at: number };

/** Run ids a user may edit on this model's page. */
export function titulEditableIds(model: TitulModel): Set<string> {
  return new Set(titulRuns(planTitlePage({ input: model.input, overrides: {} })).map((r) => r.id));
}

const clean = (v: string) => v.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, TITUL_EDIT_MAX);

export function applyTitulOps(doc: AcademicDoc, ops: TitulOp[]): Ok | Fail {
  const model = doc.titul;
  if (!model) return { ok: false, error: "Titul modeli yo‘q", at: 0 };
  const ids = titulEditableIds(model);
  const overrides = { ...model.overrides };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op !== "text" || !ids.has(op.id)) return { ok: false, error: "Bu matnni tahrirlab bo‘lmaydi", at: i };
    if (op.value === null) delete overrides[op.id];
    else overrides[op.id] = clean(op.value);
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
