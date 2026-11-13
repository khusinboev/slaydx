/**
 * PLAIN «Slayd» PICTURES — hybrid stock + AI (docs/slide-quality/SPEC.md §B).
 *
 * Before: one stock chain (Pexels → Pixabay), the query built from the writer's `imageHint` through a ~50-word
 * uz→en word map, the FIRST unseen hit taken with no look at it. Live decks showed the result: the same statue on
 * five history slides, «colour-grading graphs» and a «Chongqing skyline» on an AI-economics deck.
 *
 * Now, per deck (every step bounded by the picture-stage `deadline` — a slot that runs out of time gets no picture,
 * the deck never overruns into assembly):
 *   1. ONE LLM call writes an English stock `query`, a broader `altQuery` and an AI `scene` per picture slot
 *      (`writeStockPlans`); the old `searchQueryFor` stays as the per-slot fallback;
 *   2. both providers are searched per slot; hits are interleaved and deduplicated ONCE across the whole deck after
 *      all slots are gathered (first slot in deck order keeps a photo), so no photo can be picked twice;
 *   3. ONE batched multimodal Gemini call per group of slots (groups in parallel, through the Gemini limiter and
 *      circuit breaker) looks at the providers' small previews and picks the candidate that shows the slide's
 *      subject, or «none». A group the judge could not answer (open breaker, timeout, garbage) is «not judged»:
 *      its slots go to the AI fallback or stay without a picture — never the unseen first hit;
 *   4. slots without a fitting stock photo are drawn by the Pro slayd Gemini path (`pickProvider` for `pro-slide`:
 *      same limiter, media core and cost record), photo style, up to `aiMax` per deck (settings
 *      `slide.image_ai_fallback`, `slide.image_ai_max`).
 *
 * Promise accounting (`SlideImageReport`, lead decision): `want` = planned slots (same `plannedImageSlots` predicate,
 * D1 kept) minus `declined`. A slot is DECLINED (not promised, never refunded) when stock answered but nothing fitted
 * / was not judged and AI was not allowed, could not draw (failed, blocked, out of time) or the stage ran out of
 * time. Only a genuine stock OUTAGE (both providers failed) whose AI draw also fails counts as a failure — so the old
 * «nothing delivered» path is reached only by a real stock + AI outage, exactly as before this module.
 */
import { mapPool } from "./quality";
import { getProviderKey } from "../server/providers/resolve";
import { recordLlmUsage } from "./job-cost";
import { parseLlmJson } from "./json";
import { llmModel } from "./llm";
import { breakerFor } from "./llm/breaker";
import { limiterFor } from "./llm/limiter";
import { reportFailure, reportSuccess } from "./llm/failure";
import { PRO_IMAGE_LANES, fetchImageBytes } from "./slide-images";
import { pickProvider, type ImageProvider, type ImageSize, type SlideImage, type StockCandidate, type StockSearch } from "./image-provider";
import { searchPexels } from "./image-provider-pexels";
import { searchPixabay } from "./image-provider-pixabay";
import { searchQueryFor } from "./image-search-query";
import { composeSceneImagePrompt, composeSlideImagePrompt, writeStockPlans, type StockPlan } from "./slide-image-prompts";
import type { ImagePhase } from "./slide-progress";
import type { SlideModel } from "./slide-types";
import type { DocMeta, SlideImageReport } from "./types";

/** Policy of the hybrid stage — from settings (`slideImagePolicy`), or given by a test. */
export type SlideImagePolicy = { aiFallback: boolean; aiMax: number };
/** 4 × ≈ $0.034 stays under the cheapest plain deck price (3 000 so'm, 4–10 slides); the admin may raise it (`slide.image_ai_max`). */
export const DEFAULT_SLIDE_IMAGE_POLICY: SlideImagePolicy = { aiFallback: true, aiMax: 4 };

/** Hits asked per provider per query; candidates kept per slot for the judge. */
export const STOCK_PER_PROVIDER = 4;
export const STOCK_CANDIDATES = 5;
/** Slots per judge call — each slot sends ≤ `STOCK_CANDIDATES` previews (~5-15 KB each). */
export const JUDGE_GROUP = 4;
export const JUDGE_TIMEOUT_MS = 35_000;
/** A judge call is not started with less than this left (it would be cut off and paid for nothing). */
export const JUDGE_MIN_MS = 6_000;
/** Per preview download (they run in parallel); capped by the remaining time. */
export const THUMB_TIMEOUT_MS = 4_000;
/** A chosen photo is not downloaded with less than this left; its download is capped by the remaining time. */
export const PERSIST_MIN_MS = 3_000;
export const PERSIST_TIMEOUT_MS = 20_000;
/**
 * Worst wall time of the plain picture stage (budget check, `tests/slide-stock.test.mts`): query call 30 s + two
 * search rounds 2 × 15 s + previews 4 s + judge 35 s + one AI wave 45 s (≤ 5 parallel lanes ≥ the default cap)
 * + persisting 10 s.
 */
export const PLAIN_PICTURE_WORST_MS = 30_000 + 2 * 15_000 + THUMB_TIMEOUT_MS + JUDGE_TIMEOUT_MS + 45_000 + 10_000;
/** Lanes of the search phase (stock HTTP is cheap and fast). */
const SEARCH_LANES = 3;

/** Settings → policy; any failure (no DB in a script, a bad row) gives the defaults. */
export async function slideImagePolicy(): Promise<SlideImagePolicy> {
  if (!process.env.DATABASE_URL) return DEFAULT_SLIDE_IMAGE_POLICY;
  try {
    const { getSetting } = await import("../server/settings");
    const [aiFallback, aiMax] = await Promise.all([getSetting("slide.image_ai_fallback"), getSetting("slide.image_ai_max")]);
    return { aiFallback: Boolean(aiFallback), aiMax: Math.max(0, Math.floor(Number(aiMax) || 0)) };
  } catch {
    return DEFAULT_SLIDE_IMAGE_POLICY;
  }
}

export type HybridJob = { s: SlideModel; size: ImageSize };
export type Slot = HybridJob & { plan: StockPlan; candidates: StockCandidate[]; stockError?: StockSearch & { ok: false } };

/** Interleave two hit lists (p1, x1, p2, x2 …) so both providers reach the judge. */
export function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** Both providers for one query; their failures are returned only when neither gave a hit. */
async function searchBoth(query: string, size: ImageSize, deadline: number): Promise<StockSearch> {
  const [p, x] = await Promise.all([
    searchPexels({ searchQuery: query, size }, deadline, STOCK_PER_PROVIDER),
    searchPixabay({ searchQuery: query, size }, deadline, STOCK_PER_PROVIDER),
  ]);
  const hits = interleave(p.ok ? p.candidates : [], x.ok ? x.candidates : []);
  if (hits.length || p.ok || x.ok) return { ok: true, candidates: hits };
  // Neither answered: the worse class wins (a blocked key must be visible in the report).
  const order = ["blocked", "no-key", "rate", "timeout", "failed"];
  const pf = p as Extract<StockSearch, { ok: false }>;
  const xf = x as Extract<StockSearch, { ok: false }>;
  return order.indexOf(pf.reason) <= order.indexOf(xf.reason) ? pf : xf;
}

const uniqueByUrl = (list: StockCandidate[]) => list.filter((c, i) => list.findIndex((x) => x.url === c.url || x.thumb === c.thumb) === i);

/** Candidates of one slot: query, then the broader query when fewer than 3 (the deck-wide dedupe runs later). */
async function gather(job: HybridJob & { plan: StockPlan }, deadline: number): Promise<Slot> {
  let res = await searchBoth(job.plan.query, job.size, deadline);
  let candidates = res.ok ? uniqueByUrl(res.candidates) : [];
  if (candidates.length < 3 && job.plan.altQuery && job.plan.altQuery !== job.plan.query && deadline - Date.now() > 3_000) {
    const more = await searchBoth(job.plan.altQuery, job.size, deadline);
    if (more.ok) candidates = uniqueByUrl([...candidates, ...more.candidates]);
    if (!res.ok && more.ok) res = more;
  }
  return { ...job, candidates, ...(res.ok ? {} : { stockError: res }) };
}

/**
 * Deck-wide dedupe AFTER all slots are gathered (lanes run in parallel, so an in-lane «used» set was racy): a photo
 * stays only with the first slot in deck order; each slot keeps ≤ `STOCK_CANDIDATES`. Mutates and returns `slots`.
 */
export function dedupeAcrossDeck(slots: Slot[]): Slot[] {
  const used = new Set<string>();
  for (const slot of slots) {
    slot.candidates = slot.candidates.filter((c) => !used.has(c.url) && !used.has(c.thumb)).slice(0, STOCK_CANDIDATES);
    for (const c of slot.candidates) {
      used.add(c.url);
      used.add(c.thumb);
    }
  }
  return slots;
}

export const JUDGE_SYSTEM = [
  "You pick photographs for presentation slides. For each slot you see the slide (title, gist, what the picture should show) and numbered candidate photos.",
  "Choose the candidate that clearly shows the slide's subject: the right object, organism, place, era or activity.",
  "Answer -1 (none fits) when every candidate is off-topic, a generic business/office stock cliché unrelated to the subject, shows big text, logos or watermarks, or shows the wrong era/country for a history slide.",
  "Prefer a clear, well-lit photo whose subject fills the frame. Never pick the same photo for two slots.",
  'Return JSON only: {"picks":[{"slot":"<id>","pick":<index or -1>}]}.',
].join("\n");

/** The judge's answer -> pick per slot id; unknown slots, out-of-range indexes and duplicates are dropped. */
export function parseJudgePicks(raw: string | null, counts: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const data = raw ? (parseLlmJson(raw) as { picks?: unknown } | null) : null;
  if (!data || !Array.isArray(data.picks)) return out;
  for (const item of data.picks) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const slot = String(o.slot ?? "");
    const n = counts.get(slot);
    const pick = Number(o.pick);
    if (n === undefined || out.has(slot) || !Number.isInteger(pick)) continue;
    if (pick === -1 || (pick >= 0 && pick < n)) out.set(slot, pick);
  }
  return out;
}

const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { slot: { type: "STRING" }, pick: { type: "INTEGER" } }, required: ["slot", "pick"], propertyOrdering: ["slot", "pick"] },
    },
  },
  required: ["picks"],
};

type Thumb = { mime: string; base64: string };

/**
 * One judge call for a group of slots. Returns the picks, or `null` when the judge could not answer (no key, open
 * breaker, limiter queue full, too little time, HTTP error, timeout, unparseable) — the caller treats those slots as
 * not judged. Previews download in PARALLEL, each capped by `THUMB_TIMEOUT_MS` and the remaining time; the call's own
 * timeout is computed AFTER the downloads. The call goes through the Gemini limiter and circuit breaker and reports
 * failures/successes like every other Gemini call (`llm/failure.ts`).
 */
export async function judgeStockCandidates(
  topic: string,
  slots: readonly Slot[],
  deadline: number,
  thumbs: (c: StockCandidate, timeoutMs: number) => Promise<Thumb | null> = loadThumb,
): Promise<Map<string, number> | null> {
  const key = getProviderKey("gemini");
  if (!key || deadline - Date.now() < JUDGE_MIN_MS) return null;
  const breaker = breakerFor("gemini");
  if (!breaker.allow()) {
    console.warn("[rasm] gemini saqlagichi ochiq — rasm tekshiruvi o'tkazib yuborildi");
    return null;
  }
  const thumbBudget = Math.min(THUMB_TIMEOUT_MS, deadline - Date.now() - JUDGE_MIN_MS);
  if (thumbBudget < 1_000) return null;
  const loaded = await Promise.all(slots.map((slot) => Promise.all(slot.candidates.map((c) => thumbs(c, thumbBudget).catch(() => null)))));
  const parts: Record<string, unknown>[] = [{ text: `Deck topic: «${topic}».` }];
  const counts = new Map<string, number>();
  const index = new Map<string, number[]>();
  slots.forEach((slot, si) => {
    const kept = loaded[si].map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    if (!kept.length) return;
    const gist = [slot.s.subtitle, ...(slot.s.bullets ?? []).slice(0, 2), slot.s.quote].filter(Boolean).join(" / ").slice(0, 200);
    parts.push({ text: `SLOT ${slot.s.id}: title «${slot.s.title}»; gist «${gist}»; should show: ${slot.plan.query}. Candidates 0..${kept.length - 1}:` });
    kept.forEach((ci, k) => {
      const t = loaded[si][ci]!;
      parts.push({ text: `${slot.s.id}#${k}` }, { inlineData: { mimeType: t.mime, data: t.base64 } });
    });
    counts.set(slot.s.id, kept.length);
    index.set(slot.s.id, kept);
  });
  if (!counts.size) return null;
  // Time left is measured again AFTER the downloads.
  const left = deadline - Date.now() - 2_000;
  if (left < JUDGE_MIN_MS - 2_000) return null;
  const limiter = limiterFor("gemini");
  const release = await limiter.acquire(Math.min(5_000, left - 3_000));
  if (!release) return null;
  const model = llmModel();
  const started = Date.now();
  const fail = (kind: "http" | "timeout" | "network" | "bad_json", message: string, status?: number) =>
    reportFailure({ role: "slide-image-judge", provider: "gemini", model, attempt: 1, durationMs: Date.now() - started, kind, status, retryable: false, message });
  try {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, deadline - Date.now() - 2_000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
          // A thumbnail is judged, not read: low resolution (measured live: ~1 100 → ~300 tokens per preview).
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          responseMimeType: "application/json",
          responseSchema: JUDGE_SCHEMA,
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const u = data.usageMetadata;
    // Paid even when the answer is useless: the cost report must show it.
    if (u) recordLlmUsage({ provider: "gemini", model, inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 });
    if (!res.ok) {
      if (res.status >= 500) breaker.failure();
      fail("http", `HTTP ${res.status}`, res.status);
      return null;
    }
    breaker.success();
    reportSuccess("gemini");
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    const picks = parseJudgePicks(text, counts);
    if (!picks.size) {
      fail("bad_json", "judge answer not usable");
      return null;
    }
    // Map the judge's index (over the previews it saw) back to the slot's candidate index.
    const out = new Map<string, number>();
    for (const [slot, k] of picks) out.set(slot, k < 0 ? -1 : index.get(slot)![k]);
    return out;
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    if (timedOut) breaker.failure();
    fail(timedOut ? "timeout" : "network", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    release();
  }
}

/** The provider's small preview, downloaded through the safe fetcher (https + public host on every hop). */
async function loadThumb(c: StockCandidate, timeoutMs: number): Promise<Thumb | null> {
  const bytes = await fetchImageBytes(c.thumb, timeoutMs);
  if (!bytes) return null;
  const [mime, base64] = bytes.data.split(";base64,");
  return mime && base64 ? { mime, base64 } : null;
}

/** AI order: content slides first (the picture explains something), then the cover, then mood slides. */
function aiRank(s: SlideModel): number {
  if (s.layout === "title") return 1;
  if (s.layout === "closing" || s.layout === "quote" || s.layout === "section") return 2;
  return 0;
}

export type HybridOpts = {
  meta?: DocMeta;
  policy: SlideImagePolicy;
  onImage?: (s: SlideModel, url: string) => void;
  /** Sub-step for the live progress bar («Rasmlar tanlanmoqda»). */
  onPhase?: (phase: ImagePhase) => void;
  /** Persists a chosen remote/data picture within `timeoutMs` (`slide-images.ts persistImage`). */
  persist: (img: SlideImage, timeoutMs: number) => Promise<SlideImage | null>;
  /** Test seams. */
  ai?: ImageProvider;
  judge?: typeof judgeStockCandidates;
};

/**
 * Fills `jobs` (slides without a picture yet) in place and updates `report` (`got`, `stock`, `ai`, `declined`,
 * failure counters). `deadline` is the absolute end of the picture stage.
 */
export async function attachHybridImages(topic: string, jobs: HybridJob[], deadline: number, report: SlideImageReport, opts: HybridOpts): Promise<void> {
  const meta = opts.meta;
  const stockOn = Boolean(getProviderKey("pexels") || getProviderKey("pixabay"));
  const ai = opts.ai ?? pickProvider({ toolId: "pro-slide" });
  const aiOn = opts.policy.aiFallback && opts.policy.aiMax > 0 && ai.hasKey();
  report.stock = report.stock ?? 0;
  report.ai = report.ai ?? 0;
  report.declined = report.declined ?? 0;
  const decline = () => (report.declined! += 1);

  opts.onPhase?.("search");
  const plans = await writeStockPlans(topic, jobs, meta, deadline);
  const planned = jobs.map((j) => {
    const fallbackQuery = searchQueryFor(topic, j.s, meta) ?? "";
    const plan = plans[j.s.id] ?? { query: fallbackQuery, altQuery: searchQueryFor(topic, { title: topic }, meta) ?? fallbackQuery, scene: "" };
    return { ...j, plan: { ...plan, query: plan.query || fallbackQuery } };
  });

  // 1-2. Stock candidates (only with a stock key; otherwise every slot goes to AI), then ONE deck-wide dedupe.
  const slots: Slot[] = stockOn
    ? dedupeAcrossDeck((await mapPool(planned, SEARCH_LANES, (j) => gather(j, deadline))).filter(Boolean) as Slot[])
    : planned.map((j) => ({ ...j, candidates: [], stockError: { ok: false as const, reason: "no-key" as const, detail: "stock kalitsiz" } }));

  // 3. Judge, groups in parallel. Missing verdict = not judged (→ AI or no picture); only a box where no judge can
  //    ever run (no Gemini key and no injected judge) keeps the legacy first-candidate rule.
  const judge = opts.judge ?? judgeStockCandidates;
  const judgeExists = Boolean(opts.judge) || Boolean(getProviderKey("gemini"));
  const choice = new Map<string, number>();
  const withHits = slots.filter((s) => s.candidates.length);
  const groups: Slot[][] = [];
  for (let i = 0; i < withHits.length; i += JUDGE_GROUP) groups.push(withHits.slice(i, i + JUDGE_GROUP));
  if (groups.length) opts.onPhase?.("pick");
  const verdicts = await Promise.all(groups.map((group) => (judgeExists ? judge(topic, group, deadline) : Promise.resolve(null))));
  groups.forEach((group, g) => {
    for (const slot of group) {
      const picked = verdicts[g]?.get(slot.s.id);
      choice.set(slot.s.id, picked !== undefined ? picked : judgeExists ? -1 : 0);
    }
  });

  // Persist the chosen stock photos (unique by the deck-wide dedupe), each capped by the remaining time.
  const needAi: Slot[] = [];
  await mapPool(slots, SEARCH_LANES, async (slot) => {
    const pick = choice.get(slot.s.id);
    const cand = pick !== undefined && pick >= 0 ? slot.candidates[pick] : undefined;
    const left = deadline - Date.now();
    if (cand && left >= PERSIST_MIN_MS) {
      const kept = await opts.persist({ url: cand.url, alt: cand.alt }, Math.min(PERSIST_TIMEOUT_MS, left - 1_000));
      if (kept) {
        slot.s.image = kept;
        report.got += 1;
        report.stock! += 1;
        opts.onImage?.(slot.s, kept.url);
        return null;
      }
    }
    needAi.push(slot);
    return null;
  });

  /*
   * 4. AI fallback — up to the cap, content slides first. Outcome of a slot that ends WITHOUT a picture:
   *   - stock OUTAGE (both providers failed) and AI could not help → a failure (kept in the promise, old path);
   *   - anything else (stock answered: zero hits, nothing fitted, not judged; out of time; AI off/capped/failed)
   *     → declined (not promised, no refund) — the new steps never make a plain refund bigger than before.
   */
  const outage = (slot: Slot) => Boolean(slot.stockError && slot.stockError.reason !== "no-key");
  const failOutage = (slot: Slot) => {
    const reason = slot.stockError!.reason;
    if (reason === "blocked") {
      report.blocked += 1;
      report.blockReason = report.blockReason ?? slot.stockError!.detail;
    } else if (reason === "timeout") report.skipped += 1;
    else report.failed += 1;
  };
  const noPicture = (slot: Slot) => (outage(slot) ? failOutage(slot) : decline());
  needAi.sort((a, b) => aiRank(a.s) - aiRank(b.s));
  const allowed = aiOn ? needAi.slice(0, opts.policy.aiMax) : [];
  for (const slot of needAi.slice(allowed.length)) noPicture(slot);
  if (allowed.length) opts.onPhase?.("draw");
  let blockReason = "";
  /*
   * The Gemini account breaker (opened by a 403/5xx on any Gemini call of this process, e.g. the writer) also stops
   * the AI draws: the image endpoint is the same account. Read-only check (`state`), so no half-open probe is spent.
   */
  const geminiOpen = () => breakerFor("gemini").state === "open";
  await mapPool(allowed, PRO_IMAGE_LANES, async (slot) => {
    if (blockReason || geminiOpen() || deadline - Date.now() < ai.minMs) {
      noPicture(slot);
      return null;
    }
    const prompt = slot.plan.scene ? composeSceneImagePrompt(topic, slot.plan.scene, slot.size, meta) : composeSlideImagePrompt(topic, slot.s, slot.size, meta);
    const res = await ai.fetchImage({ prompt, size: slot.size, styleId: "photo", searchQuery: null }, deadline);
    if (!res.ok) {
      if ((res.reason === "blocked" || res.reason === "no-key") && !blockReason) blockReason = res.detail;
      noPicture(slot);
      return null;
    }
    // Alt text = what the picture shows (the scene), not the provider's echo of the prompt.
    const left = deadline - Date.now();
    const kept = await opts.persist({ url: res.image.url, alt: (slot.plan.scene || slot.s.title).slice(0, 160) }, Math.max(1_000, Math.min(PERSIST_TIMEOUT_MS, left)));
    if (!kept) {
      noPicture(slot);
      return null;
    }
    slot.s.image = kept;
    report.got += 1;
    report.ai! += 1;
    opts.onImage?.(slot.s, kept.url);
    return null;
  });
  if (blockReason) report.blockReason = report.blockReason ?? blockReason;
  report.want = Math.max(0, report.want - report.declined!);
  console.info(
    `[rasm] oddiy slayd: ${report.got}/${report.want} rasm — stok ${report.stock}, AI ${report.ai}, rasmsiz qoldi (va'dadan chiqarildi) ${report.declined}`,
  );
}
