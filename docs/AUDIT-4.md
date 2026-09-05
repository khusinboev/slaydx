# SlaydX — 4-audit: xizmatlar kesimida chuqur tahlil

**Sana:** 2026-09-05 · **Holat:** `npm run check` — typecheck toza, lint toza,
**200 test / 0 fail / 0 skip** (DB testlari ham haqiqiy Postgres bilan ishladi).

Bu audit AUDIT-3 dan keyingi holatni tekshiradi. Uch savolga javob beradi:

1. **Har bir bo'limdagi har bir xizmat** nima va'da qiladi va nimani yetkazadi;
2. **Yaratish jarayoni** (forma → navbat → worker → render → ko'ruvchi) qayerda uziladi;
3. **Fayl sifati** — yuklab olingan DOCX/PPTX/PNG haqiqatan topshirса bo'ladimi.

---

## 0. Umumiy baho

**Kuchli tomonlar — bular kamdan-kam uchraydi va saqlab qolinishi kerak:**

| Nima | Qayerda | Nega muhim |
|---|---|---|
| «Preview = Export» yagona manba | `planSlide` (slayd), `tocRows` (mundarija), `docx-profile` (tipografiya) | Ko'ruvchi va fayl bitta funksiyadan chiziladi — ular hech qachon ajralib keta olmaydi |
| Pul yechish + navbat bitta tranzaksiyada | `jobs.ts:enqueueGeneration` → `credits.ts:chargeInTx` | To'lanmagan ish worker ga tushmaydi, yechilib ish yaratilmay ham qolmaydi |
| Idempotent kredit (`reference` bo'yicha) | `credits.ts` | Webhook takrori, worker qayta urinishi ikki marta pul yechmaydi/qaytarmaydi |
| Uydirma manba rad etiladi | `isReferenceLine`, `referenceSearchPlan`, `unverifiedReferenceNote` | Soxta DOI/ISSN akademik halollik masalasi — u tug'ilishida to'siladi |
| Rezyume fakt qo'riqchisi | `resumeFactGuard` | Model o'ylab topgan ish joyi tashlanadi, o'ylab topgan yil o'chiriladi |
| Qulf egaligi (`locked_by`) yakunlashda tekshiriladi | `completeJob`/`failJob` | Eski worker yangisining natijasini bosib yozmaydi |
| Har qaror izohda SABABI bilan yozilgan | butun `lib/` | Loyihaning eng qimmatli aktivi — regressiyani odam darajasida to'sadi |

**Miqyos:** 60 ta `lib/` moduli, ~24 700 qator (lib + components + app + tests),
14 xizmat, 3 bo'lim, 5 DOCX profili, 11 ko'ruvchi.

---

## 1. Bo'limlar va xizmatlar

### 1.1. «Umumiy vositalar» (5 ta)

| Xizmat | Narx | Yo'l | Darvoza | Holati |
|---|---|---|---|---|
| **Slayd** (`slide`) | 3 000–8 000 | `buildSlideAcademicDoc` → `writeSlidesWithLlm` → `attachSlideImages` → `renderPptx` | `slides.length ≥ 0.85 × want` | ⚠️ **N-2** — byudjet dvigatelga uzatilmaydi |
| **Rasm** (`image`) | 2 000–6 000 | `buildImageArtifact` → fal.ai → `packImages` | `delivered` → `refundPartial` | ⚠️ **N-6** — kalitsiz ham sotiladi |
| **Maqola** (`article`) | 4 000–8 000 | `writeWriterWithLlm` yoki `writeImradWithLlm` | hajm + sahifa + **annotatsiya (qat'iy)** | ✅ Yaxshi |
| **Rezyume** (`resume`) | 3 000 | `writeResumeWithLlm` → `resume` profili | `summary ≥ 80 belgi` | ✅ Yaxshi |
| **Tarjimon** (`translation`) | 3 000 | `writeTranslationWithLlm` (bo'lakli) | yo'qolgan bo'lak → **xato** | ⚠️ **N-5** — chegara klientda yo'q |

Slayd va rasm — ikkalasi ham «paket» sotadi (premium, 4 ta rasm), shuning uchun
ular yagona joy bo'lib, u yerda **va'da qilingan miqdor** darvoza bilan
himoyalanishi kerak. Rasmda bu bor (`shortfallRatio` → qisman qaytarish),
slaydda esa **rasm soni** himoyalanmagan — pastga qarang.

### 1.2. «Talaba ishlari» (5 ta)

| Xizmat | Narx | Janr farqi qayerda | Holati |
|---|---|---|---|
| **Kurs ishi** | 12 000–24 000 | `courseworkSystemPrompt` — tadqiqot savoli, obyekt/predmet, 5 xulosa; `thinking: 1024` | ⚠️ **N-3** — 25 betdan yuqori tariflarda byudjet o'smaydi |
| **Referat** | 3 000–6 000 | `referatSystemPrompt` — adabiyot sharhi, tadqiqot savoli SHART emas | ✅ Yaxshi |
| **Mustaqil ish** | 3 000–6 000 | `mustaqilIshSystemPrompt` + `hasOwnTask` darvozasi (kuzatuvda) | ✅ Yaxshi |
| **Insho** | 2 000–4 000 | `essaySystemPrompt`, `essay` profili (rangli ramka) | ✅ Yaxshi |
| **Tezis** | 4 000–8 000 | `thesisSystemPrompt` — bobsiz, annotatsiya qat'iy | ✅ Yaxshi |

Janr ajratilishi AUDIT-3 dan keyin **haqiqiy**: beshta alohida tizim prompti,
`isBobStyle` bilan bob raqamlash farqi, `structureNeeds` bilan janr darvozasi.
Ilgari referat = mustaqil ish edi — bu tuzatilgan.

Kurs ishi va mustaqil ishda **reja tahriri** bor (`tocMethod`/`tocText`) —
lekin u ikki boshqaruvga bo'lingan va jim yo'qoladi (**N-4**).

### 1.3. «O'qituvchi vositalari» (4 ta)

| Xizmat | Narx | Invariantlar | Holati |
|---|---|---|---|
| **Texnologik xarita** | 6 000 | `normalizeMinutes` bilan **soat yig'indisi = jami soat**; takror mavzu tashlanadi; 70% chegara; `landscape` profil + langar | ✅ Kuchli |
| **Glossariy** | 6 000–15 000 | 20 talik bo'laklar, takror tashlash, `Intl.Collator` bilan alifbo, 70% chegara, `reference` profil | ✅ Kuchli |
| **Kalitlar (Keys)** | 6 000 | `rubricBlocks` — ballar yig'indisi majburan 10; `cases ≥ 3` | ✅ Kuchli |
| **Dars rejasi** | 4 000 | `normalizeMinutes` bilan **daqiqalar yig'indisi = dars davomiyligi**; mavzuga bog'liqlik tekshiruvi | ✅ Kuchli |

Bu bo'lim eng puxta ishlangan: hujjat YIG'ISH tarmoq chaqiruvidan ajratilgan
(`lessonDoc`, `mapDoc`), shuning uchun invariantlar LLM siz sinaladi.

---

## 2. Yaratish jarayoni — bosqichma-bosqich

```
Forma (klient)                  → missingRequired() [bir manba]
  ↓ POST /api/generations
requireUser + CSRF (Origin)     → api.ts:checkOrigin
rateLimit 5/60s + 60/1h         → ratelimit.ts (Postgres, ko'p instansiyaga chidamli)
sanitizeValues                  → 80 kalit, 4k/60k belgi, nol bayt
missingRequired (SERVER)        → forma chetlab o'tilmaydi
preflightError                  → «uddalay olmaymiz» — pul yechilishidan OLDIN
priceFor (SERVER)               → klient narxi e'tiborsiz
budgetFor                       → hajmdan hisoblangan vaqt
enqueueGeneration               → chargeInTx + INSERT, BITTA tranzaksiya
  ↓ 202 QUEUED
worker: claimJob (SKIP LOCKED)  → progressTicker (locked_at heartbeat)
buildArtifact(deadline)         → hajm darvozasi → tuzilma darvozasi → sahifa darvozasi
extractAssets → putGenerationFile → putAssets → completeJob(locked_by tekshiruvi)
  ↓ polling GET /api/generations/{id}
ArtifactViewer                  → 11 ko'ruvchidan biri, doc_json dan
```

**Bu zanjir sog'lom.** Har bosqichda «kim to'g'ri qaror qabul qiladi» savoliga
javob berilgan: narx serverda, majburiy maydon ikkala tomonda bitta funksiyadan,
pul va navbat atomik, natija qulf egasi tomonidan yoziladi.

**Uzilish nuqtalari** — quyidagi bo'limda.

---

## 3. Topilgan nuqsonlar

### P0 — pul yoki ma'lumot bilan bog'liq

#### N-1. `DELETE` yo'lida egalik tekshirilmagan fayl o'chirish

`app/api/generations/[id]/route.ts:37`

```ts
const cancelled = await cancelGeneration(id, user.id);   // ✅ egaga bog'langan
if (cancelled) await refund(...);
await deleteGenerationFile(id);                          // ❌ egasi tekshirilmaydi
const removed = await deleteGeneration(id, user.id);     // ✅ egaga bog'langan
if (!removed && !cancelled) throw new ApiError(..., 409);
```

`storage.ts:deleteGenerationFile(generationId)` `user_id` ni umuman
so'ramaydi (`getGenerationFile` va `hasGenerationFile` esa so'raydi — ya'ni
naqsh bor, bu funksiya undan chetda qolgan).

**Oqibat:** kirgan har qanday foydalanuvchi begona `id` bilan `DELETE` yuborsa,
javob 409 bo'ladi, lekin **fayl allaqachon o'chgan** — egasi «Yuklab olish»
bosganda 404 oladi. Hujjat qatori qoladi, bayt yo'q.

**Amaliy xavf hozircha past** (`randomUUID` topib bo'lmaydi), lekin bu
himoyaning o'zi emas, tasodif. Egalik SQL darajasida bo'lishi kerak.

**Tuzatish:** `deleteGenerationFile(generationId, userId)` qilib, `JOIN generations`
bilan cheklash; yoki chaqiruvni `removed || cancelled` shartidan KEYIN ko'chirish.

---

#### N-2. Slayd dvigateli byudjetni umuman bilmaydi

`slide-write.ts:523` — `buildSlideAcademicDoc(meta, deadline)` `deadline` ni
**faqat** rasm bosqichiga uzatadi:

```ts
const written = await writeSlidesWithLlm(meta, tpl, beats);   // deadline YO'Q
...
const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
await attachSlideImages(slides, ..., budget, ...);
```

`writeSlidesWithLlm` ichida bironta `remainingMs` chaqiruvi yo'q — faqat
qattiq yozilgan `timeoutMs: 90_000` (`slide-write.ts:385`).

**Arifmetikasi:**

| | qiymat |
|---|---|
| `FIXED.slide` byudjeti | 180 s |
| `jobDeadlineMs` | 165 s |
| `premium_long` = 16 slayd → 2 bo'lak, har biri qayta urinishli | **eng yomon holat 4 × 90 = 360 s** |
| Matn 150 s olsa, rasmga qoladi | 165 − 150 − 12 = **3 s** → `generateFalImage` `budget < 2000` da darhol `null` |

**Oqibat:** aynan **premium** paketlarda (6 000 va 8 000 tanga, yorlig'ida
«sifatliroq rasm» yozilgan) rasm bosqichi jim o'tkazib yuboriladi. Ish
`COMPLETED` bo'ladi, pul qaytmaydi, `console.warn` dan boshqa hech qanday
signal yo'q. `imageBudget()` 14 tagacha rasm hisoblab qo'yadi — ularning
hech biri chizilmaydi.

Bu AUDIT-3 §10 da rasm vositasi uchun yopilgan nuqsonning (qisman yetkazish,
to'liq to'lov) **slayddagi ochiq qolgan ko'rinishi**.

**Tuzatish:**
1. `writeSlidesWithLlm(meta, tpl, beats, deadline)` — har `askRange` da
   `Math.min(90_000, remainingMs(deadline))`, byudjet tugasa qayta urinishni
   tashlash;
2. `FIXED.slide` ni slayd soniga bog'lash (`premium_long` uchun ≥ 240 s);
3. rasm soni `delivered` bilan o'lchanib, `refundPartial` ga ulanishi.

---

#### N-3. Bet byudjeti eng qimmat to'rt tarifda ishlamaydi

`budget.ts:budgetFor` bet boshiga 9 s hisoblaydi, lekin
`WORKER_JOB_TIMEOUT_MS` (standart 300 000) bilan kesiladi:

| Kurs ishi tarifi | Narx | Byudjet **xohlaydi** | Byudjet **oladi** |
|---|---|---|---|
| 20–25 bet | 16 000 | 297 s | 297 s |
| 25–30 bet | 18 000 | 342 s | **300 s** |
| 30–35 bet | 20 000 | 387 s | **300 s** |
| 35–40 bet | 22 000 | 432 s | **300 s** |
| 40–45 bet | 24 000 | 477 s | **300 s** |

Ya'ni **23 betdan yuqorida formula o'lik** — to'rtta eng qimmat tarif bir xil
vaqt oladi. `budget.ts` ning o'z izohi buni tan oladi: «45 betlik kurs ishi
… ~420 s talab qiladi». `outlineShape` pool ni 6 ga ko'targani muammoni
yengillashtirdi, lekin **byudjet formulasi va standart shift bir-biriga zid**
bo'lib qoldi.

**Oqibat:** eng yuqori narxli xizmatda hajm darvozasidan (`MIN_LENGTH_RATIO`
0.8) yiqilish ehtimoli eng yuqori. Kredit qaytadi — lekin foydalanuvchi
5 daqiqa kutib hech narsa olmaydi va qayta urinadi.

**Tuzatish:** `.env.example` da `WORKER_JOB_TIMEOUT_MS=480000` qilish
(va `WORKER_CONCURRENCY` ni shunga qarab sozlash), yoki `budgetFor` ga
`cap` o'rniga aniq yuqori chegara berish. Hozirgi holatda ikkita raqam
bir-birini yolg'onga chiqaradi.

---

### P1 — foydalanuvchi tanlovi jim yo'qoladi

#### N-4. Qo'lda yozilgan reja `tocMethod` sababli tashlab yuboriladi

Ikkita boshqaruv bitta narsani boshqaradi:

- **Chips** (`tools.ts:150`): «Mundarijani o'zingiz yozasizmi yoki AI…» —
  `ai` / `manual`, standart `ai`;
- **Textarea + tugma** (`ToolWorkspace.tsx:180`): «Ish rejasi», ostida
  *«Bo'sh qoldirsangiz reja avtomatik tuziladi»*.

`tocMethod: "manual"` **faqat** `makeOutline()` ichida o'rnatiladi
(`ToolWorkspace.tsx:120`) — ya'ni «AI reja tuzsin» tugmasi bosilganda.
Foydalanuvchi rejasini to'g'ridan-to'g'ri yozsa, `tocMethod` `"ai"` bo'lib
qoladi va `write-llm.ts:221` uni umuman o'qimaydi:

```ts
const manual = meta.tocMethod === "manual" ? parseManualOutline(...) : [];
```

**Oqibat:** 16 000–24 000 tanga to'lagan foydalanuvchi o'z rejasini yozadi,
hujjat esa butunlay boshqa tuzilmada chiqadi. Hech qanday ogohlantirish yo'q.
Textarea matni («bo'sh qoldirsangiz…») aynan teskarisini va'da qiladi.

**Tuzatish:** textarea `onChange` da `tocMethod` ni avtomatik `manual` ga
o'tkazish (va bo'shatilganda `ai` ga qaytarish), chips ni esa `hasOutline`
bo'lgan vositalarda `mainFields` dan chiqarish — bitta boshqaruv qolsin.

---

#### N-5. Tarjima chegarasi uch xil raqam bilan uch joyda

| Bosqich | Chegara | Foydalanuvchi nima ko'radi |
|---|---|---|
| `/api/extract` | 200 000 belgi | «150 000 belgi tarjima qilinadi» |
| `sanitizeValues` (`MAX_SOURCE`) | 60 000 | — (jim kesiladi) |
| `preflightError` (`TRANSLATION_MAX_CHARS`) | 48 000 | «Matn juda uzun: **60 000** belgi» |

`preflightError` allaqachon **kesilgan** matnni o'lchaydi, shuning uchun
xato xabaridagi raqam har doim 60 000 — foydalanuvchi ko'rgan 150 000 emas.
Klientda esa hech qanday tekshiruv yo'q: `TranslationForm.submit()` faqat
`length < 8` ni ushlaydi.

**Oqibat:** uzun hujjat yuklagan foydalanuvchi faylni o'qitadi, «150 000 belgi
tarjima qilinadi» degan yozuvni ko'radi, tugmani bosadi va tushunarsiz
raqamli xato oladi. Pul yechilmaydi (bu to'g'ri), lekin yo'l butunlay
noto'g'ri boshqariladi.

**Tuzatish:** `TranslationForm` da `preflightError(tool, values)` ni
submit dan oldin chaqirish (u allaqachon klientda ham import qilinadigan
`lib/tools.ts` da), va matn maydonining ostida jonli hisoblagich ko'rsatish.

---

#### N-6. `features.llm` / `features.images` bayroqlari UI da ishlatilmaydi

`/api/auth/session` `features: { llm, images, telegram, pdf, payments }`
qaytaradi. UI da faqat `pdf`, `telegram`, `payments` o'qiladi
(`ResultView`, `LoginModal`, `PayDialog`). `llm` va `images` **hech qayerda
ishlatilmaydi**.

**Oqibat:** `FAL_KEY` bo'lmasa «Rasm generate» vositasi baribir to'liq
ko'rinadi va sotiladi. Foydalanuvchi to'laydi → navbat → worker →
`generateFalImage` `«FAL_KEY missing»` → `«Rasm yaratilmadi»` → xato → qaytarish.
Pul qaytadi, ammo bu «xizmat ishlamayapti» xabarini eng qimmat yo'l bilan
yetkazish. Xuddi shu holat `GEMINI_API_KEY` siz barcha matn xizmatlarida.

**Tuzatish:** `CreateGrid` da `features.images === false` bo'lsa `image`
kartochkasini «vaqtincha o'chiq» qilib ko'rsatish; `llm === false` bo'lsa
qolganlarini. Bayroqlar allaqachon serverdan kelib turibdi — ularni ulash
bir necha qator ish.

---

#### N-7. Slaydda muallif/universitet hech qachon chiqmaydi

`SlideForm.tsx` o'z `values` ini noldan quradi va profildan **hech narsa
olmaydi** (`author`, `university` yo'q). `StandardForm` esa
`defaultsFor(tool, writerProfile(user))` orqali oladi.

`slide-write.ts` da:
```ts
const footer = [meta.author, meta.university].filter(Boolean).join(" · ");  // → ""
```

**Oqibat:** har bir slaydning pastki qatori bo'sh. Himoya taqdimotida
(`defense` auditoriyasi!) muallif ismi yo'q. Ko'ruvchida ham, PPTX da ham.

**Tuzatish:** `SlideForm` ni ham `writerProfile(user)` dan boshlash.

---

### P2 — texnik qarz va sifat

#### N-8. `meta._tables` — turdan tashqari maydon bazaga tushadi

`write-llm.ts:710`:
```ts
(meta as DocMeta & { _tables?: typeof docTables })._tables = docTables;
...
const tables = (meta as DocMeta & { _tables?: AcademicDoc["tables"] })._tables;
```

`meta` obyekti keyin `doc.meta` bo'lib `doc_json` ga serializatsiya qilinadi,
ya'ni **jadval ma'lumoti JSONB da ikki marta** saqlanadi va `doc.meta._tables`
sifatida ko'ruvchiga ham boradi. Bu `AcademicDoc` shartnomasini `as` bilan
teshib o'tish — ikkita mahalliy o'zgaruvchi bilan yechiladigan masala.

#### N-9. Shablon glossariysida takroriy prefiks

`content.ts:glossaryDoc` — `terms` massivida atama nomi allaqachon
`` `${topic}: tasnif` `` ko'rinishida, keyin sarlavha yana prefikslanadi:
```ts
{ kind: "h3", text: `${topic}: ${a}` }   // → «Fotosintez: Fotosintez: tasnif»
```
Faqat LLM kalitisiz (dev/demo) yo'lda ko'rinadi, lekin aynan o'sha yo'l
demolarda ishlatiladi.

#### N-10. `payments.test.mts` production kodni chaqirmaydi

Test Click `md5` va Payme `Basic` formulasini **o'zi qayta yozadi** va o'zi
bilan solishtiradi. `app/api/payments/click/route.ts` dagi haqiqiy
`signValid()` import qilinmaydi. Ya'ni route dagi formula o'zgarsa test
yashil qolaveradi — bu esa aynan «har kim to'ladim deb webhook yuboradi»
xavfi bo'lgan joy. Test izohi to'g'ri sababni yozgan, lekin kodni emas,
izohni sinaydi.

**Tuzatish:** `signValid` va `authorized` ni route dan `lib/server/payments.ts`
ga ko'chirib, testdan chaqirish.

#### N-11. Sinovsiz qolgan nozik modullar

`json.ts` (163 qator — kesilgan LLM JSON ni qavs hisoblab tiklaydi),
`llm.ts` (qayta urinish mantig'i), `content.ts`, `scale.ts`,
`lib/viewers/from-html.ts` va `flow.ts` — hech bir test ularni import
qilmaydi. `json.ts` ayniqsa xavfli: u **barcha** JSON so'raydigan
xizmatlarning (slayd, glossariy, keys, dars, xarita, tarjima, rezyume,
IMRAD, annotatsiya) yagona kirish nuqtasi va `dropLastToken` kabi qo'lda
yozilgan holat mashinasidan iborat. Yiqilsa — jim yiqiladi.

#### N-12. Mayda UX

- `ResumeWizard` da «Davom etish» tugmasida ham narx belgisi turadi (1/5-bosqichda).
- `GlossaryViewer` `key={t.term}` — bir xil atama ikki marta kelsa React kaliti to'qnashadi (LLM yo'lida `seen` bilan to'silgan, shablon yo'lida yo'q).
- `SourceFileField` 24 000 belgi ogohlantirishini ko'rsatadi, lekin `MAX_SOURCE` (60 000) kesishi haqida hech narsa demaydi.

---

## 4. Fayl sifati

### 4.1. DOCX — kuchli

| O'lchov | Holat |
|---|---|
| Sahifa va tipografiya | 5 profil (`gost`/`article`/`essay`/`resume`/`landscape`/`reference`) — janr farqi SHART bilan emas, MA'LUMOT bilan |
| OTME/GOST muvofiqligi | Times New Roman 14 pt, 1.5 interval, 3+1.5 sm hoshiya, abzas 1.25 sm — `WORDS_PER_PAGE = 230` real o'lchovdan |
| Titul sahifa | Vazirlik sarlavhasi, imzo chizig'i (`signatureP`), kurs/guruh ajratilgan (`parseAuthorLine`), maqola uchun alohida shakl |
| Mundarija | Word MAYDONI + tayyor paragraflar birga — LibreOffice da ham, Word da ham ishlaydi; sahifa raqami ataylab yozilmaydi |
| Jadval | `columnWidths` + `tblGrid` (usiz Word avto-maketga o'tadi), langarlangan joylashuv |
| Sahifa raqami | Titul raqamsiz (`titlePage: true` + `blankFooter`) |
| Bo'sh bo'lim | Sarlavhasi ham chizilmaydi — oxirgi to'siq |

**Zaif joylar:** akademik sarlavhalar Word ning «Heading 1» uslub rangida
qoladi (LibreOffice da ko'k/to'q sariq chiqadi) — AUDIT-3 §17.4 da ataylab
qoldirilgan, lekin **topshiriladigan hujjatda ko'k sarlavha nuqson** sifatida
ko'rinadi. Buni `gost` profiliga `heading.color: "000000"` qo'shish bilan
yopish mumkin va bu maketni o'zgartirmaydi.

### 4.2. PPTX — kuchli

- `planSlide` — PPTX va sayt ko'ruvchisi uchun **bitta** koordinata manbai;
- `shrinkText: false` — PowerPoint qayta kichraytirmaydi, preview = eksport;
- `Arial` tanlovi metrik moslik uchun asoslangan (Liberation Sans, U+02BB `ʻ`);
- Notiq eslatmalari haqiqatan `addNotes` ga yoziladi;
- Rasm turi **baytlardan** aniqlanadi (`sniffImageType`) — `pptxgenjs` ichidagi parserlarga faqat haqiqiy PNG/JPEG tushadi;
- Rasm o'zimizda saqlanadi (`persistImage`) — provayderning muddatli URL i bazaga tushmaydi.

**Zaif joy:** N-2 (rasm byudjeti). Deck tayyor bo'ladi, lekin rasmsiz.

### 4.3. Rasm (PNG/ZIP) — yaxshi

- Kengaytma haqiqiy MIME dan (`imageExt`) — PNG endi `.jpg` nomi bilan tushmaydi;
- Bir nechta rasm ZIP bo'ladi, `format` yorlig'i yakunlashda haqiqiy faylga moslanadi (`formatOf`);
- Kam yetkazilsa `refundPartial` — 4 tadan 3 tasi kelsa farq qaytadi;
- `dataToBytes` buzuq base64 ni rad etadi (ilgari 3 baytlik «JPEG» saqlanardi).

### 4.4. PDF (talab bo'yicha)

LibreOffice orqali, har o'girishga alohida profil (parallel bloklanmaslik
uchun), 30 MB kirish chegarasi, ruxsat etilganlar ro'yxati (ZIP LibreOffice ga
tushmaydi). `Content-Disposition` sarlavha injeksiyasidan himoyalangan.
Bazada saqlanmaydi — to'g'ri qaror.

---

## 5. Kod sifati — fayllar kesimida

| Fayl | Qator | Baho |
|---|---|---|
| `write-specials.ts` | 1134 | ⚠️ **7 xil xizmat bitta faylda** (glossariy, keys, dars, xarita, rezyume, tarjima, IMRAD). Bo'lish kerak: `write/glossary.ts`, `write/lesson.ts`… |
| `slide-layout.ts` | 1039 | Katta, lekin bir mas'uliyat (maket) — asosli |
| `write-llm.ts` | 1023 | ⚠️ Akademik yozuvchi + insho + dispetcher. Insho (`writeEssayWithLlm`, ~180 qator) alohida faylga chiqishi mumkin |
| `tools.ts` | 828 | Katalog + narx + validatsiya. Narx (`priceFor`, 60 qator `if`) ma'lumot jadvaliga aylantirilsa yaxshi bo'lardi |
| `render-docx.ts` | 601 | Profil abstraksiyasidan keyin toza |
| Qolganlari | < 600 | Yaxshi |

**Izoh sifati — namunali.** Deyarli har qaror «nega shunday, ilgari qanday
edi, nima buzilgan edi» formatida yozilgan. Bu loyihaning eng kuchli
himoyasi va uni saqlash kerak.

**Test qamrovi:** 200 test, `lib/` ning 60 modulidan ~30 tasi sinaladi.
Haqiqiy Postgres testlari bor (`queue`, `credits`, `accounts`, `admin`,
`telegram-link`) — bu kam uchraydigan darajadagi jiddiylik. Bo'shliqlar
N-11 da.

---

## 6. Tavsiya etilgan tartib (Sprint 14)

| # | Ish | Baho | Nega shu tartibda |
|---|---|---|---|
| 1 | **N-1** `deleteGenerationFile` ga `userId` | 30 daq | Xavfsizlik, arzon |
| 2 | **N-4** `tocMethod` ni textarea dan o'rnatish | 1 soat | Foydalanuvchi to'lagan tanlovi yo'qolmoqda |
| 3 | **N-7** `SlideForm` → profil | 30 daq | Bir qatorlik, ko'rinadigan sifat |
| 4 | **N-2** slaydga `deadline` + rasm `delivered` | 1 kun | Premium paket va'dasi bajarilmayapti |
| 5 | **N-3** `WORKER_JOB_TIMEOUT_MS` ni 480 s ga | 30 daq + o'lchov | Eng qimmat tarif eng ishonchsiz |
| 6 | **N-5** klient preflight + hisoblagich | 1 soat | Yo'l boshidan noto'g'ri |
| 7 | **N-6** `features` bayroqlarini ulash | 1 soat | Ishlamaydigan xizmatni sotmaslik |
| 8 | **N-10** `signValid` ni `lib/` ga + test | 2 soat | To'lov imzosi hozir sinalmagan |
| 9 | **N-11** `json.ts` uchun testlar | 3 soat | 9 ta xizmatning yagona kirish nuqtasi |
| 10 | **N-8, N-9, N-12** | 2 soat | Texnik qarz |

**Qamrov mezoni:** har bir tuzatish uchun avval mutatsiya yozilsin
(«bu qatorni o'chirsam qaysi test yiqiladi?») — AUDIT-3 §18 dagi adversarial
supurgi naqshi bo'yicha. `N-2` va `N-4` uchun bu shart: ikkalasi ham
**jim** buziladigan yo'llar.
