/**
 * The slide deck as plain text for the examiner (owner request 15). Pure: reads the `SlideModel[]` stored in
 * `generations.doc_json` and keeps what a student could be asked about -- titles, bullets, columns, numbers, steps,
 * tables, quotes and speaker notes. The title slide, the quiz and its answers are not content to defend.
 */
import type { SlideModel } from "../generation/slide-types";

export const DECK_TEXT_MAX_CHARS = 9000;

const SKIP_LAYOUTS = new Set(["quiz", "answers", "references"]);

const one = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

function slideLines(s: SlideModel): string[] {
  const lines: string[] = [];
  const push = (label: string, v: unknown) => {
    const t = one(v);
    if (t) lines.push(label === "-" ? `- ${t}` : label ? `${label}: ${t}` : t);
  };
  push("", s.title);
  push("", s.subtitle);
  for (const b of s.bullets ?? []) push("-", b);
  if (s.left?.length || s.right?.length) {
    push("Chap", s.leftTitle);
    for (const b of s.left ?? []) push("-", b);
    push("O'ng", s.rightTitle);
    for (const b of s.right ?? []) push("-", b);
  }
  for (const st of s.stats ?? []) push("Raqam", `${one(st.value)} - ${one(st.label)}`);
  for (const st of s.steps ?? []) push("Bosqich", `${one(st.n)} ${one(st.title)}: ${one(st.text)}`);
  if (s.table) {
    push("Jadval", (s.table.headers ?? []).map(one).join(" | "));
    for (const row of s.table.rows ?? []) push("", (row ?? []).map(one).join(" | "));
  }
  push("Iqtibos", s.quote);
  push("Izoh", s.notes);
  return lines;
}

/**
 * `[Slayd N] ...` blocks, cut at a slide boundary once `max` characters are reached (a deck of 30 slides must not
 * flood the prompt; the first slides carry the structure, the cut is announced to the model).
 */
export function deckText(slides: readonly SlideModel[] | null | undefined, max: number = DECK_TEXT_MAX_CHARS): string {
  const out: string[] = [];
  let used = 0;
  let n = 0;
  for (const s of slides ?? []) {
    n++;
    if (!s || s.layout === "title" || SKIP_LAYOUTS.has(s.layout)) continue;
    const lines = slideLines(s);
    if (!lines.length) continue;
    const block = `[Slayd ${n}]\n${lines.join("\n")}`;
    if (used + block.length > max) {
      out.push("[...qolgan slaydlar qisqartirildi]");
      break;
    }
    out.push(block);
    used += block.length + 2;
  }
  return out.join("\n\n");
}
