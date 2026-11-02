import { redact } from "../log";
import { providerDef } from "./registry";
import { FAL_IMAGE_MODELS, MEDIA_CATALOG } from "../../media/catalog";

/**
 * «Tekshirish»: ONE cheap authenticated read per provider (list models, fetch one photo...), 10 s timeout, to
 * tell the admin whether a key is accepted. Nothing is generated and no paid unit is spent; the free-tier quota
 * of the stock and research APIs loses one request.
 *
 * The answer is `{ ok, message }`. A message never contains the key: it is built from the HTTP status and a
 * clipped provider error text, and every occurrence of the key (and of the usual key shapes, via `log.redact`)
 * is replaced before it leaves this module. Redirects are not followed, so a key sent in a header never
 * travels to a host the registry did not name.
 */

export const PROBE_TIMEOUT_MS = 10_000;

export type ProbeResult = { ok: boolean; message: string };

export type ProbeDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Azure Speech region (not a secret); `AZURE_SPEECH_REGION` when absent. */
  azureRegion?: string;
};

type Request = { url: string; headers?: Record<string, string> };

const REGION_RE = /^[a-z0-9-]{2,30}$/;

/** The request for `id`, or an error text when the probe cannot be built (e.g. Azure without a region). */
export function probeRequest(id: string, key: string, deps: ProbeDeps = {}): Request | { error: string } {
  switch (id) {
    case "gemini":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": key } };
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
    case "pexels":
      return { url: "https://api.pexels.com/v1/search?query=nature&per_page=1", headers: { Authorization: key } };
    case "pixabay":
      return { url: `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=nature&per_page=3` };
    case "openalex":
      return { url: `https://api.openalex.org/works?per-page=1&api_key=${encodeURIComponent(key)}` };
    case "googlebooks":
      return { url: `https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1&key=${encodeURIComponent(key)}` };
    case "elevenlabs":
      // Subscription read: free (no credits spent); needs the key's «User: read» permission.
      return { url: "https://api.elevenlabs.io/v1/user/subscription", headers: { "xi-api-key": key } };
    case "fal":
      // fal Platform API price list of OUR endpoints: needs a valid key, spends nothing
      // (https://fal.ai/docs/platform-apis/v1/models/pricing, read 2026-11-02).
      return { url: `${FAL_PRICING_URL}?endpoint_id=${encodeURIComponent(falEndpoints().join(","))}`, headers: { Authorization: `Key ${key}` } };
    case "azure": {
      const region = (deps.azureRegion ?? process.env.AZURE_SPEECH_REGION ?? "").trim().toLowerCase();
      if (!REGION_RE.test(region)) return { error: "AZURE_SPEECH_REGION sozlanmagan yoki noto'g'ri" };
      return { url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, headers: { "Ocp-Apim-Subscription-Key": key } };
    }
    default:
      return { error: "Bu provayder uchun tekshiruv yo'q" };
  }
}

/** Replaces the key itself and the usual key shapes; clips to 160 chars. */
export function redactProbeText(text: string, key: string): string {
  let out = key ? text.split(key).join("…") : text;
  const enc = key ? encodeURIComponent(key) : "";
  if (enc && enc !== key) out = out.split(enc).join("…");
  out = redact(out).replace(/\s+/g, " ").trim();
  return out.length > 160 ? `${out.slice(0, 157)}...` : out;
}

async function errorText(res: Response): Promise<string> {
  try {
    const raw = (await res.text()).slice(0, 2000);
    try {
      const j = JSON.parse(raw) as { error?: unknown; message?: unknown; detail?: unknown };
      const e = j.error ?? j.detail;
      if (typeof e === "string") return e;
      if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
      if (typeof j.message === "string") return j.message;
    } catch {
      // not JSON: the clipped raw text is enough
    }
    return raw;
  } catch {
    return "";
  }
}

const groupDigits = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * ElevenLabs answers with the plan and its character credits: the admin sees at once whether the paid plan is active
 * and how much is left (the first piece of the provider balance monitor, docs/studio/PLAN.md §19.7).
 */
export function elevenLabsMessage(body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as { tier?: unknown; status?: unknown; character_count?: unknown; character_limit?: unknown };
  const used = Number(b.character_count);
  const limit = Number(b.character_limit);
  const parts = ["Kalit qabul qilindi"];
  if (typeof b.tier === "string" && /^[\w -]{1,40}$/.test(b.tier)) parts.push(`tarif: ${b.tier}`);
  if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) parts.push(`qoldi ${groupDigits(Math.max(0, limit - used))} / ${groupDigits(limit)} kredit`);
  return parts.join(" · ");
}

export const FAL_PRICING_URL = "https://api.fal.ai/v1/models/pricing";
/** Balance read (`billing:usage:read`; a key without it answers 403, which is not a key problem). */
export const FAL_BILLING_URL = "https://api.fal.ai/v1/account/billing?expand=credits";

/** fal endpoint id → the catalog's flat USD per picture (`null` for a param-priced model such as Ideogram's quality). */
export function falEndpointPrices(): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const id of FAL_IMAGE_MODELS) {
    const e = MEDIA_CATALOG.byId(id)!;
    const flat = e.cost.per === "output" && !e.cost.by ? e.cost.usd : null;
    for (const r of e.routes) if (r.provider === "fal") out.set(r.upstreamModel, flat);
  }
  return out;
}

const falEndpoints = () => [...falEndpointPrices().keys()];

const usdText = (n: number) => `$${Number(n.toFixed(4))}`;

/**
 * The admin's answer for fal: the key works, and fal's OWN unit price of each endpoint against the price the catalog
 * charges from (a changed fal price shows here before it shows in the margin), plus the balance when the key may read it.
 */
export function falMessage(pricing: unknown, billing: unknown): string {
  const parts = ["Kalit qabul qilindi"];
  const want = falEndpointPrices();
  const rows = Array.isArray((pricing as { prices?: unknown } | null)?.prices) ? ((pricing as { prices: unknown[] }).prices as Record<string, unknown>[]) : [];
  const diffs: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = typeof r.endpoint_id === "string" ? r.endpoint_id : "";
    const price = Number(r.unit_price);
    if (!want.has(id) || !Number.isFinite(price)) continue;
    seen.add(id);
    const ours = want.get(id);
    if (ours !== null && ours !== undefined && Math.abs(price - ours) > 1e-9) diffs.push(`${id}: fal ${usdText(price)}${typeof r.unit === "string" && /^[\w -]{1,20}$/.test(r.unit) ? `/${r.unit}` : ""}, bizda ${usdText(ours)}`);
  }
  const missing = [...want.keys()].filter((id) => !seen.has(id));
  if (diffs.length) parts.push(`narx farqi — ${diffs.join("; ")}`);
  else if (rows.length) parts.push("narxlar katalog bilan mos");
  if (missing.length) parts.push(`fal narxini bermadi: ${missing.join(", ")}`);
  const credits = (billing as { credits?: { current_balance?: unknown; currency?: unknown } } | null)?.credits;
  const bal = Number(credits?.current_balance);
  if (credits && Number.isFinite(bal)) parts.push(`balans ${typeof credits.currency === "string" && /^[A-Z]{3}$/.test(credits.currency) && credits.currency !== "USD" ? `${bal} ${credits.currency}` : usdText(bal)}`);
  return parts.join(" · ");
}

/** Runs the probe of `id` with `key`. Never throws, never returns the key. */
export async function probeProvider(id: string, key: string, deps: ProbeDeps = {}): Promise<ProbeResult> {
  if (!providerDef(id)) return { ok: false, message: "Noma'lum provayder" };
  if (!key) return { ok: false, message: "Kalit kiritilmagan" };
  const req = probeRequest(id, key, deps);
  if ("error" in req) return { ok: false, message: req.error };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(req.url, { method: "GET", headers: req.headers, signal: ctrl.signal, redirect: "manual" });
    if (res.ok && id === "fal") {
      const pricing = await res.json().catch(() => null);
      let billing: unknown = null;
      try {
        const b = await fetchImpl(FAL_BILLING_URL, { method: "GET", headers: req.headers, signal: ctrl.signal, redirect: "manual" });
        if (b.ok) billing = await b.json().catch(() => null);
      } catch {
        // the balance is optional: the key already passed
      }
      // Built only from our endpoint ids and numbers (the unit is pattern-checked); the key cannot be in it, split anyway.
      return { ok: true, message: falMessage(pricing, billing).split(key).join("…") };
    }
    if (res.ok) return { ok: true, message: id === "elevenlabs" ? elevenLabsMessage(await res.json().catch(() => null)) : "Kalit qabul qilindi" };
    const detail = redactProbeText(await errorText(res), key);
    return { ok: false, message: `Provayder rad etdi (HTTP ${res.status})${detail ? `: ${detail}` : ""}` };
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    const detail = redactProbeText(e instanceof Error ? e.message : String(e), key);
    return { ok: false, message: aborted ? "Vaqt tugadi (10 soniya)" : `Tarmoq xatosi${detail ? `: ${detail}` : ""}` };
  } finally {
    clearTimeout(timer);
  }
}
