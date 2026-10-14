# Generation progress UX (2026-10-14)

Owner request: every content generation shows its progress (percent / animation), not only slides.

## Findings (before)
- Slide / Pro slide: live deck (`LiveStrip`, skeleton slides) — unchanged.
- Other 21 tools: the worker wrote `progress` + `step`, but the page showed a 2 px bar and one line of text; no percent
  number, no stage list, no motion, no time estimate.
- Real stages: coursework / referat / mustaqil-ish / thesis / article, essay, teacher tools, games, infographic,
  audio, translation already call `onStage`. **Image and Resume reported nothing** (fake time curve + generic text
  «Mavzu tahlil qilinmoqda → Reja tuzilmoqda»).
- Stalls: inside one long LLM call the value stands still for minutes (lesson plan 8 → 65 %, audio TTS 68 → 92 %).

## What changed
- `lib/progress-stages.ts` — one stage list per tool kind (doc / essay / teacher / game / infographic / audio / image /
  translation / resume / slides). Marks mirror the engines' real `stage(progress, …)` calls. Used by the worker's
  fallback ticker (tool-specific step text instead of one generic list) and by the page checklist.
- `lib/progress-smooth.ts` — display-only creep: while the server value stands still the SHOWN percent creeps toward the
  end of the CURRENT stage (never below the server value, never backwards, never past the next stage mark, ≤ 98).
  ETA = tool median × (1 − progress); past 1.3× the median it says «Odatdagidan biroz uzoqroq» instead of a stuck estimate.
- `components/files/GenerationProgress.tsx` + `GenerationArt.tsx` — big percent, moving bar, stage checklist
  (✓ / current / pending), engine step text («Paragraflar · 6/14»), elapsed clock, ETA, per-kind CSS animation
  (text lines / equalizer / image shimmer / grid / translate arrows). `prefers-reduced-motion` switches motion off.
  The old queue block (`data-queue-position`) and `role="progressbar"` contract are kept.
- `lib/server/typical-duration.ts` — per-tool median of finished jobs (30 days, ≥ 5 samples, cached 10 min, one grouped
  query). `GET /api/generations/{id}` adds `runningSec` and `typicalSec` for `IN_PROGRESS` (optional fields; old
  clients ignore them). `Generation.startedAt` is now part of the summary.
- Image (`image-studio.ts`) and Resume (`index.ts`) now emit real stages.
- Home «Fayllar» card shows the percent and a moving bar.
- Tool labels fixed: Podkast / Tabriknoma / Tinglash / Saralash «creatingLabel» no longer say «Ssenariy yozilmoqda…».
- Telegram bot progress message: not done (owner chose site / Mini App only).

## Tests
`tests/progress-smooth.test.mts` (9), `tests/ui/generation-progress.test.mts` (8), `tests/typical-duration.test.mts`
(real Postgres), image stage test in `tests/slide-images.test.mts`. Mutations: ceiling clamp, `prev` floor, slow-ETA
branch, no-creep, queued branch, avg-vs-median, min samples, status filter, cache TTL — each turned a test red.
Browser smoke (Chromium, desktop 1280 + phone 390): lesson plan / podcast / image / coursework panels render, 0 page errors.
