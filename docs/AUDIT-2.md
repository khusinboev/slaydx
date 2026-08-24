# SlaydX — 2-audit: tashqi tahlillar sintezi va keyingi mustahkamlash rejasi

**Sana:** 2026-08-24
**Muallif:** Claude (Sonnet 5) — `../tashqi tahlillar/` papkasidagi 6 ta yangi AI hisobotining meta-tahlili + har bir muhim da'voni joriy kodga (`slaydx@main`) nisbatan shaxsan tekshirish
**Munosabat:** bu hisobot `docs/AUDIT.md` (2026-08-19/20) ni bekor qilmaydi — **davom ettiradi**. Sprint 0–4 va 2026-08-20 dagi mustaqil qayta auditda yopilgan band (P0-1…P0-8, P1-1…P1-22) bu yerda qayta sanalmaydi; men ularning katta qismini joriy koddan hali ham tasdiqladim (pastda §1). Bu hujjat faqat **shundan keyin ham qolgan yoki yangi topilgan** narsalarga bag'ishlangan.

---

## 0. Bu hisobot qanday tayyorlandi

1. `tashqi tahlillar/` papkasidagi 6 ta faylning barchasi o'qildi: `deepseek.txt`, `gemini.txt`, `z-ai.txt`, `slaydx_audit_report_diff.md`, `SlaydX_chuqur_servis_tahlili_hisobot.docx`, `slaydx_14_xizmat_chuqur_audit_hisoboti.html`, va `4YBlnzgku48UeKzM-grok-workspace.zip` (bu — Grok tomonidan qurilgan **interaktiv hisobot ilovasi**; asosiy tahlil matni uning `src/lib/report-services.ts` va `report-overview.ts` fayllarida — 14 xizmatning har biri uchun ball, topilma va tavsiya).
2. Har bir manba `docs/AUDIT.md` dagi uslub bilan ishonchlilik bo'yicha baholandi (§1).
3. Manbalar orasida **kelishilgan** 8 ta aniq da'vo tanlab olinib, joriy `lib/generation/` va `lib/tools.ts` kodida **shaxsan grep/read qilindi**. Barcha 8 tasi kod bilan **to'liq tasdiqlandi** (pastga qarang) — bu qolgan, tekshirilmagan da'volarga ham nisbatan yuqori ishonch beradi, chunki ular ham xuddi shu kod bazasidan olingan.
4. `npm audit --omit=dev` qayta ishga tushirildi — holat `AUDIT.md §17` dagi bilan **bir xil** (5 ta high, ataylab kechiktirilgan).

---

## 1. Manbalar va ishonchlilik reytingi

| Manba | Format | Repo bilan bog'liqligi | Ishonchlilik | Izoh |
|---|---|---|---|---|
| `deepseek.txt` | umumiy audit shabloni | ❌ Hisobotning o'zi tan oladi: *"GitHub'ga to'g'ridan-to'g'ri ulanish imkoniyati bo'lmagani uchun... professional audit andozasi asosida tuzildi"* | **Past** | SlaydX ga emas, umumiy "taqdimot/dizayn agentligi" saytiga mo'ljallangan generic tavsiyalar (portfolio filtri, "brend audit" lead-magnit va h.k.). Bitta ham fayl nomi yo'q. Xizmat nomlari ("Motion-dizayn", "Print materiallari") loyihada **umuman mavjud emas** — bu boshqa turdagi biznes uchun yozilgan hisobot. **E'tiborga olinmaydi.** |
| `z-ai.txt` | umumiy mikroservis maslahati | ❌ Fayl nomi, funksiya nomi yo'q; "Order Service", "RabbitMQ", "Buyurtma/Mahsulot" kabi SlaydX da yo'q domenlar haqida | **Past** | SlaydX monolit Next.js + worker, mikroservis emas. Auth/DTO/health-check kabi umumiy gigiyena to'g'ri, lekin `/api/health` allaqachon bor (`app/api/health`), Winston/Pino tavsiyasi esa loyihaning o'z log strategiyasiga (`AUDIT.md`) mos emas. **Faqat umumiy gigiyena sifatida, past ustuvorlik bilan** foydalanish mumkin. |
| `gemini.txt` | arxitektura darajasidagi tahlil | ✅ To'g'ri fayl nomlari (`slide-write.ts`, `write-specials.ts`, `image-studio.ts`, `render-docx.ts`) | **O'rta** | Qator raqami yo'q, "bo'lishi kerak" darajasida. Yo'nalish to'g'ri (ko'p bosqichli generatsiya, RAG, akademik apparat), lekin da'volar tekshirilmagan taxmin sifatida qabul qilinishi kerak. |
| `slaydx_audit_report_diff.md` | .md, fayl:qator bilan | ✅✅ Aniq kod parchalari, jonli test raqamlari | **Yuqori** | Grok oilasi bilan bir xil xulosalarga keladi (pastga qarang) — mustaqil konvergensiya. |
| Grok interaktiv hisobot (`report-services.ts`/`report-overview.ts`) | TS ma'lumot fayli, veb-ilova uchun | ✅✅ Har topilmada aniq fayl, ba'zan funksiya nomi | **Yuqori** | 8/8 tanlangan da'vo men tomonimdan kod bilan **to'liq tasdiqlandi** (§2). Eng batafsil va eng aniq manba. |
| `SlaydX_..._hisobot.docx` / `...html` | ikki formatda bir xil tahlil | ✅ Metodologiya bo'limi statik tekshiruv chegarasini ochiq yozgan (`npm run typecheck` muhitda paket yo'qligi tufayli to'liq ishlamagani aytilgan — halollik belgisi) | **Yuqori** | Grok oilasidan **mustaqil** uslubda yozilgan (ingliz-o'zbek aralash, "code-proven defect" vs "production risk" farqi), lekin xuddi shu tub muammoga keladi: 5 xizmat bitta yozuvchi, sahifa-so'z abstraksiyasi, manba kesilishi. |

**Xulosa:** uchta mustaqil "oila" (Grok/diff-md, docx/html, gemini) **bir xil tub muammoga** kelishi — bu tasodif emas, chunki men buni koddan tasdiqladim. `deepseek.txt` va `z-ai.txt` boshqa toifadagi loyiha uchun yozilgan umumiy matn bo'lgani sababli quyida ishlatilmaydi.

---

## 2. Men shaxsan tasdiqlagan 8 ta da'vo (barchasi hali ham amalda)

| # | Da'vo | Qayerda tekshirildi | Natija |
|---|---|---|---|
| 1 | Slayd "premium_long" (16 slayd) 12 ta bilan ham `COMPLETED` bo'lishi mumkin | `slide-write.ts:447` — `const floor = Math.max(6, Math.ceil(want * 0.75));` | ✅ **tasdiqlandi** — 0.75 floor hamon bor |
| 2 | Referat, kurs ishi, mustaqil ish, maqola, tezis — beshtasi bitta yozuvchidan o'tadi | `write-llm.ts:746` — `const WRITER = new Set(["referat", "coursework", "mustaqil-ish", "article", "thesis"]);` | ✅ **tasdiqlandi** |
| 3 | Referat va mustaqil ish **narxda ham** ayro emas | `tools.ts:749` — `if (tool.id === "referat" \|\| tool.id === "mustaqil-ish") { ...bir xil narx jadvali... }` | ✅ **tasdiqlandi** — bitta `if` sharti ikkalasini ham qamraydi |
| 4 | Slayd JSON sxemasida `layout` enumida `table` yo'q, garchi `table` ma'lumot maydoni bo'lsa ham | `slide-write.ts:373` — enum: `"title\|agenda\|section\|bullets\|twoCol\|compare\|quote\|stats\|process\|closing"`, lekin pastda alohida `"table":{"headers"...}` maydoni bor | ✅ **tasdiqlandi** — model `layout:"table"` deb yoza olmaydi |
| 5 | "Sifatli rasm" aslida bir xil model, faqat qadam soni farq qiladi | `slide-images.ts:22-23,69-70` — `IMAGE_LIMIT`/`STEPS` premium=8, standard=4; `FAL_MODEL_PREMIUM` bo'sh bo'lsa `FAL_MODEL` ga (demak standart bilan bir xil `flux/schnell`) qaytadi | ✅ **tasdiqlandi** |
| 6 | Rezyume formasidagi "ohang" (`tone`) tanlovi promptga tushmaydi | `ResumeWizard.tsx:25,120` da bor, `write-specials.ts`/`meta.ts`/`prompts.ts` da `tone` so'zi **0 marta** uchraydi | ✅ **tasdiqlandi** — o'lik maydon |
| 7 | Dars rejasida `extra` (qo'shimcha talab) matni promptga tushmaydi, glossariy/keys da esa tushadi | `prompts.ts:82-90` (`lessonSystemPrompt`) — `meta.extra` yo'q; `prompts.ts:97` (`glossarySystemPrompt`) va `:108` (`keysSystemPrompt`) da bor | ✅ **tasdiqlandi** |
| 8 | Standart (bobli) maqola/tezisda `annotationLangs` (UZ+EN+RU) tanlovi hech narsaga ta'sir qilmaydi | `annotationLangs` faqat `meta.ts:122` (o'qiladi) va `write-specials.ts:681` (faqat IMRAD yo'lida ishlatiladi) da bor; `write-llm.ts` (standart yo'l) da **0 marta** | ✅ **tasdiqlandi** |

Qo'shimcha, tekshiruv jarayonida topilgan **9-band**: `priceFor()` da (`tools.ts:731-791`) `essay` uchun alohida shart yo'q — demak 1 varaqlik ham, 5 varaqlik ham insho bir xil **2 000 tanga** turadi, garchi forma 1–5 varaq tanlovini bersa ham (`tools.ts:254-262`). ✅ tasdiqlandi.

Va **10-band**: `glossary` xizmatida atama sonini tanlash maydoni umuman yo'q (`tools.ts:506-521` — faqat `topic`, `language`, `extra`), narx doim 6 000 tanga, chiqadigan atama soni promptda qattiq (odatda ~14 ta) — foydalanuvchi ko'proq/kamroq tanlay olmaydi. ✅ tasdiqlandi.

---

## 3. YANGI/qolgan muammolar — ustuvorlik bo'yicha

> Belgilar: **✅ men tekshirdim** (yuqoridagi §2 yoki qo'shimcha grep) · **📋 hisobotdan** (Grok/docx oilasi, ishonchli manba, lekin men shaxsan qator darajasida tekshirmadim).

### P0 — pul to'langan mahsulot va'dasi hali ham noaniq

| ID | Muammo | Holat |
|---|---|---|
| **N-1** | **5 ta akademik xizmat — 1 dvigatel.** Referat/kurs ishi/mustaqil ish/maqola/tezis deyarli bir xil `writeWriterWithLlm` orqali yoziladi. Kurs ishi Sprint 2 da qisman ajratildi (3 bob majburiy, tadqiqot savoli, jadval, `thinking:1024`), qolgan 4 tasi hali ham amalda **bir-biridan farqlanmaydi**: referat = mustaqil ish (bir xil narx jadvali!), standart maqola = standart tezis = "I BOB / II BOB" qisqa kurs ishi. Foydalanuvchi 2–4× narx farqini "chuqurlik farqi" deb o'ylaydi. | ✅ |
| **N-2** | **Slayd 75% floor.** "16 slayd" va'da qilingan paket 12 tasi bilan ham yakunlanishi mumkin — tijoriy shartnoma buzilishi (`priceFor` 8 000 tanga oladi, lekin miqdor kafolatlanmaydi). | ✅ |
| **N-3** | **Manba fayli jim kesiladi, ogohlantirishsiz.** `MAX_SOURCE=60 000` (validate.ts) qabul qilinadi, lekin modelga faqat `SOURCE_TEXT_LIMIT=24 000` boradi (meta.ts:50). Bu ataylab hujjatlashtirilgan arxitektura qarori (izoh bor), **lekin** foydalanuvchiga UI darajasida hech qanday ogohlantirish ko'rsatilmaydi (`components/` da bu haqda satr topilmadi) — 40–60k belgili fayl yuklagan foydalanuvchi faylining oxirgi ⅓–⅔ qismi generatsiyada ishlatilmaganini bilmaydi. | ✅ (chegara qasddan, ogohlantirish yo'qligi tasdiqlandi) |
| **N-4** | **Matn ichida iqtibos ([1]–[n]) yo'q.** Adabiyotlar ro'yxati "TEKSHIRILMAGAN" deb halol belgilanadi (Sprint 0 yutug'i — buzilmasin), lekin bobning o'zida qaysi gap qaysi manbaga tayanishini ko'rsatuvchi raqamli havola yo'q. GOST 7.1 talab qiladigan ISBN/jurnal-tom formatini esa joriy filtr (`isReferenceLine`) ataylab rad etadi — demak "to'g'ri" GOST yozuvini shakllantirib bo'lmaydi, faqat filtrlanmagan yoki filtrlab tashlangan variant bor. | 📋 (Grok+docx ikkalasi ham) |
| **N-5** | **"Sahifa" — so'z sonidan taxmin, render natijasi bilan tekshirilmaydi.** `targetWords` LibreOffice/Word render qilingandan keyingi haqiqiy sahifa soniga hech qachon solishtirilmaydi — shrift, jadval, bo'sh joy ta'sirini hisobga olmaydi. AUDIT.md §3.2 buni allaqachon aniqlagan (`WORDS_PER_PAGE` muammosi sifatida) va 280→230 ga tuzatilgan, lekin **post-render tekshiruv** hali qo'shilmagan — faqat so'z darvozasi bor, sahifa darvozasi yo'q. | 📋 |

### P1 — sifat va rostgo'ylik

| ID | Muammo | Holat |
|---|---|---|
| N-6 | Insho narxi varaq soniga bog'lanmagan — 1 ham, 5 ham 2 000 tanga; 5 varaqlik matn bitta LLM chaqiruviga tayanadi (kesilish xavfi). | ✅ |
| N-7 | Glossariyda atama soni (va shu orqali narx) tanlanmaydi — doim ~14 ta, 6 000 tanga. | ✅ |
| N-8 | `Keys` xizmatida rubrika balllari yig'indisi 10 ga tenglashi **kodda tekshirilmaydi** — `rubricBlocks()` (`write-specials.ts:346-360`) faqat `total`ni hisoblab ko'rsatadi, normalizatsiya qilmaydi. Promptda "10 ga teng" deyilgan, lekin bu shart emas, tavsiya. | ✅ (kod o'qildi, normalizatsiya funksiyasi topilmadi) |
| N-9 | Tarjimada info bloki (`Manba / Tildan / Hajm`) tarjima tilidan qat'i nazar doim o'zbekcha chiqadi. Rus/ingliz tiliga tarjima qilingan hujjatda bitta paragraf o'zbekcha qolib ketadi. | ✅ (`write-specials.ts:1006-1008`) |
| N-10 | Rezyume, texnologik xarita, glossariy, dars rejasi, keys — bu 5 xizmatda **preview ≠ yuklab olinadigan DOCX**. Veb-ko'rinish (viewer) vizual jihatdan boyroq, lekin DOCX standart Times 14 akademik shablon bilan chiqadi (slaydda esa `planSlide` yagona manba bo'lgani uchun bu muammo yo'q — shu yechim boshqa 5 xizmatga ham ko'chirilishi kerak). | 📋 |
| N-11 | Texnologik xarita nomi metodik atama bilan mos emas: O'zbekiston metodikasida "texnologik xarita" — **bitta darsning** bosqichlari, bu yerda esa yillik kalendar-tematik reja chiqariladi (nomi "Dars rejasi" xizmati bilan ham chalkashadi). Soat yig'indisi 70% noyob mavzu chegarasida hali ham `totalHours` ga aniq teng bo'lishi kafolatlanmagan (faqat noyoblik tekshiriladi, yig'indi emas). | 📋 |
| N-12 | Standart (bobli, IMRAD bo'lmagan) maqola va tezis DOCX titul sahifasi "talaba ishi" shablonidan foydalanadi — `organization`, `email`, `degree` maydonlari formada yig'iladi va viewer'da ko'rinadi, lekin yuklab olingan DOCX faylida `degree` umuman render qilinmaydi. | 📋 |

### P2 — dizayn qarzi (yangi, kichik)

- Kicker matnida `uppercase: true` 4 joyda hali yoqilgan holda qolgan bo'lishi mumkin — o'zbekcha `Oʻ`/`Gʻ` harflari uppercase da buziladi (AUDIT.md Slide Law qoida 9 buni taqiqlagan). 📋 — tekshirish kerak.
- `visual: "cards"` shablon va'dasi — 5 shablon "kartalar" deb belgilangan, lekin `planSlide` da cards render qilinmaydi (bullets'ga tushadi). 📋
- Auditoriya rejimi (`defense/lecture/school/pitch`, Sprint 3 yutug'i) faqat `bullets`/`agenda` layoutida shrift o'lchamiga ta'sir qiladi; `table`/`process`/`stats`/`twoCol` da auditoriya moslashuvi yo'q. 📋

---

## 4. Xizmatlar bo'yicha joriy holat (14 ta)

Ballar Grok hisobotidan olindi (u yagona manba, hozircha 14 tasini alohida-alohida ball bilan bergan); `Qoralama` — mavzuni tez tushunish uchun yaroqlimi, `Topshirish` — pul to'lagan foydalanuvchi rahbariga/o'qituvchisiga topshira oladimi, degan ikki o'lchov. Men buni tekshirmadim, faqat yo'nalish sifatida beryapman — §3 dagi 10 tasdiqlangan band bilan mos keladi.

| Xizmat | Narx | Qoralama /10 | Topshirish /10 | Asosiy teshik (§3 dan) |
|---|---|---:|---:|---|
| Slayd | 3–8k | 7 | 5 | N-2 (75% floor), table layout yo'q |
| Kurs ishi | 12–24k | 6 | 3 | N-1 (referatga yaqin), N-4 (iqtibos) |
| Referat | 3–6k | 6 | 4 | N-1 (mustaqil ish bilan bir xil) |
| Mustaqil ish | 3–6k | 5 | 3 | N-1 (referat kloni — narxda ham) |
| Insho | 2k | 7 | 5 | N-6 (narx varaqqa bog'lanmagan) |
| Maqola | 4–8k | 4 | 1.5 | N-1, N-12 (titul), standart=bobli |
| Tezis | 4–8k | 4 | 2 | N-1, standart=bobli referat |
| Rezyume | 3k | 5 | 3 | N-6-band kabi, `tone` o'lik, preview≠DOCX |
| Tarjimon | 3k | 6 | 4 | N-9 (info bloki i18n) |
| Rasm | 2–6k | 5 | 3 | narx sifatga emas, sonni sotadi |
| Texnologik xarita | 6k | 5 | 3 | N-11 (nom chalkashligi) |
| Glossariy | 6k | 6 | 4 | N-7 (atama soni tanlanmaydi) |
| Keys | 6k | 6 | 4 | N-8 (rubrika 10 ga normalizatsiya yo'q) |
| Dars rejasi | 4k | 6 | 3 | `extra` promptga tushmaydi (§2, 7-band) |

---

## 5. Bitta arxitektura tavsiyasi — eng katta richag

Yuqoridagi 14 tadan **7 tasi** (N-1, N-4, N-5, N-9, N-10, N-11, N-12) bitta ildizga tushadi: **"bitta umumiy yozuvchi/render yo'li ko'p janrga xizmat qilyapti, janr farqi esa faqat narx jadvalida, kodda emas."** Sprint 2 (AUDIT.md) buni faqat `coursework` uchun qisman hal qildi. Qolgan 4 xizmat (`referat`, `mustaqil-ish`, standart `article`, standart `thesis`) uchun xuddi shu naqsh takrorlanadi: alohida `xxxSystemPrompt()` yo'q, alohida tuzilma darvozasi yo'q.

**Tavsiya:** `write-llm.ts` dagi `WRITER` setini yagona funksiyadan chiqarib, har janr uchun `prompts.ts` da alohida funksiya yozish — xuddi `lessonSystemPrompt`/`glossarySystemPrompt`/`keysSystemPrompt` allaqachon qilingani kabi (bu naqsh loyihada **mavjud va ishlaydi**, faqat akademik yozuvchilarga qo'llanmagan):

```
referatSystemPrompt(meta)      → 2 bob, "adabiyot sharhi", yangi tadqiqot da'vo qilinmaydi
mustaqilIshSystemPrompt(meta)  → nazariya + "o'z vazifasi" bloki (hisob/misol/tahlil), fayl-rejim ustuvor
courseworkSystemPrompt(meta)   → (bor, Sprint 2) 3 bob + tadqiqot savoli + jadval
articleSystemPrompt(meta)      → jurnal skeleti (Annotatsiya→Kirish→bo'limlar→Xulosa), BOB emas
thesisSystemPrompt(meta)       → bob raqamisiz 3-5 bo'lim, majburiy annotatsiya
```

Har biriga mos **tuzilma darvozasi** (masalan, "kurs ishida ≥1 jadval", "referatda tadqiqot savoli talab QILINMAYDI" kabi qarama-qarshi tekshiruv) — bu §4 dagi "Topshirish" ballarini eng ko'p ko'taradigan yagona ish, chunki u bir vaqtning o'zida N-1, qisman N-4 va N-12 ni yopadi.

---

## 6. Keyingi sprint rejasi

AUDIT.md Sprint 0–4 dan keyin, raqamlash davom ettiriladi.

### Sprint 5 — «Janr» (5–7 kun, eng yuqori richag — §5 ga qarang)
1. `referat`, `mustaqil-ish`, standart `article`, standart `thesis` uchun alohida prompt + tuzilma darvozasi (N-1).
2. Standart maqola/tezis DOCX titul = muallif bloki (F.I.Sh, daraja, tashkilot, email) — bobli talaba shabloni emas (N-12).
3. `annotationLangs` ni standart yo'lda ham ishlatish (§2, 8-band) — aks holda forma yolg'on va'da beradi.
4. Mustaqil ishga "o'z vazifasi" bloki qo'shish, referatdan `extraOptional` orqali ajratish.

### Sprint 6 — «Akademik rostgo'ylik» (4–5 kun)
1. Matnda `[1]–[n]` iqtibos generatsiyasi (N-4) — hech bo'lmaganda paragraf oxirida eng yaqin mos manba raqami.
2. Post-render sahifa soni tekshiruvi: LibreOffice orqali DOCX→PDF, sahifa sanash, so'z darvozasiga qo'shimcha ikkinchi darvoza (N-5).
3. Manba fayl kesilishi haqida UI ogohlantirishi — 24 000 belgidan uzun fayl yuklanganda forma darhol ko'rsatsin: "faylning faqat birinchi ~24 000 belgisi ishlatiladi" (N-3).

### Sprint 7 — «Slayd va rasm» (4 kun)
1. Slayd hajm darvozasini 100% ga ko'tarish yoki UI da "≈N slayd" yorlig'iga o'tish (N-2).
2. `table` ni layout enumiga qo'shish — `report`/`defense` shablonlari haqiqatan jadval bersin.
3. `FAL_MODEL_PREMIUM` ni haqiqiy boshqa modelga sozlash (yoki UI dagi "sifatli rasm" ta'rifini "ko'proq qadam" ga aniqlashtirish — hozirgi holat yolg'on emas, faqat noaniq).

### Sprint 8 — «O'qituvchi va boshqa vositalar» (5 kun)
1. `lessonSystemPrompt` ga `meta.extra` qo'shish (§2, 7-band — bir qatorlik tuzatish, lekin foydalanuvchi kutgan narsa).
2. `rubricBlocks` balllarini 10 ga normalizatsiya qilish yoki mos kelmasa qayta so'rash (N-8).
3. Texnologik xarita: soat yig'indisini `totalHours` ga qat'iy tenglashtirish, nomni "Kalendar-tematik reja" ga aniqlashtirish yoki alohida "bitta dars xaritasi" rejimini qo'shish (N-11).
4. Glossariyga atama soni tanlovi (10/20/40) va shunga mos narx (N-7).
5. Tarjima info blokini tarjima tiliga moslash (N-9).
6. Rezyumedagi `tone` maydonini promptga ulash yoki formadan olib tashlash (§2, 6-band).
7. Insho narxini varaqqa bog'lash (N-6).

### Doimiy — buzilmasin
- `planSlide()` yagona manba tamoyili — endi boshqa 5 xizmatga (rezyume, xarita, glossariy, dars, keys) ham ko'chirilishi kerak (N-10), lekin **slaydda buzilmasin**.
- Sprint 0 dagi "LLM kaliti bor + yiqildi = FAILED + refund" qoidasi.
- Hajm darvozalari (Sprint 0/2) — Sprint 6 dagi sahifa darvozasi ularni **almashtirmaydi**, ustiga qo'shiladi.

---

## 7. Qilmaslik kerak (AUDIT.md §9 ga qo'shimcha)

| Qilmang | Nega |
|---|---|
| `z-ai.txt` dagi mikroservis/RabbitMQ/DTO tavsiyalarini asos qilib olish | Loyiha monolit-worker arxitekturasi ustida qurilgan va bu AUDIT.md da ataylab tanlangan (9/10 ball) — mikroservisga bo'lish bu yutuqni yo'q qiladi |
| `deepseek.txt` dagi xizmat nomlari/tuzilmasi asosida ish rejalashtirish | Bu boshqa turdagi loyiha (dizayn agentligi saytiga) uchun yozilgan, SlaydX dagi haqiqiy 14 xizmatga mos emas |
| Har 5 janrga darhol to'liq alohida DOCX render yo'lini yozish | Render (`render-docx.ts`) umumiy bo'lib qolishi kerak — faqat **prompt va tuzilma darvozasi** janrga xos bo'ladi. Renderni ham ajratish `AUDIT.md`dagi "kod ixchamligi vs mahsulot generikligi" muvozanatini og'dirib yuboradi |
| Slayd 0.75 floor ni birdaniga 1.0 ga ko'tarish, sinovsiz | Bu ba'zi mavzularda ko'proq LLM chaqiruvi (=xarajat, kechikish) talab qiladi; avval "≈N slayd" UI yorlig'i bilan yumshoq boshlash, keyin darvozani qattiqlashtirish xavfsizroq |

---

## 8. Sprint 5 — bajarildi (2026-08-24)

§6 dagi Sprint 5 ning 1–3-bandlari bajarildi va jonli Gemini chaqiruvi bilan tasdiqlandi (4-band alohida pipeline talab qilmadi — pastga qarang).

### 9.1. Nima qilindi

| # | Ish | Fayl |
|---|---|---|
| 1 | `writerSystemPrompt` beshta alohida funksiyaga bo'lindi: `courseworkSystemPrompt`, `referatSystemPrompt`, `mustaqilIshSystemPrompt`, `articleSystemPrompt`, `thesisSystemPrompt` — har biri o'z janr talabi bilan | `prompts.ts` |
| 2 | Kirish bo'limi ko'rsatmasi (`introBrief`) janrga qarab farqlanadi — ilgari faqat kurs ishi va «hammasi boshqa» bor edi | `write-llm.ts` |
| 3 | Bob raqamlash (`numberOutline`) endi `isBobStyle(toolId)` ga bog'liq: kurs ishi/referat/mustaqil ish — «I BOB.»; maqola/tezis (standart) — oddiy «1.», «2.» (jurnal/konferensiya uslubi, bob-kitob emas) | `write-llm.ts` |
| 4 | `annotationLangs` standart maqola VA tezis yo'lida ishlaydi (ilgari faqat IMRAD'da); `"all"` bo'lsa uz/ru/en uchalasida ham (tarjima emas, mustaqil) annotatsiya yoziladi, bitta so'rovda; ishonchlilik uchun bo'sh/yarim natijada bitta qayta urinish (`rawOutline` naqshi bo'yicha) | `write-llm.ts` (`writeAbstracts`/`askAbstracts`) |
| 5 | Maqola DOCX titul sahifasi — vazirlik/universitet shabloni o'rniga muallif bloki (F.I.Sh + daraja, tashkilot, email). Ilgari bu uch maydon yig'ilar, viewer'da ko'rinar, lekin faylga umuman tushmasdi | `render-docx.ts` |
| — | Yo'l-yo'lakay topilgan nuqson: model ba'zan bob sarlavhasini ARAB raqami bilan qaytaradi («1-BOB. …»); `stripHeadingNumber` buni tanimay, qurilish prefiksi ustiga qo'shilib «I BOB. 1-BOB. …» qo'sh sarlavha chiqargan (jonli sinovda ko'rindi, statik tahlilda yo'q edi) | `quality.ts` (`ARABIC_KEYED`) |

Mustaqil ishning «o'z vazifasi» talabi (Sprint 5, 4-band) alohida pipeline o'zgarishi talab qilmadi: `mustaqilIshSystemPrompt` buni to'g'ridan-to'g'ri talab qiladi, reja va bo'lim yozish esa shu promptdan foydalanadigan MAVJUD mexanizm orqali ishlaydi — xuddi `lessonSystemPrompt` kabi, faqat prompt darajasida farqlanadi.

### 9.2. Jonli tekshiruv (Gemini, `gemini-3.7-flash`)

| Sinov | Natija |
|---|---|
| Maqola bo'lim sarlavhalari | `Kirish`, `1. …`, `2. …`, `Xulosa` — «BOB» yo'q ✅ |
| Maqola annotatsiya, `annotationLangs: "all"` | 3 tilda (uz/ru/en), har biri mustaqil yozilgan, tarjima emas ✅ |
| Maqola DOCX titul | `PhD`, tashkilot, email ko'rindi; `VAZIRLIGI` chiqmadi ✅ |
| Mustaqil ish bo'lim sarlavhalari | `Kirish`, `I BOB. …`, `II BOB. [aniq hisob-kitob mavzusi] …`, `Xulosa` — ikkinchi bob haqiqatan amaliy hisoblash bilan bog'liq ✅ |
| Mustaqil ish — qo'sh prefiks regressiyasi | Tuzatishdan keyin qayta ishga tushirilib, «I BOB.»/«II BOB.» toza chiqishi tasdiqlandi ✅ |

### 9.3. Testlar

`npm run check` (`tsc --noEmit` + `eslint` + 140 test, shundan 137 o'tdi, 3 skip, 0 xato) toza. Qo'shilgan 8 ta yangi test: 5 tasi janr farqini (`kurs ishi va referat endi bir xil promptga ega emas`, `mustaqil ish promptida o'z bajargan amaliy vazifa talabi bor`, `BOB raqamlashni taqiqlaydi`, `kirish ko'rsatmasi janrga qarab farqlanadi`, `bob uslubi faqat akademik-kitob janrlarida`), 2 tasi maqola titulini (`tashkilot.md`), 1 tasi `stripHeadingNumber`ning arab-kalit so'zli holatini qulflaydi.

### 9.4. Qolgan Sprint 5 ish (keyingi seansga)

Bajarilmagan: referat/mustaqil ish/maqola/tezisning render-docx darajasidagi **tuzilma darvozasi** (masalan, «maqolada annotatsiya bo'lmasa FAILED», «mustaqil ishda amaliy bob topilmasa qayta yozish»). Hozircha bular faqat PROMPT darajasida talab qilinadi — model rioya qilmasa (kam uchraydigan holat), hech narsa buni ushlab qolmaydi. Bu Sprint 6 «Akademik rostgo'ylik» rejasiga tabiiy ravishda qo'shiladi (§6, N-5 bilan bir xil naqsh: post-hoc tekshiruv).

---

## 9. Sprint 6 — bajarildi (2026-08-24)

§6 dagi Sprint 6 ning uchala bandi ham bajarildi va jonli Gemini + LibreOffice bilan tasdiqlandi.

### 9.1. Nima qilindi

| # | Ish | Fayl |
|---|---|---|
| 1 | Manba fayl 24 000 belgidan uzun bo'lsa, «fayl asosida» rejimida forma darhol ogohlantiradi: nechta belgi ishlatiladi, nechtasi tashlab ketiladi. Ilgari uzunlik ko'rsatilardi, lekin kesilish haqida hech narsa aytilmasdi | `components/forms/SourceFileField.tsx` |
| 2 | Matn ichida `[n]` iqtibos: manbalar endi bo'limlar yozilishidan OLDIN so'raladi, `writeSection` ularni promptga beradi va modeldan mos gapda ko'rsatishni so'raydi. `refPlan` ishga tushsa (< 4 ishonchli manba) iqtibos umuman so'ralmaydi — chop etiladigan ro'yxat qidiruv so'rovlariga almashtirilgani uchun. Yakunida `citeGuard`/`sanitizeCitations` oraliqdan tashqari yoki osilib qolgan `[n]` larni tozalaydi | `write-llm.ts`, `quality.ts` |
| 3 | Renderlangan sahifa soni darvozasi: `renderDocx` dan keyin LibreOffice orqali PDF ga o'giriladi (`toPdf`, mavjud infratuzilma), `unpdf`ning `getDocumentProxy(...).numPages` bilan haqiqiy sahifa soni sanaladi va diapazonning **pastki chegarasining 85%** idan kam bo'lsa `FAILED` + kredit qaytadi. So'z darvozasi diapazon o'rtachasiga (80%) qaraydi — bu esa pastki chegaraga, ikkinchi, mustaqil tekshiruv | `index.ts` (`buildArtifact`), `meta.ts` (`minPages`) |

Sahifa darvozasi LibreOffice o'rnatilmagan yoki byudjet tugagan muhitda **jim o'tkazib yuboriladi** — ikkilamchi tekshiruv infratuzilma yetishmovchiligi tufayli to'g'ri hujjatni rad etmasligi kerak.

### 9.2. Jonli tekshiruv

| Sinov | Natija |
|---|---|
| Referat, 7 ta real manba | 30 paragrafda `[1]`–`[7]` iqtibos, 0 ta oraliqdan tashqari (Gemini) ✅ |
| Referat «10–15 bet» kalibrlash | so'z 95% (2854/2990), PDF **13 bet** (pastki chegara 10) ✅ |
| Kurs ishi «20–25 bet» kalibrlash | so'z 92% (4887/5290), PDF **21 bet** (pastki chegara 20 — chegaraga yaqin, aynan darvoza mo'ljallagan holat) ✅ |
| To'liq `buildArtifact` (referat + kurs ishi) | Ikkalasi ham `FAILED` bermay, haqiqiy DOCX bilan yakunlandi — yolg'on musbat yo'q | ✅ |

### 9.3. Testlar

`npm run check` toza (142 test, 139 o'tdi, 3 skip, 0 xato). Yangi: `sanitizeCitations` (5 holat), `minPages` (5 holat).

### 9.4. Qolgan ish

- §9.4 (Sprint 5 dan) — akademik janrlar uchun DOCX darajasidagi tuzilma darvozasi (masalan «maqolada annotatsiya yo'q → FAILED») hali yo'q, faqat prompt darajasida talab qilinadi.
- Sprint 8 (o'qituvchi vositalari — rubrika normalizatsiyasi, glossariy atama soni, texnologik xarita soat invarianti) hali boshlanmagan.

---

## 10. Sprint 7 — bajarildi (2026-08-24)

§6 dagi Sprint 7 ning uchala bandi ham bajarildi.

### 10.1. Nima qilindi

| # | Ish | Fayl |
|---|---|---|
| 1a | Bo'lak so'ralganidan kam slayd bilan qaytsa — bitta qayta urinish (`rawOutline`/`writeAbstracts` naqshi). Ilgari «premium_long» (16) muntazam 12 ta bilan yakunlanishining asosiy sababi shu edi | `slide-write.ts` (`writeSlidesWithLlm`) |
| 1b | Quyi chegara 0.75 → **0.85**. Qayta urinish yetishmovchilikning katta qismini yopgani uchun endi bir necha bosqichda (birdaniga 1.0 emas) qattiqlashtiriladi — AUDIT-2.md §7 dagi o'zimning ogohlantirishimga rioya qilindi | `slide-write.ts` (`floor`) |
| 2 | `layout` JSON enumiga `table` qo'shildi. `SLIDE_LAYOUTS`, `isSlideLayout`, `coerceLayout` va `slide-layout.ts`daki renderer (`case "table"`) barchasi ALLAQACHON tayyor edi va hatto testlangan edi (`slide-layout.test.mts`) — yagona teshik promptga yuboriladigan enum satri edi. `report`/`defense` shablonlaridagi `{layout:"table"}` beat shu sababli hech qachon bajarilmasdi | `slide-write.ts` (JSON sxema satri) |
| 3 | Slayd formasida «sifatli rasm» → «**sifatliroq** rasm». Standart darajadagi rasm ham fal.ai bilan chiziladi; sozlamada `FAL_MODEL_PREMIUM` ko'rsatilmasa, premium farqi «boshqa model» emas, «ko'proq (8 vs 4) qadam» — bu haqiqiy, lekin NISBIY farq | `components/forms/SlideForm.tsx` |

### 10.2. Jonli tekshiruv

| Sinov | Natija |
|---|---|
| «report» shablon, standart sifat | 10 slayd, `table` layoutli slayd 4 ustunli, 3 qatorli haqiqiy jadval bilan chiqdi (uydirma raqamsiz — tasnif/qiyos) ✅ |
| «defense» shablon, premium sifat | 12 slayd, `table` layout ham bor, to'liq PPTX 3.8 MB muvaffaqiyatli yig'ildi (xatosiz) ✅ |

### 10.3. Testlar

`npm run check` toza (142 test, o'zgarishsiz — floor va enum o'zgarishi mavjud `coerceLayout`/slayd testlari bilan allaqachon qoplangan, yangi mock-asoslangan LLM testi loyihaning o'z uslubiga mos emas: bunday o'zgarishlar jonli sinov bilan tasdiqlanadi, AUDIT.md dagi naqsh bo'yicha).

---

## 11. Yakuniy xulosa

`docs/AUDIT.md` "va'da = natija" muammosini **hajm va mavjudlik** darajasida hal qildi: slayd soni, speaker notes, adabiyot halolligi — bularning barchasi men joriy koddan tasdiqladim, ishlaydi. 2026-08-24 dagi olti tashqi hisobot (ulardan uchtasi mustaqil ravishda bir xil xulosaga kelib, sakkiztasi men tomonimdan qator darajasida tasdiqlandi) ko'rsatadiki, keyingi qatlam — **janr va format darajasidagi** rostgo'ylik. Kod "biror narsa chiqardi" dan "va'da qilingan hajmni berdi" ga o'tgan (Sprint 0–4). Keyingi qadam — "va'da qilingan **janr**ni berdi": referat adabiyot sharhi bo'lsin, kurs ishi tadqiqot bo'lsin, maqola jurnal maqolasi ko'rinishida chiqsin — hozir esa beshtasi ham bir xil "uzun insho" ko'rinishida.

Bu ish katta qayta yozishni talab qilmaydi: loyihada bu naqsh (`lessonSystemPrompt`, `glossarySystemPrompt`, `keysSystemPrompt` — har biri alohida funksiya, alohida qoida) allaqachon **mavjud va ishlaydi**. Vazifa — shu naqshni akademik yozuvchi xizmatlariga ham qo'llash.
