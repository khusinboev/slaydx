# AUDIT-16 — Rezyume 2 davomi: 10 tuzilmaviy shablon, ta'lim turi va daraja, kasblar bazasi (ESCO + hh.ru), og'ir buyruqlar siyosati

Sana: 2026-09-11. `AUDIT-15` dan keyin, o'sha sprintga mahsulot egasining
birinchi foydalanish fikrlari asosida.

## 1. Talablar

| № | Talab (mahsulot egasi so'zi bilan) | Qaror | Holat |
|---|---|---|---|
| T-1 | «classic, minimal, banner, creative bir-biriga juda o'xshash; hammasida rasm; internetdan izlab, bir-biridan umuman farq qiladigan chiroyli shablonlar qo'sh — 4 ta rasmsiz, 6 ta rasmli» | Shablon farqi BEZAKDA emas, TUZILMADA: to'rt mustaqil o'q — `columns` (single / sidebar-left / sidebar-right / split-main), `header` (plain / centered / banner / card / aside), `rowStyle` (inline / rail), `heading` (rule / caps / block / hairline / tab / hanging). 10 shablon: suratsiz `ats`, `timeline`, `compact`, `letter`; suratli `modern`, `twocol`, `banner`, `card`, `split`, `portrait`. Suratsiz shablonda surat sloti UMUMAN yo'q (`photo: null`) — yuklangan surat chizilmaydi, forma ogohlantiradi. Eski `classic/minimal/creative` → `ats/timeline/card` ga ko'chiriladi (`normalizeResumeTemplate`), eski hujjatlar ochiladi | ✅ |
| T-2 | «ish tajribasi bandlarida probel tashlab bo'lmayapti» | Nuqson: `onChange` har bosishda `trim()` + bo'sh qatorlarni tashlardi — probel bosilishi bilan o'char, Enter yangi band ochmasdi. Endi yozish paytida matn XOM saqlanadi, tozalash faqat yuborishda (`cleanBullets`). UI regressiya testi | ✅ |
| T-3 | «univer: nom, yo'nalish, DARAJA ro'yxatdan; univer/maktab/kollej ekanini aytsin, savollar shunga qarab o'zgarsin; oy so'ralmasin (o'qish sentabrdan)» | `ResumeEducation.kind` (university / college / school / course), `field` (yo'nalish), `degree` — KATALOG IDsi (bakalavr, magistr, ordinatura, PhD, DSc, tugallanmagan; kollej: kichik mutaxassis, malakali ishchi), turga qarab maydonlar (maktab: faqat nom + yillar; kurs: tashkilot + kurs nomi); tur almashganda ortiqcha maydon tozalanadi (forma ham, kirish qatlami ham); sana FAQAT yil (`normalizeYear`), `YearPicker`; daraja yorlig'i uz/ru/en koddan, boshqa tillarda inglizcha (daraja — fakt, model faqat `field` ni qayta yozadi, qo'riqchi kirishda yo'q yo'nalishni tashlaydi). Ko'ruvchida qator sarlavhasi = tahrirlanmaydigan `titlePrefix` (daraja yorlig'i) + tahrirlanadigan yo'nalish (`education.i.field`) | ✅ |
| T-4 | «sertifikat yilini ham tanlash mexanizmi bilan» | `YearPicker` (bitta yil, «hozir» yo'q), `normalizeYear(…, false)` | ✅ |
| T-5 | «taxmin bazasini tayyoridan olib kengaytirsa bo'ladimi, tayyor servislar bormi?» | Ha: **ESCO** (EK, 3 008 kasb + 13 890 ko'nikma, 27 til, CC-BY 4.0, ochiq API kalitsiz) — inglizcha nomlar va ko'nikma bog'lanishi; **hh.ru `professional_roles`** (27 kategoriya, 304 rol, ruscha, kalitsiz; hh.uz ham shu taksonomiya) — O'zbekiston bozoriga eng yaqin ro'yxat; zaxira **O\*NET** (AQSh, public domain, 1 000+ kasb, 57 000 muqobil nom). O'zbek tili hech birida yo'q → uz nomlari va o'zbekcha ko'nikmalar bir marta offline LLM bilan. Natija **1 093 kasb** (asl 346 · hh.ru 65 · ESCO 513 + 2-qatlam 95 · qolgani LLM nomini o'zgartirgan), 24 sektor (ISCO prefiksi / hh kategoriyasidan, taxmin emas); qo'lda ko'rib chiqish: 47 tashlandi, 15 nom tuzatildi, 55 sektor ko'chdi; tekis indeks 1 000 qidiruv 296 → 100 ms; `data/PROFESSIONS-SOURCES.md` (CC-BY 4.0 atributsiyasi, hh.ru shartlari). Oqim idempotent va partiyalab kommit qilinadi | ✅ |

## 2. Shablon dizayni — nega aynan shu 10 ta

Tadqiqot (resume.io, enhancv, careerkit, hireformat 2026 sharhlari): rezyume
maketlari to'rt oilaga bo'linadi — bir ustunli (ATS uchun eng xavfsiz),
yon panelli ikki ustunli (ko'nikma/til panelda), taymlayn (sana chap
ustunda, vertikal chiziq) va sarlavha-tasmali. Farq aynan TUZILMADA
sezildi, bezakda emas — birinchi to'plamning muammosi ham shu edi (4 ta bir
ustunli shablon faqat sarlavha bezagi bilan farq qilardi).

| Shablon | Surat | Tuzilma | Nima bilan ajralib turadi |
|---|---|---|---|
| `ats` | yo'q | single · centered · caps | Serif, markazlashgan ism va aloqa, robot uchun eng tekis |
| `timeline` | yo'q | single · plain · **rail** · hairline | Sanalar 30 mm chap ustunda, aksent vertikal chiziq |
| `compact` | yo'q | **split-main** · plain · tab | Ikki teng ustun, rangli panel yo'q — uzun tajriba bir varaqda |
| `letter` | yo'q | single · plain · **hanging** | Bo'lim nomi 34 mm chap maydonda, matn o'ngda — xat uslubi |
| `modern` | doira, panelda | sidebar-left (to'q) · aside | To'q chap panel |
| `twocol` | doira, panelda | sidebar-right (ochiq) · aside | Ochiq o'ng panel |
| `banner` | doira, tasmada | single · **banner** · caps | Varaq kengligidagi to'q tasma |
| `card` | kvadrat, kartada | single · **card** · block | Ochiq rangli sarlavha kartasi, bo'yalgan bo'lim sarlavhalari |
| `split` | katta kvadrat, panelda | sidebar-left (ochiq, 76 mm) · plain · tab | Keng ochiq panel, ism ASOSIY ustunda |
| `portrait` | katta doira, markazda | single · centered · rule | Surat markazda, ism ostida |

«Ko'rdim = oldim»: barcha o'qlar `planResume` (`layout.ts`) dan keladi;
DOCX (`resume/render-docx.ts`) va ko'ruvchi (`ResumePage.tsx`) faqat chizadi.
Yangi geometriyalar ikkala tomonda ham bor: `rail` qatori (DOCX — ikki
katakli jadval, o'ng katak chap chegarasi = chiziq; ko'ruvchi — flex),
`split-main` (DOCX — RANGSIZ ikki ustunli jadval, `fullHeight: false`,
aks holda jadval butunlay 2-betga o'tib ketardi — LibreOffice'da ko'rildi),
`hanging` (bo'lim MATNI `railMm` ga chekinadi, sarlavha chapda), `card`
(banner tarmog'i, ochiq fon), `centered` (`Draw.align`). Paritet testi
(`tests/viewer/resume-parity.test.mts`) 10 shablon × surat bor/yo'q uchun
matn tugunlari ketma-ketligini va `<img>` ⇔ `<w:drawing>` ni tekshiradi.

## 3. Hodisa: OOM VS Code'ni o'ldirdi — og'ir buyruqlar siyosati

Nima bo'ldi: lead `npm run test:ui` ni yurgizdi (node:test har faylni
alohida jarayonda, standart parallellik = yadro − 1 = 11 ta jsdom); shu
paytda ikki agent o'z worktree'ida chegarasiz `npm test` va `npx tsc`
yurgizdi. 14 GB xotira to'ldi, yadro OOM VS Code'ni o'ldirdi, sessiya va
ikkala agent uzildi (ish worktree'larda saqlanib qoldi). Ikkinchi omil:
`tests/ui/resume-viewer-edit.test.mts` da `assert.equal(<DOM element>, null)`
— muvaffaqiyatsizlikda `assert` diff uchun butun jsdom daraxtini
serializatsiya qiladi va bitta test 3 GB ni yeydi.

Chora (`scripts/heavy.sh`, `CLAUDE.md` «Og'ir buyruqlar», `.claude/structure.md`):
- har og'ir buyruq `scripts/heavy.sh [-m 3G] [-t 900] <buyruq>` orqali —
  `slaydx-heavy.slice` (jami 5 GB, lead + agentlar) + har buyruq o'z
  scope'ida (3 GB, `timeout -s KILL`); chegaradan oshsa faqat shu buyruq
  o'ladi (sinovda 1 GB shiftda 2 GB olgan jarayon exit 137, VS Code tegilmadi);
- `package.json` test skriptlari `--test-concurrency=2`;
- bitta test FAYLI yurgiziladi, to'liq to'plam faqat kommit oldidan, navbat bilan;
- jsdom da DOM tugunini `assert.equal(el, null)` bilan solishtirmaslik (`assert.ok(!el)`);
- agentlarga qoida prompt orqali ham beriladi (worktree'da `CLAUDE.md` yo'q — u git-ignored).

Natija: to'liq unit (1 098 ✅, 2 ta avvaldan ma'lum `.env.local` sababli),
ko'ruvchi (99) va UI (111) to'plamlari 4 GB shift ichida muammosiz o'tdi.

## 4. Bajarilish yozuvi

- `bfce483` — 10 shablon (DOCX + ko'ruvchi), probel nuqsoni, `scripts/heavy.sh`, `--test-concurrency=2`.
- `3508cb3` — siyosat `.claude/structure.md` da (agentlar uchun).
- `9d0d46f` — galereya ikki guruh (Suratsiz 4 / Suratli 6), «Suratli» tumbleri olib tashlandi; UI test + mutatsiya.
- `8911c70` — ko'ruvchi shablon tanlovi `optgroup`.
- `c513ae7` — qator/bo'lim sarlavhasi `keepNext` (jonli ru/`split` da ta'lim satri ikki betga bo'lingan edi); `live-engine --resume-template` + suratsiz/suratli tekshiruvi.
- `ba85b7e` — Agent A (5 kommit: ta'lim turi, daraja katalogi, faqat yil, `YearPicker`, sertifikat yili; 14 mutatsiya) birlashtirildi + lead ulanishi (`titlePrefix`, `field` yo'li, `emptyRow`).
- `c8b7647` — Agent B (8 kommit) birlashtirildi: kasblar 350 → 1 093, `scripts/fetch-professions.mts`, tekis indeks, 3 mutatsiya (alias indeksdan chiqarildi → qizardi; indeks har qidiruvda → tezlik testi qizardi; `‘` apostrof → qizardi).
- Yakuniy tekshiruv (`scripts/heavy.sh` ostida, navbat bilan): `tsc` 0, lint 0, unit **1 112** ✅ (2 ta avvaldan ma'lum `.env.local` holati), ko'ruvchi **99**, UI **119**.
- Chromium typeahead smoke (1 093 yozuv): «бухг» → Buxgalter · Ish haqi bo'yicha buxgalter…, «elektr» → Elektrik · Elektromexanik…, «sud» → Sud administratori…; brauzer xatolari 0.

Jonli sinov (haqiqiy Gemini, `scripts/heavy.sh` ostida): `--resume-template ats --photo …` → 13/13 (surat modelga TUSHMADI — suratsiz shablon); `--resume-template split --photo … --lang ru` → 13/13 (kvadrat surat, «Опыт работы · Образование», 2 bet — ko'zdan kechirildi, LibreOffice PNG); `--resume-template timeline` → 13/13, ta'lim satri `Bachelor’s degree, ` + `Finance and Credit` (model yo'nalishni tarjima qildi, daraja yorlig'i koddan, muassasa verbatim).

Chromium smoke (`scratchpad/pw/resume16.mjs`, admin cookie, dev server 3111): 15/15 — galereya 4 + 6 (suratsiz kartalarda `<img>` 0, suratlida 6), `timeline` tanlanadi va dialog yopiladi, ta'lim satrida tur almashganda «Yo'nalish»/«Daraja» yo'qoladi (maktab) va qaytadi (kollej — «Kichik mutaxassis | Malakali ishchi | Tugallanmagan o‘rta maxsus»), yil `<select>`, oy so'ralmaydi, sertifikat yili `<select>`, bandda probel va Enter saqlanadi, suratsiz shablon ogohlantirishi (adminda surat bor) ko'rinadi; brauzer xatolari 0.

## 5. Ochiq bandlar

- Kasb qidiruvida `nurse` so'rovi «Bog'cha mudiri» (nurs**e**ry) ni ham ichida-moslik bilan chiqaradi — eski reyting qoidasi (prefiks > so'z-prefiks > ichida), ataylab tegilmadi; kerak bo'lsa ichida-moslikni faqat ≥5 belgili so'rovga cheklash mumkin.
- Daraja katalogi yorliqlari (ordinatura → «Clinical residency», malakali-ishchi → «Vocational qualification») mahsulot egasi tasdig'ini kutadi.

- `letter` da «osilgan» yorliq DOCX'da chekinish bilan yasalgan (haqiqiy ikki ustunli yorliq jadval bilan bo'lardi, u holda bo'lim varaq chegarasida bo'linolmasdi) — Word'da sarlavha va matn bir xil satrda emas, ustma-ust; ko'ruvchi ham shunday.
- `portrait` va `ats` ikkalasi markazlashgan sarlavhali; farqi surat (portrait) va serif/caps (ats). Surat yuklanmagan portrait ATS'ga yaqin ko'rinadi — galereyada namunaviy surat bilan ko'rsatiladi.
- Eski hujjatlardagi `classic/minimal/creative` qiymatlari `doc_json` da qoladi va o'qishda ko'chiriladi; 019-o'xshash backfill kerak emas.
