/**
 * Kasblar ma'lumot bazasini bir marta yasaydi (Rezyume 2, 2-band).
 *
 * Nega skript, jonli chaqiruv emas: kasb tavsiyasi formada HAR HARF
 * bosilganda kerak. Uni LLM dan so'rash sekin ham, qimmat ham bo'lardi
 * va offline test yozib bo'lmasdi. Shuning uchun ro'yxat BIR marta
 * yasalib `data/professions.json` ga kommit qilinadi, forma esa uni
 * oddiy qidiruv bilan o'qiydi (`lib/professions.ts`).
 *
 * Natijani KOMMITDAN OLDIN odam o'qib chiqishi kerak (o'zbekcha imlo).
 *
 * Foydalanish:
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/gen-professions.mts
 *   ... --only IT,moliya       # faqat sanab o'tilgan sektorlar
 */
import { writeFile, readFile } from "node:fs/promises";
import { llmComplete } from "../lib/generation/llm.ts";

const SECTORS: { id: string; uz: string; hint: string }[] = [
  { id: "it", uz: "Axborot texnologiyalari", hint: "dasturchi, tahlilchi, tester, DevOps, ma'lumotlar" },
  { id: "moliya", uz: "Moliya va buxgalteriya", hint: "buxgalter, auditor, moliya tahlilchisi, bank" },
  { id: "talim", uz: "Ta'lim", hint: "o'qituvchi (fanlar bo'yicha), tarbiyachi, metodist, repetitor" },
  { id: "tibbiyot", uz: "Tibbiyot", hint: "shifokor mutaxassisliklari, hamshira, farmatsevt, laborant" },
  { id: "huquq", uz: "Huquq", hint: "yurist, advokat, notarius, huquqshunos maslahatchi" },
  { id: "savdo", uz: "Savdo", hint: "sotuv menejeri, do'kon mudiri, kassir, merchandayzer" },
  { id: "marketing", uz: "Marketing va PR", hint: "SMM, kontent, brend, PR, reklama" },
  { id: "ishlab-chiqarish", uz: "Ishlab chiqarish", hint: "texnolog, sifat nazoratchisi, sex boshlig'i, operator" },
  { id: "qurilish", uz: "Qurilish", hint: "muhandis, smeta, prorab, arxitektor, usta" },
  { id: "logistika", uz: "Logistika", hint: "logist, ombor mudiri, ekspeditor, ta'minot" },
  { id: "xizmat", uz: "Xizmat ko'rsatish", hint: "ofitsiant, oshpaz, barista, administrator, sartarosh" },
  { id: "davlat", uz: "Davlat xizmati", hint: "inspektor, mutaxassis, arxiv, statistika" },
  { id: "qishloq", uz: "Qishloq xo'jaligi", hint: "agronom, veterinar, fermer, zootexnik" },
  { id: "energetika", uz: "Energetika", hint: "elektrik, energetik muhandis, gaz, neft" },
  { id: "media", uz: "Media", hint: "jurnalist, muharrir, operator, montajchi, ovoz" },
  { id: "dizayn", uz: "Dizayn", hint: "grafik, UX/UI, interyer, moda, 3D" },
  { id: "hr", uz: "Kadrlar (HR)", hint: "HR menejer, rekruter, trener, kadrlar inspektori" },
  { id: "mamuriy", uz: "Ma'muriy", hint: "kotib, ofis menejer, yordamchi, arxivchi" },
  { id: "transport", uz: "Transport", hint: "haydovchi, mashinist, dispetcher, uchuvchi" },
  { id: "turizm", uz: "Turizm", hint: "gid, turmenejer, mehmonxona, aviakassa" },
  { id: "sport", uz: "Sport", hint: "murabbiy, fitnes instruktor, sport shifokori" },
  { id: "fan", uz: "Fan va tadqiqot", hint: "ilmiy xodim, laborant, tadqiqotchi" },
  { id: "sanat", uz: "San'at va madaniyat", hint: "rassom, musiqachi, aktyor, kutubxonachi" },
  { id: "xavfsizlik", uz: "Xavfsizlik", hint: "qo'riqchi, mehnat muhofazasi, yong'in xavfsizligi, kiberxavfsizlik" },
];

const SYSTEM = `You build a profession reference list for an Uzbek CV builder. Output ONE JSON object and nothing else.
Schema: {"items":[{"id":"kebab-case-latin","uz":"","ru":"","en":"","aliases":["",""],"skills":["",""]}]}
Rules:
- "uz" is the job title in Uzbek (Latin script, natural modern usage, e.g. "Buxgalter", "Frontend dasturchi").
- "ru" is the same job title in Russian, "en" in English.
- "id": short latin kebab-case, unique, derived from the English title.
- "aliases": 1-3 alternative spellings people actually type (including common Russian or English short forms, e.g. "бухгалтер", "accountant", "frontend").
- "skills": 6-10 concrete, profession-specific skills IN UZBEK (Latin script). Tools, methods, standards — not soft-skill clichés. Each at most 32 characters.
- Titles must be real jobs in Uzbekistan's labour market. No duplicates inside the batch.
- No commentary, no markdown fences.`;

function parseJson(raw: string): { items: unknown[] } | null {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as { items: unknown[] };
  } catch {
    return null;
  }
}

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(",")) : null;
const OUT = "data/professions.json";

type Profession = { id: string; uz: string; ru: string; en: string; aliases: string[]; sector: string; skills: string[] };

const existing: Profession[] = await readFile(OUT, "utf8")
  .then((t) => JSON.parse(t) as Profession[])
  .catch(() => []);
const bySector = new Map<string, Profession[]>();
for (const p of existing) bySector.set(p.sector, [...(bySector.get(p.sector) ?? []), p]);

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

for (const sector of SECTORS) {
  if (only && !only.has(sector.id)) continue;
  const user = `Sector: ${sector.uz} (${sector.hint}). Produce exactly 15 distinct job titles for this sector.`;
  process.stdout.write(`${sector.id}… `);
  const raw = await llmComplete(SYSTEM, user, 4000, { json: true, timeoutMs: 90_000 });
  const parsed = raw ? parseJson(raw) : null;
  if (!parsed?.items?.length) {
    console.log("XATO (javob yo'q)");
    continue;
  }
  const items: Profession[] = [];
  for (const it of parsed.items) {
    const o = (it ?? {}) as Record<string, unknown>;
    const id = s(o.id, 48).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    const uz = s(o.uz, 60);
    if (!id || !uz) continue;
    items.push({
      id,
      uz,
      ru: s(o.ru, 60),
      en: s(o.en, 60),
      aliases: Array.isArray(o.aliases) ? o.aliases.map((a) => s(a, 40)).filter(Boolean).slice(0, 4) : [],
      sector: sector.id,
      skills: Array.isArray(o.skills) ? o.skills.map((a) => s(a, 40)).filter(Boolean).slice(0, 12) : [],
    });
  }
  bySector.set(sector.id, items);
  console.log(`${items.length} ta`);
}

/*
 * Global unikallik ikki bosqichda:
 *   1. NOM bo'yicha — ikki sektor bir xil kasbni qaytarishi normal
 *      («UI/UX dizayner» IT da ham, dizaynda ham). Ikkinchisi tashlanadi,
 *      lekin uning ko'nikma va aliaslari birinchisiga qo'shiladi, aks
 *      holda ro'yxatda bir xil yozuv ikki marta chiqardi.
 *   2. ID bo'yicha — nomi boshqa, id bir xil bo'lsa raqam qo'shiladi.
 */
const byName = new Map<string, Profession>();
const order: string[] = [];
const nameKey = (s: string) => s.trim().toLowerCase().replace(/[‘’ʻʼ`']/g, "'");
for (const sector of SECTORS) {
  for (const p of bySector.get(sector.id) ?? []) {
    const key = nameKey(p.uz);
    const cur = byName.get(key);
    if (cur) {
      for (const s of p.skills) if (!cur.skills.includes(s) && cur.skills.length < 12) cur.skills.push(s);
      for (const a of p.aliases) if (!cur.aliases.includes(a) && cur.aliases.length < 5) cur.aliases.push(a);
      continue;
    }
    byName.set(key, { ...p });
    order.push(key);
  }
}
const seen = new Set<string>();
const all: Profession[] = [];
for (const key of order) {
  const p = byName.get(key)!;
  let id = p.id;
  let n = 2;
  while (seen.has(id)) id = `${p.id}-${n++}`;
  seen.add(id);
  all.push({ ...p, id });
}
all.sort((a, b) => a.sector.localeCompare(b.sector) || a.uz.localeCompare(b.uz));
await writeFile(OUT, `${JSON.stringify(all, null, 2)}\n`, "utf8");
console.log(`jami ${all.length} ta kasb → ${OUT}`);
