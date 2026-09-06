# SlaydX — chuqur sifat auditi

**Sana:** 2026-09-05
**Obyekt:** `slaydx/` (14 vosita, yaratish oqimi, jonli ko‘ruvchi, DOCX/PPTX/PNG)
**Usul:** joriy kod qatlamma-qatlam o‘qildi (yozuvchi → darvoza → renderer → viewer → forma → narx → worker). Oldingi `docs/AUDIT.md` / `AUDIT-2.md` / `AUDIT-3.md` / `AUDIT-4.md` dagi yopilgan bandlar qayta sanalmadi; faqat **hozir ham amalda** bo‘lgan narsalar yozildi.
**Cheklov:** jonli Gemini/fal.eval ishlatilmadi — da’volar kod bilan tasdiqlangan. Hajm/so‘z raqamlari shu sababli taxminiy emas, **qoida** sifatida beriladi.

**Munosabat:** bu hisobot oldingi to‘rttasini (`AUDIT.md` … `AUDIT-4.md`) bekor qilmaydi — **davom ettiradi**. Sprint 0–9 da yopilgan band (slayd paket farqi, insho narxi, glossariy `termCount`, rezyume `tone`, DOCX profillar, rasm ZIP/`delivered` va h.k.) bu yerda qayta sanalmaydi.

---

## 1. 60 soniyalik xulosa

Loyiha va’dasi ikki qism: **turli toifadagi hujjat yaratish** va **shu saytda jonli ko‘rish**. Birinchisi arxitektura jihatidan tayyor (navbat, kredit, darvoza, refund). Ikkinchisi slayd va rasmda deyarli bajarilgan; akademik DOCX da esa foydalanuvchi **saytda ko‘rgan narsasini yuklab olmaydi**.

Uchta jumla:

1. **Poydevor professional.** Navbat, egalik, CSRF, zip-bomb, idempotent to‘lov, LLM yiqilsa shablon o‘rniga kredit qaytishi — bular ishlaydi. Ularga tegmaslik kerak.
2. **«Ko‘rdim = oldim» hali yopilmagan.** Slayd yagona `planSlide` dan chiziladi — bu to‘g‘ri naqsh. Maqola, dars rejasi, glossariy, keys, xarita esa saytda boshqa mahsulot, faylda boshqa mahsulot.
3. **Pul va’dasi ba’zi tariflarda hali yumshoq.** 16 slayd 14 tasi bilan yakunlanishi, 40 atama 28 tasi bilan yakunlanishi, 40–45 betlik kurs ishi default 300 s byudjetga siqilishi mumkin.

| Qatlam | Ball /10 | Izoh |
|---|---:|---|
| Navbat, kredit, auth | 9 | Sanoat darajasi |
| Yaratish formasi va validatsiya | 7 | Schema-driven yaxshi; custom 3 vositada server `missingRequired` yo‘q |
| Yozuvchi (janr farqi) | 7.5 | Promptlar ajratilgan; 5 akademik janr hali bitta `writeWriterWithLlm` |
| Sifat darvozasi | 8 | So‘z + sahifa + annotatsiya; lekin 70%/85% «yetarli» to‘liq pul oladi |
| **Jonli ko‘rish** | **6** | Slayd/rasm yaxshi; 5–6 vositada preview ≠ fayl |
| **Yuklab olinadigan fayl** | **7** | DOCX profillar (GOST/maqola/rezyume/albom) bor; keys/dars/glossariy janrga to‘liq mos emas |
| Test / eval | 7.5 | ~140+ unit test, eval 14 vosita; forma va max-tarif teshiklari qolgan |

**Yakuniy: ~7.2/10.** Ochilishga yaqin, lekin «saytda ko‘rish = topshirishga yaroqli fayl» hali mahsulot sharti sifatida bajarilmagan.

---

## 2. Yaratish oqimi — qanday ishlaydi

```
Forma  →  POST /api/generations  →  pul yechish + navbat (bitta TX)
              ↓
         Worker: buildArtifact(deadline)
              ↓
    slayd → PPTX     rasm → PNG/ZIP     qolgani → DOCX
              ↓
    GET /uz/files/{id}  →  ResultView polling  →  ArtifactViewer(gen.doc)
```

Muhim qoidalar (to‘g‘ri qurilgan):

- Klient yuborgan `price` e’tiborsiz; narx `priceFor` da serverda.
- LLM kaliti bor, lekin yozuvchi `null` qaytarsa — **shablon emas, xato + kredit qaytadi**.
- Hajm darvozasi (`LENGTH_GATED`): so‘zning 80% i + (LibreOffice bo‘lsa) renderlangan sahifaning 85% i.
- Annotatsiyasiz maqola/tezis — qat’iy darvoza.
- Rasm kam chiqsa — `delivered` + qisman qaytarish.

Bu oqimning o‘zi mahsulotning eng kuchli qismi.

---

## 3. Jonli ko‘rish — asosiy tushuncha

Saytdagi ko‘rinish **saqlangan HTML emas**. `ArtifactViewer` avvalo `gen.doc` (JSON model) ni o‘qiydi, 11 xil ko‘ruvchiga yo‘naltiradi.

| Vosita | Ko‘ruvchi | Yuklab olinadigan fayl |
|---|---|---|
| Slayd | `SlideViewer` + `SlideCanvas` | PPTX (`planSlide` — preview bilan **bir xil manba**) |
| Rasm | `ImageViewer` | PNG yoki ZIP |
| Kurs ishi / referat / tezis / mustaqil ish | `WordViewer` academic | GOST DOCX |
| Maqola | `WordViewer` article | Jurnal titul + GOST tanasi |
| Insho | `WordViewer` essay | GOST + rangli ramka |
| Tarjima | `WordViewer` translation | GOST tanasi, titulsiz |
| Rezyume | `ResumeViewer` | 2 ustunli DOCX jadval |
| Glossariy | `GlossaryViewer` | `reference` profil |
| Keys | `KeysViewer` | **GOST** (reference emas) |
| Texnologik xarita | `TableViewer` landscape | Albom DOCX |
| Dars rejasi | `LessonViewer` **portret** | Albom DOCX |

Slayd — loyihadagi yagona joyda preview = eksport qasddan bir xil. Qolgan maxsus ko‘ruvchilar **sayt brendi**, fayl esa **Word/GOST**.

---

## 4. 14 xizmat — yaratish, sifat, ko‘rish

Har vosita: oqim → nima ishlaydi → nima buzilgan. Ball: yaratish / fayl / jonli ko‘rish.

### 4.1. Slayd — 8.5 / 8 / 9

**Yaratish:** mavzu yoki fayl → sifat paketi (10/14/12/16) → auditoriya, shablon, tema, titul slaydi. Narx paketi endi haqiqiy: hajm `targetPages`, rasm `premiumVisuals` (4 vs 8 qadam).

**Fayl:** `planSlide` → PPTX, `shrinkText: false` (PowerPoint shriftni qayta kichraytirmaydi). Speaker notes bor. `table` layout endi enumda.

**Kamchiliklar:**

- Paket «16 slayd» deb yoziladi, qabul qilish chegarasi **0.85** (`slide-write.ts:478`). 14 ta bilan ham `COMPLETED`, qisman qaytarish **yo‘q** (`delivered` faqat rasmda).
- `FAL_KEY` bo‘lmasa ham ish tugaydi — rasmsiz, to‘liq pul.
- `FAL_MODEL_PREMIUM` bo‘sh bo‘lsa premium ham `flux/schnell`, faqat qadam ko‘proq.
- `twoCol` / `compare` / `stats` / `process` / `table` hech qachon rasm olmaydi.
- Byudjet **barcha paketga 180 s** — premium uzun + Flux siqiladi.

### 4.2. Rasm — 7 / 8 / 8.5

**Yaratish:** prompt, 8 uslub, 6 nisbat, 1/2/4 dona. Narx 2k / 3.5k / 6k.

**Fayl:** 1 ta → xom PNG/JPEG; 2–4 → ZIP. Kam chiqsa `refundPartial`.

**Kamchiliklar:**

- Server `missingRequired` promptni **tekshirmaydi** — bo‘sh so‘rov pul yechadi, keyin refund.
- `buildImageArtifact` **deadline olmaydi**; 4 ta rasm 2×45 s ≈ 90 s, zaxira yo‘q.
- Ko‘ruvchida `doc.images` URL saqlanishi mumkin, ZIP esa bayt olinmaganini tashlaydi — saytda ko‘rinib, arxivda yo‘qolishi mumkin.
- Natija sahifasida ZIP uchun ham PDF tugmasi chiqadi; server 400 qaytaradi (`ResultView` `format !== "png"`).
- Qisman qaytarish `COMPLETED` da jim — sarlavhada to‘liq narx qoladi.

### 4.3. Kurs ishi — 8 / 7.5 / 7

**Yaratish:** OTME maydonlari, vazirlik, AI/qo‘lda mundarija (bepul `/api/outline`), 10–45 bet, jadval ha/yo‘q. Narx 12k–24k.

**Yozuvchi:** `courseworkSystemPrompt` (tadqiqot savoli, 3 bob, O‘zbekiston misoli) + umumiy `writeWriterWithLlm`. Hajm endi bob/ostmavzu **soni** orqali: ≥23 bet → 4×4, ≥33 → 5×4.

**Kamchiliklar:**

- Prompt **«uch bob»** deb qolgan, dvigatel 4–5 bob so‘raydi — modelga zid ko‘rsatma.
- Default `WORKER_JOB_TIMEOUT_MS = 300 s`. 40–45 bet hisobi ~477 s, lekin **cap 300 s**. Testlar buni 900 s cap bilan yashiradi. Eng qimmat SKU (24 000 tanga) hali ham eng xavfli.
- Jadval talabi **yumshoq** — `images=yes` bo‘lsa ham jadvalsiz `COMPLETED`.
- **Fayl asosida** rejimi yo‘q (referat/mustaqil ishda bor).
- Ko‘ruvchida imzo chizig‘i va «TEKSHIRILMAGAN manba» izohi yo‘q; DOCX da bor.
- `h2` saytda chapda, DOCX da markazda.

### 4.4. Referat — 7.5 / 7 / 7

Kurs ishi bilan **bitta yozuvchi**, boshqa prompt (adabiyot sharhi). Fayl rejimi bor. Narx mustaqil ish bilan **bir xil** (3–6k).

**Kamchiliklar:**

- UI: «Tadqiqot ishlarini yarating» — prompt esa «YANGI tadqiqot emas».
- `tocMethod` yo‘q — bepul reja tahriri yo‘q.
- `images` maydoni yo‘q, lekin `includeVisuals` default `true` — jim jadval so‘raladi.
- Tuzilma darvozasi yo‘q (kurs ishidagi tadqiqot savoli/jadval bu yerda shart emas — to‘g‘ri, lekin referat = qisqa kurs ishi xavfi qoladi).

### 4.5. Insho — 7 / 7.5 / 7.5

**Yaratish:** 1–5 varaq, narx endi varaqqa bog‘liq (2k–4k), dizayn ramkasi preview va DOCX da.

**Kamchilik:** `writeEssayInChunks(meta, sys, L, n, …)` dagi **`n` ishlatilmaydi**. 3, 4 va 5 varaq — bir xil 5 ish (kirish + 3 burchak + xulosa). Hajm faqat 80% so‘z darvozasiga tayanadi; 5 varaq uchun 4 000 tanga «chuqurroq yozuvchi» emas.

Forma default `pages: "2"` → 2 500 tanga; `priceFor` `pages` yo‘q bo‘lsa 2 000. To‘g‘ridan-to‘g‘ri API chalkashligi.

Titul hali **universitet GOST** — maktab inshosi uchun vazirlik sarlavhasi g‘alati. Saytda «Badiiy-ilmiy insho» lenti DOCX da yo‘q.

### 4.6. Maqola — 8 / 7 / **5** (preview eng yomon)

**Yaratish:** standart / IMRAD, annotatsiya tillari (UZ+EN+RU endi ishlaydi), 3–15 bet, muallif/tashkilot/email.

**Standart yo‘l:** bob raqamisiz jurnal uslubi, annotatsiya qat’iy.
**IMRAD:** betga bog‘liq ulushlar (20/15/35/30), chuqurlashtirish.

**Kritik preview ≠ fayl:**

- Sayt titul: vazirlik + universitet + fakultet + «Bajardi/Rahbar» + o‘quv yili (`WordViewer` `TitlePage` — **bitta GOST shablon**).
- DOCX titul: jurnal bloki — muallif, daraja, tashkilot, email, shahar–yil. Vazirlik yo‘q.

Foydalanuvchi jurnal maqolasini saytda **talaba ishi** deb ko‘radi.

**Yozuvchi xatosi:** IMRAD annotatsiya bo‘sh kelsa **bir jumlalik stub** qo‘yiladi (`write-specials.ts:938–946`) — qat’iy darvoza hech qachon ishlamaydi. Standart maqolada bunday stub yo‘q.

`pages` yuborilmasa: narx 3–5 bet (4 000), `extractMeta` esa `"10-15"` fallback — API orqali arzon narxga uzun ish.

### 4.7. Tezis — 7.5 / 7 / 6.5

Maqola bilan bir xil vilka (standart / IMRAD). Titul **GOST talaba ishi** (to‘g‘riroq, lekin IMRAD konferensiya tezisi uchun og‘ir).

Prompt «3–5 qisqa bo‘lim»; 20–25 bet tanlansa `outlineShape` 4×4 bob. Uzun tarif promptga zid.

### 4.8. Rezyume — 8 / 8 / 7.5

**Yaratish:** 5 qadamli sehrgar. `tone` endi promptga tushadi. Uydirma ish joyi tashlanadi, uydirma yil o‘chiriladi.

**Fayl:** 72 mm qora yon panel + asosiy ustun — ko‘ruvchi bilan bir xil g‘oya (`resumeBody`).

**Qolgan farq:**

- Ko‘ruvchi **1 sahifaga qirqiladi** (`overflow-hidden`); DOCX uzun CV ni 2-sahifaga cho‘zadi.
- Ko‘ruvchi sarlavhalari o‘zbekcha qattiq («Qisqacha»); DOCX `sectionLabels(language)` dan.
- Til tanlash yo‘q — default `uz`.
- Server `fullName`/`targetRole` ni majburiy demaydi.
- Narx har qadamda ko‘rinadi («Davom etish» ham pullidek).

### 4.9. Tarjima — 7.5 / 8 / 7.5

Bo‘laklab tarjima, yo‘qolgan bo‘lak = to‘liq fail + refund. Info bloki endi maqsad tilida. Sarlavha takrori olib tashlangan.

**Kamchiliklar:**

- Forma 48 000 cheklovni ko‘rsatmaydi; `preflightError` klientda chaqirilmaydi.
- Narx uzunlikdan qat’i nazar 3 000 (8 belgi ham, 48k ham).
- Server `sourceText` ni `missingRequired` da so‘ramaydi (`fields: []`, `modes` yo‘q).
- 15 bo‘lakdan oshsa **pul yechilgandan keyin** yiqiladi.
- Ko‘ruvchida yashil «TARJIMA» lenti faylda yo‘q. Tana GOST (TNR 14, 1.25 sm abzas) — xat/slayd tarjimasi uchun og‘ir, lekin preview va fayl **shu tanlovda mos**.

### 4.10. Texnologik xarita — 7 / 7.5 / 6

Yillik kalendar-tematik reja (nomi metodikada «bitta dars xaritasi» emas — mahsulot chalkashligi). Takror mavzu tashlanadi; soat yig‘indisi `totalHours` ga tenglashtiriladi; albom + og‘irlikli ustunlar (Mavzu 33%).

**Kamchiliklar:**

- 70% noyob hafta yetarli — 34 so‘ralib 24 tasi bilan to‘liq pul.
- Sayt: binafsha muqova + teng ustunlar. Fayl: GOST titul + og‘irlikli jadval.
- `weeklyHours: 0` serverda o‘tadi (`"0"` to‘ldirilgan hisoblanadi).
- `extra` maydoni ikki marta bog‘langan (schema `extra` + umumiy textarea).

### 4.11. Glossariy — 8 / 8 / **5.5**

`termCount` 10/20/40, narx 6/9/15k, alifbo tartibi, takror jadval **o‘chirilgan**.

**Kamchiliklar:**

- 70% yetarli: 40 ta uchun 15 000 to‘lab 28 ta olish mumkin, qisman qaytarish yo‘q.
- Sayt: pushti kartochkalar, GOST titulsiz. Fayl: vazirlik tituli + chap sarlavha + oddiy h3/p. **Ikki mahsulot.**
- Eval faqat 10 atamani sinaydi — 15k SKU qamrovda yo‘q.

### 4.12. Keys — 7 / 6 / 6

5 keys, rubrika ballari 10 ga normalizatsiya. Ikkinchi urinish bor.

**Kamchiliklar:**

- Hajm/narx tanlovi yo‘q — doim 6 000.
- Qayta urinish **birinchi partiyani o‘chiradi** — yomonroq javob yaxshisini yutishi mumkin.
- Fayl: GOST titul + **mundarija** (o‘qituvchi kaliti uchun g‘alati). Forma universitet/muallif yig‘maydi — titul deyarli bo‘sh.
- Sayt: sariq kartochkalar, mundarijasiz.

### 4.13. Mustaqil ish — 7.5 / 7 / 7

Referat narxi, lekin prompt «o‘z bajargan amaliy bob» so‘raydi. To‘ldiruvchi bob amaliy bobdan **oldin** qo‘yiladi.

**Kamchilik:** `ownTask` **faqat ogohlantirish** — sof nazariy ish ham `COMPLETED`. Fayl rejimi bor, eval uni sinamaydi.

### 4.14. Dars rejasi — 7.5 / 7 / **5**

Daqiqalar yig‘indisi `duration` ga moslanadi. `extra` endi promptga tushadi. Vaqt jadvali `map` dan keyin (langar).

**Kritik preview ≠ fayl:**

- Sayt: **portret A4**, zumrad sarlavha (Fan/Sinf/Daqiqa).
- Fayl: **albom GOST titul** + pasport + xarita + jadval.

Bosqich matni **ikki marta**: uzun `activity` (700 belgi) va jadvalda 120 belgigacha kesilgan nusxa — preview ham, DOCX ham.

90 daqiqa = 30 daqiqa narxi (4 000).

---

## 5. Fayl sifati — janr bo‘yicha

`docx-profile.ts` AUDIT-3 dagi asosiy tuzatishni amalga oshirgan. Hozir 6 profil:

| Profil | Kimga | Tipografiya |
|---|---|---|
| `gost` | kurs, referat, tezis, mustaqil, **keys**, tarjima | TNR 14, 1.5, 3 sm chap, titul + imzo |
| `article` | maqola | GOST tana + jurnal titul |
| `essay` | insho | GOST + `design` ramka |
| `resume` | rezyume | Calibri 10.5, 2 ustun |
| `landscape` | xarita, **dars** | albom, langarli jadval |
| `reference` | glossariy | chap sarlavha, justify yo‘q |

**Yaxshi:** OTME ishi Word da topshirishga yaroqli ko‘rinadi (titul, mundarija maydoni, imzo, 1.25 sm abzas). Rezyume endi referat emas. Xarita albomda o‘qiladi.

**Hali zaif:**

1. **Adabiyotlar GOST 7.1 emas.** `isReferenceLine` ISBN/DOI/jurnal tomini **ataylab rad etadi** — soxta manbadan himoya. Natija: «Muallif. Nom. – Shahar: Nashriyot, yil» + qizil «TEKSHIRILMAGAN». O‘qituvchi uchun halol, lekin «ilmiy apparat» emas. Matn ichida `[n]` bor, lekin ro‘yxat qisqa bo‘lsa iqtibos berilmaydi.
2. **Akademik DOCX da rasm yo‘q** — «jadval» maydoni faqat jadval. Bu endi yorliqda ochiq.
3. **`toUpperCase()`** sarlavha/kickerda (`render-docx.ts:122`, slayd kicker). Oʻ/Gʻ buzilishi xavfi (AUDIT Slide Law 9).
4. **Keys** `reference` profilida emas, `gost` da — o‘qituvchi kaliti talaba kurs ishi qolipida.
5. **Tarjima** ham GOST — tarjima mahsuloti emas, akademik ish.

PPTX: preview bilan eng yaqin. Qolgan xavf — CSS `lineHeight` vs PowerPoint qutisi, subpixel wrap.

---

## 6. «Saytda ko‘rish» — va’da bajarilganmi?

Mahsulot sharti: foydalanuvchi yaratganini **saytda jonli** ko‘rsin.

| Holat | Vositalar |
|---|---|
| Ha — bir xil maket | Slayd (deyarli), rasm (ko‘p holda) |
| Yaqin — bir xil model, boshqa bezak | Kurs/referat/tezis/mustaqil/insho (GOST varaq, lekin imzo/izoh/h2 farqi) |
| Yo‘q — boshqa mahsulot | **Maqola titul**, **dars orientatsiyasi**, glossariy kartochka vs Word, keys kartochka vs GOST, xarita muqova vs GOST |

Qo‘shimcha UX:

- Yaratish paytida sahifa yopilsa ish davom etadi — to‘g‘ri.
- `IN_PROGRESS` ni bekor qilib bo‘lmaydi; natija sahifasida QUEUED ni ham bekor qilish tugmasi yo‘q.
- Progress 95% gacha asimptotik — haqiqiy bosqich emas.
- `createdLabel` hech qayerda chizilmaydi.
- CreateGrid: «bir necha **soniyada**» — 20–45 betlik ish daqiqalar.

---

## 7. Ustuvor nuqsonlar (hozirgi kod)

### P0 — pul yoki «ko‘rdim ≠ oldim»

| ID | Muammo | Joy |
|---|---|---|
| P0-1 | Default 300 s cap 40–45 betlik kurs ishini (~420 s) siqadi | `env.ts:159`, `budget.ts:48` |
| P0-2 | Maqola saytda talaba tituli, faylda jurnal tituli | `WordViewer.tsx:203–235` vs `render-docx.ts:384–405` |
| P0-3 | Dars rejasi saytda portret, faylda albom | `LessonViewer.tsx` vs `docx-profile.ts:199–201` |
| P0-4 | IMRAD bo‘sh annotatsiyaga stub qo‘yadi — darvoza o‘tmaydi | `write-specials.ts:938–946` |
| P0-5 | Rasm/rezyume/tarjima serverda majburiy maydonsiz — pul → fail → refund | `tools.ts:missingRequired` |

### P1 — va’da yumshoq yoki janr buziladi

| ID | Muammo |
|---|---|
| P1-1 | Slayd 85% floor, qisman qaytarish yo‘q (16→14 to‘liq 8 000) |
| P1-2 | Glossariy/xarita 70% floor, to‘liq pul |
| P1-3 | Insho 3–5 varaq bir xil chunk yozuvchi (`n` o‘lik) |
| P1-4 | Mustaqil ish `ownTask` yumshoq |
| P1-5 | Glossariy/keys/xarita/dars: sayt brend-muqova, fayl GOST titul |
| P1-6 | `referencesNote` ko‘ruvchida yo‘q (`flow.ts`) |
| P1-7 | Maqola/tezis `pages` fallback ≠ narx fallback |
| P1-8 | Tarjima formasida 48k ogohlantirish yo‘q |
| P1-9 | ZIP rasmda PDF tugmasi |
| P1-10 | Kurs ishi prompti «3 bob», dvigatel 4–5 |
| P1-11 | Referat UI «tadqiqot», yozuvchi «adabiyot sharhi» |
| P1-12 | Premium slayd rasmsiz ham COMPLETE |

### P2 — UX va qarz

- Duplicate `extra` / `tocMethod` UI
- Rezyume 1 sahifaga qirqiladi
- Rezyume narxi har qadamda
- CreateGrid `basePrice` vs forma defaulti
- `toUpperCase` Oʻ/Gʻ
- Keys retry overwrite
- Yozuvchi `<3` bo‘limda refs/annotatsiya/top-up siz qaytadi
- Eval: fayl-rejim, glossariy-40, insho-5, rasm-4 yo‘q
- Coursework da fayl rejimi yo‘q

---

## 8. Allaqachon yopilgan (qayta ochmang)

Oldingi auditlarning katta qismi kodda yopilgan. Qayta ishlash — regressiya.

- Slayd paket farqi (10/14/12/16) va speaker notes
- Insho narxi varaqqa bog‘langan
- Glossariy `termCount` + narx
- Rezyume `tone`
- Dars `extra`
- Annotatsiya tillari (standart maqola/tezis)
- Rasm ZIP + `delivered` + MIME kengaytmasi
- DOCX profillar (rezyume 2 ustun, xarita albom, glossariy reference)
- Glossariy takror jadval o‘chirilgan
- Manba 24k ogohlantirishi (`SourceFileField`)
- Hajm/sahifa darvozasi, LLM fail → refund
- Rubrika 10, daqiqa yig‘indisi, xarita soat invarianti
- `table` slide layout enumda

---

## 9. Nima qilish kerak (tartib)

**1-hafta — rostgo‘ylik**

1. `WORKER_JOB_TIMEOUT_MS` defaultini kamida **480–600 s** qiling yoki cap ni `budgetFor` dan keyin emas, operator «favqulodda tormoz» qilib qoldiring. 24 000 tangalik SKU 300 s da yiqilishi — ochilish bloker.
2. IMRAD stub annotatsiyani olib tashlang — bo‘sh bo‘lsa qat’iy darvoza ishlasin.
3. `missingRequired` ga image prompt, resume ism/lavozim, translation `sourceText` qo‘shing.
4. Maqola `TitlePage` ni `profileFor` dagi `article` tituli bilan chizing.
5. `LessonViewer` ni `TableViewer` kabi `LANDSCAPE` qiling.

**2-hafta — preview = fayl**

6. Glossariy/keys/xarita/dars: yo GOST titulni ko‘ruvchiga qo‘shing, yo bu janrlarda `titlePage: false` (o‘qituvchi vositalari uchun ikkinchisi to‘g‘riroq).
7. `docToFlow` ga `referencesNote` va jadval `anchor`.
8. Keys uchun `reference` profil (AUDIT-3 rejasidagi kabi) — GOST talaba tituli emas.
9. ResultView PDF tugmasini faqat `docx`/`pptx` da ko‘rsating; qisman qaytarishni UI da yozing.

**3-hafta — tarif halolligi**

10. Slayd/glossariy/xarita floor ni `delivered` + `refundPartial` ga ulang — yoki floor ni 1.0 qiling.
11. `writeEssayInChunks` da `n` ni ishlating (5 varaq = ko‘proq burchak yoki min paragraf).
12. `ownTask` ni qat’iy qiling yoki UI da «kafolatlanmaydi» deb yozing.
13. Coursework promptidagi «uch bob» ni `outlineShape` ga moslang.

---

## 10. Xizmatlar yig‘indasi

| Vosita | Yaratish | Fayl | Jonli ko‘rish | Ochilishga |
|---|---:|---:|---:|---|
| Slayd | 8.5 | 8 | 9 | Ha, 85% floor tuzatilsa |
| Rasm | 7 | 8 | 8.5 | Ha, validatsiya + ZIP/PDF |
| Kurs ishi | 8 | 7.5 | 7 | 300 s cap tuzatilmasa yo‘q |
| Referat | 7.5 | 7 | 7 | Ha |
| Insho | 7 | 7.5 | 7.5 | Ha |
| Maqola | 8 | 7 | **5** | Titul moslashtirilmasa yo‘q |
| Tezis | 7.5 | 7 | 6.5 | Ha |
| Rezyume | 8 | 8 | 7.5 | Ha |
| Tarjima | 7.5 | 8 | 7.5 | Ha |
| Xarita | 7 | 7.5 | 6 | Ko‘rish tuzatilsa |
| Glossariy | 8 | 8 | **5.5** | Ko‘rish tuzatilsa |
| Keys | 7 | 6 | 6 | Profil + preview |
| Mustaqil ish | 7.5 | 7 | 7 | `ownTask` ochiq bo‘lsin |
| Dars rejasi | 7.5 | 7 | **5** | Orientatsiya tuzatilmasa yo‘q |

**Xulosa:** foydalanuvchi 14 toifada hujjat **yarata oladi**, navbat va pul mexanikasi ishonchli. «Saytda jonli ko‘rish» slayd/rasm/akademik matnning **mazmuni** uchun ishlaydi, lekin maqola, dars, glossariy va keys da ko‘rinish **boshqa hujjat**. Ochilishdan oldin P0-1…P0-5 ni yopish — qolgani sprint rejasiga tushadi.

---

# 11. Bajarilgan ish (2026-09-06, Sprint 15)

**Yakuniy holat: 234 test / 0 fail / 0 skip; typecheck, lint va build toza.**
Sprint 14 boshida 200 test edi, Sprint 15 oxirida 234.

## 11.1. Avval: hisobotni qayta bazalash

AUDIT-5 Sprint 14 dan **oldingi** koddan yozilgan. Har bir P0/P1 da'vosi
hozirgi kod bilan solishtirildi:

| Da'vo | Holat |
|---|---|
| **P0-1** 300 s cap — «ochilish bloker» | Sprint 14 (N-3) da yopilgan. `DEFAULT_JOB_TIMEOUT_MS = 480_000`; byudjetlar 207→477 s, hammasi alohida |
| §4.1 «slayd byudjeti barcha paketga 180 s» | Sprint 14 (N-2) da yopilgan |
| **P1-8** tarjima 48k ogohlantirishi | Sprint 14 (N-5) da yopilgan |
| **P2** rezyume narxi har qadamda | Sprint 14 (N-12) da yopilgan |
| **P2** duplicate `tocMethod` | Sprint 14 (N-4) da yopilgan |
| «~140+ unit test» | Aslida 200 edi, hozir 234 |

**Bitta da'vo noto'g'ri.** P2 dagi «`toUpperCase` Oʻ/Gʻ buzilishi xavfi»
empirik tekshirildi:

```
oʻzbek gʻalaba o‘quv  →  OʻZBEK GʻALABA O‘QUV
```

`ʻ` (U+02BB) modifikator harfi, `toUpperCase` unga tegmaydi. Soxta
ijobiy — bu bandga vaqt sarflanmadi.

## 11.2. Yopilgan bandlar

| ID | Nuqson | Commit | Mutatsiya |
|---|---|---|---|
| P0-4 | IMRAD stub annotatsiya darvozani yolg'onga chiqarardi | `eb121ae` | 2/2 |
| P0-5 | `image`/`resume`/`translation` serverda tekshirilmasdi | `eb121ae` | 2/2 |
| P0-2 | Maqola saytda talaba tituli, faylda jurnal tituli | `66641ec` | 2/2 |
| P0-3 | Dars rejasi saytda portret, faylda albom | `66641ec` | 1/1 |
| P1-7 | `pages` standarti narx va dvigatelda ajralib ketgan | `388b4d3` | 2/2 |
| P1-10 | Kurs ishi prompti «uch bob», dvigatel 4–5 | `388b4d3` | 1/1 |
| P1-3 | `writeEssayInChunks` da `n` o'lik | `388b4d3` | 1/1 |
| P1-1 | Slayd 0.85 floor, qisman qaytarish yo'q | `6187a73` | 2/2 |
| P1-2 | Glossariy/xarita 70% floor, to'liq pul | `6187a73` | 2/2 |
| P1-9 | ZIP rasmda PDF tugmasi | `44c68d1` | — |
| P1-6 | `referencesNote` ko'ruvchida yo'q | `44c68d1` | 2/2 |
| §4.10 | `weeklyHours: 0` serverdan o'tardi | `44c68d1` | 1/1 |
| P1-11 | Referat UI «tadqiqot», yozuvchi «adabiyot sharhi» | `fb463f0` | — |
| §5.3 | Akademik sarlavha Word uslubida (LibreOffice da KO'K) | `fb463f0` | 1/1 |

**19 mutatsiya, 19 tasi ushlandi.**

## 11.3. Asosiy tuzatishlarning mohiyati

**Titul modeli yagona manbaga aylandi.** `render-docx` `profileFor()` ga
qarab ikki xil titul chizar, sayt ko'ruvchisi esa uchinchi, har doim GOST
qolipini chizardi. Endi `lib/generation/title-model.ts`
(`toc-model.ts` naqshi) diskriminatsiyalangan tur beradi va ikkala
renderer ham AYNAN shuni chizadi — yangi titul turi qo'shilsa TypeScript
ikkalasini ham majburlaydi.

**Dars rejasi profili ajratildi.** U texnologik xarita bilan bitta
`landscape` profilda edi, lekin albomning O'Z asoslanishi faqat xaritaga
tegishli (6 ustun). Dars jadvali 4 ustunli, asosiysi esa bosqichlar
nasri — albomda u ~26 sm satrda, o'qib bo'lmaydigan uzunlikda chiqardi.
Bu yerda **fayl** noto'g'ri edi, ko'ruvchi to'g'ri.

**Insho chuqurligi richagi almashtirildi.** `n` ni paragraf soniga emas,
BURCHAK soniga bog'ladik: modeldan ko'p paragraf so'ralganda u ulushini
beradi, yangi burchak esa unga yangi savol beradi. 3/4/5 varaq →
3/4/5 burchak. Uzun insho «ko'proq gap» emas, «ko'proq qirra».

**`delivered` naqshi uch vositaga yoyildi.** Floor va va'da — ikki xil
savol: floordan past → xato + to'liq qaytarish; floor va va'da orasida →
yetkaziladi + FARQ qaytariladi. Rasm vositasi buni ishlatib turgan edi.

## 11.4. Jonli tekshiruv (`npm run live`)

AUDIT-4 §10.5 da «ataylab qilinmagan» deb qoldirilgan jonli sinov shu
sprintda yozildi va o'tkazildi. `scripts/live-engine.mts` `buildArtifact`
ni to'g'ridan-to'g'ri chaqiradi — server, sessiya va navbatsiz.

Birinchi tur, `gemini-3.7-flash`, **5/5 keys**:

| Keys | Vaqt | Natija |
|---|---:|---|
| `imrad` | 14.6 s | Annotatsiya 700 belgi, **stub emas** — P0-4 tasdiqlandi |
| `essay` | 13.0 s | 5 burchak, 1317 so'z, 6 renderlangan bet — P1-3 tasdiqlandi |
| `coursework` | 42.9 s | **4 bob** (prompt bilan mos), 13 ostmavzu, 4903 so'z, **20 bet** |
| `glossary` | 8.1 s | 20/20 atama, alifbo tartibida |
| `lesson` | 5.7 s | Daqiqalar yig'indisi **aynan 45** |

Kutilmagan natija: kurs ishi 42.9 soniyada tugadi — AUDIT-5 qo'rqqan
~420 s emas. Ya'ni N-3 dagi byudjet oshirilishi **zaxira** beradi, lekin
bu model tezligida shift bo'g'iq nuqta emas edi. Byudjet baribir to'g'ri:
sekinroq model yoki yuk ostida u yagona himoya.

**Chiqishlar ko'z bilan ko'rildi.** DOCX → PDF → PNG. Shunda uchta
auditda ochiq qolgan nuqson tasdiqlandi: akademik sarlavhalar
LibreOffice da KO'K chiqardi. `GOST_HEADING` ga `color: "000000"`
qo'shildi va qayta render bilan tekshirildi.

## 11.5. Ataylab qoldirilgan

- **P1-4 `ownTask` yumshoq** — AUDIT-3 §17.4 dagi qaror o'z kuchida:
  aniqlash evristik, jonli statistika yig'ilmaguncha darvoza
  foydalanuvchidan pul emas, ishonch olardi.
- ~~P1-5~~ — **yopildi** (`208f4c8`), pastdagi §11.6 ga qarang.
- **P1-12 premium slayd rasmsiz** — sababi (byudjet) Sprint 14 N-2 da
  tuzatildi. Rasm SONI bo'yicha qaytarish kiritilmadi: u yorliqda va'da
  qilinmagan miqdor.
- **P2 qolgan bandlar** — duplicate `extra` maydoni, rezyume ko'ruvchisi
  1 sahifaga qirqilishi, keys qayta urinishi birinchi partiyani
  o'chirishi, kurs ishida fayl rejimi yo'qligi, eval qamrovidagi
  bo'shliqlar.

## 11.6. P1-5 — titul: bitta emas, uch qismli nuqson

Dastlab bu «mahsulot qarori» deb qoldirilgan edi. Renderlangan titul
ko'z bilan ko'rilgach ma'lum bo'ldiki, qaror talab qiladigan qismi
YO'Q — uch qismning uchalasi ham aniq nuqson:

**1. Forma muassasa nomini so'ramasdi.** To'rttala o'qituvchi vositasi
ham DOCX titulini chizardi, lekin `fields` da `university` yo'q edi.
Qiymat profildan JIM kelardi, profil maydonining yorlig'i esa «Oliy
ta'lim muassasasi» — maktab o'qituvchisi u yerga o'z maktabini yozmaydi.
Ya'ni amalda titulda bu qator **bo'sh qolardi**, va foydalanuvchi uni
to'ldirishning hech qanday yo'li yo'q edi.

**2. Titulda «Bajardi» turardi.** Bu talaba tili: talaba topshiriqni
bajaradi. O'qituvchi esa dars ishlanmasini yoki texnologik xaritani
TUZADI. `docLabels` ga `compiledBy` qo'shildi va `titleModel` janrga
qarab tanlaydi — yorliq MODELDA hisoblanadi, chizuvchida emas.

**3. Ko'ruvchi titulni umuman chizmasdi.** `TitlePage` `WordViewer` dan
umumiy komponentga chiqarildi; `TitleSheet` endi to'rttala o'qituvchi
ko'ruvchisida birinchi varaq.

Natija ko'z bilan tekshirildi (PNG): vazirlik sarlavhasi → maktab nomi →
DARS REJASI → «mavzu» → «Tuzuvchi: …» + imzo chizig'i → o'quv yili →
shahar–yil. Sayt va fayl bir xil.

**Saboq:** «bu mahsulot qarori» degan xulosa erta edi. Chiqishni
renderlab ko'rmaguncha, nuqsonning nechta qismdan iboratligini bilib
bo'lmaydi.
