# AUDIT-13 — Shablonlar 2: 10 alohida dizayn, haqiqiy preview galereyasi, «O'z shablonim» (Pro)

Sana: 2026-09-10. `AUDIT-12` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Shablon tanlashda taqdimot qanday bo'lishini aniq ko'rish; shablonlar bir-biridan keskin farq qilsin (dumaloq rasm, chap/o'ng rasm…); 1-varaq shablon yuzasida | 14 → **10 shablon, 10 alohida dizayn** (`lib/generation/visuals/`), galereya `SlideCanvas` bilan haqiqiy titul + 3 eskiz, rang swatchlari galereya ostida | 🔄 Sprint A |
| T-2 | «O'z shablonim» (Pro): PPTX namuna yuklab, shu shablonda chiqarish; ko'proq vaqt ogohlantirishi | Haqiqiy shablon — namuna master/layout/temasi saqlanadi, slaydlar OOXML placeholder'larga; LibreOffice+pdftoppm rasterlash; ustamasiz | ⏳ Sprint B |

## 2. Arxitektura (Sprint A)

- `VisualSpec` (`visuals/spec.ts`): `base` (eski oila), `photo[layout]`, `fullBleed`, `plan[layout]`. `slide-layout.ts` `dispatch`/`photoSlot` avval dizaynni, keyin `base` ni chaqiradi. Eski 7 oila (`classic…dense`) kodda qoladi — eski `doc_json` va testlar uchun.
- Qatlam kengaytmalari: `image.shape: "circle"` (PPTX `rounding`, ko'ruvchi `border-radius: 50%`), `rect.shadow` (PPTX `shadow`, `box-shadow`) — paritet testi.
- Reyestr: `story` = literature + bio + magazine, `pitch` += problem, `timeline` += process; aliaslar `LEGACY_TEMPLATE_ALIASES`; `defaultTheme` har shablonda.
- Namuna dekalar `slide-samples.ts` (9 slayd, o'zbekcha, `public/samples/` Pexels fotolari) — galereya va `npm run shots` (PPTX → PDF → PNG) BITTA manbadan.

## 3. Sinov

- `tests/slide-visuals.test.mts`: har shablon × 14 maket × 3 tema × qisqa/uzun × rasmli/rasmsiz — chegara, shrift poli; `src` qoidasi; `photoSlot`; dizayn noyobligi; juftlik farqi (titul/bo'lim/bandlar/reja/iqtibos/yakun).
- `tests/ui/template-gallery.test.mts`, `tests/viewer/parity.test.mts` (dumaloq/soya).
- Ko'z bilan: `npm run shots` (10 × 9 PNG, 3 palitra).

## 4. Bajarilish yozuvi

A1–A2 yadro `11d589f`, A3 galereya (keyingi kommit). Dizaynlar: 2 opus agent (5+5, worktree).
