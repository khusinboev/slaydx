# «Titul» — free title-page builder

Owner request: «Kurs ishi, Diplom ishi va Mustaqil ishlar uchun TITULKA tayyorlash — BEPUL». The user fills a form and
gets ONE A4 Word page that looks the same in the web viewer and in the DOCX, and can edit its texts afterwards.

Tool: `ToolId "title-page"`, slug `titul`, group `talaba`, `custom: "titul"`, `basePrice: 0`. No LLM, no network: the
page is a pure function of the form values.

## Work types (heading)

| id | form label | heading (uz) |
|---|---|---|
| `coursework` | Kurs ishi | KURS ISHI |
| `bmi` | Diplom ishi (BMI) | BITIRUV MALAKAVIY ISHI |
| `independent` | Mustaqil ish | MUSTAQIL ISH |
| `referat` | Referat | REFERAT |
| `practice` | Amaliyot hisoboti | AMALIYOT HISOBOTI |
| `lab` | Laboratoriya / amaliy ish | LABORATORIYA ISHI / AMALIY ISH (+ «№ N») |
| `master` | Magistrlik dissertatsiyasi | DISSERTATSIYA (own arrangement) |

## Layouts

Offered per type (`TITUL_LAYOUTS_OF`, first = default): coursework / independent / referat → classic, mavzusida,
right-block; practice / lab → classic, right-block, mavzusida; bmi → bmi-official, classic, right-block; master →
dissertation only.

- `classic` — the owner's sample: double page border, bold caps head (ministry, university, «… FAKULTETI»,
  «… KAFEDRASI»), «<FAN> FANIDAN», 28 pt spaced heading, «Mavzu:» + topic on an underline, «Bajardi:» / «Qabul qildi:»
  name on an underline with a small italic note under it, «TOSHKENT — 2026». Margins 20/22/18/22 mm. Tuned against the
  sample PDF to ±2 mm (`scripts/titul-shots.mts`).
- `mavzusida` — «"Fan" fanidan», topic, «mavzusida», heading; «Bajardi: … guruh talabasi Name», «Qabul qildi: …».
- `right-block` — centred heading and «Mavzu: …»; the author / teacher block right-aligned, no lines.
- `bmi-official` — «Himoyaga ruxsat etilsin» + dean / head of department + date blank (right); direction, student,
  NAME, TOPIC, «mavzusidagi», heading; «Ilmiy rahbar: … ____ Name», optional «Taqrizchi».
- `dissertation` — university, «"KAFEDRA" KAFEDRASI», «Qo'lyozma huquqida» + UDK (right), NAME, TOPIC, purpose line,
  «DISSERTATSIYA», «Ilmiy rahbar» (right), «TOSHKENT – 2026».

## Fields

`lib/generation/title-page/input.ts`: `TITUL_FIELD_IDS` (29 ids = `TitulInput` keys = `FormValues` keys =
`data-field` probes). `titulFieldsOf(type, layout, ministry)` is the list the form draws; every listed field changes
the page and every unlisted one does not (`tests/titul-params.test.mts`). Topic is the only required field. Label
language: Uzbek Latin (default), Uzbek Cyrillic, Russian — `i18n.ts titulLabels`; user texts stay as typed (a typed
«Toshkent» follows the label script). Prefill from the saved profile (university, faculty, department, subject,
author, group, course, teacher → supervisor, city); author / subject are written back after «Yaratish». The form
draft (`useFormDraft`) brings back the same values when the user returns to the form.

Empty optional fields produce nothing (no dangling labels). Names on signature positions stay: an underline row keeps
its blank line; non-underlined layouts get «____________________».

## Model — one plan, two renderers

`planTitlePage({ input, overrides })` (`layout.ts`) returns zones (top / middle / bottom: height in mm, vertical
alignment) + a tail (city–year) of paragraphs (runs with stable ids, pt size, line multiple, letter spacing,
before/after, indent) and underline rows. Zone heights + tail fill the page minus 3 mm slack; `fitZone` shrinks a
zone's type in 5 % steps (from a generous width estimate) when long texts would not fit, so both renderers get the
same sizes.

- DOCX (`render-docx.ts`): zones = rows of one borderless table (height «at least», cell vertical alignment), tail =
  the paragraph after it; underline rows = nested 2-column tables with a bottom border; `lineRule="auto"` on every
  spacing, paragraph-mark sizes set explicitly; the frame is `w:pgBorders` double, offset from the page edge.
- Viewer (`components/viewers/titul/TitulPage.tsx`, `TitulViewer.tsx`): the same zones / paragraphs / rows in mm and pt
  (line = 1.15 × size), CSS double border at the same offset.
- Stored as `AcademicDoc.titul` (`TitulModel = { input, overrides }`); `renderDocx` draws `doc.titul` first.

Proof: `tests/titul-layout`, `titul-docx` (incl. LibreOffice one page at maximal lengths for every type × layout × uz/ru),
`viewer/titul-viewer` (viewer runs = plan runs = DOCX text), `ui/titul-viewer-edit`, `ui/titul-composer`.

## Editing

«Tahrirlash» in the viewer: double click / tap any text, Enter keeps, Esc cancels. One op `{ op: "text", id, value }`
(`edit.ts`); `id` must be a run of the page generated without edits; `value: null` restores the generated text; an
empty value removes the paragraph (undo brings it back). Server: `edit-adapters.ts titulAdapter` (PATCH doc → file
rebuild through `renderDocx`).

## Free and safe

- Price 0 on the server (`basePriceFor` → `basePrice`); `applyPriceAdjust(0, any)` = 0 (the `max(roundTo, …)` floor
  used to turn 0 into ≥ 100 so'm); the UI shows «Bepul» (`formatPrice`).
- Charge path: `chargeInTx` returns ok for 0 without a ledger row; the job completes; a refund is a no-op
  (`tests/titul-free.test.mts`, real Postgres).
- Abuse guard: `title.daily_limit` (default 30, 0 = unlimited, admin «Navbat va generatsiya» tab) — count of the
  user's `title-page` generations since Tashkent midnight, checked in `prepareGeneration`; 429 `daily_limit` with an
  Uzbek message.
- Not sold in the market (not in `MARKET_TOOLS`); does not unlock the one-time rating bonus (`ratings.ts` ignores
  `title-page` jobs); no provider key is needed (`toolBlockedReason` → null); budget 30 s.
