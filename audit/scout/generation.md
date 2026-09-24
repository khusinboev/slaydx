# SlaydX Generation Engine Audit — Scout Report

**Scope**: `lib/generation/` (~274 files, ~81k lines)  
**Auditor**: Claude Haiku (read-only cartography)  
**Date**: 2026-09-23  

---

## 1. Entry & Dispatch

**Main entry**: `lib/generation/index.ts:498` — `buildArtifact(tool, values, opts)` → dispatches by `tool.id`.

### Dispatch Table
| Tool ID | Engine Module | Budget Computation |
|---------|---------------|--------------------|
| `slide` / `pro-slide` | `slide-write.ts` | `SLIDE_BASE_MS + slideCount × 11_000 ms` (pro: 16_000) |
| `image` | `image-studio.ts` | `90_000 ms` (fixed) |
| `infographic` | `infographic/engine.ts` | `120_000 + blocks × 4_000 ms` |
| `translation` | `translate/engine.ts` | `60_000 + chars_k × 2_500 ms` |
| `resume` | `resume/write.ts` | `150_000 ms` (fixed) |
| `article` / `thesis` | `article/engine.ts` | `150_000 + 90_000 + pages × 16_000 ms` |
| `referat` / `coursework` / `mustaqil-ish` | `work/engine.ts` | `150_000 + 90_000 + pages × 9_000 ms` |
| `essay` | `essay/engine.ts` | Same as above (word-gated, not page-gated) |
| `lesson-plan` / `texnologik-xarita` / `glossary` / `keys` / `test` | `teacher/engine.ts` | `90–150 k base + elements × per_ms + 60 k polish` |
| `crossword` / `flashcards` / `sorting` / `listening` | `games/engine.ts` | `90–160 k base + elements × per_ms` |
| `podcast` / `greeting` | `audio/engine.ts` | `90_000 + durationMin × 48_000 ms` |

**Deadline propagation**: `opts.deadline` (epoch ms) → passed to every LLM call as budget.  
**Budget enforcement**: `lib/generation/quality.ts:116` — `remainingMs(deadline)` = `Math.max(0, deadline - Date.now())`, checked before each retry/expansion loop.  
**BuiltFile shape**: `{ bytes, mime, fileName, doc: AcademicDoc, delivered?, cost? }` (index.ts:100).

---

## 2. Outbound Network Calls

### LLM Providers (Main)

| File:Line | Provider | Endpoint | Timeout | Retries | Key Env | Honours Deadline |
|-----------|----------|----------|---------|---------|---------|------------------|
| `llm.ts:255` | Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | 40 s (or `opts.timeoutMs`) | 3× on 429/5xx | `GEMINI_API_KEY` | **Yes** (`withRetry` budget tracking) |
| `llm.ts:398` | Gemini (stream) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` | `AbortSignal.timeout(40 s / opts)` | 3× fallback | `GEMINI_API_KEY` | **Yes** (AbortSignal) |
| `llm.ts:533` | xAI | `https://api.x.ai/v1/chat/completions` | 40 s (or `opts.timeoutMs`) | 3× on 429/5xx | `XAI_API_KEY` | **Yes** |
| `llm-roles.ts:84` | Multi-provider chain | Chains provider:model from `LLM_WRITER`, `LLM_JUDGE`, `LLM_RESEARCHER`, `LLM_FAST` env | Inherits from provider | Per-provider retry + chain fallback | Per-provider | **Yes** |
| `llm/anthropic.ts:94` | Anthropic SDK | `https://api.anthropic.com/v1/messages` | `timeout: opts.timeoutMs, maxRetries: 1` | 1× retry built-in | `ANTHROPIC_API_KEY` | **No** — SDK doesn't track deadline; hardcoded timeout |
| `llm/openrouter.ts` | OpenRouter | Proxy to providers | Caller's `timeoutMs` | Provider-specific | `OPENROUTER_API_KEY` | **Yes** (via timeout) |
| `llm/openai.ts` | OpenAI | `https://api.openai.com/v1/chat/completions` | `timeoutMs` parameter | SDK default (3× internal) | `OPENAI_API_KEY` | **Yes** |

### Image Providers

| File:Line | Provider | Endpoint | Timeout | Retries | Key | Honours Deadline |
|-----------|----------|----------|---------|---------|-----|------------------|
| `image-provider-gemini.ts:185` | Gemini (image) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | 40 s (hardcoded or `budget` param) | **None** | `GEMINI_API_KEY` | **Partial** (budget param, no retry) |
| `image-provider-pexels.ts:58` | Pexels API | `https://api.pexels.com/v1/search` | `AbortSignal.timeout(budget)` | **None** | `PEXELS_API_KEY` | **Yes** |
| `image-provider-pixabay.ts:58` | Pixabay API | `https://pixabay.com/api/` | `AbortSignal.timeout(budget)` | **None** | `PIXABAY_API_KEY` | **Yes** |
| `image-provider-fal.ts:79` | fal.ai | `https://fal.ai/...` (dead code) | `AbortSignal.timeout(budget)` | **None** | `FAL_API_KEY` | **Yes** (but DEPRECATED) |

### Research/Citation

| File:Line | Provider | Endpoint | Timeout | Retries | Key | Honours Deadline |
|-----------|----------|----------|---------|---------|-----|------------------|
| `research/openalex.ts` | OpenAlex | `https://api.openalex.org/works?...` | **None** | **None** | Free (no key) | **No** |
| `research/crossref.ts` | Crossref API | `https://api.crossref.org/works?...` | **None** | **None** | Free | **No** |
| `research/googlebooks.ts` | Google Books | `https://www.googleapis.com/books/v1/volumes?...` | **None** | **None** | `GOOGLE_BOOKS_API_KEY` | **No** |
| `research/lexuz.ts` | lex.uz (Uzbek law) | `https://lex.uz/...` | **None** | **None** | None | **No** |
| `llm.ts:191` | Gemini grounding | (via Gemini `tools: [{ google_search: {} }]`) | 40 s | 3× (Gemini retry) | `GEMINI_API_KEY` | **Yes** |

### TTS (Audio)

| File:Line | Provider | Endpoint | Timeout | Retries | Key | Honours Deadline |
|-----------|----------|----------|---------|---------|-----|------------------|
| `tts/gemini.ts` | Gemini (TTS) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent` | Per-call budget | **None** | `GEMINI_API_KEY` | **Partial** |
| `tts/azure.ts` | Azure Cognitive | `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` | Per-call budget | **None** | `AZURE_SPEECH_KEY` | **Partial** |

### Grounding (User-Supplied URLs)

| File:Line | Surface | Flag |
|-----------|---------|------|
| `slide-research.ts:167` | `HEAD` request to user-provided `.uri` (from grounding results) | **SSRF surface** — validates `http(s)://` but no IP range check |
| `research/verify.ts` | Citation `uri` fields parsed from Crossref/OpenAlex | Lower risk (API-sourced) |

---

## 3. LLM Fallback Chain

**Entry**: `llm-roles.ts:73` — `complete(role, system, user, opts)` where `role ∈ {writer, judge, researcher, fast}`.

**Chain logic** (`llm/chain.ts`):
1. Parse `LLM_<ROLE>` env var → array of `provider:model` specs (e.g., `gemini:gemini-3.1-flash-lite,anthropic:claude-opus,openrouter:qwen-32b`)
2. Iterate specs left-to-right; try adapter (`gemini`, `anthropic`, `openai`, `openrouter`, `xai`)
3. On 429/5xx: retry provider (up to 3× per `withRetry`); if all fail, next spec
4. On 4xx (client error): skip to next spec immediately (won't help)
5. Return first spec that succeeds or `null` (all exhausted)

**Cost tracking**: `llm-pricing.ts` — maps `(provider, model, inputTokens, outputTokens)` → USD cost; written to `generations.cost_json` (telemetry).

**Max output tokens**: Caller specifies `opts.maxTokens` (default 1200 LLM, 2048 grounding); no global cap visible to generation layer (SDK enforces model limits server-side).

**Per-user / global cost caps**: **None visible** in generation module. Cost metering is for telemetry only (`cost_json` field in DB), no runtime cost limit.

---

## 4. Local Heavy Processing

### Child Process Spawns

| File:Line | Binary | Arguments | Timeout | Concurrency | Cleanup |
|-----------|--------|-----------|---------|-------------|---------|
| `lib/server/pdf.ts:56` | LibreOffice (`soffice` / `libreoffice`) | `--headless --convert-to pdf --outdir <dir> <docx/pptx>` | 90 s | Via `WORKER_CONCURRENCY` (≤2 heavy) | `rm -r <tmpdir>` in `finally` ✓ |
| `lib/server/thumb.ts` | `pdftoppm` | `-png -r 150 <pdf> <outdir>` | 30 s | Single process per call | `rm -r` in `finally` ✓ |
| `lib/server/template-upload.ts` | `pdftoppm` | `-png -gray -r 150 <pdf>` | 30 s | Single per upload | `rm -r` in `finally` ✓ |

### Memory-Bound Processing

| File:Line | Library | Input Type | Bounds/Limits | Notes |
|-----------|---------|-----------|---------------|-------|
| `image-studio.ts:322` | JSZip | User-uploaded PPTX | **No entry-count limit** | Zips entire deck (all assets) |
| `pptx-template.ts:1` | JSZip | User-uploaded PPTX template | **No limit** | Parses master/layout; ~20 MB upload max via `server/template-upload.ts` |
| `translate/xml-scan.ts:1` | JSZip | User-uploaded DOCX/PPTX/XLSX | **No limit** | Extracts text segments for translation; 200 kchar segment cap (`translationChars`) |
| `render-docx.ts` | `docx` library (no JSZip) | Generated AcademicDoc | Implicit in DOCX spec | Renders up to 45-page coursework (2700 pt estimated) |
| `render-pptx.ts` | `pptx` library | Generated SlideDoc | Slides ≤ 30 (pro-slide) | 30 slides × images × shapes → ~5 MB PPTX typical |
| `sharp` | Image processing | Stock photo → PNG/WebP | **No size limit in call** | Called from `image-studio.ts`, `figures/svg.ts` (renders 300 dpi A4 SVG → 2480×3508 px PNG); `server/template-upload.ts` for rasterizing template layout |
| `unpdf` (pdf.js) | PDF parsing | User PPTX→LibreOffice PDF | 30 MB input max | Read for page count validation in `index.ts:755` |
| `lamejs` (if used) | MP3 encoding | Raw PCM audio | **No explicit bound** | Audio tools (podcast, greeting) — 5 min × 16 kHz ~= 4.8 MB PCM |

---

## 5. Module-Level State

**Caches & Singletons**:

| File:Line | Name | Type | Bounds | Purge |
|-----------|------|------|--------|-------|
| `research/cache.ts:29,53` | `override` (test seam) + `dbStore` | `SourceCacheStore \| null` | Lazy init once; DB-backed | Via `source_cache` table (30-day TTL) |
| `research/cache.ts:38` | Memory cache (testable) | `Map<string, SourceCacheEntry>` | **Unbounded if test doesn't limit** | Test owns lifecycle |

**No other module-level Maps, Counters, or Caches found** — most state is transient (per-job).

---

## 6. Quality Gates & Retries

### Inside a Single Job (Worst Case Expansion)

**Coursework (45 pages, maximum)**:
- Outline: 1 LLM call
- Intro: 1 call
- Per-section body: 5 bob × 3 ostmavzu = 15 calls (parallel mapPool(3) → 5 batches)
- Expansion loop (`WORK_EXPAND_BELOW 0.85`): if word count < 85% of goal, retry 1 per section (up to 15 more)
- Conclusion: 1 call
- Total worst-case: **~35 LLM calls** (+ citations, review, polish)

**Article (15 pages, max typical)**:
- Research (OpenAlex): 1 call (cached 30 days)
- Outline: 1 call
- Body sections: 3 parallel (mapPool) → up to 5 calls (2-3 sections)
- Visuals (figures): per-type SVG spec generation (deterministic, not LLM)
- Abstracts ×3 languages: 3 calls
- Review (judge): 1 call
- Polish (`ARTICLE_POLISH_MS` 90 s): ≤6 fix iterations @ 2 calls/iteration = ≤12 calls
- **Total worst-case: ~25 LLM calls**

**Slide (16 slides, pro-slide)**:
- Deck planning: 1 call
- Two phases of 8 slides each: 2 calls
- Per-slide image (Gemini): 16 calls (parallel, budget-limited)
- Optional grounding: 1 call (per Gemini + fallback Gemini again)
- **Total: ~20 LLM + image calls**

### Retry Bounds

| Loop | Bounds | File:Line |
|------|--------|-----------|
| `withRetry` in `llm.ts` | **3 attempts** (6 s min before next) | llm.ts:125 |
| Per-provider spec in chain | **N specs** in `LLM_<ROLE>` env (no limit, but typically 2-3) | llm/chain.ts |
| `writeSection` expansion | **1 retry** if blocks < minParas (hardcoded as `remainingMs > 10_000`) | write-llm.ts:288 |
| Article `mapPool` per-section | **3 parallel, 1 job per section** (no retry at section level) | article/engine.ts |
| `jsonRetry` in parsing | **8 attempts** on parse error (with exponential backoff) | json.ts:174 |

---

## 7. Observations for Auditors

### Calls Without Timeouts
- **OpenAlex** (`research/openalex.ts`) — unbounded network latency; cached 30 days but first call blocks
- **Crossref** (`research/crossref.ts`) — same; cached but first call can block job
- **Google Books** (`research/googlebooks.ts`) — no timeout; API quota but no deadline enforcement
- **lex.uz** (Uzbek law search) — no timeout

**Impact**: Citation/reference research can stall a job if API unresponsive; long-running 45-page coursework already at budget limit (600 s). If research adds 30 s, job timeout.

### Unbounded Input Sizes Reaching LLM Prompts
- **User-provided DOCX/PPTX for translation** — up to 200 kchars (`translationChars`), split into batches (`mapPool(4)`), retried; byudjet scales (`2.5 ms/kchar`). Acceptable but no per-prompt size ceiling enforced server-side; Anthropic/Gemini truncate internally.
- **Slide research (grounding)** — user text via `llmGrounded` + optional Gemini internet search; model decides search terms, no limit on result set parsed. Managed by timeout.
- **Resume professionalsk list** (1,093 entries) — searched client-side with `searchProfessions`, result embedded in LLM prompt → unbounded result set if prefix match huge (unlikely but possible for "а" in Cyrillic).

### Temp Files & Cleanup
- ✅ PDF conversion: `mkdtemp` → cleanup in `finally` block (lib/server/pdf.ts:49,86)
- ✅ Thumbnail: cleanup in `finally` (lib/server/thumb.ts)
- ✅ Template upload: cleanup in `finally` (lib/server/template-upload.ts)
- ⚠️ Image studio (`image-studio.ts`): No explicit temp directory; uses `sharp` in-memory; acceptable.

### SSRF Surface
- **`slide-research.ts:167`** — `HEAD` request to `s.uri` from Gemini grounding results. URI validated as `http(s)://` but **no IP range check** (private network risk if Gemini compromised or API hijacked). Validated as last-resort check only; research data trusted.

### Cost Metering
- ✅ LLM `usage` (tokens) tracked per call → `CostMeter` aggregates → `generations.cost_json`
- **No runtime cost limit** — pure telemetry; no cap enforced during generation
- **No per-user cost cap** visible; per-job budget is TIME, not money

### Concurrency Limits
- ✅ Heavy processes (LibreOffice, tests) limited to ≤2 via `scripts/heavy.sh` cgroup (5 GB total / lead + agents)
- ✅ LLM `mapPool` parallelism explicit (typically 3-4 workers)
- **No unbounded parallel LLM calls** — `mapPool` enforces concurrency

### File Processing Edge Cases
- User PDF translation via `unpdf` — no entry-count limit on ZIP entries within DOCX/PPTX; malformed archive can OOM. Mitigated by 20 MB upload cap and `jszip` robustness.
- Generated DOCX with 100+ figures (infographic + article) — each figure PNG rasterized via `sharp`; number of figures bounded by tool (article: 4 max, infographic: 8 max).

---

## Summary Table: Network Call Audit

| Category | Count | No Timeout | No Retry | SSRF Risk |
|----------|-------|-----------|----------|-----------|
| LLM providers | 5 | 0 | 1 (Anthropic: 1 retry) | 0 |
| Image APIs | 4 | 0 | 4 | 0 |
| Research/citation | 4 | **4** | 4 | 0 |
| Grounding (Gemini) | 1 | 0 | 1 | 0 |
| TTS | 2 | 0 | 1–0 (varies) | 0 |
| **User URL (SSRF)** | 1 | 0 | 0 | **1** |
| **Total outbound** | **17** | **4** | **10** | **1** |

---

## Production Readiness Notes

1. **Research APIs block generation**: OpenAlex/Crossref calls in hot path without timeout. Cache mitigates but cold start stalls. Consider async pre-fetch or circuit breaker.
2. **Template/source ZIP parsing**: No entry-count limit in JSZip; zip bomb risk (20 MB upload can expand). Add entry count check or use streaming parser.
3. **SSRF on grounding URIs**: User cannot control, but validate against private IP ranges for defense-in-depth.
4. **Cost tracking without enforcement**: Telemetry is good; consider adding `cost_json` quota alerts (not runtime enforcement).
5. **Multi-provider LLM chain**: No explicit provider health check; chain always tries all specs sequentially before fail. Consider exponential backoff between specs or time-budget-aware spec selection.
