# AUDIT-9 — Pro slayd: har parametr ishlaydi

`AUDIT-8` ni DAVOM ETTIRADI. U yerda maket shablonga qarab o'zgaradigan
bo'ldi; bu sprintda **forma parametrlari** haqiqiy ta'sirga ega bo'ldi
va yangi **`pro-slide`** vositasi qo'shildi.

Sprint sababi — foydalanuvchi talabi: *«har bir kiritiladigan parametr
albatta ishlashi kerak, eski holatdagilar kabi faqat bezak bo'lib
turmasin»*. AUDIT-7 da 21 shablon deyarli bir xil chizardi; xuddi
shunday, forma maydonlarining bir qismi promptga ham, maketga ham
umuman yetib bormasdi.

Ish 9 ta parallel paket bilan olib borildi (`worktree` da, bittadan
fayl egaligi bilan): 0a/0b poydevor, A auditoriya/tur, B bloklar→beats,
C quiz/references/answers, D internet qidiruvi, E rasm provayderlari,
F logotip, G formalar, H/H2 prompt bo'limlari va yorliqlar.

## 1. «Bezak yo'q» kafolati — reyestr va differensial zond

Yagona manba: `lib/generation/slide-params.ts`. Har parametr o'zining
ta'sir nuqtalarini (`impacts`) va ikkita zond qiymatini (`probeA`,
`probeB`) e'lon qiladi. `tests/slide-params.test.mts` har parametr
uchun A va B bilan butun quvurni qayta hisoblaydi va e'lon qilingan
HAR ta'sirda farq bo'lishini talab qiladi:

| Ta'sir | Nima o'lchanadi |
|---|---|
| `prompt` | `slideSystem(meta, tpl)` matni |
| `beats` | `deckBeats` → `fallbackSlides` layout ketma-ketligi |
| `layout` | 13 layout × `planSlide` JSON |
| `price` | `priceFor` |
| `images` | `composeSlideImagePrompt` |
| `research` | tarmoq izi (fetch stub: URL + `google_search` + JSON rejimi) |

**Natija: 25 parametr, kutish ro'yxati (`PENDING`) BO'SH.** Ro'yxatga
yangi qator qo'shish — «bezak parametr» ni rasman tan olish — alohida
test bilan taqiqlangan.

## 2. Yangi vosita: `pro-slide`

| | `slide` (oddiy) | `pro-slide` |
|---|---|---|
| Narx | 4 paket (3 000–8 000 tanga) | `slaydlar × 2 000 tanga` (4–30) |
| Rasm | fal.ai, mos slaydlarda | Gemini `gemini-3.1-flash-image` |
| Brif | auditoriya, tur, reja bandlari, matn hajmi, test, internet, logotip | + tuzilma bloklari, asosiy g'oyalar, mahalliy misollar |
| Byudjet | 90 s + 11 s/slayd | 150 s + 16 s/slayd |

Ikkalasi ham bitta dvigateldan o'tadi — `pro-slide` alohida kod yo'li
emas, `DocMeta` va reyestr orqali sozlangan bir xil quvur.

## 3. Yangi imkoniyatlar

- **Auditoriya 14 ta** (`slide-audience.ts`): maktab 1–4 dan magistr va
  boshqaruvgacha, har biriga shrift poli, band soni va uzunligi.
  Eski qiymatlar alias orqali saqlanadi — eski `doc_json` buzilmaydi.
- **Taqdimot turi 9 ta** (`slide-purpose.ts`): tur standart shablon va
  standart bloklarni beradi, foydalanuvchi ustidan yozadi.
- **Tuzilma bloklari 9 ta** (`slide-blocks.ts`): reja, maqsadlar,
  motivatsiya, amaliyot, test, uyga vazifa, jadval, diagramma,
  adabiyotlar → beats'ga ankor (early/middle/late/end) bo'yicha
  kiritiladi, uzunlik `want` ga tenglashtiriladi.
- **Yangi maketlar**: `quiz` (savol + 4 variant, javob slaydda YO'Q),
  `references` (manbalar), `answers` (javoblar kaliti).
- **Internet qidiruvi** (`slide-research.ts`): Gemini grounding, ikki
  chaqiruvli arxitektura (grounding JSON rejimi bilan ishlamaydi),
  manbalar `references` slaydiga tushadi — uydirma havola yo'q.
- **Logotip**: `logo_uploads` (user-scoped), `/api/uploads/logo`
  (≤2 MB, baytlardan PNG/JPEG), har slaydda `contain` bilan.
- **Rasm uslublari 4 ta** (minimal, illyustratsiya, doska, foto).
  Qattiq «Photorealistic» ko'rsatmasi olib tashlandi.
- **Yorliqlar 18 tilda** (`SLIDE_LABELS`).

## 4. Jonli sinovda topilgan nuqsonlar

Unit testlar yashil bo'lgan holatda jonli deka (`npm run live
pro-slide`) beshta nuqsonni ochdi — hammasi shu sprintda tuzatildi.

| № | Nuqson | Sabab | Holat |
|---|---|---|---|
| X-1 | Pro dekada **7/7 rasm yo'qoldi** | Gemini so'rov shifti fal ga mo'ljallangan 45 s edi (o'lchov: ~34 s, uzun promptda undan ko'p); uzilish `res.json().catch(() => null)` ichida yo'qolib «javobda rasm yo'q» bo'lib ko'rinardi | ✅ shift 120 s, uzilish `timeout` |
| X-2 | Vaqt tugagach ham so'rov ketardi — pul sarflanardi | `Date.now() >= deadline` sharti | ✅ `provider.minMs` (Gemini 30 s, fal 8 s) |
| X-3 | **10 slayd so'ralgan deka 13 chiqdi** | `finalizeQuiz` savollarni rejadan KEYIN ajratardi | ✅ test slaydlari rejaga ko'chdi |
| X-3b | `titleSlide: false` da deka **bir slaydga kalta** | titul filtri uzunlik muvozanatidan keyin ishlardi | ✅ `deckBeats` |
| X-4 | «Javoblar» slaydi deyarli bo'sh (1 javobda maydonning 14% i) | `planAnswers` javoblar soniga qarab masshtablanmasdi | ✅ 1–2 javob yirik kalit varag'i (96/72 pt), qamrov 14% → 63% |
| X-5 | 7 blok yoqilgan 10 slaydli dekada `quizCount: 3` dan 1 ta savol qolardi | sig'im qoidasida test guruhi birinchi bo'lib qisqarardi | ✅ test guruhi tananing ≥1/3 ini oladi, o'rinni SHABLON standarti bergan blok bo'shatadi |

X-3 alohida e'tiborga loyiq: pro narxi `slaydlar × 2 000 tanga`
bo'lgani uchun uzunlik — hisob-kitob. Endi u `tests/slide-length.test.mts`
da **8 640 holatlik supurish** bilan qulflangan.

## 5. Ko'z bilan ko'rilgani

`scripts/slide-eyes.mts` (LLM siz) va jonli deka PPTX → LibreOffice →
PDF → PNG:

- Logotip 13 layoutda o'ng yuqorida, `contain`, sarlavha bilan
  kesishmaydi; to'q to'la rasmli slaydlarda yarim shaffof plashka.
- `quiz` slaydi: savol + A/B/C/D kartalari, javob ko'rinmaydi.
- `answers`: javoblar kaliti; `references`: manba domenlari.
- `localExamples` + `illustration` uslubi: rasmda o'zbek maktab
  o'quvchilari, do'ppi, xarita — ya'ni ikkala parametr ham ko'zga
  ko'rinadigan ta'sir berdi.
- Kolontitulda muallif · lavozim · tashkilot (`position` yangi maydon).

- «Javoblar» slaydi (X-4 dan keyin): ikkita katta karta, 72 pt li
  «1 — A» / «2 — C» — kalit varag'idek o'qiladi.

Yakuniy jonli natija: **10/10 slayd, 5 rasm, 6 manba, 2 quiz + javoblar
kaliti, izoh faylga tushmaydi** — 42 s. Jonli to'plamning qolgan 5 keysi
(maqola, insho, kurs ishi, glossariy, dars rejasi) ham yashil —
regressiya yo'q; oddiy `slide` uchun alohida paritet keysi qo'shildi
(10 slayd, 3 quiz, javob izohda, `textVolume: qisqa` → 56 belgi/band).

## 6. Ochiq qolgan bandlar

- **E2** — `twoCol`/`stats`/`process`/`table` uchun rasm tasmasi
  (hozir rasm ~60–65% slaydda; yorliqda halol yozilgan).
- Oddiy vosita rasmi: Pexels → Pixabay → fal (P1).
- Pro dekaning PPTX hajmi: 1K JPEG ≈ 0.9 MB × 21 rasm ≈ 19 MB.
  Qayta siqish uchun loyihada rasm kutubxonasi yo'q.
- AUDIT-8 dan qolgan N-3, N-5, N-6, N-10.
- Server: SSH/firewall (P0), `bhm` jurnali, build cache.

## 7. Bajarilish yozuvi

`main` da: poydevor `68fc383`/`01e8f0c`, A+D `95baffa`, H `ac93d24`,
E `f807d1c`, B `693a0f1`/`0da2326`, F `dcbd23a`, H2 `68ac206`,
G `06b301d`, C `7d71596`, X-1 `546107b`, X-2 `2897ab6`, X-3 `899c6d9`,
X-3b `e9646e0`.

X-4/X-5 `f208f4e`. Testlar: **530 unit + 21 ko'ruvchi**, `npm run check`
yashil (0 xato, 0 ogohlantirish).
