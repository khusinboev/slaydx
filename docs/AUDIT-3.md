# SlaydX — 3-audit: «Preview = Export» va yetkazib berish halolligi bo'yicha ish rejasi

**Sana:** 2026-09-05
**Muallif:** Claude (Opus 5) — joriy kodning (`slaydx@8ad43e9`, ishchi daraxt toza) mustaqil qatlamli auditi
**Munosabat:** `docs/AUDIT.md` (Sprint 0–4) va `docs/AUDIT-2.md` (Sprint 5–8) ni **davom ettiradi**. U yerda yopilgan band bu yerda qayta sanalmaydi. Sprint raqamlash davom etadi: **Sprint 9 dan boshlanadi**.

**Boshlang'ich holat (tekshirildi):** `npm test` → 145 test, **142 pass / 0 fail / 3 skip**. `git status` toza.

---

## 0. Bu audit qanday tuzildi

Oldingi ikki hisobot **tashqi AI tahlillari sintezi** edi. Bu safar tashqi manba yo'q — 21 889 qator TS/TSX to'g'ridan-to'g'ri, **qatlam bo'yicha** o'qib chiqildi:

1. **Ajratish auditi** — 14 xizmatning har biri uchun 7 qatlam (prompt → yozuvchi → darvoza → renderer → viewer → forma → narx) bo'ylab "bu turga xosmi yoki umumiymi" savoli berildi.
2. Har topilma **fayl:qator** darajasida tasdiqlandi.
3. Har topilma uchun **pul savoli** berildi: *foydalanuvchi to'lagan narsani oldimi?* — bu `AUDIT.md` dan beri davom etayotgan yagona mezon.

### 0.1. Ajratish darajasi — asosiy o'lchov

| Qatlam | Ajratilgan / 14 | Ball |
|---|---:|---:|
| System prompt | **14 / 14** | 9.0 |
| Sifat darvozasi | 13 / 14 (rasmda yo'q) | 9.0 |
| Yozuvchi funksiya | 9 / 14 (5 akademik janr umumiy) | 8.0 |
| Viewer | 11 kind / 8 komponent | 8.5 |
| Forma | 4 maxsus + 10 schema-driven | 8.0 |
| **Renderer** | **3 / 14** (PPTX, PNG alohida; **11 tasi bitta DOCX**) | **6.0** |

**Asosiy topilma:** ajratish darajasi qatlamdan qatlamga **monotonik tushadi** — prompt 14/14, yozuvchi 9/14, renderer 3/14. Ya'ni loyiha "nima yozish kerak" ni janrga qarab biladi, lekin "uni qanday ko'rsatish kerak" ni bilmaydi. Foydalanuvchi **aynan renderer chiqargan faylni** yuklab oladi va o'qituvchisiga topshiradi.

---

## 1. Ustuvorlik jadvali

| # | Muammo | Fayl | Ta'sir | Ustuvorlik | Sprint |
|---|---|---|---|---|---|
| **A-1** | Rezyume DOCX akademik referat qolipida chiqadi — viewer bilan umuman boshqacha | `render-docx.ts` | 3 000 tanga, **preview ≠ export** | **P0** | 9 |
| **A-2** | Rasm: 4 ta so'ralib 1 tasi kelsa ham 6 000 tanga to'liq yechiladi | `image-studio.ts:125` | **Pul halolligi** | **P0** | 10 |
| **A-3** | Rasm: 4 ta rasm yaratilib, faylga faqat 1 tasi tushadi | `image-studio.ts:146` | Va'da ≠ yetkazish | **P0** | 10 |
| **A-4** | Jadval HAR DOIM hujjat oxirida — bo'lim ichida emas | `render-docx.ts:314` | Xarita/dars rejasi tuzilmasi buziladi | **P1** | 9 |
| **A-5** | Glossariy DOCX da atamalar **ikki marta** chiqadi | `write-specials.ts:363` | 40 atama = 80 yozuv | **P1** | 9 |
| **A-6** | Texnologik xarita 6 ustunli jadval portret A4 da, 3 sm chap chekinish bilan | `render-docx.ts:364` | O'qib bo'lmaydi | **P1** | 9 |
| **A-7** | `referat` va `mustaqil-ish` bir xil `outlineShape` — tuzilma darvozasi yo'q | `write-llm.ts:190` | AUDIT-2 §12.1 qoldig'i | **P1** | 11 |
| **A-8** | Annotatsiya faqat promptda talab qilinadi, darvoza yo'q | `write-llm.ts:705` | Maqola annotatsiyasiz chiqishi mumkin | **P1** | 11 |
| **A-9** | Barcha 14 xizmatga bitta 300 s byudjet | `env.ts:159` | 45 betlik ish yiqiladi, 1 varaq isrof | **P1** | 12 |
| **A-10** | Progress ticker `expected` haqiqiy byudjetdan 5–6 barobar kichik | `worker.ts:65` | 2-daqiqada 95% da qotadi | **P2** | 12 |
| **A-11** | `mapPool` uch marta nusxalangan | 3 fayl | Texnik qarz | **P2** | 13 |
| **A-12** | `ResumeViewer` bloklarni `join("\n")` bilan tekislaydi | `ResumeViewer.tsx:14` | Yozuvchi qurgan tuzilma yo'qoladi | **P2** | 13 |
| **A-13** | `output: "pdf"` tipda bor, 14 vositadan hech biri ishlatmaydi | `types.ts:80` | O'lik tip | **P2** | 13 |
| **A-14** | `ImageViewer` yuklash nomi qattiq `.jpg` | `ImageViewer.tsx:98` | PNG `.jpg` nomi bilan tushadi | **P2** | 10 |

---

# SPRINT 9 — «Hujjat profili» (P0, 5–7 kun)

> **Bir jumlada:** DOCX renderer 11 xizmatga bitta qolip beradi; uni **janr profiliga** bo'lish kerak.

## 9.1. Muammoning aniq tavsifi

`renderDocx()` ([render-docx.ts:202](../lib/generation/render-docx.ts#L202)) — 398 qatorli **yagona** funksiya. Butun tipografiya modul darajasida qattiq yozilgan:

```ts
const FONT = "Times New Roman";
const SIZE = 28;   // 14pt
const LINE = 360;  // 1.5 interval
// A4 portret, chap 3 sm, o'ng 1.5 sm — GOST/OTME
```

Turga bog'liq **butun mantiq — atigi 2 ta shart**:

| Qator | Shart | Nima qiladi |
|---|---|---|
| `:208` | `meta.toolId === "article"` | Jurnal titul sahifasi |
| `:346` | `meta.toolId === "essay"` | Rangli sahifa ramkasi |

Qolgan hamma narsa — rezyume, glossariy, keys, dars rejasi, texnologik xarita — **kurs ishi qolipida** chiqadi: markazlashtirilgan BOSH HARFLI H1, `JUSTIFIED` matn, 1.25 sm birinchi qator chekinishi, 3 sm chap chekinish.

### Eng og'ir holat — rezyume

`ResumeViewer` ([ResumeViewer.tsx:26](../components/viewers/ResumeViewer.tsx#L26)) foydalanuvchiga **ikki ustunli, qora yon panelli, zamonaviy CV** ko'rsatadi:

```
┌────────────┬──────────────────────────┐
│ ■ REZYUME  │  QISQACHA                │
│ Ism Familya│  ─────────────           │
│ Lavozim    │  4-6 gap                 │
│            │                          │
│ ALOQA      │  ISH TAJRIBASI           │
│ ...        │  ─────────────           │
│ KO'NIKMA   │  ...                     │
└────────────┴──────────────────────────┘
```

Yuklab olingan DOCX esa:

```
              QISQACHA            ← markazda, BOSH HARF, TNR 14pt bold
    Men 5 yillik tajribaga ega... ← justified, 1.25sm chekinish
              EXP
              EDU
```

Bu **bitta xizmatda ikki xil mahsulot**. Foydalanuvchi 3 000 tanga to'lab ko'rgan narsasini olmaydi. `AUDIT-2 §4` buni «`preview≠DOCX`» deb qayd etgan — hali yopilmagan.

## 9.2. Yechim: `DocProfile` abstraksiyasi

**Nima uchun `if (toolId === ...)` qo'shish YOMON yechim:** hozir 2 ta shart bor, 11 xizmat uchun 11 ta bo'ladi — 398 qatorli funksiya 900 qatorga aylanadi va har yangi xizmat uni yana kattalashtiradi. Loyihada **allaqachon ishlaydigan naqsh bor**: `slide-themes.ts` (15 mavzu) va `slide-templates.ts` (19 shablon) — **ma'lumot sifatida deklaratsiya**, kod sifatida shart emas. Aynan shu naqsh DOCX ga ko'chiriladi.

### Yangi fayl: `lib/generation/docx-profile.ts`

```ts
export type DocProfileId = "gost" | "article" | "essay" | "resume" | "landscape" | "reference";

export type DocProfile = {
  id: DocProfileId;
  page: {
    orientation: "portrait" | "landscape";
    margin: { top: number; bottom: number; left: number; right: number };  // DXA
    border?: "essay";      // rangli ramka — faqat insho
  };
  type: {
    font: string;
    size: number;          // half-points
    line: number;          // 240 = single, 360 = 1.5
    justify: boolean;
    firstLineIndent: number;
  };
  heading: {
    align: "center" | "left";
    upper: boolean;
    rule: boolean;         // sarlavha ostidagi chiziq (rezyume/glossariy)
  };
  titlePage: "gost" | "article" | "none";
  tablePlacement: "anchored" | "end";
  columns?: 1 | 2;         // glossariy uchun ikki ustun
};

const PROFILES: Record<DocProfileId, DocProfile> = { /* ... */ };

/** Profil `toolId` dan olinadi — bitta joyda, boshqa hech qayerda. */
export function profileFor(meta: DocMeta): DocProfile {
  switch (meta.toolId) {
    case "resume":              return PROFILES.resume;
    case "essay":               return PROFILES.essay;
    case "article":             return PROFILES.article;
    case "texnologik-xarita":   return PROFILES.landscape;
    case "lesson-plan":         return PROFILES.landscape;
    case "glossary":
    case "keys":                return PROFILES.reference;
    default:                    return PROFILES.gost;
  }
}
```

`renderDocx()` da `FONT`/`SIZE`/`LINE` konstantalari o'rnini `const P = profileFor(doc.meta)` egallaydi. **Mavjud xatti-harakat o'zgarmaydi:** `gost` profili hozirgi konstantalar bilan **bayt-bayt bir xil** bo'lishi kerak — bu regressiyani nol qiladi va o'zgarish faqat 5 xizmatga tegadi.

### 9.2.1. Rezyume profili — CV, referat emas

| Parametr | GOST (hozir) | `resume` (bo'ladi) |
|---|---|---|
| Shrift | Times New Roman 14pt | **Calibri 10.5pt** (ATS-friendly, sans) |
| Interval | 1.5 (360) | **1.15 (276)** |
| Chekinish | chap 3 sm | **har tomondan 1.6 sm** |
| Matn | JUSTIFIED + 1.25 sm | **LEFT, chekinishsiz** |
| Sarlavha | markazda, BOSH HARF | **chapda, ostida to'q sariq chiziq** |
| Titul | — | yo'q; **ism + lavozim + aloqa qatori** yuqorida |

Ikki ustunli tuzilma `docx` paketida **chegarasiz jadval** orqali quriladi (Word/LibreOffice ikkalasida ham ishonchli; `columns` xossasidan ko'ra barqarorroq, chunki u ustunlararo matn oqimini boshqarib bo'lmaydi):

```ts
// 72mm yon panel + qolgani asosiy ustun — viewer bilan bir xil nisbat
new Table({
  borders: NO_BORDERS,
  columnWidths: [Math.round(72 * 56.7), CONTENT_W - Math.round(72 * 56.7)],
  rows: [new TableRow({ children: [asideCell, mainCell] })],
})
```

Yon panelning to'q foni `TableCell.shading` bilan (`fill: "1C1917"` — viewer bilan **aynan bir xil rang**), matn oq (`color: "F5F5F4"`).

> **Muhim:** `writeResumeWithLlm` allaqachon `h3` (ish joyi sarlavhasi) va `li` (bullet) bloklarini to'g'ri quradi ([write-specials.ts:551](../lib/generation/write-specials.ts#L551)). Ular hozir generic `blockToParagraphs` orqali o'tadi. Profil bilan `h3` → bold + yil o'ngda tab-stop, `li` → nuqtali ro'yxat bo'ladi. **Yozuvchini o'zgartirish shart emas** — bu ishning arzon bo'lishining sababi.

### 9.2.2. `landscape` profili — A-6

Texnologik xarita jadvali **6 ustunli**: `№ | Soat | Mavzu | Metod | Natija | Nazorat`. Hozir u portret A4 da, chap chekinishi 3 sm bo'lgan holda chiziladi → foydali kenglik ≈ 16.4 sm, ya'ni ustunga **2.7 sm**. «Mavzu» ustuniga 80 belgi sig'maydi.

Yechim: `orientation: "landscape"` + har tomondan 1.5 sm chekinish → foydali kenglik **26.7 sm** (+63%). Ustun kengliklari teng emas, mazmunga qarab taqsimlanadi:

```ts
columnWidths: pct([5, 7, 34, 16, 24, 14])  // № Soat Mavzu Metod Natija Nazorat
```

Dars rejasi jadvali (`Bosqich | Daqiqa | Faoliyat | Natija`) ham shu profilga tushadi.

### 9.2.3. `tablePlacement: "anchored"` — A-4

Hozir ([render-docx.ts:314](../lib/generation/render-docx.ts#L314)):

```ts
for (const s of doc.sections) { /* barcha bo'limlar */ }
for (const tb of doc.tables ?? []) { /* keyin BARCHA jadvallar */ }
```

Ya'ni jadval **doim** oxirida, adabiyotlardan oldin. Dars rejasida bu shunday chiqadi: *Pasport → Bosqichlar matni → Uy vazifasi → [3 sahifa keyin] Vaqt jadvali*. O'qituvchi darsni jadval bilan olib boradi, matn bilan emas.

Yechim — `DocTable` ga ixtiyoriy langar:

```ts
export type DocTable = {
  caption?: string;
  headers: string[];
  rows: string[][];
  /** Shu `DocSection.id` dan keyin chizilsin. Bo'sh bo'lsa — oxirida (eski xatti-harakat). */
  anchor?: string;
};
```

`writeLessonWithLlm` → `anchor: "map"`, `writeMapWithLlm` → `anchor: "passport"`. Boshqa hech qayerda `anchor` yo'q ⇒ **barcha mavjud hujjatlar o'zgarishsiz qoladi**.

### 9.2.4. Glossariy takrorini yo'q qilish — A-5

[write-specials.ts:353-372](../lib/generation/write-specials.ts#L353) da bir xil atamalar **ikki marta** yoziladi:

```ts
sections: [ ..., section("atamalar", L.terms, terms.flatMap(t => [h3(t.term), p(t.def)])) ],
tables:   [ { caption: L.shortTable, rows: terms.map(t => [t.term, clip(t.def, 200)]) } ],
```

40 atamalik glossariy (15 000 tanga) DOCX da **80 ta yozuv** beradi — ikkinchisi birinchisining 200 belgigacha kesilgan nusxasi. Bu «qo'shimcha qiymat» emas, nuqson.

**Yechim:** `tables` bloki olib tashlanadi; atamalar ro'yxati `reference` profilida **ikki ustunli** (`columns: 2`) chiqadi — bosma lug'at ko'rinishi, sahifa soni ikki barobar kamayadi va hujjat professional ko'rinadi.

## 9.3. Qabul mezonlari

- [ ] `profileFor()` 6 profil qaytaradi; `gost` yo'li hozirgi bayt chiqishi bilan **bir xil** (snapshot test).
- [ ] Rezyume DOCX: Calibri 10.5, ikki ustun, yon panel `#1C1917`, markazlashtirilgan BOSH HARFLI sarlavha **yo'q**.
- [ ] Texnologik xarita va dars rejasi DOCX — **albom** yo'nalishida.
- [ ] Dars rejasi jadvali «Dars xaritasi» bo'limidan **keyin**, uy vazifasidan oldin.
- [ ] 40 atamalik glossariy DOCX da har atama **bir marta**.
- [ ] `npm run check` toza.

## 9.4. Testlar (yangi, `tests/document.test.mts` ga)

```
✓ gost profili hozirgi tipografiya konstantalarini saqlaydi
✓ rezyume profili justify va birinchi qator chekinishini o'chiradi
✓ rezyume DOCX da markazlashtirilgan BOSH HARFLI bo'lim sarlavhasi yo'q
✓ texnologik xarita albom yo'nalishida chiqadi
✓ anchor berilgan jadval o'z bo'limidan keyin turadi
✓ anchor berilmagan jadval eski joyida (oxirida) qoladi
✓ glossariy atamani ikki marta chizmaydi
```

## 9.5. Xavflar

| Xavf | Ehtimol | Yumshatish |
|---|---|---|
| `docx` paketi `landscape` + jadval kengligini noto'g'ri hisoblaydi | O'rta | `CONTENT_W` ni profildan hisoblash; LibreOffice PDF eksporti bilan qo'lda tekshirish |
| Rezyume ikki ustuni LibreOffice da siljiydi | O'rta | Jadval yondashuvi (`columns` emas) — LibreOffice da barqarorroq |
| GOST hujjatlarida regressiya | **Past** | `gost` profili — konstantalarning aynan nusxasi; snapshot test |

---

# SPRINT 10 — «Rasm xizmati halolligi» (P0, 2–3 kun)

> **Bir jumlada:** rasm — 14 xizmatdan **yagona** sifat darvozasi yo'qi, va u yagona qisman yetkazishda ham to'liq pul oladigani.

## 10.1. A-2: qisman yetkazish, to'liq to'lov

Narx **faqat songa** bog'langan ([tools.ts:741](../lib/tools.ts#L741)):

```ts
if (tool.id === "image") {
  const n = Number(values.imageCount || 1);
  if (n >= 4) return 6000;
  if (n >= 2) return 3500;
  return 2000;
}
```

Yetkazish esa ([image-studio.ts:125](../lib/generation/image-studio.ts#L125)):

```ts
const images = raw.filter((x): x is GenImage => Boolean(x));
if (!images.length) throw new Error("Rasm yaratilmadi. Qayta urinib ko'ring.");
```

**4 ta so'raldi, 1 tasi keldi → shart bajarilmaydi → ish `COMPLETED` → 6 000 tanga yechilgan holida qoladi.** `fal` API 429 yoki content-filter qaytarishi odatiy hol, ya'ni bu nazariy emas.

Boshqa 13 xizmatning hammasida shunga o'xshash darvoza **bor**: glossariyda 70%, xaritada 70%, tarjimada bitta bo'lak yo'qolsa `throw`, akademikda 80% so'z + 85% sahifa. Rasm — istisno.

### Yechim: qisman qaytarish (`refundPartial`)

To'liq `throw` **noto'g'ri yechim** bo'lardi: 4 tadan 3 tasi kelgan bo'lsa, foydalanuvchi 3 ta yaxshi rasmni yo'qotadi va butun ish yiqiladi. To'g'ri yechim — **yetkazilganiga to'lash**.

`lib/server/credits.ts` ga:

```ts
/**
 * Ishning bir qismi bajarilmasa — proporsional qaytarish.
 *
 * `refund()` bilan bir xil idempotentlik kaliti (`reference`) ishlatiladi,
 * shuning uchun bitta ish uchun yo to'liq, yo qisman qaytarish bo'ladi —
 * ikkalasi emas.
 */
export async function refundPartial(
  userId: string,
  reference: string,
  ratio: number,          // 0 < ratio < 1
  note = "",
): Promise<boolean>
```

`buildArtifact` natijasiga yangi ixtiyoriy maydon:

```ts
export type BuiltFile = {
  // ...
  /** Va'da qilinganning qanchasi yetkazildi. 1 dan kichik bo'lsa worker farqni qaytaradi. */
  delivered?: { got: number; want: number };
};
```

`buildImageArtifact` da:

```ts
if (!images.length) throw new Error("Rasm yaratilmadi. Qayta urinib ko'ring.");
const delivered = images.length < count ? { got: images.length, want: count } : undefined;
```

`worker.ts` da `completeJob` dan keyin:

```ts
if (won && file.delivered) {
  const { got, want } = file.delivered;
  await refundPartial(job.userId, job.id, 1 - got / want,
    `${want} tadan ${got} tasi yaratildi — farq qaytarildi`);
}
```

Foydalanuvchi 3 ta rasmni oladi **va** 1 500 tanga qaytadi. Bu `throw` dan ham, jim o'tkazishdan ham halolroq.

> **Kengaytiriladi:** `delivered` maydoni universal — kelajakda slaydda «15 ta so'raldi, 12 tasi chiqdi» holatiga ham xuddi shu mexanizm qo'llanadi.

## 10.2. A-3: 4 ta rasm — 1 ta fayl

[image-studio.ts:146](../lib/generation/image-studio.ts#L146):

```ts
// Yuklab olinadigan fayl — birinchi rasm.
let first = images[0].url;
```

Qolgan 3 tasi faqat viewer orqali, bittalab. Foydalanuvchi «4 ta rasm» uchun to'ladi, `Yuklab olish` tugmasi esa 1 tasini beradi.

**Yechim:** `jszip` allaqachon bog'liqlikda (`package.json`) — bir nechta rasm ZIP ga yig'iladi:

```ts
if (images.length > 1) {
  const zip = new JSZip();
  images.forEach((im, i) => {
    const b = dataToBytes(im.url);
    if (b) zip.file(`rasm-${i + 1}.${extOf(im.url)}`, b);
  });
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    fileName: `${meta.fileNameHint || "rasm"}-${images.length}ta.zip`,
    mime: "application/zip",
    /* ... */
  };
}
```

Bitta rasm bo'lsa — eski yo'l (PNG/JPG), chunki bitta rasm uchun ZIP noqulay.

> `Generation.format` tipiga `"zip"` qo'shiladi ([types.ts:98](../lib/types.ts#L98)) — bu A-13 (o'lik `"pdf"` tipi) bilan bitta o'zgarishda hal qilinadi.

## 10.3. A-14: yuklash nomidagi qattiq `.jpg`

[ImageViewer.tsx:98](../components/viewers/ImageViewer.tsx#L98):

```ts
a.download = `rasm-${i + 1}.jpg`;   // PNG ham .jpg nomi bilan tushadi
```

`image-studio.ts` allaqachon MIME ni to'g'ri aniqlaydi (`png ? "png" : "jpg"`) — viewer shu mantiqni takrorlashi kerak. `GenImage` ga `mime?: string` qo'shiladi yoki URL kengaytmasidan olinadi.

## 10.4. Qabul mezonlari

- [ ] 4 ta so'ralib 2 tasi kelsa: fayl 2 ta rasmli ZIP, hisobda **3 000 tanga** yechilgan (6 000 emas).
- [ ] Tranzaksiyalar ro'yxatida qaytarish sababi ko'rinadi.
- [ ] 1 ta rasm — eski yo'l, ZIP emas.
- [ ] PNG rasm `.png` nomi bilan yuklanadi.

## 10.5. Testlar

```
✓ refundPartial charge summasining ulushini qaytaradi
✓ refundPartial ikki marta chaqirilsa ikkinchisi false qaytaradi (idempotent)
✓ delivered berilmaganda qaytarish bo'lmaydi
✓ bir nechta rasm ZIP ga yig'iladi, bittasi xom fayl bo'lib qoladi
✓ ZIP ichidagi fayl kengaytmalari haqiqiy MIME ga mos
```

---

# SPRINT 11 — «Janr tuzilma darvozalari» (P1, 4–5 kun)

> `AUDIT-2 §12.1` da **ataylab qoldirilgan** ish. Endi navbat keldi.

## 11.1. A-7: `referat` va `mustaqil-ish` hali ham struktura jihatidan bir xil

Sprint 5 da promptlar ajratildi ✅. Lekin **tuzilma** hali umumiy ([write-llm.ts:190](../lib/generation/write-llm.ts#L190)):

```ts
export function outlineShape(pages: number, toolId: string) {
  const p = Math.max(4, pages || 8);
  if (p >= 33) return { chapters: 5, subs: 4 };
  if (p >= 23) return { chapters: 4, subs: 4 };
  if (p >= 18 || toolId === "coursework") return { chapters: 3, subs: 3 };
  return { chapters: 2, subs: 3 };
}
```

`toolId` faqat **bitta** joyda (`coursework`) ta'sir qiladi. 15 betlik referat va 15 betlik mustaqil ish → **aynan bir xil skelet**, narxi ham bir xil (`tools.ts:765`, ikkalasi bitta shartda). Foydalanuvchi ikki xil xizmatga pul to'laydi, bitta mahsulot oladi.

### Yechim: `genreShape()` — janr birinchi, sahifa ikkinchi

```ts
type GenreShape = {
  chapters: (pages: number) => number;
  subs: number;
  /** Majburiy tuzilma elementlari — darvoza shularni tekshiradi. */
  requires: Array<"abstract" | "table" | "ownTask" | "researchQuestion" | "sourceReview">;
};

const GENRE: Record<string, GenreShape> = {
  referat:        { chapters: p => (p >= 20 ? 3 : 2), subs: 3, requires: ["sourceReview"] },
  "mustaqil-ish": { chapters: p => (p >= 20 ? 3 : 2), subs: 3, requires: ["ownTask"] },
  coursework:     { chapters: p => (p >= 33 ? 5 : p >= 23 ? 4 : 3), subs: 3,
                    requires: ["researchQuestion", "table"] },
  article:        { chapters: () => 4, subs: 0, requires: ["abstract"] },
  thesis:         { chapters: p => (p >= 15 ? 5 : 3), subs: 0, requires: ["abstract"] },
};
```

**Janr farqi endi ikki qatlamda:** prompt (nima yozish) + shakl (necha bo'lim, nima majburiy).

## 11.2. A-8: `requires` darvozasi

Hozir annotatsiya **faqat promptda** so'raladi ([write-llm.ts:705](../lib/generation/write-llm.ts#L705)):

```ts
if ((meta.toolId === "article" || meta.toolId === "thesis") && remainingMs(deadline) > 12_000) {
  // annotatsiya yozishga URINADI — chiqmasa hujjat annotatsiyasiz COMPLETED bo'ladi
}
```

Byudjet tugagan bo'lsa yoki model javob bermasa — maqola annotatsiyasiz chiqadi va **jurnal maqolasi bo'lmay qoladi**. Bu `LENGTH_GATED` darvozasi bilan bir xil mantiq, faqat hajm emas, **tuzilma** uchun.

`lib/generation/index.ts` ga hajm darvozasidan **keyin**:

```ts
/**
 * Tuzilma darvozasi — hajm darvozasining tuzilmaviy juftligi.
 *
 * Hajm darvozasi «yetarli yozildimi» ni so'raydi, bu esa «va'da qilingan
 * JANR chiqdimi» ni. Annotatsiyasiz maqola — uzun referat, jadvalsiz kurs
 * ishi esa uzun insho. Ikkalasi ham to'langan narsa emas.
 */
const missing = missingStructure(tool.id, academic);
if (llmDoc && missing.length) {
  throw new Error(
    `Hujjat tuzilmasi to'liq chiqmadi (${missing.join(", ")} yo'q). ` +
      `Kredit qaytariladi — qayta urinib ko'ring.`,
  );
}
```

```ts
export function missingStructure(toolId: string, doc: AcademicDoc): string[] {
  const need = GENRE[toolId]?.requires ?? [];
  const out: string[] = [];
  if (need.includes("abstract") && !doc.abstracts?.length) out.push("annotatsiya");
  if (need.includes("table") && !doc.tables?.length)       out.push("jadval");
  // ownTask / researchQuestion / sourceReview — bo'lim sarlavhalari bo'yicha
  return out;
}
```

> **Ehtiyotkorlik:** `requires` **kam** bo'lishi kerak. Har qo'shilgan talab yiqilish ehtimolini oshiradi va foydalanuvchi «ish bajarilmadi» xabarini ko'radi. Boshlanishi: faqat `abstract` (maqola/tezis) va `table` (kurs ishi) — ikkalasi ham obyektiv o'lchanadi. `ownTask`/`researchQuestion` **avval faqat `console.warn`** bilan kuzatiladi, jonli statistika yig'ilgach darvozaga aylantiriladi.

## 11.3. Qabul mezonlari

- [ ] 15 betlik referat va 15 betlik mustaqil ish **turli** bo'lim soni/nomiga ega.
- [ ] Annotatsiyasiz maqola `COMPLETED` bo'lmaydi — kredit qaytadi.
- [ ] Jadvalsiz kurs ishi `COMPLETED` bo'lmaydi.
- [ ] `ownTask`/`researchQuestion` — hozircha faqat log.
- [ ] Jonli Gemini bilan har 5 janr tekshiriladi va natija `AUDIT-3.md` ga yoziladi.

---

# SPRINT 12 — «Byudjet adolati» (P1, 2–3 kun)

## 12.1. A-9: bitta byudjet — 14 xizmat

[env.ts:159](../lib/server/env.ts#L159):

```ts
jobTimeoutMs: int("WORKER_JOB_TIMEOUT_MS", 300_000),   // hammasi uchun bitta
```

`worker.ts:110` da har ish **285 s** oladi — 1 varaqlik insho ham, 45 betlik kurs ishi ham.

**Ikki tomonlama zarar:**

| Xizmat | Haqiqiy ehtiyoj | Beriladi | Oqibat |
|---|---|---|---|
| Insho, 1 varaq | ~40 s | 285 s | `concurrency: 2` slotini keraksiz band qiladi |
| Kurs ishi, 45 bet | ~420 s (5 bob × 4 ostmavzu) | 285 s | Byudjet tugaydi → hajm darvozasi yiqiladi → **kredit qaytadi** |

Ikkinchisi og'irroq: foydalanuvchi 24 000 tanga to'lagan eng qimmat xizmatda muvaffaqiyatsizlik ehtimoli **eng yuqori**, chunki byudjet eng qattiq.

### Yechim: `budgetFor(toolId, values)`

```ts
// lib/server/job-budget.ts
/**
 * Ishga ajratiladigan vaqt — hajmdan hisoblanadi, qattiq yozilmaydi.
 *
 * Asos: bitta LLM bo'lim chaqiruvi ≈ 25-40 s. 45 betlik kurs ishi
 * 5 bob × 4 ostmavzu = 20 chaqiruv, 4 tadan parallel → 5 to'lqin.
 */
export function budgetFor(toolId: ToolId, values: FormValues): number {
  const base = { image: 90_000, translation: 240_000, slide: 180_000 }[toolId];
  if (base) return base;
  const pages = targetPagesOf(values);
  return clamp(90_000 + pages * 9_000, 90_000, 600_000);   // 45 bet → 495 s
}
```

`generations` jadvaliga `budget_ms` ustuni qo'shiladi (migratsiya `009_job_budget.sql`) — `claimJob` uni o'qiydi, `reclaimStaleJobs` esa **shu qiymatga** qarab o'lik ishni aniqlaydi (hozir global konstanta bilan solishtiradi, ya'ni uzoq ish o'lik deb belgilanib qolishi mumkin).

> **Ehtiyot chorasi:** `WORKER_JOB_TIMEOUT_MS` yuqori chegara sifatida qoladi — `budgetFor` undan oshib keta olmaydi. Shunda operator bitta o'zgaruvchi bilan hamma narsani cheklay oladi.

## 12.2. A-10: progress ticker haqiqatga mos emas

[worker.ts:65](../lib/server/worker.ts#L65):

```ts
const expected = job.toolId === "slide" ? 60_000 : job.toolId === "image" ? 30_000 : 45_000;
```

Kurs ishi uchun `expected = 45 s`, haqiqiy vaqt ≈ 280 s. `1 - exp(-t/45000)` formulasi **90 soniyada 95% ga yetadi** va qolgan 3 daqiqa progress qotib turadi — aynan kod izohida «bo'lmaydi» deb yozilgan holat.

**Yechim:** `expected = budgetFor(...) * 0.7`. Bitta manba — ikkala joyda.

## 12.3. Qabul mezonlari

- [ ] 45 betlik kurs ishi ≥ 480 s oladi, 1 varaqlik insho ≤ 120 s.
- [ ] `reclaimStaleJobs` ish o'z byudjetidan oshgandagina uni o'lik deb belgilaydi.
- [ ] Progress 45 betlik ishda 4-daqiqada ~80% da bo'ladi, 90 soniyada 95% da emas.
- [ ] `WORKER_JOB_TIMEOUT_MS` yuqori chegara sifatida hurmat qilinadi.

---

# SPRINT 13 — «Texnik qarz» (P2, 1–2 kun)

| # | Ish | Fayl |
|---|---|---|
| A-11 | `mapPool` ni `quality.ts` dan import qilish; ikki private nusxani o'chirish | `image-studio.ts:71`, `slide-images.ts:251` |
| A-12 | `ResumeViewer` `join("\n")` o'rniga `h3`/`li` bloklarini render qilsin | `ResumeViewer.tsx:14` |
| A-13 | `output`/`format` tipidan `"pdf"` ni olib tashlash, `"zip"` qo'shish | `types.ts:80,98` |

**A-12 nozikligi:** `writeResumeWithLlm` `h3` (ish joyi) + `li` (natija bulletlari) quradi, viewer esa hammasini `\n` bilan tekislaydi. Ya'ni **Sprint 9 dan keyin DOCX viewerdan boyroq bo'lib qoladi** — teskari muammo. Shuning uchun A-12 Sprint 9 bilan **birga** bajarilishi kerak, keyinga qolmasin.

---

## 14. Umumiy jadval

| Sprint | Nomi | Kun | Ustuvorlik | Yopadigan bandlar |
|---|---|---:|---|---|
| **9** | Hujjat profili | 5–7 | **P0** | A-1, A-4, A-5, A-6 |
| **10** | Rasm halolligi | 2–3 | **P0** | A-2, A-3, A-14 |
| **11** | Janr darvozalari | 4–5 | P1 | A-7, A-8 |
| **12** | Byudjet adolati | 2–3 | P1 | A-9, A-10 |
| **13** | Texnik qarz | 1–2 | P2 | A-11, A-12, A-13 |
| | **Jami** | **14–20 kun** | | **14 band** |

### Kutilayotgan natija

| O'lchov | Hozir | Sprint 13 dan keyin |
|---|---:|---:|
| Renderer ajratilishi | 3 / 14 | **9 / 14** |
| Sifat darvozasi | 13 / 14 | **14 / 14** |
| Tuzilma darvozasi | 0 / 5 janr | **5 / 5** |
| Umumiy ball | **7.9 / 10** | **~8.9 / 10** |

---

## 15. Ish tartibi qoidalari

1. **Har sprint — alohida commit** (yoki mantiqiy bo'lakka bir nechta). Xabar `AUDIT-2` uslubida: `feat(docx): rezyume uchun alohida hujjat profili (Sprint 9)`.
2. Har commitdan oldin `npm run check` (tsc + eslint + test) **toza** bo'lishi shart.
3. Har sprint oxirida **jonli Gemini bilan tekshiruv** — natija shu faylning «bajarildi» bo'limiga yoziladi (`AUDIT-2 §9.2` kabi).
4. `gost` profilida **hech narsa o'zgarmasligi** kerak — bu Sprint 9 ning eng muhim invarianti.
5. Yangi darvoza qo'shilganda **avval `console.warn`**, jonli statistika yig'ilgach `throw`. Darvoza noto'g'ri ishga tushsa, u foydalanuvchidan pul emas, **ishonch** oladi.

---

## 16. Qilinmaydigan ishlar (ataylab)

| Taklif | Nega yo'q |
|---|---|
| Har fayl turi uchun alohida worker protsessi | Hozirgi bitta universal worker to'g'ri: qulf + heartbeat + refund mantig'i bir joyda. 14 protsess bu mantiqni 14 marta takrorlardi. Yuk oshsa `WORKER_CONCURRENCY` va gorizontal masshtab yetarli. |
| DOCX o'rniga HTML→PDF ga o'tish | Foydalanuvchi **tahrirlanadigan** `.docx` topshiradi. PDF bu talabni buzadi. |
| LISTEN/NOTIFY bilan polling'ni almashtirish | 150 ms band polling hozirgi yuk uchun yetarli; murakkablik hali oqlanmagan. Yuk o'lchangach qayta ko'riladi. |
| Janr uchun alohida yozuvchi funksiyalar (5 ta) | Prompt + `genreShape` + `requires` uchtasi janr farqini yetarlicha ifodalaydi. 5 ta deyarli bir xil funksiya — takror, ajratish emas. |
