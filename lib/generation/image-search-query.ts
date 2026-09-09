/**
 * BEPUL FOTO QIDIRUV SO'ROVI (AUDIT-9 P3).
 *
 * Nega bu fayl bor. `slide-image-prompts.ts` `composeSlideImagePrompt`
 * AI rasm modeli uchun UZUN, tarkibli ingliz matn yasaydi («TOPIC (must
 * be visible): …. THIS SLIDE: …. cinematic establishing view…»). Stock
 * foto qidiruv API (Pexels/Pixabay) buni yoqtirmaydi — ular 2-5 so'zli
 * aniq ot iborasini kutadi («water cycle diagram» kabi), uzun jumla
 * bersa deyarli hech narsa yoki tasodifiy natija qaytaradi.
 *
 * Manba ustuvorligi: slayd `imageHint` (odatda eng aniq ko'rsatma) →
 * sarlavha+kichik sarlavha/iqtibos → mavzu (`topic`). Har biri
 * tokenlarga bo'linadi, o'zbek/rus so'zlar (bor bo'lsa) kichik lug'at
 * bilan ingliz so'ziga o'giriladi (`WORD_MAP` — TO'LIQ tarjimon EMAS,
 * taqdimotlarda tez-tez uchraydigan ~50 ot uchun evristika), stop-so'zlar
 * chiqarib tashlanadi, birinchi 2-5 NOYOB so'z qoladi.
 *
 * O'zbekistonga oid mashhur joy/taom (Registon, palov, Buxoro...) uchun
 * `uz-gazetteer.ts` (mustaqil «Rasm» vositasi va slayd AI prompti bilan
 * BITTA manba) haqiqiy ingliz tafsilotini beradi — u lug'atdan ustun
 * turadi, chunki taxmindan aniqroq.
 *
 * Determinizm: funksiya faqat argumentlardan hisoblaydi (na `Date.now`,
 * na tarmoq, na tasodifiy son) — bir xil kirish har doim bir xil so'rov
 * beradi. Test shuni tekshiradi.
 */
import { groundUzbekScene } from "./uz-gazetteer";
import type { SlideModel } from "./slide-types";
import type { SlideImageMeta } from "./slide-image-prompts";

/**
 * Inglizcha «bog'lovchi» so'zlar — ot emas, qidiruv so'roviga qo'shilsa
 * shovqin qiladi (masalan «the water of the cycle» → «water cycle»
 * o'rniga besh so'zli chalkash satr chiqardi).
 */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or",
  "with", "without", "is", "are", "was", "were", "this", "that", "these",
  "those", "from", "by", "as", "it", "its", "be", "being", "been", "has",
  "have", "had", "will", "shall", "can", "could", "would", "should", "may",
  "might", "must", "not", "no", "do", "does", "did", "so", "if", "than",
  "then", "but", "about", "into", "over", "under", "between", "during",
  "before", "after", "above", "below", "up", "down", "out", "off",
  "again", "here", "there", "when", "where", "why", "how", "all", "each",
  "few", "more", "most", "other", "some", "such", "only", "own", "same",
  "very", "just", "slide", "topic", "subject", "real", "one",
]);

/**
 * O'zbek/rus → ingliz evristik lug'at.
 *
 * TO'LIQ TARJIMON EMAS: taqdimotlarda tez-tez uchraydigan ~50 umumiy ot
 * (tabiat, fan, iqtisod, jamiyat mavzulari). Lug'atda yo'q so'z o'zgarishsiz
 * o'tadi — ba'zan bu allaqachon ingliz so'zi (masalan «robot», «internet»),
 * ba'zan yo'q. Ikkinchi holatda qidiruv kam natija berishi mumkin, lekin
 * bu XAVFSIZ: `chainProvider` bo'sh/yiqilgan natijani keyingi manbaga
 * (oxir-oqibat fal AI ga) o'tkazadi — hech qachon rasmsiz qolinmaydi.
 */
// Kalitlar `translateWord` bilan bir xil normallashda: apostrof/tutuq
// belgisi ('  ’  ʻ  `) OLIB TASHLANGAN, kichik harf. Shu sabab «o'zgarishi»
// emas, «ozgarishi» yoziladi — aks holda kirishdagi turli apostrof
// belgilari (klaviatura, Unicode varianti) kalitga mos kelmay qolardi.
const WORD_MAP: Record<string, string> = {
  suv: "water", aylanish: "cycle", aylanishi: "cycle",
  iqlim: "climate", ozgarish: "change", ozgarishi: "change",
  tabiat: "nature", quyosh: "sun", energiya: "energy", energiyasi: "energy",
  shamol: "wind", yer: "earth", kosmos: "space", sayyora: "planet",
  yulduz: "star", galaktika: "galaxy",
  tarix: "history", urush: "war", jamiyat: "society", madaniyat: "culture",
  sanat: "art", musiqa: "music", sport: "sport",
  futbol: "football", transport: "transport", mashina: "car",
  samolyot: "airplane", poyezd: "train", kema: "ship",
  shahar: "city", qishloq: "village", bozor: "market", savdo: "trade",
  biznes: "business", moliya: "finance", bank: "bank", pul: "money",
  sanoat: "industry", ekologiya: "ecology", iflos: "pollution",
  chiqindi: "waste", elektr: "electricity",
  odam: "human", bola: "child", maktab: "school", universitet: "university",
  talaba: "student", oqituvchi: "teacher",
  kitob: "book", til: "language", adabiyot: "literature",
  jarayon: "process", tizim: "system", tarmoq: "network",
  internet: "internet", telefon: "phone",
  malumot: "data", statistika: "statistics",
  tibbiyot: "medicine", shifokor: "doctor", kasallik: "disease",
  dori: "medicine", vaksina: "vaccine", virus: "virus",
  hujayra: "cell", organizm: "organism", ekotizim: "ecosystem",
  ormon: "forest", chol: "desert",
  dengiz: "sea", okean: "ocean", daryo: "river", kol: "lake",
  tog: "mountain", vulqon: "volcano",
  zilzila: "earthquake", obhavo: "weather",
  harorat: "temperature", atom: "atom", molekula: "molecule",
  metall: "metal", plastik: "plastic", qogoz: "paper",
  yogoch: "wood", tosh: "stone",
  kompyuter: "computer", dastur: "software", robot: "robot",
  kimyo: "chemistry", fizika: "physics", biologiya: "biology",
  matematika: "mathematics", iqtisod: "economy", iqtisodiyot: "economics",
  suniy: "artificial", // "sun'iy" → apostrof olib tashlangach "suniy"
  intellekt: "intelligence",
};

/** Faqat harflardan tashkil topgan so'zlarni ajratadi (belgi/raqamsiz). */
function tokenize(text: string): string[] {
  return text.match(/\p{L}[\p{L}'-]*/gu) ?? [];
}

/**
 * Lug'atdan qidiradi — kalitlar apostrof/tutuq va chiziqchasiz, kichik
 * harfda saqlangan (masalan «ob-havo» → «obhavo»), kirish ham shunga mos
 * normallashtiriladi.
 */
function translateWord(raw: string): string {
  const key = raw.toLowerCase().replace(/['’ʻ`-]/g, "");
  return WORD_MAP[key] || raw;
}

function usable(word: string): boolean {
  if (word.length < 3) return false;
  return !STOPWORDS.has(word.toLowerCase());
}

const MAX_WORDS = 5;
const MIN_WORDS_WITH_SUFFIX = 4;

/**
 * Slayd/mavzu matnidan 2-5 so'zli inglizcha qidiruv so'rovi yasaydi.
 *
 * `null` qaytishi — bepul manbalar bu slayd uchun UMUMAN so'ralmasin
 * degani: uslub `photo` bo'lmasa (illustration/chalk/minimal), stock
 * foto arxivi mos kelmaydi — to'g'ridan-to'g'ri fal (AI) chizadi.
 */
export function searchQueryFor(
  topic: string,
  slide: Pick<SlideModel, "title" | "subtitle" | "quote" | "imageHint">,
  meta?: SlideImageMeta,
): string | null {
  const style = meta?.slideImageStyle ?? "photo";
  if (style !== "photo") return null;

  const hint = (slide.imageHint || "").trim();
  const moment = hint || [slide.title, slide.subtitle || slide.quote || ""].filter(Boolean).join(" ");
  const gazetteer = groundUzbekScene(`${topic} ${moment}`);

  // Manba tartibi: gazetteer (haqiqiy ingliz matni) → imageHint/sarlavha
  // (eng aniq) → mavzu (eng umumiy, zaxira).
  const sources = [gazetteer, moment, topic].filter(Boolean);

  const seen = new Set<string>();
  const words: string[] = [];
  for (const source of sources) {
    for (const raw of tokenize(source)) {
      const translated = translateWord(raw);
      if (!usable(translated)) continue;
      const norm = translated.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      words.push(translated.toLowerCase());
      if (words.length >= MAX_WORDS) break;
    }
    if (words.length >= MAX_WORDS) break;
  }

  if (!words.length) return null;

  const wantsLocal = Boolean(meta?.localExamples);
  const cap = wantsLocal ? MIN_WORDS_WITH_SUFFIX : MAX_WORDS;
  const out = words.slice(0, cap);
  if (wantsLocal && !seen.has("uzbekistan")) out.push("Uzbekistan");

  return out.join(" ");
}
