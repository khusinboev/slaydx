# AUDIT-10 — Jonli generatsiya va ko'ruvchida tahrirlash («pro daraja»)

`AUDIT-9` ni DAVOM ETTIRADI. U yerda har forma parametri ishlaydigan
bo'ldi; bu sprintda foydalanuvchi dekani **yaratilayotgan paytda**
ko'radi va tayyor dekani **ko'ruvchida tahrirlaydi** — PPTX esa
tahrirga ergashadi («ko'rdim = oldim» saqlanadi).

Foydalanuvchi talabi (2026-09-09): *«pagelarga matn yozilayotgani, rasm
izlanib qo'yilganlari — barchasi jonli ko'rinib tursin; matn ustiga
ikki marta bosib o'zi qo'lda o'zgartira olsin»*.

Ish 20 ta parallel paket bilan olib borildi (worktree, fayl egaligi):
F0/F1/F1a/F1b/F2 poydevor, L1–L5 jonli, E1–E8 tahrir, I integratsiya.

## 0. P0 hotfix (F0)

Pro slayd Word ko'ruvchisida ochilardi — `viewerKind` da `pro-slide`
yo'q edi. Tuzatildi va test endi CHIQISH FORMATI bo'yicha: har PPTX
vosita → `slides`, PNG → `image`. Deploy `f8c33c8`.

## 1. Jonli generatsiya

**Hodisa modeli** (`lib/generation/slide-progress.ts`): dvigatel
`onProgress(ev)` orqali `plan → stage → research → slide(index) → deck →
images(wait) → image(index,url) → done` chiqaradi; `applyLiveEvent`
sof reduktori `LiveDeck` yig'adi (progress MONOTON).

**Oqim** (`llm.ts` `llmStream`): Gemini `streamGenerateContent?alt=sse`,
**opt-in** — faqat `onProgress` berilganda; `llmComplete` o'zgarmadi
(mavjud stublar buzilmadi); `LLM_STREAM=false` kill-switch; 4xx →
oqimsiz zaxira; `thought` qismlari tashlanadi. `slide-write.ts`
`extractNewSlides` — `parseLlmJson` yarim elementni saqlagani uchun
`length-1` gacha «tayyor»; `emittedAbs` retryda takror bermaydi;
bo'lak tugaganda oqimsiz yo'lda ham slaydlar guruh bo'lib chiqadi.
`plan` hodisasi LLM dan OLDIN — skelet darhol.

**Kanal** (`013_live_edit.sql`): `live_json` + `live_seq`; worker
`LiveReporter` (`lib/server/live.ts`) ≥400 ms koalessiya, `locked_by`
predikati + heartbeat, rasm baytlari darhol `putAssets` (JSONB da faqat
asset URL), 1.5 MB chegara. `progress/step` endi HAQIQIY («Matn
yozilmoqda · 7/12 slayd») — bosh sahifa kartochkasi ham shuni ko'rsatadi.

**Transport**: polling `?since=liveSeq` (o'zgarmagan javob yuborilmaydi),
`IN_PROGRESS + live` da 1.2 s. SSE — V2.

**Ko'ruvchi**: `SlideViewer` → `SlideRail` + `SlideStage` + `useSlideKeys`
(HTML bayt-baytiga eskicha — snapshot testi); `SlideCanvas.reveal`
(`undefined` → paritet o'zgarmaydi); `SkeletonSlide`, `LiveStrip`,
`ImageWaitPlaque` (`photoSlot` qutisida), `useReveal` (rAF typing,
`prefers-reduced-motion`, auto-follow, `final` da typing yo'q).

## 2. Ko'ruvchida tahrirlash

**Manba ko'rsatkichi**: `SlideLayer.text.src / srcLines` — har `plan*`
funksiyasida (E1/E2), dekorativ qatlamlar `src`siz; PPTX `paintLayer`
`src` ni o'qimaydi (statik test). `SlideCanvas` `data-src`.

**Sof mantiq** (`slide-edit.ts`): `DocOp` 9 tur (`text/notes/image/
layout/add/delete/insert/set/reorder`), `applyDocOps` (indeks, oxirgi
slayd, permutatsiya, o'z aktivi URL, `photoSlot`), `inverseOps` (aylanma
tenglik har op uchun), `sanitizeSlideModel` (oq-ro'yxat), `convertLayout`
(27 ruxsat etilgan yo'nalish, 13 tasi yo'qotishli; 155 taqiq, sababi
bilan), `parseDocOps` (≤50 op, ≤4000 belgi). `SLIDE_LIMITS` yagona
chegara jadvali — `normalizeSlide` ham shundan o'qiydi.

**Server**: `PATCH …/doc {baseVersion, ops}` (409 `version/status/legacy`,
422 `{error, at}`), `POST …/rebuild` (advisory lock, render
tranzaksiyadan tashqarida, `file_version < doc_version` bo'lsagina),
`GET …/file` eskirgan faylni HECH QACHON bermaydi; rasm: `POST
…/slides/{i}/image` (sniff, ≤5 MB), `…/image/regenerate` (bepul,
`image_redraws < 5` bitta UPDATE predikatida, yiqilsa `releaseRedraw`,
`seed` tasodifiy). Aktivlar `assetImageResolver` orqali — faqat o'z
`/api/generations/{id}/assets/` URL'lari, SSRF himoyasi saqlanadi.

**Klient**: `useSlideEdit` (optimistik `applyDocOps`, 400 ms koalessiya,
bitta in-flight PATCH, undo/redo 100, 409 → qayta yuklash, 3 s
rebuild debounce, `ensureFresh`), `SlideEditor` overlay (dblclick →
textarea, Enter/Esc/blur), toolbar (maket chip'lari, + Slayd, O'chirish,
▲/▼, DnD eskizlar), notes textarea, Ctrl+Z.

## 3. Test infrastrukturasi

`npm run test:ui` — jsdom + Testing Library (dblclick/Enter/Esc/DnD/
Ctrl+Z). `npm run check` endi 4 yo'l: typecheck+lint+unit+viewer+ui.

## 4. Jonli sinovda topilganlar

| № | Topilma | Holat |
|---|---|---|
| Y-1 | Gemini prepaid krediti tugagan — `429 credits depleted`; serverdagi worker ham yiqilmoqda (kredit qaytariladi) | ✅ vaqtinchalik kalit (lokal); serverga — foydalanuvchi ruxsati bilan |

**Jonli oqim isboti** (`npm run live -- pro-slide`, 10 slayd, internet, 3 test):

```
+0.0s  plan 10 slayd            ← skelet LLM dan OLDIN
+5.8s  research 6 manba
+7.0s  slide #0 … +11.8s slide #9   ← 10 slayd 4.8 s ichida BIRMA-BIR (oqim)
+11.8s deck · images 5 kutilmoqda
+28.6s image #1 … +35.0s image #0   ← rasmlar tartibsiz, indeks bilan
+35.2s done                      ← jami 35 s (AUDIT-9 da 81 s edi)
```
Barcha 9 tekshiruv yashil (10/10 slayd, 2 quiz + javoblar, 6 manba,
5 rasm, izoh faylda yo'q, kolontitul).

## 5. Bajarilish yozuvi

`main`: F0 `f8c33c8`, F1 `bb49a1f`, F2/F1a/F1b, L1 `565a3fd`, L2 `fcbe36b`,
L4 `d3b911a`, E1 `c7c21fd`, L5 `4589731`, L3+E4 `d5a7c21`, E8 `3df0dda`,
E5 `849257d`, E6 `e924f29`+`825bf62`. Testlar: **751 unit + 49 viewer + 25 ui**, lint toza.

Jonli kanal (worker → `live_json`) `scripts/live-worker.mts` bilan tasdiqlandi:
`seq 0→12`, «Matn yozilmoqda · 1/10 … 9/10 slayd» → «Rasmlar · 0/6» →
«Yig'ilmoqda…» → COMPLETED da `live_json = NULL`.

Admin hisobida (`adkhambek_4`) serverda namunalar: slayd `382177a0…`,
pro slayd `2d33bdee…` — ikkalasi COMPLETED.

## 6. Qo'shimcha (2026-09-10) — foydalanuvchi ekran rasmlari asosida

| Talab | Holat |
|---|---|
| «Mening fayllarim» kartochkasida 1-slayd ko'ruvchidagidek | ✅ `preview.slide` + `FilePreview` `SlideCanvas` renderi; eski dekalar `scripts/backfill-preview.mts` bilan (serverda 21/21) |
| Eskizlarni sudrab tartiblash doim | ✅ toggle'siz, tashlash chizig'i, ▲/▼ |
| Ikki bosish → joyida tahrir + shrift o'lchami | ✅ `SlideModel.fontSize` (kalit — `src` JSON), `style` op, `applyFontOverrides` `planSlide` OXIRIDA — PPTX va ko'ruvchi bir xil; panel: −/+, 12…66, «Standart» |
| Tashqariga bitta bosish yopadi, tepada «Saqlash» | ✅ qo'lda saqlash (bitta PATCH + rebuild), Ctrl+S, `beforeunload`; avtomatik PATCH yo'q |
| «Tahrirlash» tugmasi olib tashlansin | ✅ |
| E2 — rasm tasmalari | ✅ twoCol/compare/stats/process/table (`photoSlot` kengaytirildi) |
| Pexels → Pixabay → fal | ✅ `chainProvider`, `searchQueryFor`; kalitlar `PEXELS_API_KEY`/`PIXABAY_API_KEY` (bo'lmasa fal — eskicha) |
| Footer / test javobi tahriri, «asl holatga qaytarish» | ✅ `footer`/`answer` op'lari, `014_doc_prev.sql`, `POST …/doc/restore`, `hasPrev` — UI tugmalari keyingi qadam |

**Y-2 (topildi va tuzatildi):** `tests/ui/*` da `assert.equal(<jsdom tugun>, null)` yiqilganda
`node:assert` tugunni `util.inspect` bilan chizishga urinib jarayonni QOTIRIB, xotirani
shishirar edi — `npm run test:ui` osilib, laptop OOM ga tushgan (VS Code qulashlari shundan).
Qoida: DOM tugunini `=== null, true` bilan solishtiring; og'ir buyruqlar `systemd-run --scope
-p MemoryMax=…` va `timeout -s KILL` ostida, ajratilgan holda.

**Y-3 (haqiqiy nuqson):** taqdimot (`present`) rejimida tahrir qatlami chiqar edi — `editOn && !present`.

Testlar: **800 unit + 56 ko'ruvchi + 40 UI** (xotira cheklovi bilan), tsc/lint toza.
Deploy: `31cfe84` → `ec6a49c` (014 migratsiyasi).
