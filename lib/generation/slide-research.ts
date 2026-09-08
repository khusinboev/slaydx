import { languageDirective } from "./i18n";
import { llmGrounded } from "./llm";
import { remainingMs } from "./quality";
import type { DocMeta } from "./types";

/**
 * Internet TADQIQOTI — Gemini grounding (`google_search`).
 *
 * Jonli tasdiqlangan (2026-09-08): `generateContent` da
 * `tools:[{google_search:{}}]` ishlaydi, javob `groundingMetadata`
 * (`webSearchQueries`, `groundingChunks[].web{uri,title}`,
 * `groundingSupports`, `searchEntryPoint`). `uri` — Google redirect,
 * `title` — domen. JSON rejimi bilan birga ISHLAMAYDI → ikki chaqiruv:
 * shu yerda matnli tadqiqot, keyin deck JSON.
 */
export type SlideSource = { title: string; uri: string };

export type SlideResearch = {
  /** Tekshirilgan faktlar matni — promptga `sourceBlock` naqshida kiradi. */
  facts: string;
  sources: SlideSource[];
  queries: string[];
  /** Google ToS: qidiruv takliflari HTML — sayt ko'ruvchisida ko'rsatiladi. */
  entryPoint?: string;
};

/**
 * Tadqiqot uchun eng kam vaqt.
 *
 * Grounding chaqiruvi qidiruv + o'ylash + matn: jonli sinovda 6–12 s.
 * Bundan kam vaqt qolganda umuman boshlamaymiz — chaqiruv baribir
 * timeout bo'lardi, lekin MATN bosqichidan vaqt o'g'irlagan bo'lardi.
 * Deck matnsiz umuman yo'q, tadqiqotsiz esa bor.
 */
const MIN_RESEARCH_MS = 8_000;

/** References slaydiga sig'adigan manba soni. */
const MAX_SOURCES = 8;

/** Redirectlarni ochishga ajratiladigan UMUMIY vaqt. */
const REDIRECT_MS = 3_000;

/** Grounding javobidagi `uri` shu manzil bo'lsa — ochish mumkin. */
const REDIRECT_HOST = "vertexaisearch.cloud.google.com";

/**
 * Mavzu bo'yicha internetdan tekshirilgan faktlar to'plami.
 *
 * `null` — «tadqiqot yo'q» degani va bu NORMAL yo'l: foydalanuvchi
 * qidiruvni yoqmagan, vaqt yetmagan, kalit Gemini emas yoki chaqiruv
 * yiqilgan. Deck baribir yoziladi (`slide-write.ts`), shunchaki
 * promptda tadqiqot bloki bo'lmaydi.
 */
export async function runSlideResearch(meta: DocMeta, deadline?: number): Promise<SlideResearch | null> {
  // Qidiruv YOQILMAGAN bo'lsa tarmoqqa umuman chiqmaymiz. Bu narx
  // masalasi ham: oyiga 5 000 qidiruv bepul, keyin $14/1000.
  if (meta.internetSearch !== true) return null;

  const budget = remainingMs(deadline);
  if (budget < MIN_RESEARCH_MS) {
    console.warn("[research] vaqt yetmadi:", budget, "ms — tadqiqot o'tkazib yuborildi");
    return null;
  }

  const res = await llmGrounded(researchSystem(meta), researchUser(meta), 2048, {
    timeoutMs: budget,
    /*
     * O'ylash byudjeti KICHIK, lekin nol emas. Nol bo'lsa model qidiruv
     * qilish/qilmaslikni «o'ylab» ulgurmay to'g'ridan-to'g'ri javob
     * yozadi va `groundingMetadata` kelmaydi; katta bo'lsa
     * `maxOutputTokens` ni o'ylash yeb qo'yadi va kandidat bo'sh
     * qaytadi. 256 — jonli sinovda 500–800 tokenlik matn bergan qiymat.
     */
    thinking: 256,
  });
  if (!res || !res.text.trim()) {
    console.warn("[research] natija bo'sh — tadqiqotsiz davom etamiz");
    return null;
  }

  /*
   * Manbalar bo'sh bo'lishi mumkin (model qidirmadi). Bu HALOKAT emas:
   * faktlar baribir qaytadi, shunchaki references slaydiga qo'yadigan
   * havola bo'lmaydi.
   */
  const sources = await resolveSources(dedupSources(res.sources), deadline);
  return {
    facts: res.text.trim(),
    sources,
    queries: res.queries,
    entryPoint: res.entryPoint,
  };
}

/** Rol va qat'iy qoidalar. */
function researchSystem(meta: DocMeta): string {
  return [
    languageDirective(meta.language),
    `Siz taqdimot uchun material yig'uvchi tadqiqotchisiz. Internetdan qidiring.`,
    `Mavzu bo‘yicha 6–10 ta TEKSHIRILGAN fakt yozing: son, sana, tashkilot, joy.`,
    `Har fakt bir jumla, alohida qator. Raqamlamang, sarlavha qo‘ymang, xulosa yozmang.`,
    `Uydirma yo‘q; bilmasang yozma. Manba topilmagan raqamni taxmin qilib yozmang.`,
  ].join("\n");
}

/** Aniq topshiriq — mavzu, fan va foydalanuvchi bergan yo'nalishlar. */
function researchUser(meta: DocMeta): string {
  const lines = [`Mavzu: «${meta.topic}».`];
  if (meta.subject.trim()) lines.push(`Fan: ${meta.subject.trim()}.`);
  if (meta.keyIdeas.length) {
    lines.push(`Ayniqsa shu g‘oyalar bo‘yicha fakt qidiring: ${meta.keyIdeas.join("; ")}.`);
  }
  if (meta.localExamples) {
    lines.push(`O‘zbekiston bo‘yicha ma’lumot USTUVOR: milliy statistika, mahalliy tashkilot, mahalliy misol.`);
  }
  return lines.join("\n");
}

/**
 * Manbalarni `title` bo'yicha noyoblaydi va ≤8 ta qoldiradi.
 *
 * Nega `title` bo'yicha: grounding `title` sifatida DOMEN qaytaradi
 * (`daryo.uz`), `uri` esa har chunk uchun boshqacha redirect. Ya'ni
 * bitta saytning uch sahifasi uch xil `uri` bilan keladi va references
 * slaydida «daryo.uz, daryo.uz, daryo.uz» bo'lib chiqardi.
 */
function dedupSources(list: SlideSource[]): SlideSource[] {
  const seen = new Set<string>();
  const out: SlideSource[] = [];
  for (const s of list) {
    const title = s.title.trim();
    const uri = s.uri.trim();
    if (!title || !uri) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, uri });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/**
 * Google redirectini HAQIQIY manzilga ochadi — IXTIYORIY qadam.
 *
 * Grounding `uri` sifatida `vertexaisearch.cloud.google.com/...` beradi.
 * Uni references slaydiga qo'ysak foydalanuvchi havolani ko'rib manbani
 * taniy olmaydi va havola vaqt o'tib o'ladi. HEAD + `redirect: "manual"`
 * bilan `location` sarlavhasini o'qiymiz.
 *
 * Yiqilsa (timeout, tarmoq, 403) — eski `uri` QOLADI. Bu qadam uchun
 * deck qurbon qilinmaydi: umumiy 3 s, hammasi parallel.
 */
async function resolveSources(sources: SlideSource[], deadline?: number): Promise<SlideSource[]> {
  const targets = sources.filter((s) => s.uri.includes(REDIRECT_HOST));
  if (!targets.length) return sources;
  // Deck muddatidan o'g'irlamaymiz: vaqt qolmagan bo'lsa domen qoladi.
  if (remainingMs(deadline) < REDIRECT_MS) return sources;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REDIRECT_MS);
  try {
    return await Promise.all(
      sources.map(async (s) => {
        if (!s.uri.includes(REDIRECT_HOST)) return s;
        try {
          const res = await fetch(s.uri, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
          const loc = res.headers?.get?.("location");
          return loc && /^https?:\/\//i.test(loc) ? { title: s.title, uri: loc } : s;
        } catch {
          return s;
        }
      }),
    );
  } catch {
    return sources;
  } finally {
    clearTimeout(timer);
  }
}
