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
 * Har qirqiladigan KO'RINADIGAN maydon `planSlide` orqali o'lchandi:
 * 17 vizual × {rasmsiz, rasm tasmasi bilan}, real o'zbekcha so'zlar
 * (so'z bo'yicha qatorlash), talaba auditoriyasi (pol 15 pt; `*` —
 * 1–4 sinf, pol 24 pt). «base» = shrift kichraymasdan sig'adigan belgi,
 * «min» = pol shriftida sig'adigan belgi. Har katakda: ENG TOR holat
 * (qaysi vizual) / 25-persentil. Qayta o'lchash: `fitChars`
 * (`slide-quality.ts`) — prompt oraliqlari ham shu funksiyadan.
 *
 *   maydon            base (tor / p25)          min (tor / p25)          eski → YANGI
 *   title             36 story / 53             72 classic+rasm / 75     80 → 72
 *   kicker            42 notebook / 60          42 notebook / 60         40 (qoldi)
 *   subtitle (titul)  75 story / 173            173 magazine / 228       140 (qoldi)
 *   subtitleSection   111 story / 205           258 story / 419          300 → 250
 *   subtitleClosing   53 notebook / 139         139 classic / 159        160 → 135
 *   colTitle          16 circle+rasm / 24       16 split+rasm / 24       40 → 24
 *   colItem ×3        53 magazine+rasm / 75     75 dashboard+rasm / 139  ┐
 *   colItem ×4        36 magazine+rasm / 53     36 dashboard+rasm / 111  ┘ 120 → 110
 *   colItem ×4 *      4 circle+rasm / 36        16 circle+rasm / 85      (prompt: vizual × auditoriya)
 *   quote             111 notebook / 139        383 magazine / 495       220 → 280
 *   quoteBy           53 notebook / 85          53 notebook / 85         60 → 50
 *   statLabel ×2      111 bold+rasm / 234       296 dashboard+rasm / 470 ┐
 *   statLabel ×3      60 bold+rasm / 111        159 dashboard+rasm / 205 │ 110 (qoldi)
 *   statLabel ×4      42 bold+rasm / 85         75 dashboard+rasm / 139  ┘
 *   stepTitle ×4/×5   16 / 4 rail+rasm / 53     36 / 24 rail+rasm / 85   40 (qoldi; rail — P2)
 *   stepText ×3       53 rail+rasm / 111        121 rail+rasm / 185      ┐ 160 (qoldi —
 *   stepText ×4       24 classic+rasm / 24      53 rail+rasm / 85        │ slide-chart testi
 *   stepText ×5       16 classic+rasm / 16      42 classic+rasm / 42     ┘ ≥135 ni qulflaydi)
 *   tableHeader 3/5   36 / 16 classic+rasm      75 / 42 classic+rasm     40 / 26 (qoldi)
 *   tableCell 3/5     60 / 24 classic+rasm      111 / 60 classic+rasm    60 (qoldi)
 *   quizQ             121 classic / 121         290 timeline / 351       120 → 200
 *   quizOption        75 cards / 121            129 cards / 185          60 → 130
 *   quizOption *      24 cards / 36             24 cards / 53            (prompt: ≤ 2 so'z — P2)
 *   refTitle / refSource  85 / 673              241 / 673                90 / 200 (qoldi)
 *   bullets ×4 (165)  75 cards+rasm / 135       135 cards+rasm / 216     (auditoriya `bulletChars`)
 *
 * QAROR QOIDASI: qopqoq ≈ pol shriftidagi TIPIK (p25) sig'im, eng tor
 * holatdan uzoq bo'lmasa — eng tor sig'im. «Qirqmasdan fitSize» varianti
 * YO'Q: `fitSize` pol ostiga tushmaydi, sig'magan matn qutidan chiqadi
 * (qirqilganidan yomonroq). Aniq hajmni PROMPT beradi — deka vizuali ×
 * auditoriya × rasm tasmasi bo'yicha (`layoutWordTargets`), undan oshgan
 * test varianti `thinSlides` da «clipped-option» bo'ladi. Qirqish esa
 * so'z CHEGARASIDA (`clipTo`) — so'z o'rtasida «…» yo'q.
 *
 * Qopqoqdan PAST sig'imli holatlar maket muammosi (P2): rasmli ikki
 * qatorli `process` (4–5 bosqich, matn qutisi 0.5"), `cards` test
 * varianti va bandlari bolalar shriftida, `circle`/`split`/`story`/
 * `dashboard` ustunlari, `rail` bosqich sarlavhasi.
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
   * Yorliq: karta 3.58 × 2.3", 11 pt da ~480 belgi; diagrammada ~220.
   * AUDIT-25 qayta o'lchovi (17 vizual): 2 karta ≥ 482, 3 karta ≥ 270,
   * 4 karta ≥ 185 (`dashboard`) — 110 hamma joyda sig'adi, O'ZGARMADI.
   */
  statLabel: 110,
  /** `stats` kartalari soni. */
  statsMax: 4,
  /** Bosqich raqami («1», «I», «01»). */
  stepN: 8,
  /** Bosqich sarlavhasi. */
  stepTitle: 40,
  /**
   * Bosqich matni: 4 kartali qatorda 2.47 × 1.75", 14 pt da ~138 belgi.
   * AUDIT-25 qayta o'lchovi (11 pt pol, 17 vizual): 3 bosqich ≥ 205,
   * 4 bosqich ≥ 135 (`rail`), 5 bosqich ≥ 75 (`classic`). Chegara 160
   * QOLDI — bu qirqish qopqog'i; hajmni prompt boshqaradi: 4 bosqichgacha
   * «≤ 15 so'z», 5 bosqichda «≤ 8 so'z» (`layoutWordTargets`, maketdan).
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
  /** Jadval katagi. */
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
