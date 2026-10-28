/**
 * QO'LYOZMA KO'RINISH (mustaqil ish, Program 17 band 10) — YAGONA MANBA.
 *
 * Mustaqil ish mazmuni o'zgarmaydi; faqat KO'RINISH: maktab daftari
 * (chiziqli yoki katakli varaq, siyoh rangi, qo'lyozma shrifti). Bu
 * fayldagi sonlarni uch joy o'qiydi — ular ajralib ketmasligi uchun
 * shu yerda turadi:
 *
 *   • `render-hand.ts` — DOCX (qator balandligi, chegaralar, varaq foni);
 *   • `components/viewers/WordViewer.tsx` + `app/globals.css` — sayt
 *     ko'ruvchisi (CSS o'zgaruvchilar `handCssVars` dan);
 *   • `paper-png.ts` — chizilgan varaq PNG si (DOCX foni).
 *
 * Izomorf: DOM ham, `docx` ham, Node importi ham YO'Q.
 *
 * ── Qator ← → chiziq qoidasi ───────────────────────────────────────────
 * Matn QAT'IY (exact) qator balandligida yoziladi: har qator = daftarning
 * bitta chizig'i oralig'i (`pitchTw`). Barcha bo'shliqlar (`before`/`after`)
 * shu oraliqning butun karrasi, shuning uchun sahifaning istalgan qatori
 * chiziqqa tushadi. LibreOffice (va Word) aniq balandlikda matn asosini
 * (baseline) qator balandligining 80 % ida qo'yadi — chiziq aynan shu
 * balandlikda chiziladi (`BASELINE_FRACTION`, render orqali tasdiqlangan).
 * Brauzerda esa asos shrift o'lchamlaridan chiqadi (`handBaselinePx`).
 */

/* ────────────────────────── tanlovlar ────────────────────────── */

export const WORK_VIEWS = ["plain", "hand"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];
export const WORK_VIEW_LABELS: Record<WorkView, string> = { plain: "Oddiy (Word)", hand: "Qo‘lyozma" };

export const HAND_INKS = ["blue", "black", "purple"] as const;
export type HandInk = (typeof HAND_INKS)[number];
export const HAND_INK_LABELS: Record<HandInk, string> = { blue: "Ko‘k", black: "Qora", purple: "Binafsha" };
/** Siyoh ranglari (HEX, `#` siz) — ruchka siyohiga yaqin, oq qog'ozda o'qiladigan to'qlikda. */
export const HAND_INK_HEX: Record<HandInk, string> = { blue: "1B3AA6", black: "1C1C1E", purple: "5B2A9E" };

export const HAND_PAPERS = ["lined", "grid"] as const;
export type HandPaper = (typeof HAND_PAPERS)[number];
export const HAND_PAPER_LABELS: Record<HandPaper, string> = { lined: "Chiziqli", grid: "Katakli" };

export const HAND_FONT_IDS = ["school", "pen", "badscript", "caveat"] as const;
export type HandFontId = (typeof HAND_FONT_IDS)[number];

export const HAND_DEFAULTS = { ink: "blue", paper: "lined", font: "school" } as const satisfies { ink: HandInk; paper: HandPaper; font: HandFontId };

/**
 * Modelga (`WorkModel.hand`) saqlanadigan tanlov. `lively` — «jonli yozuv»
 * (har so'z biroz boshqacha); o'chiq bo'lsa maydon umuman yo'q (eski ishlar o'zgarmaydi).
 */
export type WorkHand = {
  ink: HandInk;
  paper: HandPaper;
  font: HandFontId;
  lively?: true;
  /** `plain` — sarlavha oddiy yoziladi («Kirish»); yo'q = BOSH HARFLI (eski ishlar o'zgarmaydi). */
  headings?: "plain";
  /** `calligraphy` — muqova sarlavhasi Great Vibes'da; yo'q = oddiy qo'lyozma shrifti. */
  cover?: "calligraphy";
  /** `false` — sarlavha tagiga chiziq chizilmaydi; yo'q = chiziladi. */
  underline?: false;
};

/** Formadagi qo'shimcha tanlovlar (qiymat = forma maydoni); `…_DEFAULT` — yangi forma standarti. */
export const HAND_HEADINGS = ["plain", "caps"] as const;
export type HandHeadingsValue = (typeof HAND_HEADINGS)[number];
export const HAND_HEADINGS_LABELS: Record<HandHeadingsValue, string> = { plain: "Oddiy", caps: "BOSH HARFLI" };
export const HAND_HEADINGS_DEFAULT: HandHeadingsValue = "plain";

export const HAND_COVERS = ["plain", "calligraphy"] as const;
export type HandCoverValue = (typeof HAND_COVERS)[number];
export const HAND_COVER_LABELS: Record<HandCoverValue, string> = { plain: "Oddiy", calligraphy: "Kalligrafik" };
export const HAND_COVER_DEFAULT: HandCoverValue = "plain";

export const HAND_UNDERLINES = ["on", "off"] as const;
export type HandUnderlineValue = (typeof HAND_UNDERLINES)[number];
export const HAND_UNDERLINE_LABELS: Record<HandUnderlineValue, string> = { on: "Bor", off: "Yo‘q" };
export const HAND_UNDERLINE_DEFAULT: HandUnderlineValue = "on";

/** Formadagi «Yozuv» tanlovi: tekis (standart emas, eski xulq) yoki jonli. */
export const HAND_LIVELY_VALUES = ["off", "on"] as const;
export type HandLivelyValue = (typeof HAND_LIVELY_VALUES)[number];
export const HAND_LIVELY_LABELS: Record<HandLivelyValue, string> = { off: "Tekis", on: "Jonli" };
/** Yangi forma standarti: haqiqiy qo'lda yozilgandek. */
export const HAND_LIVELY_DEFAULT: HandLivelyValue = "on";

/* ────────────────────────── shriftlar ────────────────────────── */

/**
 * Shrift YUZI (face): DOCX da alohida `w:rFonts`, ko'ruvchida alohida `@font-face`.
 * `scale` — asosiy shriftga nisbatan o'lcham (x-balandlik tenglashtiriladi: Marck
 * Script xuddi shu pt da Playwrite'dan kichikroq ko'rinadi).
 */
export type HandFace = { family: string; file: string; url: string; scale: number };

/** Asosiy shrift yopmaydigan belgilarni (kirill) chizadigan yo'ldosh yuz; `ranges` — Unicode [dan, gacha]. */
export type HandCompanion = HandFace & { ranges: readonly (readonly [number, number])[] };

export type HandFontSpec = {
  id: HandFontId;
  label: string;
  /** Asosiy yuz: CSS/DOCX oila nomi (shrift faylining ichidagi nom). */
  family: string;
  /** `public/fonts/handwriting/` ichidagi fayl. */
  file: string;
  /** Sayt ko'ruvchisi uchun URL. */
  url: string;
  /**
   * Ko'ruvchi CSS oilasi. Yo'ldoshsiz shriftda `family` ga teng; yo'ldoshli
   * shriftda `handFontFaceCss` bitta oilaga `unicode-range` bilan birlashtirgan nom.
   */
  css: string;
  /** Yozuv o'lchami (pt) — daftar chizig'iga nisbatan (asosiy yuz). */
  sizePt: number;
  /** `hhea` (em ulushi) — brauzer asosini hisoblash uchun; test fayl bilan solishtiradi. */
  ascent: number;
  descent: number;
  /** Belgi diapazoni bo'yicha yo'ldosh yuzlar (kirill: Marck Script, Қ Ғ Ҳ: Bad Script). */
  companions: readonly HandCompanion[];
  /**
   * Muqova sarlavhasi (`handCoverLines` dagi `big` qator) uchun kalligrafik yuz
   * (Great Vibes). Yopmagan belgi (Қ Ғ Ҳ…) oddiy yuzlarga tushadi; `scale` — asosiy
   * yuz x-balandligiga nisbatan. `css` — ko'ruvchidagi alohida oila nomi (har
   * shriftda o'z `size-adjust` i bor).
   */
  title?: HandCompanion & { css: string };
  /**
   * Hech bir yuz YOPMAYDIGAN, lekin hujjatda uchrashi mumkin bo'lgan belgilar
   * va ularning o'rinbosari. Test faylning haqiqiy `cmap` ini solishtiradi
   * (ro'yxat eskirsa qizaradi).
   */
  fallback: Record<number, number>;
};

/** U+02BB «ʻ» (o‘/g‘ ning belgisi) va U+02BC «ʼ» (maʼno) — Playwrite/Bad Script/Caveat/Marck da yo'q; U+2018/U+2019 bor. */
const TURNED_COMMA = 0x02bb;
const MODIFIER_APOSTROPHE = 0x02bc;
const LEFT_QUOTE = 0x2018;
const RIGHT_QUOTE = 0x2019;

/** Kirill (rus + o'zbek ў) va № — Marck Script yopadi; Қ Ғ Ҳ (U+0490–04FF) ni yopmaydi. */
const MARCK_RANGES = [[0x0400, 0x045f], [0x2116, 0x2116]] as const;
/** Қ қ Ғ ғ Ҳ ҳ — Marck Script da yo'q, Bad Script (maktab/qalam uslubiga eng yaqin) yopadi. */
const EXT_CYRILLIC_RANGES = [[0x0490, 0x04ff]] as const;

/** Great Vibes qamrovi: lotin (+ kengaytma), kirill (rus + ў), tinish, №. Қ Ғ Ҳ yo'q (test haqiqiy `cmap` bilan solishtiradi). */
const GREAT_VIBES_RANGES = [[0x20, 0x7e], [0xa1, 0xac], [0xae, 0xff], [0x2013, 0x2014], [0x2018, 0x2019], [0x201c, 0x201d], [0x0400, 0x045f], [0x2116, 0x2116]] as const;
const GREAT_VIBES_FACE = { family: "Great Vibes", file: "GreatVibes-Regular.ttf", url: "/fonts/handwriting/GreatVibes-Regular.ttf", ranges: GREAT_VIBES_RANGES } as const;

const BAD_SCRIPT_FACE = { family: "Bad Script", file: "BadScript-Regular.ttf", url: "/fonts/handwriting/BadScript-Regular.ttf" } as const;
const MARCK_FACE = { family: "Marck Script", file: "MarckScript-Regular.ttf", url: "/fonts/handwriting/MarckScript-Regular.ttf" } as const;

export const HAND_FONTS: Record<HandFontId, HandFontSpec> = {
  school: {
    id: "school",
    label: "Maktab husnixati",
    family: "Playwrite US Trad",
    file: "PlaywriteUSTrad.ttf",
    url: "/fonts/handwriting/PlaywriteUSTrad.ttf",
    css: "SlaydX Maktab",
    sizePt: 15,
    ascent: 1.428,
    descent: 0.504,
    companions: [
      { ...MARCK_FACE, scale: 1.38, ranges: MARCK_RANGES },
      { ...BAD_SCRIPT_FACE, scale: 1.03, ranges: EXT_CYRILLIC_RANGES },
    ],
    title: { ...GREAT_VIBES_FACE, css: "SlaydX Title Maktab", scale: 1.45 },
    fallback: { [TURNED_COMMA]: LEFT_QUOTE, [MODIFIER_APOSTROPHE]: RIGHT_QUOTE },
  },
  pen: {
    id: "pen",
    label: "Qalam-pero",
    family: "Marck Script",
    file: "MarckScript-Regular.ttf",
    url: "/fonts/handwriting/MarckScript-Regular.ttf",
    css: "SlaydX Pen",
    sizePt: 20,
    ascent: 0.864,
    descent: 0.385,
    companions: [{ ...BAD_SCRIPT_FACE, scale: 0.74, ranges: EXT_CYRILLIC_RANGES }],
    title: { ...GREAT_VIBES_FACE, css: "SlaydX Title Pen", scale: 1.04 },
    fallback: { [TURNED_COMMA]: LEFT_QUOTE, [MODIFIER_APOSTROPHE]: RIGHT_QUOTE },
  },
  badscript: {
    id: "badscript",
    label: "Bad Script",
    family: "Bad Script",
    file: "BadScript-Regular.ttf",
    url: "/fonts/handwriting/BadScript-Regular.ttf",
    css: "Bad Script",
    sizePt: 16,
    ascent: 1.324,
    descent: 0.648,
    companions: [],
    fallback: { [TURNED_COMMA]: LEFT_QUOTE },
  },
  caveat: {
    id: "caveat",
    label: "Caveat",
    family: "Caveat",
    file: "Caveat-Regular.ttf",
    url: "/fonts/handwriting/Caveat-Regular.ttf",
    css: "Caveat",
    sizePt: 20,
    ascent: 0.96,
    descent: 0.3,
    companions: [],
    fallback: { [TURNED_COMMA]: LEFT_QUOTE },
  },
};

export const HAND_FONT_LIST: HandFontSpec[] = HAND_FONT_IDS.map((id) => HAND_FONTS[id]);

/**
 * Shrift yopmaydigan belgini o'rinbosariga almashtiradi (`ʻ` → `‘`).
 * DOCX ham, ko'ruvchi ham matnni SHU funksiya orqali o'tkazadi.
 */
export function handText(font: HandFontId, text: string): string {
  const map = HAND_FONTS[font].fallback;
  let out = "";
  for (const ch of text) {
    const to = map[ch.codePointAt(0)!];
    out += to === undefined ? ch : String.fromCodePoint(to);
  }
  return out;
}

/** Belgi (`cp`) qaysi yuzda chiziladi: yo'ldosh diapazoni, bo'lmasa asosiy yuz. */
export function handFaceOf(font: HandFontId, cp: number): HandFace {
  const spec = HAND_FONTS[font];
  const c = spec.companions.find((x) => x.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
  return c ?? { family: spec.family, file: spec.file, url: spec.url, scale: 1 };
}

/** Shriftning barcha yuzlari (asosiy birinchi) — DOCX ga joylash va `fc-cache` uchun. */
export function handFaces(font: HandFontId): HandFace[] {
  const spec = HAND_FONTS[font];
  return [{ family: spec.family, file: spec.file, url: spec.url, scale: 1 }, ...spec.companions];
}

export type HandSegment = { text: string; face: HandFace };

/**
 * Matnni (avval `handText`) yuzlar bo'yicha bo'laklarga ajratadi. Bo'shliq
 * oldingi harfning yuzini oladi (so'z orasida bo'lak uzilmasin), qolgan
 * belgi (raqam, tinish) o'z yuzida chiziladi. DOCX har bo'lakni alohida
 * `w:r` qiladi; ko'ruvchi buni `unicode-range` bilan o'zi bajaradi.
 */
export function handSegments(font: HandFontId, text: string): HandSegment[] {
  const out: HandSegment[] = [];
  for (const ch of handText(font, text)) {
    const cp = ch.codePointAt(0)!;
    const face = handFaceOf(font, cp);
    const last = out[out.length - 1];
    if (last && (last.face.family === face.family || /\s/.test(ch))) last.text += ch;
    else out.push({ text: ch, face });
  }
  return out;
}

/**
 * Muqova sarlavhasi bo'laklari: Great Vibes yopgan belgi — sarlavha yuzida
 * (`title: true`), qolgani (Қ Ғ Ҳ, ‘) — oddiy yuzlarda. Sarlavhasiz shriftda
 * `handSegments` bilan bir xil.
 */
export type HandTitleSegment = HandSegment & { title: boolean };
export function handTitleSegments(font: HandFontId, text: string): HandTitleSegment[] {
  const t = HAND_FONTS[font].title;
  if (!t) return handSegments(font, text).map((x) => ({ ...x, title: false }));
  const out: HandTitleSegment[] = [];
  for (const ch of handText(font, text)) {
    const cp = ch.codePointAt(0)!;
    const isTitle = t.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
    const face: HandFace = isTitle ? { family: t.family, file: t.file, url: t.url, scale: t.scale } : handFaceOf(font, cp);
    const last = out[out.length - 1];
    if (last && (last.face.family === face.family || /\s/.test(ch))) last.text += ch;
    else out.push({ text: ch, face, title: isTitle });
  }
  return out;
}

/* ────────────────────────── daftar varag'i ────────────────────────── */

/** Twip → mm / px (96 dpi) / pt. */
export const twToMm = (tw: number) => (tw / 1440) * 25.4;
export const twToPx = (tw: number) => tw / 15;
export const mmToTw = (mm: number) => Math.round((mm / 25.4) * 1440);

/** LibreOffice/Word: aniq qator balandligida matn asosi qator balandligining 80 % ida. */
export const BASELINE_FRACTION = 0.8;

export type HandPaperSpec = {
  id: HandPaper;
  /** Matn qatorlari oralig'i (twip) — bitta qator = bitta daftar oralig'i. */
  pitchTw: number;
  /** Chizma oralig'i (mm): chiziqlida = qator; katakli daftarda 5 mm katak, qator ikki katak. */
  cellMm: number;
  ruleHex: string;
  /** Chiziq qalinligi (mm). */
  ruleMm: number;
};

export const HAND_PAPER_SPECS: Record<HandPaper, HandPaperSpec> = {
  lined: { id: "lined", pitchTw: 510, cellMm: twToMm(510), ruleHex: "8FB3D9", ruleMm: 0.3 },
  grid: { id: "grid", pitchTw: 567, cellMm: 5, ruleHex: "A9C4E4", ruleMm: 0.25 },
};

/** Sahifa (A4) va chap chegara chizig'i. */
export const HAND_PAGE = {
  widthTw: 11906,
  heightTw: 16838,
  topTw: mmToTw(18),
  /** Pastki chegara kamida shuncha (sahifa raqami sig'sin), qolgani butun qatorlardan chiqadi. */
  bottomMinTw: 1000,
  /** Qizil chap chegara chizig'i (mm, sahifa chetidan). */
  redLineMm: 20,
  redHex: "E0736F",
  redMm: 0.4,
  /** Matn chap chekkasi — qizil chiziqdan 5 mm o'ngda (katak chizig'iga tushadi). */
  leftTw: mmToTw(25),
  rightTw: mmToTw(12),
  /** Abzats chekinishi. */
  firstLineTw: mmToTw(12),
} as const;

export type HandGeometry = {
  paper: HandPaper;
  font: HandFontSpec;
  pitchTw: number;
  pitchPx: number;
  /** Bir sahifadagi qatorlar soni. */
  lines: number;
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  sizePt: number;
  /** Matn kengligi (twip). */
  contentTw: number;
  /** DOCX (LibreOffice/Word) da birinchi chiziq: sahifa tepasidan mm. */
  docxRuleY0Mm: number;
  /** Ko'ruvchida (brauzer) birinchi chiziq: sahifa tepasidan px. */
  viewerRuleY0Px: number;
};

/** Brauzerda qator ichida matn asosi (px, qator qutisi tepasidan): yarim-leading + ascent. */
export function handBaselinePx(font: HandFontSpec, sizePt: number, pitchPx: number): number {
  const sizePx = (sizePt * 96) / 72;
  return (pitchPx - (font.ascent + font.descent) * sizePx) / 2 + font.ascent * sizePx;
}

export function handGeometry(paper: HandPaper, fontId: HandFontId): HandGeometry {
  const spec = HAND_PAPER_SPECS[paper];
  const font = HAND_FONTS[fontId];
  const lines = Math.floor((HAND_PAGE.heightTw - HAND_PAGE.topTw - HAND_PAGE.bottomMinTw) / spec.pitchTw);
  // +10 twip zaxira: yaxlitlash oxirgi qatorni keyingi sahifaga tashlamasin.
  const bottom = HAND_PAGE.heightTw - HAND_PAGE.topTw - lines * spec.pitchTw - 10;
  const pitchPx = twToPx(spec.pitchTw);
  return {
    paper,
    font,
    pitchTw: spec.pitchTw,
    pitchPx,
    lines,
    margins: { top: HAND_PAGE.topTw, bottom, left: HAND_PAGE.leftTw, right: HAND_PAGE.rightTw, header: 0, footer: mmToTw(7) },
    sizePt: font.sizePt,
    contentTw: HAND_PAGE.widthTw - HAND_PAGE.leftTw - HAND_PAGE.rightTw,
    docxRuleY0Mm: twToMm(HAND_PAGE.topTw + BASELINE_FRACTION * spec.pitchTw),
    viewerRuleY0Px: twToPx(HAND_PAGE.topTw) + handBaselinePx(font, font.sizePt, pitchPx),
  };
}

/* ────────────────────────── reja uslubi ────────────────────────── */

/** `planWork` ko'tarib yuradigan uslub: DOCX ham, ko'ruvchi ham FAQAT shundan o'qiydi. */
export type HandStyle = WorkHand & {
  kind: "handwritten";
  inkHex: string;
  family: string;
  fontFile: string;
  fontUrl: string;
};

export function handStyleOf(hand: WorkHand): HandStyle {
  const font = HAND_FONTS[hand.font];
  return { kind: "handwritten", ...hand, inkHex: HAND_INK_HEX[hand.ink], family: font.family, fontFile: font.file, fontUrl: font.url };
}

export const isHandInk = (v: unknown): v is HandInk => (HAND_INKS as readonly string[]).includes(String(v));
export const isHandPaper = (v: unknown): v is HandPaper => (HAND_PAPERS as readonly string[]).includes(String(v));
export const isHandFont = (v: unknown): v is HandFontId => (HAND_FONT_IDS as readonly string[]).includes(String(v));

/** Tashqi (xom) qiymatdan toza tanlov; noma'lum qiymat standartga tushadi. */
export function normalizeHand(raw: { ink?: unknown; paper?: unknown; font?: unknown; lively?: unknown; headings?: unknown; cover?: unknown; underline?: unknown }): WorkHand {
  const font = isHandFont(raw.font) ? raw.font : HAND_DEFAULTS.font;
  return {
    ink: isHandInk(raw.ink) ? raw.ink : HAND_DEFAULTS.ink,
    paper: isHandPaper(raw.paper) ? raw.paper : HAND_DEFAULTS.paper,
    font,
    ...(raw.lively === true || raw.lively === "on" ? { lively: true as const } : {}),
    ...(raw.headings === "plain" ? { headings: "plain" as const } : {}),
    ...(raw.cover === "calligraphy" && HAND_FONTS[font].title ? { cover: "calligraphy" as const } : {}),
    ...(raw.underline === false || raw.underline === "off" ? { underline: false as const } : {}),
  };
}

/* ────────────────────────── jonli yozuv ────────────────────────── */

/**
 * JONLI YOZUV: har so'z o'z balandligi (asosdan ±1 pt gacha) va siyoh to'qligi
 * bilan chiziladi — qo'lda yozilganda so'zlar chiziqda bir xil turmaydi.
 * FAQAT so'z kengligiga TEGMAYDIGAN o'zgarish (vertikal siljish, rang): shunda
 * DOCX va ko'ruvchida qator uzilishi bir xil qoladi. Qiyalik (rotate) DOCX da yo'q,
 * shuning uchun ishlatilmaydi.
 *
 * Tasodif DETERMINISTIK — `index` (paragrafdagi so'z tartibi) va so'zning o'zidan;
 * DOCX va ko'ruvchi bir xil paragrafga bir xil siljish beradi, qayta chizsa ham o'zgarmaydi.
 */
export type HandWordJitter = {
  /** Asosdan siljish, yarim-punktda (DOCX `w:position`); musbat — yuqoriga. */
  dyHalfPt: number;
  /** Siyohning oq tomonga aralashishi, foizda (0–16): 0 — to'liq to'q. */
  tonePct: number;
};

const JITTER_DY = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 2] as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function handWordJitter(index: number, word: string): HandWordJitter {
  const h = fnv1a(`${index}:${word.trim()}`);
  return { dyHalfPt: JITTER_DY[h % JITTER_DY.length]!, tonePct: (h >>> 8) % 17 };
}

/**
 * Ko'ruvchi/forma namunasi uchun inline uslub (`CiteSpan.j`): `position: relative` joylashuvga
 * TEGMAYDI; siyoh `color-mix` bilan oqaradi (DOCX `handToneHex` bilan bir xil natija).
 */
export function handJitterCss(j: { dy: number; t: number }): { position: "relative"; top: string; color?: string } {
  return { position: "relative", top: `${-j.dy * 0.5}pt`, ...(j.t ? { color: `color-mix(in srgb, var(--hand-ink), #fff ${j.t}%)` } : {}) };
}

/** Matnni so'z + undan keyingi bo'shliq bo'laklariga ajratadi (birlashtirilsa matn aynan tiklanadi). */
export function handWordPieces(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/** Siyoh HEX ini oq tomonga `pct` foiz aralashtiradi (DOCX ranggi; ko'ruvchida `color-mix` bir xil natija beradi). */
export function handToneHex(inkHex: string, pct: number): string {
  const n = Number.parseInt(inkHex, 16);
  const mix = (c: number) => Math.round(c + ((255 - c) * pct) / 100);
  const hex = (c: number) => mix(c).toString(16).padStart(2, "0").toUpperCase();
  return `${hex((n >> 16) & 255)}${hex((n >> 8) & 255)}${hex(n & 255)}`;
}

/* ────────────────────────── ko'ruvchi CSS ────────────────────────── */

/**
 * Ko'ruvchi varag'i uchun CSS o'zgaruvchilar. Chiziq fonini `app/globals.css`
 * `.word-hand` qoidasi shu o'zgaruvchilardan quradi.
 */
export function handCssVars(style: HandStyle): Record<string, string> {
  const g = handGeometry(style.paper, style.font);
  const spec = HAND_PAPER_SPECS[style.paper];
  const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;
  const mmPx = (mm: number) => (mm / 25.4) * 96;
  const ruleW = Math.max(1, mmPx(spec.ruleMm));
  const redX = mmPx(HAND_PAGE.redLineMm);
  /* Chiziq qadami: chiziqlida = qator oralig'i; katakli varaqda ikki katak = bir qator. */
  const cell = style.paper === "grid" ? g.pitchPx / 2 : g.pitchPx;
  const mod = (v: number, m: number) => v - Math.floor(v / m) * m;
  return {
    "--hand-ink": `#${style.inkHex}`,
    "--hand-family": `"${g.font.css}"`,
    "--hand-size": `${g.sizePt}pt`,
    "--hand-lively": style.lively ? "1" : "0",
    ...(g.font.title && style.cover === "calligraphy" ? { "--hand-title-family": `"${g.font.title.css}", "${g.font.css}"` } : {}),
    /** Sarlavha harf shakli matnning o'zida (`planWork`); bu belgi ko'ruvchi o'lchov daraxtini ham ajratadi. */
    "--hand-headings": style.headings === "plain" ? "plain" : "caps",
    "--hand-head-decoration": style.underline === false ? "none" : "underline",
    "--hand-pitch": px(g.pitchPx),
    "--hand-lines": String(g.lines),
    "--hand-rule": `#${spec.ruleHex}`,
    "--hand-rule-w": px(ruleW),
    "--hand-red": `#${HAND_PAGE.redHex}`,
    "--hand-red-x": px(redX),
    "--hand-red-w": px(Math.max(1, mmPx(HAND_PAGE.redMm))),
    "--hand-y0": px(g.viewerRuleY0Px),
    "--hand-cell": px(cell),
    /** Birinchi gorizontal chiziq `--hand-phase` da (0…cell), birinchi vertikal katak chizig'i `--hand-vphase` da. */
    "--hand-phase": px(mod(g.viewerRuleY0Px, cell)),
    "--hand-vphase": px(mod(redX, cell)),
    "--hand-first-line": px(twToPx(HAND_PAGE.firstLineTw)),
    "--hand-pad": `${px(twToPx(g.margins.top))} ${px(twToPx(g.margins.right))} ${px(twToPx(g.margins.bottom))} ${px(twToPx(g.margins.left))}`,
  };
}

/** `unicode-range` qiymati: `U+0400-045F,U+2116`. */
const unicodeRange = (ranges: HandCompanion["ranges"]) =>
  ranges.map(([lo, hi]) => (lo === hi ? `U+${lo.toString(16).toUpperCase().padStart(4, "0")}` : `U+${lo.toString(16).toUpperCase().padStart(4, "0")}-${hi.toString(16).toUpperCase().padStart(4, "0")}`)).join(",");

/**
 * `@font-face` (ko'ruvchi va forma namunasi) — `app/globals.css` bilan bir xil
 * nom/URL/`unicode-range`/`size-adjust` (test solishtiradi). Yo'ldoshli shrift
 * BITTA oilaga birlashadi: asosiy yuz hammasini, yo'ldoshlar o'z diapazonini yopadi
 * (keyin e'lon qilingan yuz ustun).
 */
export function handFontFaceCss(): string {
  const face = (family: string, url: string, extra = "") => `@font-face{font-family:"${family}";src:url("${url}") format("truetype");${extra}font-display:swap}`;
  const out: string[] = [];
  for (const f of HAND_FONT_LIST) {
    out.push(face(f.css, f.url));
    for (const c of f.companions) out.push(face(f.css, c.url, `size-adjust:${Math.round(c.scale * 100)}%;unicode-range:${unicodeRange(c.ranges)};`));
    if (f.title) out.push(face(f.title.css, f.title.url, `size-adjust:${Math.round(f.title.scale * 100)}%;unicode-range:${unicodeRange(f.title.ranges)};`));
  }
  return out.join("\n");
}

/* ────────────────────────── titul (daftar muqovasi) ────────────────────────── */

export type HandCoverLine =
  | { role: "gap" }
  | { role: "center"; text: string; big?: boolean }
  | { role: "field"; label: string; text: string };

/** Titul modelining (`title-model.ts`, `kind: "gost"`) daftar muqovasiga kerakli qismi. */
export type HandCoverSource = {
  university: string;
  workLabel: string;
  subjectLine?: string;
  topic: string;
  topicLabel?: string;
  author?: string;
  authorLabel: string;
  courseLine?: string;
  teacher?: string;
  teacherLabel: string;
  cityYear: string;
};

/**
 * Daftar muqovasi: «Mustaqil ish / fan / mavzu / bajardi / tekshirdi».
 * Rasmiy titulning vazirlik, fakultet, kafedra va o'quv yili qatorlari
 * ATAYIN yo'q — qo'lyozma muqova sodda. DOCX va ko'ruvchi BIR ro'yxatni chizadi.
 */
export function handCoverLines(T: HandCoverSource): HandCoverLine[] {
  const out: HandCoverLine[] = [{ role: "gap" }, { role: "gap" }];
  if (T.university) out.push({ role: "center", text: T.university }, { role: "gap" });
  out.push({ role: "center", text: T.workLabel, big: true });
  if (T.subjectLine) out.push({ role: "center", text: T.subjectLine });
  out.push({ role: "gap" });
  out.push({ role: "center", text: T.topicLabel ? `${T.topicLabel} «${T.topic}»` : `«${T.topic}»` });
  out.push({ role: "gap" }, { role: "gap" });
  if (T.author) out.push({ role: "field", label: T.authorLabel, text: T.author });
  if (T.courseLine) out.push({ role: "field", label: "", text: T.courseLine });
  if (T.teacher) out.push({ role: "field", label: T.teacherLabel, text: T.teacher });
  out.push({ role: "gap" }, { role: "gap" });
  out.push({ role: "center", text: T.cityYear });
  return out;
}

/* ────────────────────────── formula (qo'lyozmada) ────────────────────────── */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const OPS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", infty: "∞", sum: "Σ", prod: "Π",
  int: "∫", partial: "∂", nabla: "∇", rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", cdots: "…", ldots: "…", degree: "°",
};
const ACCENT: Record<string, string> = { bar: "\u0304", overline: "\u0304", hat: "\u0302", vec: "\u20D7", tilde: "\u0303" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

function script(body: string, table: Record<string, string>, mark: string): string {
  const chars = [...body];
  return chars.every((c) => table[c]) ? chars.map((c) => table[c]).join("") : `${mark}(${body})`;
}

/**
 * LaTeX → oddiy matn («E = mc²»). Qo'lyozmada formula qo'lda yoziladi:
 * brauzer/LibreOffice formula tahrirchisi (matematik shrift, aniq bo'lmagan
 * balandlik) chiziqlarga mos kelmaydi. Murakkab tuzilma (kasr, ildiz,
 * daraja) qavs bilan ochiq yoziladi.
 */
export function handFormulaText(latex: string): string {
  let s = latex
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, " ")
    .replace(/\\([%$&#_{}])/g, "$1")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\(bar|overline|hat|vec|tilde)\{([^{}]*)\}/g, (_, cmd: string, body: string) => `${body}${ACCENT[cmd]}`);
  // Ichki-ichiga tushgan kasr/ildizlarni ketma-ket yechamiz.
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, "$1√($2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\^\{([^{}]*)\}/g, (_, b: string) => script(b, SUP, "^"))
    .replace(/\^(\w)/g, (_, b: string) => script(b, SUP, "^"))
    .replace(/_\{([^{}]*)\}/g, (_, b: string) => script(b, SUB, "_"))
    .replace(/_(\w)/g, (_, b: string) => script(b, SUB, "_"))
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? OPS[name] ?? name)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}
