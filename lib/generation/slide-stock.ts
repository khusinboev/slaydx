/**
 * PLAIN «Slayd» PICTURES — hybrid stock + AI (docs/slide-quality/SPEC.md §B).
 *
 * Before: one stock chain (Pexels → Pixabay), the query built from the writer's `imageHint` through a ~50-word
 * uz→en word map, the FIRST unseen hit taken with no look at it. Live decks showed the result: the same statue on
 * five history slides, «colour-grading graphs» and a «Chongqing skyline» on an AI-economics deck.
 *
 * Now, per deck:
 *   1. ONE LLM call writes an English stock `query`, a broader `altQuery` and an AI `scene` per picture slot
 *      (`writeStockPlans`); the old `searchQueryFor` stays as the per-slot fallback;
 *   2. both providers are searched per slot (their hits interleaved, deduplicated across the deck);
 *   3. ONE batched multimodal Gemini call per group of slots looks at the providers' small previews and picks the
 *      candidate that shows the slide's subject, or «none» (`judgeStockCandidates`); a broken/failed answer
 *      degrades to the first candidate (today's behaviour) — it never fails the deck;
 *   4. slots left without a fitting stock photo are drawn by the Pro slayd Gemini path (`pickProvider` for
 *      `pro-slide`: same limiter, media core and cost record), photo style, up to `aiMax` per deck
 *      (settings `slide.image_ai_fallback`, `slide.image_ai_max`).
 *
 * Promise accounting (`SlideImageReport`): `want` = planned slots (same `plannedImageSlots` predicate, D1 kept)
 * minus `declined` — slots where stock had no fitting picture and AI was not allowed (setting off / cap reached):
 * like D1 that is a policy outcome, not a shortfall, so it never triggers a refund. Provider failures still count.
 */
import { mapPool } from "./quality";
import { getProviderKey } from "../server/providers/resolve";
import { recordLlmUsage } from "./job-cost";
import { parseLlmJson } from "./json";
import { llmModel } from "./llm";
import { PRO_IMAGE_LANES, fetchImageBytes } from "./slide-images";
import { pickProvider, type ImageProvider, type ImageSize, type SlideImage, type StockCandidate, type StockSearch } from "./image-provider";
import { searchPexels } from "./image-provider-pexels";
import { searchPixabay } from "./image-provider-pixabay";
import { searchQueryFor } from "./image-search-query";
import { composeSceneImagePrompt, composeSlideImagePrompt, writeStockPlans, type StockPlan } from "./slide-image-prompts";
import type { SlideModel } from "./slide-types";
import type { DocMeta, SlideImageReport } from "./types";

/** Policy of the hybrid stage — from settings (`slideImagePolicy`), or given by a test. */
export type SlideImagePolicy = { aiFallback: boolean; aiMax: number };
export const DEFAULT_SLIDE_IMAGE_POLICY: SlideImagePolicy = { aiFallback: true, aiMax: 8 };

/** Hits asked per provider per query; candidates kept per slot for the judge. */
export const STOCK_PER_PROVIDER = 4;
export const STOCK_CANDIDATES = 5;
/** Slots per judge call — each slot sends ≤ `STOCK_CANDIDATES` previews (~5-15 KB each). */
export const JUDGE_GROUP = 4;
export const JUDGE_TIMEOUT_MS = 25_000;
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
type Slot = HybridJob & { plan: StockPlan; candidates: StockCandidate[]; stockError?: StockSearch & { ok: false } };

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

/** Candidates of one slot: query, then the broader query when fewer than 3; deduplicated against the whole deck. */
async function gather(job: HybridJob & { plan: StockPlan }, used: Set<string>, deadline: number): Promise<Slot> {
  const keep = (list: StockCandidate[]) => list.filter((c) => !used.has(c.url) && !used.has(c.thumb));
  let res = await searchBoth(job.plan.query, job.size, deadline);
  let candidates = res.ok ? keep(res.candidates) : [];
  if (candidates.length < 3 && job.plan.altQuery && job.plan.altQuery !== job.plan.query) {
    const more = await searchBoth(job.plan.altQuery, job.size, deadline);
    if (more.ok) candidates = [...candidates, ...keep(more.candidates).filter((c) => !candidates.some((x) => x.url === c.url))];
    if (!res.ok && more.ok) res = more;
  }
  candidates = candidates.slice(0, STOCK_CANDIDATES);
  for (const c of candidates) {
    used.add(c.url);
    used.add(c.thumb);
  }
  return { ...job, candidates, ...(res.ok ? {} : { stockError: res }) };
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
 * One judge call for a group of slots. Returns the picks, or `null` when the judge could not answer (no key, HTTP
 * error, timeout, unparseable) — the caller then keeps today's behaviour (first candidate). A slot whose previews
 * could not be downloaded is judged with what is left; a slot with none is not sent.
 */
export async function judgeStockCandidates(
  topic: string,
  slots: readonly Slot[],
  deadline: number,
  thumbs: (c: StockCandidate) => Promise<Thumb | null> = loadThumb,
): Promise<Map<string, number> | null> {
  const key = getProviderKey("gemini");
  const left = deadline - Date.now();
  if (!key || left < 6_000) return null;
  const parts: Record<string, unknown>[] = [{ text: `Deck topic: «${topic}».` }];
  const counts = new Map<string, number>();
  const index = new Map<string, number[]>();
  for (const slot of slots) {
    const loaded = await Promise.all(slot.candidates.map((c) => thumbs(c)));
    const kept = loaded.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    if (!kept.length) continue;
    const gist = [slot.s.subtitle, ...(slot.s.bullets ?? []).slice(0, 2), slot.s.quote].filter(Boolean).join(" / ").slice(0, 200);
    parts.push({ text: `SLOT ${slot.s.id}: title «${slot.s.title}»; gist «${gist}»; should show: ${slot.plan.query}. Candidates 0..${kept.length - 1}:` });
    kept.forEach((ci, k) => {
      const t = loaded[ci]!;
      parts.push({ text: `${slot.s.id}#${k}` }, { inlineData: { mimeType: t.mime, data: t.base64 } });
    });
    counts.set(slot.s.id, kept.length);
    index.set(slot.s.id, kept);
  }
  if (!counts.size) return null;
  const model = llmModel();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(Math.min(JUDGE_TIMEOUT_MS, left - 3_000)),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
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
      console.warn(`[rasm] mos rasm tekshiruvi: HTTP ${res.status}`);
      return null;
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    const picks = parseJudgePicks(text, counts);
    if (!picks.size) return null;
    // Map the judge's index (over the previews it saw) back to the slot's candidate index.
    const out = new Map<string, number>();
    for (const [slot, k] of picks) out.set(slot, k < 0 ? -1 : index.get(slot)![k]);
    return out;
  } catch (e) {
    console.warn("[rasm] mos rasm tekshiruvi o'tkazib yuborildi:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** The provider's small preview, downloaded through the safe fetcher (https + public host on every hop). */
async function loadThumb(c: StockCandidate): Promise<Thumb | null> {
  const bytes = await fetchImageBytes(c.thumb);
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
  /** Persists a chosen remote/data picture (`slide-images.ts persistImage`). */
  persist: (img: SlideImage) => Promise<SlideImage | null>;
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

  const plans = await writeStockPlans(topic, jobs, meta);
  const planned = jobs.map((j) => {
    const fallbackQuery = searchQueryFor(topic, j.s, meta) ?? "";
    const plan = plans[j.s.id] ?? { query: fallbackQuery, altQuery: searchQueryFor(topic, { title: topic }, meta) ?? fallbackQuery, scene: "" };
    return { ...j, plan: { ...plan, query: plan.query || fallbackQuery } };
  });

  // 1-2. Stock candidates (only with a stock key; otherwise every slot goes to AI).
  const used = new Set<string>();
  const slots: Slot[] = stockOn
    ? ((await mapPool(planned, SEARCH_LANES, (j) => gather(j, used, deadline))).filter(Boolean) as Slot[])
    : planned.map((j) => ({ ...j, candidates: [], stockError: { ok: false as const, reason: "no-key" as const, detail: "stock kalitsiz" } }));

  // 3. Judge, per group. `null` = judge unavailable → first candidate (legacy behaviour) for that group.
  const judge = opts.judge ?? judgeStockCandidates;
  const choice = new Map<string, number>();
  const withHits = slots.filter((s) => s.candidates.length);
  for (let i = 0; i < withHits.length; i += JUDGE_GROUP) {
    const group = withHits.slice(i, i + JUDGE_GROUP);
    const picks = await judge(topic, group, deadline);
    for (const slot of group) choice.set(slot.s.id, picks ? (picks.get(slot.s.id) ?? 0) : 0);
  }

  // Persist the chosen stock photos; a failed download sends the slot to AI like «none fits».
  const needAi: Slot[] = [];
  await mapPool(slots, SEARCH_LANES, async (slot) => {
    const pick = choice.get(slot.s.id);
    const cand = pick !== undefined && pick >= 0 ? slot.candidates[pick] : undefined;
    if (cand) {
      const kept = await opts.persist({ url: cand.url, alt: cand.alt });
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

  // 4. AI fallback for the rest — up to the cap, content slides first.
  needAi.sort((a, b) => aiRank(a.s) - aiRank(b.s));
  const allowed = aiOn ? needAi.slice(0, opts.policy.aiMax) : [];
  for (const slot of needAi.slice(allowed.length)) {
    // Stock answered (zero hits or nothing fitting): a policy outcome → not promised. A stock outage: a failure.
    if (slot.stockError && slot.stockError.reason !== "no-key") {
      if (slot.stockError.reason === "blocked") {
        report.blocked += 1;
        report.blockReason = report.blockReason ?? slot.stockError.detail;
      } else if (slot.stockError.reason === "timeout") report.skipped += 1;
      else report.failed += 1;
    } else {
      report.declined! += 1;
    }
  }
  let blockReason = "";
  await mapPool(allowed, PRO_IMAGE_LANES, async (slot) => {
    if (blockReason) {
      report.blocked += 1;
      return null;
    }
    if (deadline - Date.now() < ai.minMs) {
      report.skipped += 1;
      return null;
    }
    const prompt = slot.plan.scene
      ? composeSceneImagePrompt(topic, slot.plan.scene, slot.size, meta)
      : composeSlideImagePrompt(topic, slot.s, slot.size, meta);
    const res = await ai.fetchImage({ prompt, size: slot.size, styleId: "photo", searchQuery: null }, deadline);
    if (!res.ok) {
      if (res.reason === "blocked" || res.reason === "no-key") {
        report.blocked += 1;
        if (!blockReason) blockReason = res.detail;
      } else if (res.reason === "timeout") report.skipped += 1;
      else report.failed += 1;
      return null;
    }
    const kept = await opts.persist(res.image);
    if (!kept) {
      report.failed += 1;
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
    `[rasm] oddiy slayd: ${report.got}/${report.want} rasm — stok ${report.stock}, AI ${report.ai}, mos kelmadi (va'dadan chiqarildi) ${report.declined}`,
  );
}
