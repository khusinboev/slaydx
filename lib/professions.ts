/**
 * Kasb/lavozim tavsiyalari (Rezyume 2, 2-band) — izomorf.
 *
 * Ma'lumot `data/professions.json` da (bir marta `scripts/gen-professions.mts`
 * bilan yasalgan, odam o'qib chiqqan). Qidiruv jonli LLM chaqirig'isiz:
 * forma har harf bosilganda tavsiya ko'rsatadi, ya'ni javob bir necha
 * millisekundda kelishi kerak.
 *
 * Uch tilda qidiriladi (uz/ru/en) va aliaslarda: foydalanuvchi «бухг» yoki
 * «front» deb yozsa ham o'zbekcha lavozimni topadi.
 */
import raw from "../data/professions.json";

export type Profession = {
  id: string;
  uz: string;
  ru: string;
  en: string;
  aliases: string[];
  sector: string;
  /** Kasbga xos ko'nikmalar (o'zbekcha) — forma «Tavsiya» sifatida taklif qiladi. */
  skills: string[];
};

export const PROFESSIONS: Profession[] = raw as Profession[];

export type ProfessionMatch = { id: string; label: string; match: "uz" | "ru" | "en" | "alias"; skills: string[] };

/** NFKC + kichik harf; o'zbek apostroflari bir shaklga keltiriladi. */
export function normQuery(q: string): string {
  return (q || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX = PROFESSIONS.map((p) => ({
  p,
  keys: [
    { field: "uz" as const, text: normQuery(p.uz) },
    { field: "ru" as const, text: normQuery(p.ru) },
    { field: "en" as const, text: normQuery(p.en) },
    ...p.aliases.map((a) => ({ field: "alias" as const, text: normQuery(a) })),
  ].filter((k) => k.text),
}));

/**
 * Reyting: to'liq mos = 0, boshidan mos = 1, so'z boshidan = 2, ichida = 3.
 * Topilmasa `null` — natijaga tushmaydi.
 */
function score(text: string, q: string): number | null {
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.includes(` ${q}`)) return 2;
  if (text.includes(q)) return 3;
  return null;
}

/** Bo'sh so'rov → eng ko'p ishlatiladigan (birinchi) kasblar. */
export function searchProfessions(q: string, limit = 8): ProfessionMatch[] {
  const query = normQuery(q);
  if (!query) return PROFESSIONS.slice(0, limit).map((p) => ({ id: p.id, label: p.uz, match: "uz" as const, skills: p.skills }));
  const hits: { s: number; field: ProfessionMatch["match"]; p: Profession }[] = [];
  for (const entry of INDEX) {
    let best: { s: number; field: ProfessionMatch["match"] } | null = null;
    for (const k of entry.keys) {
      const s = score(k.text, query);
      if (s === null) continue;
      // O'zbekcha nom ustun: bir xil reytingda u tanlanadi.
      const weighted = s * 4 + (k.field === "uz" ? 0 : k.field === "ru" ? 1 : k.field === "en" ? 2 : 3);
      if (!best || weighted < best.s) best = { s: weighted, field: k.field };
    }
    if (best) hits.push({ s: best.s, field: best.field, p: entry.p });
  }
  hits.sort((a, b) => a.s - b.s || a.p.uz.length - b.p.uz.length || a.p.uz.localeCompare(b.p.uz));
  return hits.slice(0, limit).map((h) => ({ id: h.p.id, label: h.p.uz, match: h.field, skills: h.p.skills }));
}

export function professionById(id: string): Profession | undefined {
  return PROFESSIONS.find((p) => p.id === id);
}

/**
 * Lavozim MATNI bo'yicha ko'nikma tavsiyasi.
 *
 * Forma foydalanuvchi tanlagan kasbning `id` sini emas, MATNINI saqlaydi
 * (u o'zi ham yozishi mumkin) — shuning uchun ko'nikmalar aynan mos
 * kelgan yozuvdan olinadi.
 */
export function skillsForRole(role: string): string[] {
  const q = normQuery(role);
  if (!q) return [];
  const exact = INDEX.find((e) => e.keys.some((k) => k.text === q));
  if (exact) return exact.p.skills;
  const near = searchProfessions(role, 1)[0];
  return near?.skills ?? [];
}
