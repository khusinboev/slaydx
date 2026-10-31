import { redact } from "../log";
import { providerDef } from "./registry";

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
      const j = JSON.parse(raw) as { error?: unknown; message?: unknown };
      const e = j.error;
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
    if (res.ok) return { ok: true, message: "Kalit qabul qilindi" };
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
