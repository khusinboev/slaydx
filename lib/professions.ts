/**
 * Kasb/lavozim tavsiyalari (Rezyume 2, 2-band) — izomorf.
 *
 * Ma'lumot `data/professions.json` da (`scripts/gen-professions.mts`
 * bilan ESCO + hh.ru taksonomiyalaridan yasalgan, odam o'qib chiqqan —
 * manba va litsenziya `data/PROFESSIONS-SOURCES.md` da). Qidiruv jonli
 * LLM chaqirig'isiz: forma har harf bosilganda tavsiya ko'rsatadi,
 * ya'ni javob bir necha millisekundda kelishi kerak.
 *
 * Uch tilda qidiriladi (uz/ru/en) va aliaslarda: foydalanuvchi «бухг»
 * yoki «front» deb yozsa ham o'zbekcha lavozimni topadi.
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

const FIELDS = ["uz", "ru", "en", "alias"] as const;

/*
 * Indeks TEKIS massivlarda, modul yuklanganda BIR marta quriladi.
 *
 * Nega tekis: ro'yxat 350 tadan 1 000+ ga o'sganda ichma-ich obyektlar
 * bo'yicha yurish (`[{p, keys:[{field,text}]}]`) har qidiruvda minglab
 * xossa o'qishiga aylanadi. Bu yerda bitta sikl, bitta massiv o'qish —
 * 1 000 qidiruv testdagi 300 ms chegarasida qolishining asosiy sababi.
 *
 * `KEY_OWNER[i]` — kalit qaysi kasbga tegishli (PROFESSIONS indeksi),
 * `KEY_FIELD[i]` — qaysi maydondan (0=uz, 1=ru, 2=en, 3=alias). Maydon
 * raqami reytingda «o'zbekcha nom ustun» qo'shimchasi ham bo'ladi.
 */
const KEY_TEXT: string[] = [];
const KEY_OWNER: number[] = [];
const KEY_FIELD: number[] = [];
/** Aynan mos keluvchi nom (uz/ru/en/alias) → kasb indeksi; birinchisi ustun. */
const EXACT = new Map<string, number>();
const BY_ID = new Map<string, Profession>();

for (let i = 0; i < PROFESSIONS.length; i++) {
  const p = PROFESSIONS[i];
  BY_ID.set(p.id, p);
  const texts: [string, number][] = [
    [p.uz, 0],
    [p.ru, 1],
    [p.en, 2],
    ...p.aliases.map((a) => [a, 3] as [string, number]),
  ];
  for (const [srcText, field] of texts) {
    const text = normQuery(srcText);
    if (!text) continue;
    KEY_TEXT.push(text);
    KEY_OWNER.push(i);
    KEY_FIELD.push(field);
    if (!EXACT.has(text)) EXACT.set(text, i);
  }
}

/*
 * Har qidiruvda massivni tozalash o'rniga AVLOD raqami: `stamp[o]`
 * joriy avlodga teng bo'lsa, bu kasb shu qidiruvda allaqachon
 * uchragan. Shunda 1 000+ elementli massivni har chaqiruvda
 * to'ldirish kerak bo'lmaydi.
 */
const bestScore = new Int32Array(PROFESSIONS.length);
const bestField = new Int32Array(PROFESSIONS.length);
const stamp = new Int32Array(PROFESSIONS.length);
let generation = 0;

/** Bo'sh so'rov → eng ko'p ishlatiladigan (birinchi) kasblar. */
export function searchProfessions(q: string, limit = 8): ProfessionMatch[] {
  const query = normQuery(q);
  if (!query) return PROFESSIONS.slice(0, limit).map((p) => ({ id: p.id, label: p.uz, match: "uz" as const, skills: p.skills }));

  // « + so'rov» birikmasi sikldan TASHQARIDA yasaladi: ichkarida bo'lsa
  // har kalit uchun yangi satr ajratilardi (eski kodning eng qimmat joyi).
  const spaceQuery = ` ${query}`;
  const qLen = query.length;
  const gen = ++generation;
  const hits: number[] = [];

  for (let i = 0; i < KEY_TEXT.length; i++) {
    const text = KEY_TEXT[i];
    if (text.length < qLen) continue;
    const at = text.indexOf(query);
    if (at < 0) continue;
    /*
     * Reyting: to'liq mos = 0, boshidan mos = 1, so'z boshidan = 2,
     * ichida = 3. Birinchi uchrash so'z boshida bo'lmasa ham,
     * KEYINGISI bo'lishi mumkin («abcfront frontend» + «front») —
     * shuning uchun oxirgi shoxda to'liq qidiruv qoladi.
     */
    let sc: number;
    if (at === 0) sc = text.length === qLen ? 0 : 1;
    else if (text.charCodeAt(at - 1) === 32) sc = 2;
    else sc = text.includes(spaceQuery) ? 2 : 3;

    // O'zbekcha nom ustun: bir xil reytingda u tanlanadi.
    const weighted = sc * 4 + KEY_FIELD[i];
    const owner = KEY_OWNER[i];
    if (stamp[owner] !== gen) {
      stamp[owner] = gen;
      bestScore[owner] = weighted;
      bestField[owner] = KEY_FIELD[i];
      hits.push(owner);
    } else if (weighted < bestScore[owner]) {
      bestScore[owner] = weighted;
      bestField[owner] = KEY_FIELD[i];
    }
  }

  hits.sort((a, b) => {
    const d = bestScore[a] - bestScore[b];
    if (d) return d;
    const la = PROFESSIONS[a].uz;
    const lb = PROFESSIONS[b].uz;
    return la.length - lb.length || la.localeCompare(lb);
  });
  return hits.slice(0, limit).map((o) => {
    const p = PROFESSIONS[o];
    return { id: p.id, label: p.uz, match: FIELDS[bestField[o]], skills: p.skills };
  });
}

export function professionById(id: string): Profession | undefined {
  return BY_ID.get(id);
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
  const exact = EXACT.get(q);
  if (exact !== undefined) return PROFESSIONS[exact].skills;
  const near = searchProfessions(role, 1)[0];
  return near?.skills ?? [];
}
