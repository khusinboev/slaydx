# AUDIT-15 — Rezyume 2: tuzilmali forma, 6 shablon + surat, pro tahrir, 18 tilda AI qayta yozish

Sana: 2026-09-10. `AUDIT-14` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Forma parametrlari saqlansin; telefon `+` va guruhlar bilan | `resume_drafts` (foydalanuvchiga bitta qator, 1,2 s debounce, `pagehide` da darhol), `PhoneInput`: ekranda `+998 90 123 45 67`, saqlashda `+998901234567` | ✅ |
| T-2 | Kasb/lavozim uchun uz/ru/en tavsiya, chip bilan tanlash | `data/professions.json` (350 kasb, 24 sektor, har biriga 5–12 ko'nikma), `searchProfessions` prefiks/so'z-prefiks/ichida reytingi, `Combobox` (ARIA listbox, chip, o'z matni) | ✅ |
| T-3 | Tajriba pro darajada: kompaniya, sana tanlagich, lavozim tavsiyadan | `RowList` + `MonthPicker` (oy/yil/«hozir»), lavozim `Combobox`; satrlar JSON bo'lib yuboriladi (`validate` `MAX_JSON` 24 000) | ✅ |
| T-4 | Ta'lim parametrlari aqlli — tumbler bilan ochiladigan bloklar | Ta'lim standart holatda ochiq, sertifikat/til/havola yopiq; yopiq blok ma'lumoti holatda qoladi, lekin `[]` yuboriladi | ✅ |
| T-5 | Parametr tartibi qayta ko'rilsin, keraksizi olib tashlansin | 6 karta: Shaxsiy · Maqsad · Tajriba · Ta'lim/Sertifikat/Tillar · Ko'nikmalar · ▸ Sozlamalar; eski erkin matnli `summary`/`experience`/`education` bloblari o'chdi | ✅ |
| T-6 | Bir nechta shablon (suratli/suratsiz), o'z surati, ko'ruvchida pro tahrir | 6 shablon × 6 palitra, surat kesish dialogi (doira → shaffof PNG), ko'ruvchida band/satr tahriri, shablon/rang almashish, suratni markazlash | ✅ |
| T-7 | AI hamma ma'lumotni qayta tartiblab yozsin, boyitsin, 18 tilda chiqarsin | `resume/write.ts`: faktlar FAQAT kirishdan, model — summary/lavozim/band/ko'nikma/yorliq; boyitish ≤2 band + ≤6 ko'nikma (`ai:true`); chiqish tili 18 tadan | ✅ |

Qarorlar (mahsulot egasi): narx **3 000 tanga, hammasi ichida** (shablon, surat, boyitish, til uchun ustama yo'q); chiqish tillari — tarjimondagi 18 til; boyitish faqat lavozimga xos vazifa va ko'nikma (ish beruvchi/sana/diplom hech qachon o'ylab topilmaydi); 6 shablon.

## 2. Arxitektura

```
ResumeComposer ──autosave──▶ PUT /api/resume/draft         (019 resume_drafts)
   surat ──▶ POST /api/uploads/photo                        (019 photo_uploads: kesilgan + asl + {x,y,zoom})
   Yaratish ──▶ POST /api/generations                       (satrlar JSON maydonlarda, MAX_JSON 24 000)
Worker: photoDataUrl → buildArtifact({photo})
  ▼ lib/generation/resume/
    input.ts   resumeInputFromValues  (id'li satrlar e1.., d1..; kesilgan JSON ga chidamli)
    write.ts   prompt (languageDirective + verbatim + boyitish ON/OFF) → JSON → mergeLlm
    guard.ts   id / yil / tashkilot / ai-limit nazorati (skriptga sezgir)
    model.ts   ResumeModel → doc.resume + resumeSections (karta, qidiruv, eski kod)
    layout.ts  planResume(model) → zonalar va itemlar (har birida `path`)   ← YAGONA MANBA
       ├─ resume/render-docx.ts            (ImageRun surat, panel/banner jadvallari)
       └─ components/viewers/resume/ResumePage.tsx   (ko'ruvchi · galereya · tahrir)
Tahrir: ResumeOp[] → PATCH /api/generations/{id}/doc → edit-adapters (slide | resume) → DOCX qayta yasaladi → eskiz yangilanadi
```

## 3. Sinov

- **Jonli** (`npm run live -- resume …`, haqiqiy Gemini): uz kirish → `en` chiqish 11/11 yashil (summary 360 belgi, kompaniyalar verbatim, kirishda yo'q yil yo'q, xronologik tartib, `ai` shifti 1–2/ish joyi, 1 bet, ~3 s); `--lang de --enrich-off` 11/11 (yorliqlar «Berufserfahrung · Ausbildung» — modeldan, 0 ta `ai`); `--lang ja` yorliqlar 職務経歴 · 学歴; `--photo <fayl>` bilan DOCX ichida rasm (11 KB → 101 KB).
- **Jonli sinov topgan uchta nuqson** (unit testlar ko'rmagan, hammasi tuzatilgan): (1) tarjima qilingan lavozim/daraja qo'riqchi tomonidan o'zbekchaga QAYTARILARDI — endi tashkilot tekshiruvi `role`/`degree` ga umuman qo'llanmaydi; (2) qisqacha uzunlik darvozasi qo'riqchidan OLDIN o'lchardi — endi keyin, chegara 200; (3) qo'riqchi ikki bosh harfli har qanday birikmani tashkilot deb bilardi (`Financial Analyst`, nemischa `Management-Reporting`) va qisqachaning eng kuchli jumlasini tashlardi — endi tashkilot MARKERI (`GmbH, LLC, MChJ, Bank, Universitet…`) yoki akronim talab qilinadi.
- **Brauzer (Chromium, admin sessiya)**: forma → telefon `+998 90 123 45 67` → kasb typeahead («бухг» → Buxgalter) → ish joyi + oy/yil → surat yuklash va kesish → shablon dialogi (6 karta, palitra) → qayta yuklashda qoralama tiklandi → «Yaratish» 3 000 tanga → natija sahifasi. Smoke ikki nuqsonni topdi: (a) `ToolWorkspace` hali ESKI sehrgarni chizardi (kommit orasida yo'qolgan o'zgarish — endi dispatch testi bor), (b) galereya namunasi `/samples/resume-photo*` ni so'rar, fayllar yo'q edi (404) — endi neytral avatar chizmasi qo'shildi.
- **HTTP integratsiyasi**: 12 ta ish joyi × 6 band + 8 ta ta'lim (JSON maydon 9,2 KB) `POST /api/generations` orqali o'tdi va 2 betlik DOCX bo'lib qaytdi — B-3 (`MAX_JSON` 24 000) haqiqiy yo'lda tasdiqlandi.
- **Ishlab chiqarish buildi**: `npm run build` toza (ogohlantirishsiz), `data/professions.json` bundle ichida; worker tasviriga ham `data/` ko'chiriladi.
- **Testlar**: unit **1096/1098**, ko'ruvchi **91/91**, UI **110/110**; `tsc` va `eslint` toza. Ikkita yiqilgan test — `document.test.mts` dagi rasm provayderi bandlari; ular sprintdan OLDINGI `5126177` kommitida ham AYNAN shunday yiqiladi (`fal.ai` hisobi bloklangan, `.env.local` ga bog'liq) — Rezyume 2 ga aloqasi yo'q.
- **Yangi testlar (~170)**: dvigatel `resume-{params,guard,model,layout,write}` 70; render/tahrir `resume-{docx,edit,commit}` 64; ko'ruvchi `viewer/resume-{parity,legacy,form}` 28; forma va primitivlar `ui/resume-{primitives,composer,viewer-edit}` 25; server/ma'lumot `phone`, `photo`, `photo-crop`, `professions`, `resume-draft` 29.
- **Mutatsiya**: dvigatel 25/25, render-tahrir 6/6, lead qismi 4/4 (telefon guruhlash naqshi, kesim klampi, kasblar ru/en indeksi, forma `data-field` qamrovi) — har biri nomli testni qizartirdi. Ikki mutant BO'SH assertionni ochdi (`sortDesc` `mergeLlm` da o'lik kod edi; daraja regressiyasi tashkilot nomzodi yasamaydigan satrga tayangan) — ikkalasi ham tuzatildi.
- **Ko'z bilan** (LibreOffice PDF → PNG): 6 shablon; ikki haqiqiy nuqson topildi va tuzatildi — `w:lineRule` berilmagani uchun 36 mm surat ~5 mm tasmaga siqilardi, va yalang'och `Tab` XML ga chiqmay davr matnga yopishardi. Lead tomondan: `twocol` da 2-betda panel mazmun qadar (ko'ruvchi ham shunday — paritet qulflandi), ko'nikma «chiplari» ikkala tomonda ham oddiy oqim + « · ».

## 4. Bajarilish yozuvi

- Ikki opus agent alohida worktree'da: **WP1 dvigatel** (`e6a5f21`, `8211330`, `6227e95`, `eb466a2`), **WP2 render/ko'ruvchi/tahrir** (`9648b3a`, `90caa3d`, `1d41222`, `e1e35fd`, `e39252d`). Lead: poydevor (`d6249c1`), server+ma'lumot+primitivlar (`aa0110f`), forma ulanishi (`d5052b9`), forma testlari (`4f88218`), hujjatlar (`3474b83`) va tuzatishlar.
- **Ish taqsimoti qoidasi**: har agent faqat O'Z fayllarini o'zgartirdi; umumiy `types.ts` va `layout.ts` sprint boshida bitta «tiplar poydevori» kommiti bilan qotirildi — shu sabab 9 ta birlashmada bironta konflikt bo'lmadi.
- **Jonli sinov to'rtta nuqson topdi** (unit testlar ko'rmagan): tarjima qilingan lavozim/darajaning qaytarilishi; uzunlik darvozasining qo'riqchidan oldin o'lchashi; ikki bosh harfli birikmani tashkilot deb bilish; uzunlik chegarasining YOZUV TIZIMIGA bog'lanmagani (yapon tilida 209 belgi «qisqa» sanalardi). **Brauzer smoke'i ikkitasini topdi**: eski sehrgar sahifada qolib ketgani va galereya namunasidagi 404. Bularning bittasi ham jsdom/SSR testida ko'rinmasdi — `docs/AUDIT-11` dagi «brauzer smoke'i shart» xulosasi yana tasdiqlandi.
- **Ochiq bandlar**: (1) surat shakli shablonga mos kelmasa forma ogohlantiradi, ko'ruvchi esa avtomatik qayta kesmaydi; (2) faylda yon panel 2-betdan boshlab mazmun qadar (har betda to'liq bo'lishi uchun kolontitulga langarlangan shakl kerak — alohida ish); (3) `legacyResumeModel` eski `li` blokini bitta ko'nikma qiladi; (4) tor panelda uzun bir so'zli ko'nikma LibreOffice'da bo'linadi; (5) `resumeMainHeightPx` 1-varaq chegarasini hamma varaqqa qo'llaydi (banner shablonida keyingi varaqlar ozgina bo'sh qoladi — kesilgandan xavfsizroq); (6) `photo_uploads` 90 kundan keyin tozalanadi — eski `photoAssetId` bilan qayta yaratishda rezyume suratsiz chiqadi.

## 5. Deploy (2026-09-10)

- Zaxira: `slaydx-20260910205843.sql` (332 MB), `ROLLBACK.txt` → `5126177`. Deploy: `bash /opt/slaydx/deploy.sh`, HEAD **`5902c7b`**; `019_resume.sql` qo'llandi, `resume_drafts` va `photo_uploads` jadvallari bor, `/api/health` 200, worker ko'tarildi. Boshqa loyihalar (nodav-*, call-tizim-*, mser) tegilmadi.
- **Prod smoke** (admin sessiya, Chromium, `https://slaydxx.uz`): forma → telefon formatlanishi → kasb typeahead → ish joyi → surat kesish va yuklash → shablon galereyasi (6 karta) → qoralama qayta yuklashdan keyin tiklandi → «Yaratish» 3 000 tanga → natija → banddagi tahrir saqlandi → ko'ruvchida shablon `creative/plum` ga o'zgardi va saqlandi. **Sahifa xatolari yo'q.**
- **Eski rezyume** (2026-09-06 da yaratilgan, `doc_json.resume` siz) yangi ko'ruvchida `legacyResumeModel` orqali to'g'ri ochildi — panel, aloqa, ko'nikmalar, tajriba joyida, xato yo'q.
- Prod DOCX: 436 KB, tahrir matni va surat media faylida; karta eskizi (`/thumb`) 200; `resume_drafts` qatori paydo bo'ldi.
