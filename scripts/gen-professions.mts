/**
 * Kasblar ma'lumot bazasini yasaydi va KENGAYTIRADI (Rezyume 2 / AUDIT-16).
 *
 * Nega skript, jonli chaqiruv emas: kasb tavsiyasi formada HAR HARF
 * bosilganda kerak. Uni LLM dan so'rash sekin ham, qimmat ham bo'lardi
 * va offline test yozib bo'lmasdi. Shuning uchun ro'yxat skript bilan
 * yasalib `data/professions.json` ga kommit qilinadi, forma esa uni
 * oddiy qidiruv bilan o'qiydi (`lib/professions.ts`).
 *
 * OQIM (bitta buyruq, ikki bosqich):
 *
 *   1. `scripts/fetch-professions.mts` — ESCO (ISCO-08 daraxti, inglizcha,
 *      CC-BY 4.0) va hh.ru `professional_roles` (ruscha) dan XOM kasb
 *      nomlarini oladi va keshlaydi. Sektor ISCO kodidan / hh
 *      kategoriyasidan keladi — taxmin qilinmaydi.
 *   2. Shu fayl — xom nomlarni mavjud ro'yxat bilan solishtiradi,
 *      YANGILARINI LLM ga beradi: o'zbekcha/ruscha/inglizcha nom,
 *      aliaslar va O'ZBEKCHA ko'nikmalar. LLM ro'yxat TUZMAYDI, faqat
 *      tarjima qiladi va O'zbekistonda uchramaydigan kasbni `ok:false`
 *      bilan belgilaydi.
 *
 * IDEMPOTENT: mavjud `data/professions.json` USTUN — hech qachon qayta
 * yozilmaydi, faqat YETISHMAYOTGANI qo'shiladi. Qayta yugurtirish
 * xavfsiz; `--limit` ni oshirib ro'yxatni bosqichma-bosqich
 * kattalashtirish mumkin.
 *
 * Foydalanish:
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/gen-professions.mts
 *   ... --only it,moliya      # faqat sanab o'tilgan sektorlar
 *   ... --limit 48       # sektordagi JAMI yozuvlar chegarasi (standart 48)
 *   ... --batch 14            # bitta LLM chaqiruvidagi nomzodlar soni
 *   ... --concurrency 3       # parallel LLM chaqiruvlari
 *   ... --refresh-sources     # ESCO/hh keshini majburan yangilash
 *   ... --deepen huquq,hr     # yupqa sektorlarda ESCO ixtisosliklarini (2-qatlam) ham olish
 *   ... --dry                 # faylga yozmaydi, faqat hisobot
 */
import { writeFile, readFile } from "node:fs/promises";
import { llmComplete } from "../lib/generation/llm.ts";
import { deepenFlag, loadSources, type SourceRow } from "./fetch-professions.mts";

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

const SYSTEM = `You extend a profession reference list for an Uzbek CV builder. Output ONE JSON object and nothing else.

The input is a numbered list of candidate job titles harvested from two official taxonomies: ESCO (English) and hh.ru (Russian). You do NOT invent the list — you translate it and filter it.

Schema: {"items":[{"n":1,"ok":true,"id":"kebab-case-latin","uz":"","ru":"","en":"","aliases":["",""],"skills":["",""]}]}

Rules:
- Return EXACTLY one item per input candidate, echoing its "n". Never merge, never skip, never add extra numbers.
- "ok": false when the candidate must NOT enter the list. Set it false when:
  * the job does not realistically exist in Uzbekistan's labour market (e.g. "reindeer herder", "oyster farmer", "ski instructor", "snow groomer driver");
  * it is a hyper-narrow EU/industry sub-specialisation nobody would write on a CV here (e.g. "beverages distribution manager", "aircraft de-icing technician");
  * it duplicates ANOTHER candidate in this same batch, or duplicates one of the "already listed" titles given by the user — keep the broader one and mark the narrower one false;
  * it is not a job title at all (a department, a status, "other").
  When "ok" is false the other fields may be empty strings / empty arrays.
- "uz": the job title in Uzbek, LATIN script, the way it is actually written in Uzbek job ads ("Buxgalter", "Frontend dasturchi", "Payvandchi", "Qurilish muhandisi"). Use the PLAIN ASCII apostrophe in o' and g' — never the characters U+2018, U+2019, U+02BB, U+02BC. Do not transliterate the English word when a real Uzbek term exists.
- "ru": the same job title in Russian. "en": in English. All three are REQUIRED when ok is true.
- "id": short latin kebab-case derived from the English title, unique within the batch.
- "aliases": 2-4 alternative spellings people actually type, including the Russian form and an English or short form (e.g. "бухгалтер", "accountant", "frontend").
- "skills": 6-10 concrete, profession-specific skills IN UZBEK (Latin script, plain apostrophes). Tools, methods, standards, documents, machines, programs. FORBIDDEN: soft-skill cliches ("Mas'uliyatlilik", "Jamoada ishlash", "Muloqot ko'nikmalari"), and repeating the job title itself. Each skill at most 32 characters.
- No commentary, no markdown fences.`;

/* ------------------------------------------------------------------ *
 * Bayroqlar
 * ------------------------------------------------------------------ */

function flag(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(",")) : null;
const LIMIT = flag("limit", 48);
const BATCH = flag("batch", 14);
const CONCURRENCY = flag("concurrency", 3);
const DRY = process.argv.includes("--dry");
const OUT = "data/professions.json";

type Profession = { id: string; uz: string; ru: string; en: string; aliases: string[]; sector: string; skills: string[] };

/* ------------------------------------------------------------------ *
 * Yordamchilar
 * ------------------------------------------------------------------ */

/**
 * O'zbek apostroflarini BITTA shaklga keltiradi.
 *
 * Fayldagi uslub — oddiy ASCII `'` (o', g'). LLM esa gohida tipografik
 * `‘`/`’`/`ʻ` qaytaradi: aralashib qolsa bir xil kasb ikki xil yozilib,
 * ko'z bilan ko'rilganda ro'yxat qo'pol ko'rinadi.
 */
const apos = (s: string) => s.replace(/[‘’ʻʼ´`]/g, "'");

/** Nom bo'yicha dedup kaliti — apostrof shakli va registr farq qilmaydi. */
const nameKey = (s: string) => apos(s).trim().toLowerCase().replace(/\s+/g, " ");

function parseJson(raw: string): { items?: unknown[] } | null {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as { items?: unknown[] };
  } catch {
    return null;
  }
}

const s = (v: unknown, n: number) => (typeof v === "string" ? apos(v).trim().slice(0, n) : "");

/** Kichik parallellik bilan bajarish — manbani ham, kalitni ham bezovta qilmaydi. */
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. Mavjud ro'yxat
 * ------------------------------------------------------------------ */

const existing: Profession[] = await readFile(OUT, "utf8")
  .then((t) => JSON.parse(t) as Profession[])
  .catch(() => []);

// Mavjud yozuvlar ham apostrof bo'yicha bir xil shaklga keltiriladi
// (fayl 350 tada uchta chetlashgan yozuv bilan kelgan edi).
for (const p of existing) {
  p.uz = apos(p.uz);
  p.skills = p.skills.map(apos);
  p.aliases = p.aliases.map(apos);
}

/**
 * Takroriylik filtri UCH tilda ham ishlaydi.
 *
 * Manba nomi inglizcha (ESCO) yoki ruscha (hh) keladi — agar faqat
 * o'zbekcha nom bo'yicha solishtirilsa, «accountant» LLM ga borib
 * «Buxgalter» bo'lib qaytardi va ro'yxatda ikkinchi marta paydo
 * bo'lardi. Shuning uchun mavjud yozuvning uz/ru/en va aliaslari
 * ham kalitlar to'plamiga kiradi.
 */
const takenNames = new Set<string>();
const takenIds = new Set<string>();
for (const p of existing) {
  for (const v of [p.uz, p.ru, p.en, ...p.aliases]) if (v) takenNames.add(nameKey(v));
  takenIds.add(p.id);
}

/* ------------------------------------------------------------------ *
 * 2. Manbalar → sektor bo'yicha nomzodlar
 * ------------------------------------------------------------------ */

const sources = await loadSources({
  force: process.argv.includes("--refresh-sources"),
  deepen: deepenFlag(process.argv),
  log: (m) => console.log(m),
});

/**
 * Nomzodlar tartibi — QAMROV uchun muhim.
 *
 * Avval hh.ru rollari (O'zbekiston bozoriga eng yaqin ro'yxat), keyin
 * ESCO — lekin ESCO ni ketma-ket emas, ISCO guruhlari bo'ylab NAVBAT
 * bilan olamiz. Aks holda `--limit` chegarasi bitta guruhda
 * tugab, masalan «payvandchi»ning oltita turi kirib, «tokar» umuman
 * kirmay qolardi.
 */
function orderCandidates(rows: SourceRow[]): SourceRow[] {
  const hh = rows.filter((r) => r.source === "hh");
  const byGroup = new Map<string, SourceRow[]>();
  for (const r of rows) {
    if (r.source !== "esco") continue;
    byGroup.set(r.code, [...(byGroup.get(r.code) ?? []), r]);
  }
  const groups = [...byGroup.values()];
  const esco: SourceRow[] = [];
  for (let i = 0; groups.some((g) => g.length > i); i++) {
    for (const g of groups) if (g[i]) esco.push(g[i]);
  }
  return [...hh, ...esco];
}

const candidatesBySector = new Map<string, SourceRow[]>();
for (const sector of SECTORS) {
  const rows = sources.rows.filter((r) => r.sector === sector.id);
  const seen = new Set<string>();
  const fresh: SourceRow[] = [];
  for (const r of orderCandidates(rows)) {
    const key = nameKey(r.en || r.ru);
    // Mavjud ro'yxatda bormi yoki manbalar ichida takrorlanganmi.
    if (!key || seen.has(key) || takenNames.has(key)) continue;
    seen.add(key);
    fresh.push(r);
  }
  candidatesBySector.set(sector.id, fresh);
}

/* ------------------------------------------------------------------ *
 * 3. LLM bilan to'ldirish
 * ------------------------------------------------------------------ */

type Filled = Profession & { ok: boolean };

/** LLM `ok:false` bilan rad etganlari — hisobot uchun (nima tashlanganini ko'rish). */
const rejected: string[] = [];

/** Bitta partiya: nomzodlar → to'ldirilgan yozuvlar (yoki bo'sh massiv). */
async function fillBatch(sector: { id: string; uz: string; hint: string }, batch: SourceRow[], known: string[]): Promise<Filled[]> {
  const list = batch
    .map((r, i) => {
      const name = r.en ? `EN: ${r.en}` : `RU: ${r.ru}`;
      const extra = r.aliases.length ? ` (also: ${r.aliases.join(", ")})` : "";
      return `${i + 1}. ${name}${extra} — source group: ${r.group}`;
    })
    .join("\n");
  const user = [
    `Sector: ${sector.uz} (${sector.hint}).`,
    `Already listed in this sector, do NOT repeat: ${known.slice(0, 120).join(", ") || "—"}.`,
    "",
    `Candidates (${batch.length}):`,
    list,
  ].join("\n");
  const raw = await llmComplete(SYSTEM, user, 8000, { json: true, timeoutMs: 120_000 });
  const parsed = raw ? parseJson(raw) : null;
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out: Filled[] = [];
  for (const it of items) {
    const o = (it ?? {}) as Record<string, unknown>;
    const n = Number(o.n);
    const src = Number.isFinite(n) ? batch[n - 1] : undefined;
    const id = s(o.id, 48).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    const uz = s(o.uz, 60);
    const ok = o.ok !== false;
    // 40 belgidan uzun ko'nikma test chegarasidan o'tmaydi — kesib
    // yarim so'z qoldirgandan ko'ra butunlay tashlagan ma'qul.
    const skills = (Array.isArray(o.skills) ? o.skills : [])
      .map((a) => s(a, 60))
      .filter((a) => a && a.length <= 40)
      .slice(0, 12);
    const ru = s(o.ru, 60) || s(src?.ru, 60);
    const en = s(o.en, 60) || s(src?.en, 60);
    // Nomning o'zini alias qilib takrorlash indeksni bo'rttiradi, xolos.
    const own = new Set([uz, ru, en].map(nameKey));
    const aliases = (Array.isArray(o.aliases) ? o.aliases : [])
      .map((a) => s(a, 40))
      .filter((a) => a && !own.has(nameKey(a)))
      .slice(0, 5);
    if (!ok) {
      rejected.push(`${sector.id}: ${src?.en || src?.ru || `#${n}`}`);
      continue;
    }
    if (!id || !uz || skills.length < 5) continue;
    out.push({ id, uz, ru, en, aliases, sector: sector.id, skills, ok: true });
  }
  return out;
}

const added: Profession[] = [];
const stats: { sector: string; have: number; sent: number; kept: number }[] = [];

for (const sector of SECTORS) {
  if (only && !only.has(sector.id)) continue;
  const have = existing.filter((p) => p.sector === sector.id).length;
  const need = Math.max(0, LIMIT - have);
  const pool0 = candidatesBySector.get(sector.id) ?? [];
  if (need === 0 || pool0.length === 0) {
    stats.push({ sector: sector.id, have, sent: 0, kept: 0 });
    console.log(`${sector.id}: ${have} ta bor, nomzod ${pool0.length} — o'tkazildi`);
    continue;
  }
  // LLM `ok:false` bilan bir qismini rad etadi, shuning uchun kerakligidan
  // KO'PROQ yuboriladi (tajribada ~30% rad etiladi).
  const send = pool0.slice(0, Math.min(pool0.length, Math.ceil(need * 1.6) + BATCH));
  const batches: SourceRow[][] = [];
  for (let i = 0; i < send.length; i += BATCH) batches.push(send.slice(i, i + BATCH));
  const known = existing.filter((p) => p.sector === sector.id).map((p) => p.uz);
  process.stdout.write(`${sector.id}: ${have} ta bor, ${need} ta kerak, ${send.length} nomzod / ${batches.length} partiya… `);
  const results = await pool(batches, CONCURRENCY, (b) => fillBatch(sector, b, known));
  let kept = 0;
  for (const group of results) {
    for (const p of group) {
      if (kept >= need) break;
      const key = nameKey(p.uz);
      if (takenNames.has(key) || takenNames.has(nameKey(p.en)) || takenNames.has(nameKey(p.ru))) continue;
      let id = p.id;
      let k = 2;
      while (takenIds.has(id)) id = `${p.id}-${k++}`;
      takenIds.add(id);
      // YANGI yozuvning aliaslari band qilinmaydi: LLM aliasga qo'shni
      // kasb nomini ham yozib qo'yadi («Tarmoq administratori» tarmoq
      // muhandisiga alias sifatida) va keyin o'sha kasbning o'zi kirmay
      // qolardi. Faqat qo'lda ko'rilgan mavjud yozuvlar aliasi band.
      for (const v of [p.uz, p.ru, p.en]) if (v) takenNames.add(nameKey(v));
      added.push({ id, uz: p.uz, ru: p.ru, en: p.en, aliases: p.aliases, sector: p.sector, skills: p.skills });
      kept++;
    }
  }
  stats.push({ sector: sector.id, have, sent: send.length, kept });
  console.log(`+${kept}`);
}

/* ------------------------------------------------------------------ *
 * 4. Yozish
 * ------------------------------------------------------------------ */

/*
 * Yakuniy tozalash — MAVJUD yozuvlarga ham tegadi, lekin faqat
 * takroriylik bo'yicha:
 *
 *   - bir xil nom (uz YOKI ru YOKI en) ikki yozuvda bo'lsa birinchisi
 *     qoladi, ikkinchisining ko'nikma/aliaslari unga qo'shiladi. Eski
 *     ro'yxatda uchta shunday juftlik bor edi («Motion dizayner» media va
 *     dizaynda, «Komplayens» moliya va huquqda, «Avtoyuklagich haydovchisi»
 *     transport va logistikada) — faqat uz bo'yicha tekshirilgani uchun
 *     o'tib ketgan;
 *   - ko'nikmalar registrdan qat'i nazar takrorlanmaydi
 *     («Penetration testing» / «Penetration Testing»).
 */
const merged: Profession[] = [];
const byAnyName = new Map<string, Profession>();
let mergedAway = 0;
for (const p of [...existing, ...added]) {
  if (!p.uz || !p.ru || !p.en) continue;
  const keys = [p.uz, p.ru, p.en].map(nameKey);
  const cur = keys.map((k) => byAnyName.get(k)).find(Boolean);
  if (cur) {
    for (const sk of p.skills) if (!cur.skills.some((x) => x.toLowerCase() === sk.toLowerCase()) && cur.skills.length < 12) cur.skills.push(sk);
    for (const a of p.aliases) if (!cur.aliases.some((x) => nameKey(x) === nameKey(a)) && cur.aliases.length < 5) cur.aliases.push(a);
    mergedAway++;
    continue;
  }
  const seenSkill = new Set<string>();
  p.skills = p.skills.filter((sk) => {
    const k = sk.toLowerCase();
    if (seenSkill.has(k)) return false;
    seenSkill.add(k);
    return true;
  });
  for (const k of keys) byAnyName.set(k, p);
  merged.push(p);
}
if (mergedAway) console.log(`nom bo'yicha birlashtirildi: ${mergedAway} ta yozuv`);

const all = merged.filter((p) => p.skills.length >= 5);
all.sort((a, b) => a.sector.localeCompare(b.sector) || a.uz.localeCompare(b.uz));

console.log("\nsektor           bor   yuborildi  qo'shildi");
for (const r of stats) console.log(`${r.sector.padEnd(17)}${String(r.have).padStart(3)}${String(r.sent).padStart(10)}${String(r.kept).padStart(10)}`);
if (rejected.length) console.log(`\nLLM rad etdi (${rejected.length}): ${rejected.join("; ")}`);
console.log(`\njami ${all.length} ta kasb (+${added.length})`);

if (DRY) {
  // Quruq yugurishda nima qo'shilgan bo'lardi — ko'z bilan tekshirish uchun.
  for (const p of added) console.log(`  [${p.sector}] ${p.uz} | ${p.ru} | ${p.en} | ${p.aliases.join(", ")}\n      ${p.skills.join(" · ")}`);
  console.log("--dry: fayl yozilmadi");
} else {
  await writeFile(OUT, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  console.log(`→ ${OUT}`);
}
