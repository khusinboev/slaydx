/**
 * Kasblar bazasi uchun TASHQI MANBALARDAN xom ro'yxat yig'adi
 * (Rezyume 2 / AUDIT-16, `data/professions.json` ning 1-bosqichi).
 *
 * Nega tashqi manba: ro'yxatni LLM dan "o'ylab topishini" so'rash
 * 350 tadan keyin takrorlana boshlaydi va qamrov tasodifiy bo'lib
 * qoladi. Shuning uchun KASB NOMLARI ikkita rasmiy, ochiq
 * taksonomiyadan olinadi, LLM esa faqat TARJIMA va KO'NIKMA yozadi —
 * ya'ni u nimani bilsa shuni qiladi, ro'yxat tuzishni emas.
 *
 *   1. ESCO (Yevropa Komissiyasi, CC-BY 4.0) — ISCO-08 daraxti bo'ylab
 *      yuriladi: 10 ta katta guruh → 43 → 130 → 436 ta "unit group",
 *      har birida ESCO ning asosiy kasblari. Inglizcha nom + ISCO kodi.
 *      Kod bizga SEKTORni ham beradi (quyidagi `ISCO_SECTOR`), ya'ni
 *      sektor taxmin qilinmaydi, taksonomiyadan keladi.
 *   2. hh.ru `professional_roles` — 27 kategoriya, 304 rol, RUSCHA.
 *      hh.uz ham shu taksonomiyani ishlatadi, shuning uchun bu ro'yxat
 *      O'zbekiston mehnat bozoriga eng yaqini.
 *
 * Natija `node_modules/.cache/` ga yoziladi (repoga tushmaydi) —
 * `scripts/gen-professions.mts` uni o'qiydi. Tarmoq so'rovi ~620 ta,
 * shuning uchun keshsiz qayta yugurtirish shart emas.
 *
 * Foydalanish (odatda to'g'ridan-to'g'ri chaqirilmaydi):
 *   npx tsx scripts/fetch-professions.mts          # keshni yangilaydi
 *   npx tsx scripts/fetch-professions.mts --force  # keshni e'tiborsiz qoldiradi
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Manbalarga o'zimizni tanitamiz — ikkalasi ham anonim so'rovni cheklaydi. */
const UA = "SlaydX/1.0 (Uzbek CV builder profession dataset; +https://slaydx.uz)";
const CACHE = "node_modules/.cache/slaydx-professions-sources.json";
/** Manbalarni bezovta qilmaslik uchun so'rovlar orasidagi pauza. */
const PAUSE_MS = 150;

export type SourceRow = {
  source: "esco" | "hh";
  /** Inglizcha nom (ESCO) — bo'lmasligi mumkin. */
  en: string;
  /** Ruscha nom (hh.ru) — bo'lmasligi mumkin. */
  ru: string;
  /** Manba nomi ichidagi muqobil variantlar («Слесарь, сантехник» → 2 ta). */
  aliases: string[];
  /** Bizning 24 sektordan biri. */
  sector: string;
  /** ISCO-08 kodi yoki hh rol id si — manba izi (`PROFESSIONS-SOURCES.md`). */
  code: string;
  /** ISCO unit group nomi yoki hh kategoriya nomi — LLM ga kontekst. */
  group: string;
  /** ESCO kasb URI si — ikkinchi qatlamni (`deepen`) olish uchun. */
  uri?: string;
  /** ESCO da asosiy kasb OSTIDAGI ixtisoslik (ikkinchi qatlam). */
  deep?: boolean;
};

/** Qayta urinishlardan keyin ham olinmagan ESCO shoxi — keyingi yugurishda tuzatiladi. */
export type MissedBranch = { code: string; depth: number };

export type SourceCache = {
  fetchedAt: string;
  rows: SourceRow[];
  missed: MissedBranch[];
  /** Ikkinchi qatlami olingan sektorlar — qayta so'ralmaydi. */
  deepened?: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Qayta urinadigan JSON GET.
 *
 * ESCO API bir nechta IP ga DNS qaytaradi va ularning bir qismi vaqti-vaqti
 * bilan ETIMEDOUT beradi (jonli kuzatilgan). Qayta urinishsiz butun daraxt
 * yurishi bitta uzilishda yarim qolardi.
 */
async function getJson(url: string, tries = 5): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return (await r.json()) as Record<string, unknown>;
      // 4xx (429 dan boshqa) — qayta urinish yordam bermaydi.
      if (r.status < 500 && r.status !== 429) return null;
    } catch {
      /* tarmoq uzilishi — pastda qayta urinamiz */
    }
    await sleep(700 * (i + 1));
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ESCO: ISCO-08 kodidan bizning sektorga
 * ------------------------------------------------------------------ */

/**
 * ISCO-08 kod prefiksidan sektor. UZUNROQ prefiks ustun turadi, shuning
 * uchun «2142» (qurilish muhandisi) «214» (muhandislar) dan oldin oladi.
 *
 * Bu jadval ro'yxat SIFATINING yarmi: sektor noto'g'ri bo'lsa forma
 * tavsiyani noto'g'ri guruhda ko'rsatadi, LLM esa sektorni o'zi
 * taxmin qilib yanada adashadi.
 */
const ISCO_SECTOR: [string, string][] = [
  // 0 — harbiy xizmat
  ["0", "xavfsizlik"],
  // 1 — rahbarlar
  ["111", "davlat"],
  ["112", "mamuriy"],
  ["1211", "moliya"],
  ["1212", "hr"],
  ["1213", "mamuriy"],
  ["1219", "mamuriy"],
  ["122", "marketing"],
  ["131", "qishloq"],
  ["1321", "ishlab-chiqarish"],
  ["1322", "energetika"],
  ["1323", "qurilish"],
  ["1324", "logistika"],
  ["133", "it"],
  ["1341", "talim"],
  ["1342", "tibbiyot"],
  ["1343", "tibbiyot"],
  ["1344", "davlat"],
  ["1345", "talim"],
  ["1346", "moliya"],
  ["1349", "mamuriy"],
  ["141", "turizm"],
  ["142", "savdo"],
  ["1431", "sport"],
  ["1439", "xizmat"],
  // 2 — oliy malakali mutaxassislar
  ["211", "fan"],
  ["212", "fan"],
  ["213", "qishloq"],
  ["2141", "ishlab-chiqarish"],
  ["2142", "qurilish"],
  ["2143", "qishloq"],
  ["2144", "ishlab-chiqarish"],
  ["2145", "ishlab-chiqarish"],
  ["2146", "energetika"],
  ["2149", "ishlab-chiqarish"],
  ["215", "energetika"],
  ["2161", "qurilish"],
  ["2162", "qurilish"],
  ["2163", "dizayn"],
  ["2164", "qurilish"],
  ["2165", "qurilish"],
  ["2166", "dizayn"],
  ["22", "tibbiyot"],
  ["23", "talim"],
  ["241", "moliya"],
  ["2421", "mamuriy"],
  ["2422", "davlat"],
  ["2423", "hr"],
  ["2424", "hr"],
  ["243", "marketing"],
  ["25", "it"],
  ["261", "huquq"],
  ["262", "sanat"],
  ["2631", "moliya"],
  ["263", "fan"],
  ["264", "media"],
  ["265", "sanat"],
  // 3 — o'rta malakali mutaxassislar
  ["311", "ishlab-chiqarish"],
  ["3123", "qurilish"],
  ["312", "ishlab-chiqarish"],
  ["313", "energetika"],
  ["314", "fan"],
  ["315", "transport"],
  ["324", "qishloq"],
  ["32", "tibbiyot"],
  ["331", "moliya"],
  ["332", "savdo"],
  ["3331", "logistika"],
  ["3332", "marketing"],
  ["3333", "hr"],
  ["3334", "savdo"],
  ["3339", "savdo"],
  ["334", "mamuriy"],
  ["335", "davlat"],
  ["341", "huquq"],
  ["342", "sport"],
  ["3431", "media"],
  ["3432", "dizayn"],
  ["3433", "sanat"],
  ["3434", "xizmat"],
  ["3435", "sanat"],
  ["352", "media"],
  ["35", "it"],
  // 4 — kotiblar va hisob xodimlari
  ["41", "mamuriy"],
  ["421", "moliya"],
  ["4221", "turizm"],
  ["4222", "savdo"],
  ["4224", "turizm"],
  ["422", "mamuriy"],
  ["431", "moliya"],
  ["432", "logistika"],
  ["4412", "logistika"],
  ["44", "mamuriy"],
  // 5 — xizmat ko'rsatish va savdo
  ["511", "turizm"],
  ["51", "xizmat"],
  ["52", "savdo"],
  ["531", "talim"],
  ["53", "tibbiyot"],
  ["54", "xavfsizlik"],
  // 6 — qishloq xo'jaligi
  ["6", "qishloq"],
  // 7 — hunarmand va ishchi kasblar
  ["71", "qurilish"],
  ["723", "transport"],
  ["72", "ishlab-chiqarish"],
  ["732", "media"],
  ["73", "sanat"],
  ["742", "it"],
  ["74", "energetika"],
  ["75", "ishlab-chiqarish"],
  // 8 — operator va haydovchilar
  ["811", "energetika"],
  ["81", "ishlab-chiqarish"],
  ["82", "ishlab-chiqarish"],
  ["83", "transport"],
  // 9 — oddiy kasblar
  ["911", "xizmat"],
  ["92", "qishloq"],
  ["931", "qurilish"],
  ["93", "ishlab-chiqarish"],
  ["94", "xizmat"],
  ["96", "xizmat"],
];
// UZUNROQ prefiks oldin tekshiriladi — «2142» «214» dan ustun bo'lishi uchun.
ISCO_SECTOR.sort((a, b) => b[0].length - a[0].length);

/**
 * O'zbekiston rezyumesida umuman uchramaydigan ISCO guruhlari.
 *
 * 63 — o'zini boqish uchun dehqonchilik (kasb emas, turmush tarzi),
 * 95 — ko'chada savdo/xizmat, 62 — o'rmonchilik/ov/baliqchilik
 * (O'zbekistonda deyarli yo'q). Qolganini LLM ning `ok` bayrog'i
 * saralaydi — bu yerda faqat ATAYLAB keraksizi kesiladi.
 */
const ISCO_SKIP = ["63", "95", "62"];

function sectorForIsco(code: string): string | null {
  const digits = code.replace(/\D/g, "");
  if (ISCO_SKIP.some((p) => digits.startsWith(p))) return null;
  for (const [prefix, sector] of ISCO_SECTOR) if (digits.startsWith(prefix)) return sector;
  return null;
}

type EscoLink = { title?: string; uri?: string; code?: string };

function links(j: Record<string, unknown> | null, key: string): EscoLink[] {
  const l = (j?._links ?? {}) as Record<string, unknown>;
  const v = l[key];
  return Array.isArray(v) ? (v as EscoLink[]) : [];
}

type EscoWalk = { rows: SourceRow[]; missed: MissedBranch[] };

/**
 * ISCO daraxtining bir shoxi: 0-daraja katta guruh, 3-daraja «unit group».
 *
 * Olinmagan shox `missed` ga yoziladi va keshda qoladi: ESCO ning
 * ba'zi IP lari 5 urinishda ham javob bermagani jonli kuzatildi
 * (C212 — statistiklar butun guruhi tushib qolgan edi). Keyingi
 * `loadSources` faqat shu shoxlarni qayta so'raydi — 620 ta so'rovni
 * emas.
 */
async function escoBranch(code: string, depth: number, out: EscoWalk, log: (s: string) => void): Promise<void> {
  const j = await getJson(`https://ec.europa.eu/esco/api/resource/concept?uri=${encodeURIComponent(`http://data.europa.eu/esco/isco/C${code}`)}&language=en`);
  await sleep(PAUSE_MS);
  if (!j) {
    log(`  ESCO C${code} olinmadi (keyingi yugurishda qayta so'raladi)`);
    out.missed.push({ code, depth });
    return;
  }
  if (depth === 3) {
    const sector = sectorForIsco(code);
    if (!sector) return;
    const group = String(j.title ?? "");
    for (const o of links(j, "narrowerOccupation")) {
      const en = (o.title ?? "").trim();
      if (!en) continue;
      out.rows.push({ source: "esco", en, ru: "", aliases: [], sector, code, group, uri: o.uri });
    }
    return;
  }
  for (const n of links(j, "narrowerConcept")) {
    const child = n.code ?? (n.uri ?? "").split("/").pop()?.replace(/^C/, "") ?? "";
    if (!child) continue;
    // Keraksiz shoxni umuman OCHMAYMIZ — bir necha o'nlab so'rov tejaladi.
    if (ISCO_SKIP.some((p) => child.startsWith(p))) continue;
    await escoBranch(child, depth + 1, out, log);
  }
}

export async function fetchEsco(log: (s: string) => void = () => {}): Promise<EscoWalk> {
  const out: EscoWalk = { rows: [], missed: [] };
  for (let major = 0; major <= 9; major++) {
    await escoBranch(String(major), 0, out, log);
    log(`  ESCO ${major}-guruh: jami ${out.rows.length} kasb`);
  }
  return out;
}

/** Keshdagi olinmagan shoxlarni qayta so'raydi; muvaffaqiyatli bo'lganlari keshdan chiqadi. */
async function repairMissed(cache: SourceCache, log: (s: string) => void): Promise<boolean> {
  if (!cache.missed?.length) return false;
  log(`ESCO: ${cache.missed.length} ta olinmagan shox qayta so'ralmoqda…`);
  const out: EscoWalk = { rows: [], missed: [] };
  for (const m of cache.missed) await escoBranch(m.code, m.depth, out, log);
  // Bir shox ikki marta kirmasin: manba + guruh kodi + nom bo'yicha.
  const have = new Set(cache.rows.map((r) => `${r.source}|${r.code}|${r.en}`));
  let added = 0;
  for (const r of out.rows) {
    const k = `${r.source}|${r.code}|${r.en}`;
    if (have.has(k)) continue;
    have.add(k);
    cache.rows.push(r);
    added++;
  }
  cache.missed = out.missed;
  log(`  tuzatildi: +${added} kasb, hali olinmagan: ${out.missed.length}`);
  return true;
}

/**
 * Ikkinchi qatlam — YUPQA sektorlar uchun.
 *
 * ISCO daraxti unit group ostidagi ASOSIY ESCO kasblarini beradi
 * (~1 700 ta). Qolgan ~1 300 tasi shu asosiylarning ixtisosliklari
 * («lawyer» → «corporate lawyer», «tax lawyer»…). Huquq, HR, sport,
 * turizm kabi sektorlarda asosiy qatlam 15–30 tadan oshmaydi — 1 000+
 * ro'yxat uchun yetmaydi. Shu sektorlarda har asosiy kasbning
 * `narrowerOccupation` ro'yxati ham olinadi (bir kasb = bir so'rov).
 *
 * Eski kesh (URI siz) uchun avval unit group qayta so'rab URI olinadi.
 * Idempotent: `cache.deepened` da bor sektor qayta so'ralmaydi.
 */
export async function deepenSectors(cache: SourceCache, sectors: string[], log: (s: string) => void): Promise<boolean> {
  const done = new Set(cache.deepened ?? []);
  const todo = sectors.filter((s) => !done.has(s));
  if (!todo.length) return false;
  const rows = cache.rows.filter((r) => r.source === "esco" && !r.deep && todo.includes(r.sector));
  // URI siz yozuvlar — unit group dan qayta olinadi (eski kesh).
  const noUri = rows.filter((r) => !r.uri);
  if (noUri.length) {
    const codes = [...new Set(noUri.map((r) => r.code))];
    log(`ESCO: ${codes.length} ta unit group dan URI olinmoqda…`);
    for (const code of codes) {
      const j = await getJson(`https://ec.europa.eu/esco/api/resource/concept?uri=${encodeURIComponent(`http://data.europa.eu/esco/isco/C${code}`)}&language=en`);
      await sleep(PAUSE_MS);
      for (const o of links(j, "narrowerOccupation")) {
        const r = noUri.find((x) => x.code === code && x.en === (o.title ?? "").trim());
        if (r && o.uri) r.uri = o.uri;
      }
    }
  }
  const have = new Set(cache.rows.map((r) => `${r.source}|${r.sector}|${r.en.toLowerCase()}`));
  let added = 0;
  log(`ESCO: ${todo.join(",")} — ${rows.length} ta asosiy kasbning ixtisosliklari so'ralmoqda…`);
  for (const r of rows) {
    if (!r.uri) continue;
    const j = await getJson(`https://ec.europa.eu/esco/api/resource/concept?uri=${encodeURIComponent(r.uri)}&language=en`);
    await sleep(PAUSE_MS);
    for (const o of links(j, "narrowerOccupation")) {
      const en = (o.title ?? "").trim();
      const k = `esco|${r.sector}|${en.toLowerCase()}`;
      if (!en || have.has(k)) continue;
      have.add(k);
      cache.rows.push({ source: "esco", en, ru: "", aliases: [], sector: r.sector, code: r.code, group: r.en, uri: o.uri, deep: true });
      added++;
    }
  }
  cache.deepened = [...done, ...todo];
  log(`  ikkinchi qatlam: +${added} kasb`);
  return true;
}

/* ------------------------------------------------------------------ *
 * hh.ru professional_roles
 * ------------------------------------------------------------------ */

/** hh kategoriya id → sektor (kategoriya nomi izohda). */
const HH_CATEGORY: Record<string, string> = {
  "1": "savdo", // Продажи, обслуживание клиентов
  "2": "savdo", // Розничная торговля
  "3": "moliya", // Финансы, бухгалтерия
  "4": "moliya", // Стратегия, инвестиции, консалтинг
  "5": "mamuriy", // Административный персонал
  "6": "marketing", // Маркетинг, реклама, PR
  "7": "ishlab-chiqarish", // Производство, сервисное обслуживание
  "8": "energetika", // Добыча сырья
  "9": "qishloq", // Сельское хозяйство
  "10": "logistika", // Транспорт, логистика, перевозки
  "11": "it", // Информационные технологии
  "12": "hr", // Управление персоналом, тренинги
  "13": "huquq", // Юристы
  "14": "logistika", // Закупки
  "15": "xavfsizlik", // Безопасность
  "16": "xizmat", // Домашний, обслуживающий персонал
  "17": "ishlab-chiqarish", // Рабочий персонал
  "18": "qurilish", // Строительство, недвижимость
  "19": "transport", // Автомобильный бизнес
  "20": "turizm", // Туризм, гостиницы, рестораны
  "21": "sport", // Спортивные клубы, фитнес, салоны красоты
  "22": "moliya", // Страхование
  "23": "tibbiyot", // Медицина, фармацевтика
  "24": "media", // Искусство, развлечения, массмедиа
  "25": "talim", // Наука, образование
  "26": "mamuriy", // Высший и средний менеджмент
  // 27 «Другое» — mazmunsiz, tashlanadi.
};

/**
 * ROL nomidan sektor — kategoriya xaritasidan USTUN.
 *
 * hh da bir rol bir necha kategoriyada uchraydi («Дизайнер, художник»
 * IT da ham, marketingda ham, qurilishda ham). Kategoriya bo'yicha
 * tanlansa rol qaysi kategoriya birinchi kelganiga qarab tushardi.
 * Shuning uchun aniq nomlar shu yerda qat'iy biriktiriladi; qolgani
 * kategoriyadan oladi.
 */
const HH_ROLE_SECTOR: [RegExp, string][] = [
  [/^Дизайнер, художник/i, "dizayn"],
  [/^Арт-директор/i, "dizayn"],
  [/^(Артист|Режиссер|Продюсер)/i, "sanat"],
  [/^(Журналист|Копирайтер|Видеооператор|Фотограф)/i, "media"],
  [/^(Директор по информационным|Технический директор|Гейм-дизайнер|Методолог)/i, "it"],
  [/^Директор по маркетингу/i, "marketing"],
  [/^Директор по персоналу/i, "hr"],
  [/^Директор юридического/i, "huquq"],
  [/^(Финансовый директор|Руководитель отдела страхования)/i, "moliya"],
  [/^Руководитель отдела логистики/i, "logistika"],
  [/^(Начальник производства|Руководитель службы эксплуатации)/i, "ishlab-chiqarish"],
  [/^(Коммерческий директор|Руководитель отдела продаж|Руководитель отдела клиентского)/i, "savdo"],
  [/^(Научный специалист|Лаборант)/i, "fan"],
  [/^(Косметолог|Парикмахер|Массажист|Мастер ногтевого)/i, "xizmat"],
  [/^(Повар|Официант|Мойщик посуды|Уборщица|Хостес|Обвальщик|Сотрудник ресторана)/i, "xizmat"],
  [/^(Водитель|Машинист|Бортпроводник|Курьер)/i, "transport"],
  [/^(Воспитатель|Учитель|Куратор)/i, "talim"],
  [/^(Геодезист|Геолог)/i, "qurilish"],
  [/^(Охранник|Военнослужащий|Полицейский)/i, "xavfsizlik"],
  [/^Специалист по информационной безопасности/i, "xavfsizlik"],
  [/^Переводчик/i, "mamuriy"],
];

export async function fetchHh(log: (s: string) => void = () => {}): Promise<SourceRow[]> {
  const j = await getJson("https://api.hh.ru/professional_roles");
  const cats = (j?.categories ?? []) as { id: string; name: string; roles: { id: string; name: string }[] }[];
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const c of cats) {
    const fallback = HH_CATEGORY[c.id];
    if (!fallback) continue;
    for (const r of c.roles) {
      if (seen.has(r.id) || /^Друг/i.test(r.name)) continue;
      seen.add(r.id);
      const sector = HH_ROLE_SECTOR.find(([re]) => re.test(r.name))?.[1] ?? fallback;
      // «Слесарь, сантехник» — birinchisi nom, qolgani alias.
      const parts = r.name.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
      out.push({ source: "hh", en: "", ru: parts[0] ?? r.name, aliases: parts.slice(1, 4), sector, code: r.id, group: c.name });
    }
  }
  log(`  hh.ru: ${out.length} ta unikal rol (${cats.length} kategoriyadan)`);
  return out;
}

/* ------------------------------------------------------------------ *
 * Kesh
 * ------------------------------------------------------------------ */

export async function loadSources(
  opts: { force?: boolean; deepen?: string[]; log?: (s: string) => void } = {},
): Promise<SourceCache> {
  const log = opts.log ?? (() => {});
  let cache: SourceCache | null = null;
  let dirty = false;
  if (!opts.force) {
    cache = await readFile(CACHE, "utf8")
      .then((t) => JSON.parse(t) as SourceCache)
      .catch(() => null);
    if (cache?.rows?.length) {
      log(`Kesh: ${cache.rows.length} ta manba yozuvi (${cache.fetchedAt})`);
      dirty = await repairMissed(cache, log);
    } else cache = null;
  }
  if (!cache) {
    log("Manbalar yuklanmoqda (ESCO ISCO daraxti ~620 so'rov + hh.ru)…");
    // Ketma-ket: ikki manbani bir vaqtda urish ham, ESCO daraxtini parallel
    // yurish ham «mehmon bo'lib bormaslik» qoidasini buzardi.
    const esco = await fetchEsco(log);
    const hh = await fetchHh(log);
    cache = { fetchedAt: new Date().toISOString(), rows: [...esco.rows, ...hh], missed: esco.missed };
    dirty = true;
    log(`Manbalar: ESCO ${esco.rows.length} (olinmagan shox: ${esco.missed.length}), hh.ru ${hh.length}`);
  }
  if (opts.deepen?.length && (await deepenSectors(cache, opts.deepen, log))) dirty = true;
  if (dirty) {
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(cache), "utf8");
    log(`Kesh yozildi: ${CACHE} — ${cache.rows.length} yozuv`);
  }
  return cache;
}

/** `--deepen huquq,hr` → ["huquq","hr"]; bayroq bo'lmasa bo'sh. */
export function deepenFlag(argv: string[]): string[] {
  const i = argv.indexOf("--deepen");
  return i > 0 && argv[i + 1] ? argv[i + 1].split(",").filter(Boolean) : [];
}

if (process.argv[1]?.endsWith("fetch-professions.mts")) {
  const c = await loadSources({ force: process.argv.includes("--force"), deepen: deepenFlag(process.argv), log: (s) => console.log(s) });
  const bySector = new Map<string, number>();
  for (const r of c.rows) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + 1);
  console.log([...bySector].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join("  "));
}
