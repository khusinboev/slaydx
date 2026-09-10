# Dizaynlar (Shablonlar 2) — ishlab chiqish brifi

Har fayl `<id>.ts` — bitta shablonning dizayni (`VisualSpec`, `spec.ts`).
`slide-layout.ts` `dispatch` avval `plan[layout]` ni, bo'lmasa `base`
oilasini chaqiradi; `photoSlot` esa `photo[layout]` ni.

## Majburiy minimum (har dizayn)

`plan` da: `title`, `section`, `bullets`, `agenda`, `quote`, `closing`.
Shular dizaynni ajratib turadi (`tests/slide-visuals.test.mts` juftlik
farqini shu maketlarda tekshiradi). `twoCol`/`compare`/`stats`/`process`/
`table` — xohlasangiz; bo'lmasa `base` chizadi.

## Asboblar — `LAYOUT_KIT` (`slide-layout.ts`, FAQAT funksiya ichida o'qing — ESM sikli)

```ts
import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
const { fitSize, fitLines, inkHeight, bulletGap, pushFooter, planHeading, photo, W, H, M, FOOT_Y, LOGO_BOX, SECTION_TOP, SECTION_BOTTOM } = LAYOUT_KIT; // funksiya ICHIDA
```

- `fitSize(text, box, basePt, minPt)` — qutiga sig'adigan eng katta shrift.
- `fitLines(lines, box, basePt, minPt, paraSpacePt)` — ro'yxat uchun.
- `inkHeight(text, w, pt)` — matn necha dyuym balandlik oladi (markazlash uchun).
- `bulletGap(lines, box, pt)` — bandlar orasidagi oraliq (pt).
- `pushFooter(layers, s, theme, index, total, {x, w}, light)` — kolontitul, HAR slaydda.
- `photo(layers, url, box, dim)` — rasm + qoraytirish; `url` yo'q bo'lsa hech narsa chizmaydi — rasm o'rnini dekor bilan to'ldiring.
- Slayd 13.333 × 7.5 dyuym; `M` = 0.5 chekka; `FOOT_Y` = 7.14; logo `LOGO_BOX` (o'ng yuqori, x 12.15) — yuqori sarlavhalarni `ctx.reserve` ga toraytiring.

## Qatlamlar

- `{ t: "rect", box, fill?: {color, alpha?}, line?, radius?, shadow? }`
- `{ t: "image", box, url, fit?, shape?: "circle" }` — dumaloq uchun KVADRAT quti.
- `{ t: "text", box, text | lines, color, size, bold?, italic?, align?, valign?, bullets?, paraSpace?, tracking?, uppercase?, font?, src?, srcLines? }`
  - `font: "Georgia"` (serif) — `slide-fonts.ts` reyestridagi `face`; PPTX va ko'ruvchi bir xil.

## Qoidalar (testlar bilan qulflangan)

1. **Chegara** — har qatlam 0..W × 0..H ichida.
2. **`src`** — modeldan kelgan har matn: `{f:"title"}`, `{f:"subtitle"}`, `{f:"kicker"}`,
   `{f:"quote"}`, `{f:"quoteBy"}`; ro'yxat — `srcLines: items.map((_, i) => ({f:"bullets", i}))`.
   Dekorativ matn (raqam «01», «→», tirnoq) `src`SIZ.
3. **Ranglar — faqat o'lchangan juftliklar** (`tests/themes.test.mts`):
   yorug' sahifa (`theme.bg`/`surface`): `text`, `muted`, `accentInk`;
   to'q sahifa (`theme.titleBg`): `titleText`, `titleMuted`. `accent`/`accent2` —
   FAQAT to'ldirish (chiziq, blok, nuqta), matn rangi EMAS.
4. **Rasm yo'q bo'lsa ham maket to'liq** — rangli blok, katta raqam, chiziq.
5. **Shrift poli** — tana `ctx.bodyType.bodyPt`/`minPt` (auditoriya), sarlavha ≥ 16, kolontitul 11.
6. **Bandlar soni** — `ctx.bodyType.maxBullets` / `agendaMax` bilan kesing.
7. Kod izohlari o'zbekcha. Hech qanday tashqi resurs (font fayli, rasm) yo'q.

## Ko'z bilan tekshirish

```bash
npm run shots -- <id>        # eval-out/visuals/<id>-1..9.png (PPTX → PDF → PNG)
THEME=chalk npm run shots -- <id>
```
Har 9 slaydni ko'ring: bo'sh maydon, ustma-ust tushish, o'qilmaydigan rang, kesilgan matn — hammasi
shu yerda ko'rinadi. Dizayn 15 palitrada ham buzilmasin (kamida 3 tasini ko'ring: standart, `chalk`, `ink`).
