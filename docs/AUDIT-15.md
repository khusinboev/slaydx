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

(sprint yakunida to'ldiriladi)

## 4. Bajarilish yozuvi

(sprint yakunida to'ldiriladi)
