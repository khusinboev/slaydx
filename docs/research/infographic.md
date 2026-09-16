# R6 — Infografika (ta'lim plakati, A4/A3)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan; URL yo'q joyda
aniq "bizning tavsiya" deb belgilangan (tashqi manba emas).

## 1. Dizayn standartlari/tamoyillari

| Tamoyil | Nima deyiladi | Manba |
|---|---|---|
| Turlar | Ro'yxat (list/checklist), jarayon (process), taqqoslash (comparison — yonma-yon/Venn), statistika (statistical), xronologiya (timeline) — ta'lim mavzulari (tarix/adabiyot/fan) uchun mos | [venngage.com/9-types-of-infographic-template](https://venngage.com/blog/9-types-of-infographic-template/) |
| Bitta g'oya | Yaxshi infografika bitta aniq fikrni yetkazadi, mos diagramma turini tanlaydi, vizual ierarxiyani saqlaydi (muhimi kattaroq ko'rinadi), 10 soniyada "skanerlanadi" | [ovrdrv.com/infographic-design](https://www.ovrdrv.com/knowledge/infographic-design) |
| Kompozitsiya | Soddalik, vizual ierarxiya, rang/bo'shliqdan strategik foydalanish; matn minimal, vizual ustuvor | [content-and-marketing.com](https://www.content-and-marketing.com/blog/engaging-infographics-essential-design-principles/) |
| Taqqoslash maketi | Ikki/uch element yonma-yon — bo'lingan ustunlar, parallel ustunlar yoki Venn tuzilma | [venngage.com/9-types](https://venngage.com/blog/9-types-of-infographic-template/) |
| Matn hajmi | O'rtacha infografika 150–400 so'z; bosma (A1) uchun <200 so'z tavsiya; eng ko'p ulashilganlar o'rtacha 227–230 so'z; matn rasmdan ko'p bo'lmasligi kerak | [animateyour.science/10-tips](https://www.animateyour.science/post/10-tips-for-creating-an-effective-scientific-infographic), [dearcontent.com](https://www.dearcontent.com/minimal-yet-powerful-improving-the-text-on-your-infographics/) |
| Shrift o'lchami (A4) | A4 plakatlar uchun tana matni 10–12pt, sarlavha 18–24pt standart tavsiya | [vizcept.com/font-sizes-a1-poster](https://vizcept.com/blog/font-sizes-for-a1-poster) |
| Kontrast (WCAG 2.1 AA) | Oddiy matn ≥4.5:1, katta matn (18pt qalin yoki 24pt oddiy dan boshlab) ≥3:1; grafik/UI elementlar ≥3:1; AAA — 7:1/4.5:1 | [getstark.co/wcag-contrast-minimum](https://www.getstark.co/wcag-explained/perceivable/distinguishable/contrast-minimum/) |
| Rang palitrasi | 3–5 rangga cheklash (1 dominant + 1 aksent + neytral) tavsiya etiladi; matn/fon kontrasti kamida 4.5:1 | [wix.com/infographic-colors](https://www.wix.com/wixel/resources/infographic-colors) |

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai (`/uz/infographics`) | Canva Magic Design | Piktochart AI | Venngage AI | Napkin AI | Biz olamizmi + sabab |
|---|---|---|---|---|---|---|
| Kirish | mavzu (majburiy) + til (18, chip) + ixtiyoriy tavsif ("statistik ma'lumot, diagramma turi") | matn prompt yoki mavjud kontent | matn prompt → bir necha maket varianti | matn/CSV/Excel yuklash | tayyor matnni joylash | **ha** — mavzu+til+ixtiyoriy tavsif (bizda ham `extra`), + qo'shimcha tur/blok soni (ular yo'q, bizda bor — chuqurroq nazorat) |
| Uslub | yo'q (LLM tanlaydi) | Watercolor/Neon/Filmic kabi uslub tanlovlari | shablon galereyasidan tanlov | rang/ikon/shrift moslashtirish (brendga) | avtomatik | **keyin** — hozircha standart 1 uslub (vektor, qora chiziq), keyingi bosqichda variant qo'shish mumkin |
| Rang | yo'q (ko'rinmadi) | brend-kit rangidan avtomatik moslashtirish | shablon ichida tanlov | to'liq tahrirlanadigan rang/ikon/shrift | avtomatik | **ha** — LLM `palette` maydonini tanlaydi (5–6 nomlangan to'plamdan), foydalanuvchi tanlamaydi (soddalik uchun) |
| Blok/tur soni | yo'q (bitta yaxlit natija, nazorat qilinmaydi) | shablon avtomatik tuzadi | komponent kutubxonasi (ma'lumot/quote/bio/banner bloklari) | diagramma avtomatik + tahrir | avtomatik | **ha** — reyestrda `blockCount` (3–8) va `type` (7 tur) — sodda.ai'dan farqli, aniq nazorat beramiz |
| Format/nisbat | faqat bitta (ko'rinmadi, natija yaratilmadi) | ko'p nisbat (post/slayd/hikoya) | bir nechta aspekt nisbati (YouTube/TikTok video ham) | ko'p format | — | **A4 portret standart**; A3 — keyingi bosqich (bosma ehtiyoj past, PPTX integratsiyasi ustuvor) |
| Narx | 2 000 tanga flat, tarix/ro'yxat sahifasi yo'q | Canva obuna ichida (alohida narx yo'q) | obuna | obuna | obuna/bepul | PM qarori bo'yicha 2 000 tekis (AUDIT-20 §Umumiy) — o'zgarmaydi |
| Chiqish | PNG (ko'rinishga qarab) | PNG/PDF/ijtimoiy tarmoq o'lchamlari | PNG/PDF | PNG/PDF/interaktiv | PNG/SVG/PPTX | **ha** — PNG 300 dpi + PDF (bir betlik DOCX o'rami); PPTX integratsiyasi keyingi audit |

**Xulosa:** sodda.ai infografikasi eng sayoz (3 maydon, nazoratsiz natija, hatto namuna ham topilmadi — [slaydtop-a-test-atestatsiya-infografika.md §3](./slaydtop-a-test-atestatsiya-infografika.md)); xalqaro vositalar (Piktochart/Venngage) kuchli tahrir/shablon tizimiga tayanadi — bizda tahrir yo'q, shuning uchun **LLM spetsifikatsiyasi aniqroq bo'lishi** (tur/blok soni/palitra) ustuvor, aks holda natija tasodifiy chiqadi.

## 3. Bizga tavsiya — reyestr

**Infografika turlari** (`InfographicType`):

| id | Tavsif | Blok soni | Maxsus maydon |
|---|---|---|---|
| `list` | Ro'yxat/checklist (qoidalar, bosqichlar tartibsiz) | 3–8 | — |
| `process` | Jarayon (1→2→3, o'q bilan) | 3–6 | `order` (raqam badge) |
| `compare` | Taqqoslash (2 ustun, ≤6 band har birida) | 2 guruh | `side: "left"\|"right"` |
| `stat` | Statistika (katta raqam + izoh) | 3–6 | `stat` majburiy |
| `timeline` | Xronologiya (sana/davr + voqea) | 3–8 | `when` majburiy |
| `cause-effect` | Sabab–natija (chap: sabablar, o'ng: natijalar, markazda o'q) | 2–4 + 2–4 | `role: "cause"\|"effect"` |
| `map-structure` | Tuzilma/xarita (markaziy tushuncha + tarmoq — mavzu bo'linmasi) | 3–7 | `parent?` (ierarxiya) |

**Parametrlar** (`id`, tur, variantlar, standart, majburiymi, `impacts`):

| id | tur | variantlar/chegara | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `topic` | text | — | — | ha | prompt |
| `type` | select | 7 tur (yuqorida) | `list` | ha | prompt, layout |
| `blockCount` | select | tur bo'yicha chegarada (3–8) | 5 | yo'q | prompt, layout |
| `palette` | select | 6 nomlangan (pastda) | `indigo` | yo'q | palette |
| `size` | select | A4 / A3 | A4 | yo'q | layout (A3 — keyin) |
| `language` | select | 18 til | uz | ha | prompt, layout (matn yo'nalishi) |
| `extra` | textarea | — | — | yo'q | prompt (statistik son/diagramma turi kabi tavsif) |

**LLM spetsifikatsiyasi (JSON sxema)**:

```json
{
  "title": "string (≤60 belgi)",
  "subtitle": "string? (≤90 belgi)",
  "type": "list|process|compare|stat|timeline|cause-effect|map-structure",
  "blocks": [
    { "icon": "tabler-icon-nomi", "heading": "string (≤40 belgi)", "text": "string (≤120 so'z/blok emas — JAMI ≤120 so'z butun plakatda)", "stat": "string? (faqat stat turida, masalan '73%')", "when": "string? (faqat timeline)", "role": "cause|effect? (faqat cause-effect)" }
  ],
  "palette": "indigo|forest|sunset|ocean|berry|slate",
  "source": "string? (faqat foydalanuvchi bergan bo'lsa)"
}
```

**Maket qoidalari** (A4 portret 210×297 mm, 300 dpi = 2480×3508 px):

| Zona | O'lcham | Shrift |
|---|---|---|
| Chekka (margin) | 12 mm | — |
| Sarlavha (title) | to'liq kenglik, ~28 mm balandlik | 26–30 pt qalin |
| Ost sarlavha (subtitle) | ~10 mm | 13–14 pt oddiy |
| Blok panjarasi | 3 blok → 1 ustun; 4–6 blok → 2 ustun; 7–8 blok → 2×4 | — |
| Blok kartasi | 2 ustunda ~85×50 mm, 1 ustunda ~186×32 mm | sarlavha 13–14 pt qalin, matn 10–11 pt |
| Ikon (blok ichida) | 14×14 mm doira ichida | — |
| Stat raqami (`stat` turida) | — | 24–28 pt qalin, aksent rang |
| Pastki qator (manba/sana, ixtiyoriy) | ~8 mm | 8–9 pt |

Bu o'lchamlar qidiruv natijasidagi umumiy tavsiyadan (A4: tana 10–12pt/sarlavha 18–24pt — [vizcept.com](https://vizcept.com/blog/font-sizes-for-a1-poster)) picha kattaroq, chunki bizda plakat matn zich sahifa emas — blok soni kam (3–8), shrift kattaroq bo'lsa o'qish qulayroq (bizning tavsiya, manbasiz).

**Palitra to'plami** (6 nomlangan, WCAG AA matn/fon ≥4.5:1 tekshirilgan tuzilishda — [wix.com/infographic-colors](https://www.wix.com/wixel/resources/infographic-colors), [venngage.com/accessible-colors](https://venngage.com/blog/accessible-colors/) tamoyillari asosida tanlangan, aniq HEX'lar bizning tanlov):

| Nomi | Dominant | Aksent | Neytral fon | Matn |
|---|---|---|---|---|
| `indigo` | #3730A3 | #F59E0B | #F5F5F7 | #1F2933 |
| `forest` | #14532D | #CA8A04 | #F3F6F2 | #1F2933 |
| `sunset` | #9A3412 | #0E7490 | #FBF5EF | #1F2933 |
| `ocean` | #0C4A6E | #DB2777 | #F0F7FB | #1F2933 |
| `berry` | #6D28D9 | #059669 | #F6F3FC | #1F2933 |
| `slate` | #1E293B | #D97706 | #F4F5F7 | #1F2933 |

Har birida colorblind-safe amber/ko'k aksent naqshi ([media.io colorblind palette #0072B2/#E69F00](https://www.media.io/color-palette/infographic-color-palette.html) mantig'iga yaqin) — dominant/aksent kombinatsiyasi ikkalasi protanopiya/deuteranopiyada ham farqlanadi. Amalga oshirishda har palitra `figures/model.ts` ga o'xshash konstantalar sifatida yozilib, `svg.ts` dagi `fillAttr`/`LayoutText.fill` orqali ishlatiladi (bular allaqachon ixtiyoriy rang qabul qiladi — faqat `shapeSvg` dagi qattiq qora `STROKE` infografika uchun rangga moslashtirilishi kerak, `lib/generation/figures/svg.ts:25,65`).

**Ikon to'plami** — Tabler Icons (MIT litsenziya, atributsiya shart emas — [github.com/tabler/tabler-icons/LICENSE](https://github.com/tabler/tabler-icons/blob/main/LICENSE)), 24×24 grid, 2px strok, SVG fayl sifatida — [tabler.io/icons](https://tabler.io/icons). 6100+ ikon, «Education» toifasida 223 ta — [tabler.io/icons](https://tabler.io/icons). Muqobil: Lucide (ISC, funksional MIT'ga teng, atributsiya shart emas — [lucide.dev/license](https://lucide.dev/license)) yoki Phosphor (MIT, 6 og'irlik: Thin/Light/Regular/Bold/Fill/Duotone — [dev.to/lucide-vs-tabler-vs-phosphor](https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl)). **Tavsiya: Tabler** — mavjud `svg.ts` uslubiga (qora chiziq, oddiy geometriya) eng yaqin, "Education" toifasi tayyor.

Taxminiy ≈40 ta ikon nomi (ta'lim mavzulari uchun; **aniq slug nomlari WP boshida `@tabler/icons` ro'yxatidan tasdiqlanishi shart** — bu yerda faqat konseptual ro'yxat, manbasiz):
`book`, `books`, `school`, `backpack`, `certificate`, `pencil`, `ruler`, `ruler-2`, `math-function`, `sigma`, `abacus`, `atom`, `flask`, `test-pipe`, `microscope`, `dna`, `world`, `map`, `globe`, `language`, `bulb`, `target`, `clipboard-check`, `clipboard-list`, `checklist`, `chart-bar`, `chart-pie`, `chart-line`, `trending-up`, `users`, `calendar`, `clock`, `award`, `trophy`, `star`, `puzzle`, `compass`, `flag`, `brain`, `heart`, `history`.

**Chiqish**: PNG 300 dpi (`figurePng`, mavjud dvigatel — faqat `widthMm` A4 kengligiga o'zgartiriladi, `lib/generation/figures/png.ts:37`); PDF — bir betlik DOCX/PPTX o'rami (rasm to'liq betni to'ldiradi); PPTX'ga joylash — keyingi audit (2-dastur rejasida allaqachon qayd etilgan).

## 4. Sifat mezonlari

**Deterministik qoidalar** (`ReviewCheck` uslubida):

| id | Tekshiradi | Chegara |
|---|---|---|
| `blockCount` | Blok soni tur chegarasida | 3–8 (tur bo'yicha jadval) |
| `textLength` | Butun plakat matni (sarlavha+ost+bloklar) | ≤120 so'z (bizning tavsiya — xalqaro 150–400 dan qattiqroq, chunki A4 blok maydoni kichik va sxemalar allaqachon zich; [animateyour.science](https://www.animateyour.science/post/10-tips-for-creating-an-effective-scientific-infographic) <200 so'zni "A1" uchun tavsiya qiladi, A4 bizda undan kichik) |
| `titleLength` | Sarlavha belgi soni | ≤60 |
| `iconKnown` | Har blok `icon` — tasdiqlangan Tabler slug ro'yxatida | 100% mos, aks holda standart ikon |
| `contrast` | Har palitra dominant/aksent matn-fon juftligi | ≥4.5:1 (WCAG AA — [getstark.co](https://www.getstark.co/wcag-explained/perceivable/distinguishable/contrast-minimum/)), oldindan hisoblab qulflanadi (runtime emas — palitralar statik) |
| `noOverflow` | Blok matni kartaga sig'adi | `textWidth`/`LINE_K` bilan SVG matn o'lchash (mavjud `model.ts textWidth`, DOM'siz) — sig'masa qisqartiriladi yoki qayta yozdiriladi |
| `statPresent` | `type:"stat"` bo'lsa har blokda `stat` bor | 100% |

**Judge mezonlari** (3–5, ingliz tilida):

1. `topicClarity` — does the infographic communicate one clear idea about the topic at a glance, without unrelated filler blocks?
2. `visualLogic` — does the chosen type (list/process/compare/timeline/stat/cause-effect) actually fit the content, or is content forced into a mismatched structure?
3. `headingConciseness` — are block headings short, scannable phrases (not full sentences)?
4. `ageFit` — is the language simple enough for a school audience (no unexplained jargon)?
5. `honestyCheck` — no invented statistics, dates or sources beyond what the user provided.

**Halollik chegarasi:** `stat` va `source` maydonlari **faqat** foydalanuvchi `extra`/manba faylida bergan raqam-faktlardan to'ldiriladi; LLM prompt'da aniq taqiq bo'lishi kerak ("Agar aniq raqam berilmagan bo'lsa, `stat` maydonini bo'sh qoldiring yoki umumiy tavsif yozing, o'ylab topilgan foiz/son YO'Q") — xuddi maqola/dars rejasi dvigatellarida qo'llanilgan naqsh (`lessonSystemPrompt`, [lesson-plan.md §4](./lesson-plan.md)).

## 5. Namunalar

- Fotosintez jarayoni infografikasi (process turi, bosqichma-bosqich, ikon+matn bloklari): [venngage.com/photosynthesis-process-in-plants](https://venngage.com/templates/infographics/photosynthesis-process-in-plants-infographic-43bf5a10-c3b0-40cd-bde7-17c48b61de48)
- Fotosintez vs Hujayra nafas olishi (compare turi, Venn/yonma-yon): [piktochart.com/photosynthesis-and-cellular-respiration-venn-diagram](https://piktochart.com/templates/posters/fact/2687-photosynthesis-and-cellular-respiration-venn-diagram/)
- 9 infografika turi katalogi (barcha 7 turimiz namunalari bilan): [venngage.com/9-types-of-infographic-template](https://venngage.com/blog/9-types-of-infographic-template/)

**LLM uchun yaxshi/yomon spetsifikatsiya misoli** (`type: "process"`, mavzu: "Suv aylanishi"):

- ✅ Yaxshi: `{"heading": "Bug'lanish", "text": "Quyosh issiqligi ostida dengiz va ko'l suvi bug'ga aylanadi, atmosferaga ko'tariladi."}` — aniq bosqich, mavzuga bog'liq, ≤25 so'z.
- ❌ Yomon: `{"heading": "Tabiat hodisasi", "text": "Suv aylanishi muhim jarayon bo'lib, ko'plab omillarga bog'liq va turli sharoitlarda turlicha kechadi."}` — umumiy shablon, hech qanday bosqichga xos ma'lumot yo'q, `textLength`/`topicClarity` buni rad etishi kerak.
- ❌ Yomon (halollik): `{"heading": "Statistika", "stat": "71% Yer yuzasi suv"}` — agar foydalanuvchi bu raqamni bermagan bo'lsa, model buni o'zi "bilib" yozgan (haqiqatda to'g'ri bo'lsa ham, `honestyCheck`/manba yo'q, taqiq).

## 6. Ochiq savollar / egasidan kerak narsalar

1. Palitra ranglari (§3 jadval) — bizning tanlov, PM tasdiqlashi kerakmi yoki dizayner ko'rib chiqsinmi?
2. Ikon to'plami — Tabler tavsiya qilindi, lekin aniq 40 slug WP boshida `@tabler/icons` paketidan tasdiqlanishi kerak (hozir konseptual ro'yxat, ba'zi nomlar noto'g'ri bo'lishi mumkin).
3. A3 o'lcham — §3 da "keyin" deb belgilandi (AUDIT-20 kontekstda faqat A4 aytilgan); PPTX integratsiyasi ham keyingi audit — shu tartib tasdiqlanadimi?
4. `svg.ts`dagi qattiq qora `STROKE` (`lib/generation/figures/svg.ts:25`) infografika uchun rangga moslashtirilishi kerak (blok chegarasi palitra rangida yoki neytral kulrang) — bu WP-C (article) sxemalariga ta'sir qilmasligi uchun alohida `svg.ts` funksiyasi/parametri kerakmi, yoki yangi `infographic-svg.ts` fayl yaratilsinmi?
5. `textLength` chegarasi ≤120 so'z — bu butun plakat (sarlavha+bloklar) uchunmi yoki har blok uchunmi? Xalqaro manbalar (150–400 so'z butun infografika uchun) bilan solishtirganda ancha qattiq — PM buni tasdiqlaydimi yoki 150 so'zgacha yumshatiladimi?
