import { safeSlice } from "./safe-text";
/**
 * Slayd matn chegaralari — YAGONA jadval.
 *
 * Bu fayl ATAYLAB bog'liqliksiz: uni ham dvigatel (`normalizeSlide`,
 * server tomonida), ham ko'ruvchidagi tahrir mantig'i (`slide-edit.ts`,
 * klient bundle'da) import qiladi. Shuning uchun bu yerda `llm.ts`,
 * `server-only` yoki React ga olib boradigan bironta import bo'lmasin.
 *
 * Raqamlar MAKETDAN o'lchangan (`slide-layout.ts` qutilari va
 * `fitSize`/`fitLines` pollari) — promptdagi so'z sonidan emas. O'lchov
 * izohlari `slide-write.ts` dagi asl joylarida qoldirilgan; bu yerda
 * faqat qiymat turadi, chunki endi ikki joyda ikki nusxa emas, bitta
 * manba bo'lishi kerak: tahrirda qirqilgan matn PPTX da ham aynan shu
 * chegara bilan chizilishi shart («ko'rdim = oldim»).
 *
 * ── AUDIT-25 O'LCHOVI (2026-09-24) ─────────────────────────────────────
 *
 * Har qirqiladigan KO'RINADIGAN maydon `planSlide` orqali o'lchandi
 * (`fitChars`, `slide-quality.ts`; P2 `c7a1c82` maketi — process/stats/
 * table ham auditoriya POLIDA, A2-04): 17 vizual, har vizualda rasmsiz
 * VA rasm tasmasi bilan holatning kichigi, real o'zbekcha so'zlar (so'z
 * bo'yicha qatorlash). Katak = pol shriftida sig'adigan belgi,
 * «eng tor / 17 vizual medianasi». Pol (minPt): 15 talaba/pedagog,
 * 16 rahbariyat/umumiy/kattalar, 18 10–11 sinf/o'smir/keng, 20 8–9 sinf,
 * 22 5–7 sinf/bolalar markazi, 24 1–4 sinf.
 *
 *   maydon        qopqoq   15pt      16pt      18pt      20pt      22pt      24pt     qaror
 *   title          80→72   72/139    72/139    72/139    72/139    72/139    72/139   72 (rasmli section, classic)
 *   kicker            40   42/72     42/72     42/72     42/72     42/72     42/72    qoldi
 *   bullets ×max  bulletChars 135/234  97/222  85/135   60/173    60/152    24/111   auditoriya jadvali; `cards` — P2
 *   colTitle       40→24   16/24     16/24     16/24     16/24     16/24     16/24    24 (mediana)
 *   colItem ×3    120→110  75/165    53/165    53/165    42/165    24/165    16/165   ┐ 110 (×4 mediana);
 *   colItem ×4    120→110  36/111    36/111    36/111    36/111    24/111    16/111   ┘ aniq — clipLimit
 *   stepText ×3      160   53/139    36/121    36/85     24/53     24/36     24/36    ┐ 160 qoldi (slide-chart
 *   stepText ×4      160   24/111    24/85     24/60     16/42     16/36     16/36    │ testi ≥135); aniq —
 *   stepText ×5      160   24/72     16/42     16/36     4/16      4/4       4/4      ┘ clipLimit + maxSteps
 *   stepTitle ×4/5    40   24/53     24/53     16/24     4/24      4/16      4/16     qoldi; aniq — clipLimit
 *   statLabel ×2     110   129/234   111/222   85/165    75/129    72/97     42/85    ┐ 110 qoldi; aniq —
 *   statLabel ×4     110   42/85     42/60     24/53     24/53     24/24     16/16    ┘ clipLimit + maxStats
 *   tableCell ×3      60   53/53     53/53     24/24     24/24     16/16     16/16    ┐ 60 qoldi (tahrir);
 *   tableCell ×5      60   24/24     24/24     4/4       4/4       4/4       4/4      ┘ clipLimit + maxTableCols
 *   tableHeader 3/5 40/26  36 / 16   36 / 16   16 / 4    16 / 4    4 / 4     4 / 4    qoldi; aniq — clipLimit
 *   subtitleSection 300→250 258/383 (hamma pol — shrift qat'iy)                      250
 *   subtitleClosing 160→135 139/339 (hamma pol)                                       135 (A4: defense-14 kesilgan)
 *   quote        220→280   383/383 (hamma pol)                                       280 (prompt 30 so'zgacha)
 *   quoteBy       60→50    53/85   (hamma pol)                                       50 + prompt «faqat muallif»
 *   quizQ        120→200   290/383 (hamma pol)                                       200
 *   quizOption    60→130   129/195   85/185    75/121    53/111    53/75     24/60    130 (15 pt eng tor); aniq — clipLimit
 *   refTitle / refSource 90 / 200 — 241 / 673, `planReferences` o'zi qisqartiradi     qoldi
 *
 * QAROR QOIDASI. (1) `SLIDE_LIMITS` — STATIK qopqoq (tahrir ham o'qiydi):
 * eng past pol (15 pt) da eng tor holat tipikdan uzoq bo'lmasa — shu
 * sig'im, aks holda TIPIK vizual (mediana). (2) Model matni esa
 * `clipLimit(field, rules, visual, count)` bilan qirqiladi —
 * auditoriya × vizual × element soni, pol shriftidagi sig'im, lekin
 * statik qopqoqdan oshmaydi va `CLIP_FLOOR_CHARS` (24) dan tushmaydi
 * (P1 `normalizeSlide` ga ulaydi). «Qirqmasdan fitSize» varianti YO'Q:
 * `fitSize` pol ostiga tushmaydi, sig'magan matn qutidan chiqadi. Maket
 * avval polgacha kichraytiradi, keyin ortig'i SO'Z CHEGARASIDA (`clipTo`)
 * qirqiladi. (3) Qirqish kamdan-kam bo'lsin: prompt aynan shu sig'imdan
 * so'z oralig'i va ELEMENT SONI oladi (`layoutWordTargets`: 5–7/1–4
 * sinfga kam bosqich/karta/ustun).
 *
 * SIG'MAYDIGAN KOMBINATSIYALAR (prompt maqsadiga aylandi, qolgani P2):
 * 20–24 pt da process kartasi 3 bosqichda ham 6 so'z ko'tarmaydi
 * (mediana 36–53 belgi), 4–5 bosqich 1–2 so'z; 18–24 pt da 5 ustunli
 * jadval katagiga bitta so'z sig'maydi, 3 ustunda ~2 so'z; 22–24 pt da
 * 4 karta stats yorlig'i ~2 so'z; `cards` 1–4 sinf bandi/test varianti
 * 24 belgi; `rail`/`dashboard`/`circle`/`split` ustun va bosqich qutilari
 * — mediana yaxshi, eng tor holatlar P2 da.
 */
export const SLIDE_LIMITS = {
  /**
   * Har maketda sarlavha. Tahrirda bo'sh qoldirib bo'lmaydi. 80 da
   * rasmli `section`/`title` (classic) pol shriftida chiqib ketardi (72/75).
   */
  title: 72,
  /** Sarlavha ustidagi mayda yorliq. */
  kicker: 40,
  /** Standart maketlar uchun izoh matni. */
  subtitle: 140,
  /**
   * `section` subtitle. AUDIT-25 o'lchovi (`fitChars("subtitleSection")`,
   * 17 vizual, real o'zbekcha so'zlar): eng tor — `story`, ~258 belgi.
   * 300 da `story` bo'lim slaydi qutidan chiqardi; 250 hamma vizualga
   * sig'adi va promptdagi «≤ 27 so'z» (250 / 9) ni kesmaydi.
   */
  subtitleSection: 250,
  /**
   * `closing` subtitle. Eski izoh «8.95 × 0.85", 16 pt → ~160» edi, lekin
   * qayta o'lchovda `classic` pol shriftida 139 belgi ko'taradi; jonli
   * `defense-14` da yakun matni so'z o'rtasidan kesilgan (A4). 135.
   */
  subtitleClosing: 135,
  /**
   * `twoCol`/`compare` ustun sarlavhasi. Median quti ~36 belgi, rasmli
   * `circle`/`split` da 16, p25 24 — qopqoq 24 («Afzalliklar»,
   * «Zamonaviy yondashuv» sig'adi).
   */
  colTitle: 24,
  /**
   * Ustundagi bitta band. Eski «4 × 120 → 16 pt» faqat `classic`
   * rasmsiz edi; rasm tasmasi bilan 4 bandli ustun tipik holda (p25)
   * ~111 belgi ko'taradi. Jonli `lecture-12` da 6 bandning 5 tasi
   * so'z o'rtasidan kesilgan: prompt «10–15 so'z» (~135) so'rardi.
   * Endi 110 + prompt oralig'i maketdan (`layoutWordTargets.colItem`).
   */
  colItem: 110,
  /** Bitta ustunda eng ko'p band. */
  colItems: 4,
  /**
   * Iqtibos matni. AUDIT-25 o'lchovi: eng tor quti (`magazine`) ~383
   * belgi ko'taradi. 220 promptdagi «12–30 so'z» ning yuqori qismini
   * «…» bilan kesardi; 280 = 31 so'z, har vizualga sig'adi.
   */
  quote: 280,
  /**
   * Iqtibos muallifi — bitta qator, shrift o'zgarmaydi: `notebook` 53
   * belgi. Jonli dekada «Adam Smit — Shotlandiyalik faylasuf va
   * iqtisodchi olim, zam…» — model tavsif yozgan; prompt endi «faqat
   * muallif» deydi, qopqoq 50.
   */
  quoteBy: 50,
  /** `stats` katta raqami. */
  statValue: 24,
  /**
   * Yorliq — STATIK qopqoq (talaba poli 15 pt da 2–3 karta medianasi
   * ≥ 111). P2 A2-04 dan keyin yorliq auditoriya polida: 1–4 sinf 4
   * karta ~16 belgi — model matni `clipLimit("statLabel", …, count)`
   * bilan qirqiladi, prompt esa `maxStats` kartadan ko'p so'ramaydi.
   */
  statLabel: 110,
  /** `stats` kartalari soni. */
  statsMax: 4,
  /** Bosqich raqami («1», «I», «01»). */
  stepN: 8,
  /** Bosqich sarlavhasi. */
  stepTitle: 40,
  /**
   * Bosqich matni — STATIK qopqoq 160 QOLDI (bir qatorli rasmsiz karta
   * 11 pt da ~255; `tests/slide-chart.test.mts` ≥ 135 ni qulflaydi).
   * Lekin rasm tasmasi bilan 4–5 bosqich IKKI qatorga tushadi (A1-01):
   * talaba polida 4 bosqich mediana ~111, 5 bosqich ~72, maktab polida
   * 4–36 belgi (jadval yuqorida). Model matni `clipLimit("stepText", …,
   * steps.length)` bilan qirqiladi, prompt `maxSteps` va so'z oralig'ini
   * shu sig'imdan oladi.
   */
  stepText: 160,
  /** `process` bosqichlari soni. */
  stepsMax: 5,
  /** Jadval sarlavhasi — ustun soni ≤3 bo'lganda (keng ustun). */
  tableHeaderWide: 40,
  /** Jadval sarlavhasi — 4+ ustun (tor ustun). */
  tableHeader: 26,
  /** Model javobidagi xom sarlavha (keyin ustun soniga qarab qisqaradi). */
  tableHeaderRaw: 60,
  /**
   * Jadval katagi — STATIK qopqoq (tahrir). Model matni
   * `clipLimit("tableCell", …, cols)` bilan: 3 ustun talaba polida ~53,
   * 18–24 pt da 16–24 — prompt `maxTableCols` dan ko'p ustun so'ramaydi.
   */
  tableCell: 60,
  /** Jadval ustunlari soni. */
  tableCols: 5,
  /** Jadval qatorlari soni. */
  tableRows: 6,
  /**
   * Test savoli. AUDIT-25 o'lchovi: eng tor savol qutisi (`timeline`,
   * 12.1 × 1.05", pol 16 pt) ~290 belgi ko'taradi; 120 esa 13 so'zdan
   * uzun savolni «…» bilan kesardi. 200 = 22 so'z, har vizualga sig'adi.
   */
  quizQ: 200,
  /**
   * Test varianti — QIRQISH qopqog'i, maket o'lchovidan.
   *
   * Jonli dekada variantlar «…me'yor…» bilan kesilgan chiqdi: 60 belgi
   * (~6 so'z) to'liq javobga yetmasdi. Variant qutisi shriftni AUDITORIYA
   * oralig'ida (`bodyPt` → `minPt`) siqadi, ya'ni sig'im auditoriyaga
   * bog'liq. O'lchov (`fitChars("quizOption")`, `planQuiz` ning 6 oilasi
   * + 10 dizayn vizuali, real so'zlar) — ENG TOR quti `cards` (5.34 ×
   * 0.81"; `circle`/`editorial` ham shu):
   *
   *   pol 15 pt (talaba, pedagog)   → 129 belgi
   *   pol 16 pt (rahbariyat, umumiy) →  85
   *   pol 18 pt (10–11 sinf)        →  75
   *   pol 20–22 pt (5–9 sinf)       →  53
   *   pol 24 pt (1–4 sinf)          →  24
   *
   * `fitSize` pol ostiga tushmaydi, shuning uchun «kesmasdan shriftni
   * kichraytirish» varianti o'qiladigan matn bermaydi — sig'magan matn
   * qutidan chiqadi. Tanlov: qopqoq = eng past poldagi eng tor quti
   * sig'imi (130), aniq auditoriya hajmini esa prompt beradi («≤ N so'z»,
   * `layoutWordTargets`), undan oshgan variantni `thinSlides`
   * «clipped-option» deb topib, ta'mirga yuboradi.
   */
  quizOption: 130,
  /** Variantlar soni — AYNAN shuncha (A/B/C/D kartalari). */
  quizOptions: 4,
  /** Deka bo'ylab savollar soni (formadagi `quizCount` chegarasi). */
  quizMax: 10,
  /** Manba nomi. */
  refTitle: 90,
  /** Manba havolasi — TO'LIQ saqlanadi, `planReferences` o'zi qisqartiradi. */
  refSource: 200,
  /** `references` bandlari soni. */
  refsMax: 6,
  /** `answers` slaydidagi bitta qator («1 — B»). */
  answersItem: 40,
  /** Rasm uchun ko'rsatma (rasm prompti manbasi). */
  imageHint: 180,
  /** Rasmning `alt` matni. */
  imageAlt: 180,
  /** Modeldan kelgan notiq izohi. */
  notes: 700,
  /**
   * Tahrirdagi notiq izohi — modelnikidan uzunroq: foydalanuvchi o'z
   * nutqini yozadi va uni PPTX «Speaker notes» maydoni ko'taradi.
   */
  notesEdit: 2000,
  /**
   * Dekadagi slaydlar soni — XAVFSIZLIK chegarasi, narx chegarasi EMAS.
   * Narx bo'yicha yuqori chegara `slide-params.ts` da (`SLIDE_MAX`) va
   * uni server qatlami qo'llaydi; bu yerda faqat «cheksiz o'smasin».
   */
  maxSlides: 60,
} as const;

export type SlideLimits = typeof SLIDE_LIMITS;

/** Foydalanuvchi yuklaydigan slayd rasmi (PNG/JPEG) uchun yuqori chegara. */
export const SLIDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Klientdagi bekor qilish (Ctrl+Z) stegi chuqurligi. */
export const UNDO_DEPTH = 100;

/** Oxirgi tahrirdan keyin PPTX qayta yasalgunicha kutish (ms). */
export const REBUILD_DEBOUNCE_MS = 3000;

/**
 * Qirqish SO'Z CHEGARASIDA bo'ladi, agar chegara shu ulushdan keyin
 * uchrasa. Undan oldin bo'lsa (bitta uzun so'z, URL) — qattiq kesiladi:
 * aks holda 110 belgilik joyga 20 belgi qolardi.
 */
export const CLIP_WORD_MIN_SHARE = 0.6;

/**
 * Matnni bitta qatorga keltirib chegaraga qisqartiradi.
 *
 * Ketma-ket bo'shliqlar bittaga tushadi, chetlari kesiladi. Chegaradan
 * uzun matn «…» bilan tugaydi, natija uzunligi ≤ `n`. AUDIT-25: kesish
 * endi SO'Z CHEGARASIDA — ilgari «…imkonini ber…», «…olim, zam…» kabi
 * so'z o'rtasidan kesilardi (jonli `lecture-12`). Oxiridagi vergul/
 * tire tashlanadi («…olim…», «…olim,…» emas). Bitta uzun so'z (URL,
 * `"a".repeat(n)`) — eskicha qattiq kesiladi, uzunlik aynan `n`.
 * Ko'p qatorli matn (notiq izohi) uchun EMAS — u qatorlarni yo'qotadi.
 */
export function clipTo(text: string, n: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const head = safeSlice(t, n - 1);
  // `t[n-1]` bo'shliq bo'lsa `head` o'zi to'liq so'z bilan tugaydi.
  const cut = t[head.length] === " " ? head.length : head.lastIndexOf(" ");
  const body = cut >= Math.ceil((n - 1) * CLIP_WORD_MIN_SHARE) ? head.slice(0, cut) : head;
  return `${body.replace(/[\s,;:–—-]+$/u, "")}…`;
}
