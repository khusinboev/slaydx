# AUDIT-15 — Rezyume 2: tuzilmali forma, 6 shablon + surat, pro tahrir, 18 tilda AI qayta yozish

Sana: 2026-09-10. `AUDIT-14` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Forma parametrlari saqlansin; telefon `+` va guruhlar bilan | `resume_drafts` (foydalanuvchiga bitta qator, 1,2 s debounce, `pagehide` da darhol), `PhoneInput`: ekranda `+998 90 123 45 67`, saqlashda `+998901234567` | ⏳ |
| T-2 | Kasb/lavozim uchun uz/ru/en tavsiya, chip bilan tanlash | `data/professions.json` (350 kasb, 24 sektor, har biriga 5–12 ko'nikma), `searchProfessions` prefiks/so'z-prefiks/ichida reytingi, `Combobox` (ARIA listbox, chip, o'z matni) | ⏳ |
| T-3 | Tajriba pro darajada: kompaniya, sana tanlagich, lavozim tavsiyadan | `RowList` + `MonthPicker` (oy/yil/«hozir»), lavozim `Combobox`; satrlar JSON bo'lib yuboriladi (`validate` `MAX_JSON` 24 000) | ⏳ |
| T-4 | Ta'lim parametrlari aqlli — tumbler bilan ochiladigan bloklar | Ta'lim standart holatda ochiq, sertifikat/til/havola yopiq; yopiq blok ma'lumoti holatda qoladi, lekin `[]` yuboriladi | ⏳ |
| T-5 | Parametr tartibi qayta ko'rilsin, keraksizi olib tashlansin | 6 karta: Shaxsiy · Maqsad · Tajriba · Ta'lim/Sertifikat/Tillar · Ko'nikmalar · ▸ Sozlamalar; eski erkin matnli `summary`/`experience`/`education` bloblari o'chdi | ⏳ |
| T-6 | Bir nechta shablon (suratli/suratsiz), o'z surati, ko'ruvchida pro tahrir | 6 shablon × 6 palitra, surat kesish dialogi (doira → shaffof PNG), ko'ruvchida band/satr tahriri, shablon/rang almashish, suratni markazlash | ⏳ |
| T-7 | AI hamma ma'lumotni qayta tartiblab yozsin, boyitsin, 18 tilda chiqarsin | `resume/write.ts`: faktlar FAQAT kirishdan, model — summary/lavozim/band/ko'nikma/yorliq; boyitish ≤2 band + ≤6 ko'nikma (`ai:true`); chiqish tili 18 tadan | ⏳ |

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

> Bo'lim sprint davomida to'ldirilib boradi; ko'ruvchi/tahrir qismi WP2–WP4 tugagach yakunlanadi.

- **Jonli** (`npm run live -- resume …`, haqiqiy Gemini): uz kirish → `en` chiqish 11/11 yashil (summary 360 belgi, kompaniyalar verbatim, kirishda yo'q yil yo'q, xronologik tartib, `ai` shifti 1–2/ish joyi, 1 bet, ~3 s); `--lang de --enrich-off` 11/11 (yorliqlar «Berufserfahrung · Ausbildung» — modeldan, 0 ta `ai`); `--lang ja` yorliqlar 職務経歴 · 学歴; `--photo <fayl>` bilan DOCX ichida rasm (11 KB → 101 KB).
- **Jonli sinov topgan uchta nuqson** (unit testlar ko'rmagan, hammasi tuzatilgan): (1) tarjima qilingan lavozim/daraja qo'riqchi tomonidan o'zbekchaga QAYTARILARDI — endi tashkilot tekshiruvi `role`/`degree` ga umuman qo'llanmaydi; (2) qisqacha uzunlik darvozasi qo'riqchidan OLDIN o'lchardi — endi keyin, chegara 200; (3) qo'riqchi ikki bosh harfli har qanday birikmani tashkilot deb bilardi (`Financial Analyst`, nemischa `Management-Reporting`) va qisqachaning eng kuchli jumlasini tashlardi — endi tashkilot MARKERI (`GmbH, LLC, MChJ, Bank, Universitet…`) yoki akronim talab qilinadi.
- **Brauzer (Chromium, admin sessiya)**: forma → telefon `+998 90 123 45 67` → kasb typeahead («бухг» → Buxgalter) → ish joyi + oy/yil → surat yuklash va kesish → shablon dialogi (6 karta, palitra) → qayta yuklashda qoralama tiklandi → «Yaratish» 3 000 tanga → natija sahifasi. Smoke ikki nuqsonni topdi: (a) `ToolWorkspace` hali ESKI sehrgarni chizardi (kommit orasida yo'qolgan o'zgarish — endi dispatch testi bor), (b) galereya namunasi `/samples/resume-photo*` ni so'rar, fayllar yo'q edi (404) — endi neytral avatar chizmasi qo'shildi.
- **HTTP integratsiyasi**: 12 ta ish joyi × 6 band + 8 ta ta'lim (JSON maydon 9,2 KB) `POST /api/generations` orqali o'tdi va 2 betlik DOCX bo'lib qaytdi — B-3 (`MAX_JSON` 24 000) haqiqiy yo'lda tasdiqlandi.
- **Ishlab chiqarish buildi**: `npm run build` toza (ogohlantirishsiz), `data/professions.json` bundle ichida; worker tasviriga ham `data/` ko'chiriladi.

## 4. Bajarilish yozuvi

(sprint yakunida to'ldiriladi)
