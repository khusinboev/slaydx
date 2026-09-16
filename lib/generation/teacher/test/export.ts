/**
 * GIFT EKSPORTI (Moodle) — AUDIT-20 WP-B, R3 §2 «eng arzon interop».
 *
 * Sof funksiya, bog'liqliksiz: `TestModel` → `.txt` satri. Chiqishga
 * ulash (tugma, fayl) AUDIT-22 da — shuning uchun bu yerda faqat
 * FORMAT, hech qanday I/O yo'q.
 *
 * GIFT sintaksisi: `::sarlavha:: savol {=to'g'ri ~noto'g'ri}`;
 * `truefalse` — `{T}`/`{F}`; ochiq qisqa javob — `{=javob}`;
 * moslik — `{=chap -> o'ng}`. Maxsus belgilar (`~ = # { } :`) ekranlanadi.
 */
import type { TestMatchPair, TestModel, TestQuestion } from "../types";

/** GIFT da ma'noli belgilar — teskari chiziq bilan ekranlanadi. */
export function giftEscape(s: string): string {
  return String(s ?? "")
    .replace(/([~=#{}:\\])/g, "\\$1")
    .replace(/\r?\n/g, " ")
    .trim();
}

function giftBody(q: TestQuestion): string | null {
  switch (q.kind) {
    case "single": {
      const answer = Number(q.answer);
      const opts = q.options.map((o, i) => `${i === answer ? "=" : "~"}${giftEscape(o)}`);
      return opts.length ? `{${opts.join(" ")}}` : null;
    }
    case "truefalse":
      return q.answer === true ? "{T}" : "{F}";
    case "multi": {
      const right = new Set((q.answer as number[]) ?? []);
      if (!right.size) return null;
      // GIFT ko'p javobli savolda foiz beradi: to'g'rilar teng ulush, xatolar −100 %.
      const pct = Math.round(100 / right.size);
      const opts = q.options.map((o, i) => (right.has(i) ? `~%${pct}%${giftEscape(o)}` : `~%-100%${giftEscape(o)}`));
      return `{${opts.join(" ")}}`;
    }
    case "open": {
      const a = String(q.answer ?? "").trim();
      return a ? `{=${giftEscape(a)}}` : null;
    }
    case "match": {
      const pairs = (q.answer as TestMatchPair[]) ?? [];
      // Chap ustun `options` ning boshida, o'ng ustun — qolganida.
      const half = Math.ceil(q.options.length / 2);
      const rows = pairs
        .map((p) => {
          const left = q.options[p.left];
          const right = q.options[half + p.right] ?? q.options[p.right];
          return left && right ? `=${giftEscape(left)} -> ${giftEscape(right)}` : "";
        })
        .filter(Boolean);
      return rows.length ? `{\n${rows.join("\n")}\n}` : null;
    }
  }
}

/**
 * Butun testni GIFT matniga o'giradi.
 *
 * Qaytarib bo'lmaydigan savol (javobi buzuq) O'TKAZIB YUBORILADI —
 * Moodle importi bitta buzuq qatorda BUTUN faylni rad etadi, shuning
 * uchun eksport «qanchasi chiqdi» ni jimgina kamaytiradi.
 */
export function toGift(model: TestModel, title: string): string {
  const head = [`// ${title.replace(/\r?\n/g, " ")}`, `// SlaydX — ${model.type}, ${model.questions.length} savol`, ""];
  const items = model.questions
    .map((q, i) => {
      const body = giftBody(q);
      if (!body) return "";
      return `::${giftEscape(`${title} ${i + 1}`)}::${giftEscape(q.stem)} ${body}`;
    })
    .filter(Boolean);
  return [...head, ...items].join("\n");
}
