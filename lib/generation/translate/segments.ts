/**
 * Segment modeli — tarjima dvigatelining YAGONA valyutasi.
 *
 * Butun sprintning talabi: chiqish formati = kirish formati va uslub,
 * shrift, jadval, kolontitul, rasm o'z joyida qoladi. Buning yagona yo'li —
 * hujjatni QAYTA QURMASLIK: undan faqat MATN tugunlari olinadi, tarjima
 * qilinadi va aynan o'sha tugunlarga qaytariladi.
 *
 * Shu sababli formatlash MATN ichida `⟦…⟧` tokenlari bilan olib
 * yuriladi. Tokenlar ataylab `⟦`/`⟧` (U+27E6/U+27E7) bilan yozilgan:
 * bu belgilar odatiy hujjatda ham, LLM chiqishida ham uchramaydi, ya'ni
 * ularni matn bilan chalkashtirib bo'lmaydi va tekshiruv (multiset
 * tengligi) ishonchli bo'ladi.
 *
 *   ⟦tab⟧      tabulyatsiya
 *   ⟦br⟧       qator uzilishi (paragraf ichida)
 *   ⟦1⟧ ⟦2⟧…   OPAQUE bo'lak: rasm, maydon (PAGE), simvol, formula —
 *              tarjima qilinmaydi, joyi saqlanadi
 *   ⟦rK⟧…⟦/rK⟧ alohida formatlangan span (qalin, kursiv) — K-run
 *   ⟦lK⟧…⟦/lK⟧ giperhavola matni (havolaning o'zi tegilmaydi)
 */

export type SourceKind = "docx" | "pptx" | "xlsx" | "pdf" | "txt" | "md" | "csv";

export type SegmentKind = "p" | "h" | "li" | "cell" | "note" | "title" | "other";

export type Segment = {
  /** Barqaror identifikator, masalan `d0:p17` yoki `x:s12`. */
  id: string;
  text: string;
  kind: SegmentKind;
  /** Kontekst yorlig'i — modelga ham, ko'ruvchining guruhlashiga ham. */
  ctx?: string;
  /** Fayl ichidagi qism (ZIP yo'li yoki mantiqiy nom). */
  part: string;
  /**
   * Aynan shu matnli OLDINGI segmentning id si.
   *
   * Nega kerak: hujjatlarda takror ko'p (jadval sarlavhalari, kolontitul,
   * «Jami»). Dublikatni bir marta tarjima qilib nusxalash pul va vaqtni
   * tejaydi va — muhimrog'i — bir xil matn hujjatning ikki joyida BOSHQA
   * tarjima bo'lib chiqmasligini kafolatlaydi.
   */
  dup?: string;
};

export type SegmentMap = Map<string, string>;

/**
 * PDF dan tiklangan tuzilma bloki.
 *
 * PDF da paragraf, sarlavha, ro'yxat degan tushuncha YO'Q — faqat
 * koordinatali matn parchalari. `pdf.ts` ularni shu bloklarga tiklaydi,
 * keyin bloklar segmentga, tarjimadan keyin esa `AcademicDoc` ga
 * aylanadi. Tip shu yerda turadi, chunki `Extracted` unga bog'liq va
 * `segments.ts` — tiplarning yagona uyi (aks holda halqali import).
 */
export type PdfBlock = {
  kind: "h" | "p" | "li" | "table";
  text?: string;
  rows?: string[][];
  /** 1 dan boshlanadigan sahifa raqami. */
  page: number;
};

export type Extracted = {
  segments: Segment[];
  /** Tarjima qilinadigan segmentlar matnining yig'indisi — NARX shundan. */
  chars: number;
  warnings: string[];
  pdf?: { blocks: PdfBlock[]; pages: number };
};

/**
 * Tokenlarni topuvchi regexp — har chaqiruvda YANGISI.
 *
 * Global regexp `lastIndex` holatini olib yuradi. Bitta nusxani bir
 * necha funksiya (`pieces`, `planZone`, `tokenSpans`) baham ko'rsa, biri
 * ikkinchisining o'rnini surib yuboradi va token jimgina o'tkazib
 * yuboriladi — natijada matn noto'g'ri runga tushadi. Shuning uchun
 * umumiy o'zgaruvchi emas, fabrika.
 */
export function tokenRe(): RegExp {
  return /⟦(?:tab|br|\d+|\/?[rl]\d+)⟧/g;
}

/** Formatlash markerlari soni chegarasi — undan ortig'i modelni chalg'itadi. */
export const MAX_RUN_MARKERS = 4;

/** Bitta segmentning eng katta uzunligi (undan kattasi bo'linadi). */
export const MAX_SEGMENT_CHARS = 2000;

/**
 * Tokenlarni ko'rsatish uchun tozalaydi: `⟦tab⟧`→`\t`, `⟦br⟧`→`\n`,
 * qolganlari olib tashlanadi.
 *
 * Ko'ruvchidagi «asl ↔ tarjima» ustunlari va `isTranslatable` shu
 * ko'rinish ustida ishlaydi — foydalanuvchi hech qachon `⟦3⟧` ni
 * ko'rmaydi.
 */
export function stripTokens(text: string): string {
  return text.replace(tokenRe(), (t) => (t === "⟦tab⟧" ? "\t" : t === "⟦br⟧" ? "\n" : ""));
}

/** Matndagi tokenlarning tartiblangan ro'yxati — tekshiruv uchun. */
export function tokenMultiset(text: string): string[] {
  return (text.match(tokenRe()) ?? []).slice().sort();
}

/**
 * Juft tokenlar (`⟦rK⟧`/`⟦/rK⟧`, `⟦lK⟧`/`⟦/lK⟧`) muvozanatli va to'g'ri
 * ichma-ich joylashganmi.
 *
 * Model markerni ochib yopmasa yoki tartibini almashtirsa, matnni
 * runlarga taqsimlash ma'nosiz bo'ladi — bunday holatda applier
 * DOMINANT runga qaytadi (formatlash yo'qoladi, lekin MATN va hujjat
 * tuzilmasi saqlanadi).
 */
export function tokensBalanced(text: string): boolean {
  const stack: string[] = [];
  for (const m of text.match(tokenRe()) ?? []) {
    const body = m.slice(1, -1);
    if (body === "tab" || body === "br" || /^\d+$/.test(body)) continue;
    if (body.startsWith("/")) {
      if (stack.pop() !== body.slice(1)) return false;
    } else {
      stack.push(body);
    }
  }
  return stack.length === 0;
}

const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `ISO-9001`, `HTTP/1.1`, `A1` — kod, tarjima qilinmaydi. */
const CODE_RE = /^[A-Z0-9_\-./]{2,}$/;
/**
 * O'lchov birliklari — «12 kg», «5 %», «3.5 GHz» tarjimasiz qoladi.
 * Ro'yxat ataylab qisqa: shubhali holatda tarjima qilingani yaxshiroq.
 */
const UNITS = new Set([
  "%", "mm", "sm", "cm", "dm", "m", "km", "mg", "g", "kg", "t", "ml", "l",
  "kb", "mb", "gb", "tb", "px", "pt", "hz", "khz", "mhz", "ghz",
  "usd", "eur", "uzs", "rub", "°c", "°f",
]);

/**
 * Segment umuman tarjima qilinishi kerakmi.
 *
 * Nega bu muhim: har tarjima qilinmaydigan segment PUL (narx `chars`
 * dan hisoblanadi), VAQT (LLM chaqiruvi) va XAVF (model raqamni yoki
 * URL ni «tarjima» qilib yuborishi) demakdir. Tarjima qilinmagan
 * segment esa hujjatda o'z holicha, tegilmasdan qoladi.
 */
export function isTranslatable(text: string): boolean {
  const t = stripTokens(text).trim();
  if (!t) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (URL_RE.test(t) || EMAIL_RE.test(t)) return false;
  // Faqat BOSH HARFLI kod/artikul (`ISO-9001`) — kichik harf yo'q.
  if (CODE_RE.test(t) && !/\p{Ll}/u.test(t)) return false;
  // Raqam + o'lchov birligi: «12 kg», «3,5 GHz».
  const bare = t.replace(/[\d\s.,:;()[\]/–—-]+/g, " ").trim().toLowerCase();
  if (bare && bare.split(/\s+/).every((w) => UNITS.has(w))) return false;
  return true;
}

/** Dublikat aniqlash kaliti — ko'rinadigan matn, registr va bo'shliqsiz. */
export function normKey(text: string): string {
  return stripTokens(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Takrorlanuvchi segmentlarga `dup` qo'yadi (birinchisi «asl» bo'lib
 * qoladi, keyingilari unga ishora qiladi).
 */
export function markDuplicates(segs: Segment[]): void {
  const first = new Map<string, string>();
  for (const s of segs) {
    if (!isTranslatable(s.text)) continue;
    const key = normKey(s.text);
    if (!key) continue;
    const prev = first.get(key);
    if (prev && prev !== s.id) s.dup = prev;
    else if (!prev) first.set(key, s.id);
  }
}

/** Matndagi `⟦…⟧` tokenlarining [boshi, oxiri) oraliqlari. */
function tokenSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = tokenRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function insideToken(spans: Array<[number, number]>, i: number): boolean {
  return spans.some(([a, b]) => i > a && i < b);
}

/**
 * Juda uzun segmentni JUMLA chegarasi bo'yicha bo'ladi.
 *
 * Nega: bitta partiya ≤3 500 belgi va segment partiyalar orasida
 * BO'LINMAYDI — 6 000 belgilik paragraf (matn qutisi, tezis) aks holda
 * umuman tarjima qilinmasdi. Token HECH QACHON o'rtasidan kesilmaydi,
 * aks holda `⟦r1⟧` ikki bo'lakka bo'linib multiset tekshiruvi
 * ikkalasida ham qulaydi.
 */
export function splitOversize(seg: Segment, max: number = MAX_SEGMENT_CHARS): Segment[] {
  if (seg.text.length <= max) return [seg];
  const spans = tokenSpans(seg.text);
  const text = seg.text;

  // Nomzod chegaralar: jumla oxiri yoki `⟦br⟧` dan keyin.
  const cuts: number[] = [];
  const sentence = /[.!?…‥。？！:;]["»”’)]*\s+|⟦br⟧/g;
  let m: RegExpExecArray | null;
  while ((m = sentence.exec(text))) {
    const at = m.index + m[0].length;
    if (at < text.length && !insideToken(spans, at)) cuts.push(at);
  }
  // Jumla topilmasa — so'z chegarasi (uzun ro'yxat, jadval katagi).
  if (!cuts.length) {
    const word = /\s+/g;
    while ((m = word.exec(text))) {
      const at = m.index + m[0].length;
      if (at < text.length && !insideToken(spans, at)) cuts.push(at);
    }
  }
  if (!cuts.length) return [seg];

  const parts: string[] = [];
  let from = 0;
  let last = 0;
  for (const cut of cuts) {
    if (cut - from > max && last > from) {
      parts.push(text.slice(from, last));
      from = last;
    }
    last = cut;
  }
  parts.push(text.slice(from));

  if (parts.length < 2) return [seg];
  return parts.map((t, i) => ({ ...seg, id: `${seg.id}#${i}`, text: t }));
}

/**
 * `splitOversize` bo'laklarini qayta yig'adi.
 *
 * Model bo'lakning oxiridagi probelni yeb qo'yishi mumkin — shuning
 * uchun chegarada bo'shliq yo'q bo'lsa bittasi qo'shiladi, aks holda
 * ikki jumla qo'shilib ketardi.
 */
export function joinSubsegments(parts: string[]): string {
  let out = "";
  for (const p of parts) {
    if (!out) {
      out = p;
      continue;
    }
    const needsSpace = !/\s$/.test(out) && !/^\s/.test(p) && !out.endsWith("⟧") && !p.startsWith("⟦");
    out += (needsSpace ? " " : "") + p;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────
 * ZONA MODELI — matn tugunlarini tokenlashtirish va qaytarish.
 *
 * Bu qism DOCX, PPTX va XLSX uchun UMUMIY, chunki uchalasi ham bir xil
 * tuzilishga ega: paragraf = ketma-ket «run» lar, har birida o'z
 * formatlash xossalari (`rPr`) va matni. Farqi faqat teg nomlarida va
 * opaque hisoblangan narsalarda — ular adapterda qoladi.
 * ──────────────────────────────────────────────────────────────────── */

/** Bitta MANTIQIY run: qo'shni bir xil `rPr` li runlar birlashtirilgan. */
export type ZoneRun = {
  /** Formatlash kaliti (`rsid`/`lang`/`noProof` tozalangan `rPr`). */
  key: string;
  /** Run matni — `⟦tab⟧`/`⟦br⟧` tokenlari bilan. */
  text: string;
};

/** Bir yoki bir necha runli matn maydoni. `link` — giperhavola ichi. */
export type Zone = { link: boolean; runs: ZoneRun[] };

export type ParaPart = { kind: "opaque" } | { kind: "zone"; zone: Zone };

export type ZonePlan = {
  zone: Zone;
  /** `K` → `zone.runs` indeksi. Bo'sh bo'lsa marker ishlatilmagan. */
  markers: Map<number, number>;
};

export type ParaText = { text: string; zones: ZonePlan[] };

/** Qo'shni bir xil formatli runlarni birlashtiradi. */
export function mergeRuns(runs: ZoneRun[]): Array<{ key: string; text: string; first: number }> {
  const out: Array<{ key: string; text: string; first: number }> = [];
  runs.forEach((r, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.key === r.key) prev.text += r.text;
    else out.push({ key: r.key, text: r.text, first: i });
  });
  return out;
}

/** Zonadagi eng uzun (dominant) run indeksi. */
export function dominantRun(zone: Zone): number {
  let best = 0;
  let bestLen = -1;
  zone.runs.forEach((r, i) => {
    const len = stripTokens(r.text).trim().length;
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  });
  return best;
}

/**
 * Paragraf qismlaridan MODELGA yuboriladigan matnni quradi.
 *
 * Markerlar FAQAT zonada 2–4 ta har xil formatli mantiqiy run bo'lganda
 * qo'yiladi. Bittada — keraksiz shovqin; to'rttadan ko'pda — model
 * markerlarni chalkashtirib yuboradi va foyda zarardan kam
 * (`>4` holat dominant runga tushadi, bu hujjatlashtirilgan cheklov).
 */
export function buildParaText(parts: ParaPart[]): ParaText {
  const zones: ZonePlan[] = [];
  let opaque = 0;
  let k = 0;
  let l = 0;
  let text = "";

  for (const part of parts) {
    if (part.kind === "opaque") {
      text += `⟦${++opaque}⟧`;
      continue;
    }
    const zone = part.zone;
    const markers = new Map<number, number>();
    const useMarkers = zone.runs.length >= 2 && zone.runs.length <= MAX_RUN_MARKERS;
    let body = "";
    zone.runs.forEach((r, i) => {
      if (!useMarkers) {
        body += r.text;
        return;
      }
      const key = ++k;
      markers.set(key, i);
      body += `⟦r${key}⟧${r.text}⟦/r${key}⟧`;
    });
    if (zone.link) {
      const key = ++l;
      text += `⟦l${key}⟧${body}⟦/l${key}⟧`;
    } else {
      text += body;
    }
    zones.push({ zone, markers });
  }
  return { text, zones };
}

/** `⟦rK⟧`/`⟦lK⟧`/`⟦n⟧` olib tashlanadi, `⟦tab⟧`/`⟦br⟧` qoladi. */
export function keepLayoutTokens(text: string): string {
  return text.replace(tokenRe(), (t) => (t === "⟦tab⟧" || t === "⟦br⟧" ? t : ""));
}

type Item = { link: boolean; text: string };

/** Tarjima matnini opaque tokenlar va havola spanlari bo'yicha bo'laklaydi. */
function pieces(text: string): Item[] {
  const out: Item[] = [];
  let buf = "";
  let i = 0;
  const re = tokenRe();
  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) break;
    const body = m[0].slice(1, -1);
    if (/^\d+$/.test(body)) {
      buf += text.slice(i, m.index);
      out.push({ link: false, text: buf });
      buf = "";
      i = m.index + m[0].length;
      continue;
    }
    if (/^l\d+$/.test(body)) {
      const close = `⟦/${body}⟧`;
      const at = text.indexOf(close, m.index);
      if (at < 0) {
        // Yopilmagan havola — matn deb qaraymiz (fallback baribir ishlaydi).
        buf += text.slice(i, m.index + m[0].length);
        i = m.index + m[0].length;
        continue;
      }
      buf += text.slice(i, m.index);
      out.push({ link: false, text: buf });
      buf = "";
      out.push({ link: true, text: text.slice(m.index + m[0].length, at) });
      i = at + close.length;
      continue;
    }
    buf += text.slice(i, m.index + m[0].length);
    i = m.index + m[0].length;
  }
  buf += text.slice(i);
  out.push({ link: false, text: buf });
  return out;
}

/**
 * Tarjimani zonalarga TAQSIMLAYDI.
 *
 * Bo'laklar zonalarga TURI va TARTIBI bo'yicha 1:1 mos keladi. Model
 * tokenlarni yo'qotgan bo'lsa (bo'laklar soni mos kelmasa) — hamma
 * matn birinchi oddiy zonaga tushadi. Bu «yomon, lekin xavfsiz»
 * qaytish yo'li: formatlash yo'qoladi, MATN esa yo'qolmaydi.
 */
export function distribute(text: string, zones: ZonePlan[]): Array<string | null> {
  const fallback = (): Array<string | null> => {
    const out: Array<string | null> = zones.map(() => null);
    const firstBare = zones.findIndex((z) => !z.zone.link);
    const target = firstBare >= 0 ? firstBare : 0;
    if (zones.length) out[target] = keepLayoutTokens(text);
    return out;
  };

  /*
   * BO'SH oddiy bo'laklar tashlanadi.
   *
   * Ular tokenlar chegarasida tabiiy paydo bo'ladi: «matn⟦l1⟧havola⟦/l1⟧»
   * ni bo'lish oxirida bo'sh bo'lak qoldiradi, holbuki unga mos zona
   * YO'Q. Tashlanmasa bo'laklar soni zonalar sonidan doim ortiq bo'lib,
   * har havolali paragraf fallback ga tushardi — ya'ni havola matni
   * oddiy matnga aylanardi.
   */
  const items = pieces(text).filter((it) => it.link || it.text !== "");
  const needLink = zones.filter((z) => z.zone.link).length;
  const needBare = zones.length - needLink;
  const gotLink = items.filter((it) => it.link).length;
  if (gotLink !== needLink || items.length - gotLink > needBare) return fallback();

  let i = 0;
  const out = zones.map((z) => {
    const it = items[i];
    if (it && it.link === z.zone.link) {
      i++;
      return it.text;
    }
    return null;
  });
  // Bo'lak ortib qolsa — moslik buzilgan, matnni yo'qotmaymiz.
  return i === items.length ? out : fallback();
}

export type Piece = { run: number; text: string };

/**
 * Zona tarjimasini runlarga joylaydi.
 *
 * `null` — zonaga tegilmasin (tarjima bo'sh yoki yo'q): asl matn
 * qoladi. Bu ataylab: bo'sh natija hujjatdan matnni JIMGINA o'chirib
 * yuborishi mumkin bo'lgan yagona yo'l edi.
 */
export function planZone(plan: ZonePlan, text: string | null): Piece[] | null {
  if (text === null) return null;
  if (!stripTokens(text).trim()) return null;
  const dom = dominantRun(plan.zone);
  const fallback = (): Piece[] => [{ run: dom, text: keepLayoutTokens(text) }];

  if (!plan.markers.size) return fallback();
  if (!tokensBalanced(text)) return fallback();

  const out: Piece[] = [];
  const stack: number[] = [];
  let buf = "";
  let cur = dom;
  let ok = true;

  const flush = () => {
    if (!buf) return;
    const prev = out[out.length - 1];
    if (prev && prev.run === cur) prev.text += buf;
    else out.push({ run: cur, text: buf });
    buf = "";
  };

  let i = 0;
  const re = tokenRe();
  while (i < text.length && ok) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) break;
    buf += text.slice(i, m.index);
    const body = m[0].slice(1, -1);
    i = m.index + m[0].length;

    if (body === "tab" || body === "br") {
      buf += m[0];
      continue;
    }
    if (/^\d+$/.test(body) || /^\/?l\d+$/.test(body)) continue; // zona ichida ma'nosiz
    if (body.startsWith("/r")) {
      flush();
      stack.pop();
      cur = stack.length ? stack[stack.length - 1] : dom;
      continue;
    }
    const k = Number(body.slice(1));
    const run = plan.markers.get(k);
    if (run === undefined) {
      ok = false;
      break;
    }
    flush();
    stack.push(run);
    cur = run;
  }
  if (!ok) return fallback();
  buf += text.slice(i);
  flush();

  const kept = out.filter((p) => p.text.length);
  return kept.length ? kept : fallback();
}
