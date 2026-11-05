/**
 * The ONE adapter of every OpenAI-compatible text provider (`POST {baseUrl}/chat/completions`), parameterised by a
 * preset row. Adding a provider is a table entry, see docs/ops/LLM-FALLBACK.md.
 *
 * What differs from Gemini, and how it degrades safely:
 *   - no grounding: `llm.ts` never sends a grounded call here (the deck is written without research instead);
 *   - thinking is switched OFF for every call: `opts.thinking` is a Gemini budget, both presets think by default, the
 *     reasoning would cost output tokens and it is only ever read from `content`, never from `reasoning_content`;
 *   - `responseSchema` cannot be enforced: `response_format` is `json_object` and the schema goes into the prompt;
 *   - JSON mode needs the word «JSON» in the prompt on both providers, `JSON_INSTRUCTION` guarantees it;
 *   - text only: multimodal calls stay on Gemini (`domla-deps.ts`, `test-analysis.ts`).
 *
 * Error mapping (Attempt shape, the chain decides from it):
 *   429 / 5xx / network   retryable, `Retry-After` honoured;
 *   429 with no quota     not retryable, `account` (DashScope: «You exceeded your current quota», arrears);
 *   401 / 402 / 403       not retryable, the breaker opens (`failure.ts isAccountFailure`), the chain moves on at once;
 *   data_inspection       `safety`, not retryable, the provider stays healthy;
 *   other 4xx             not retryable;
 *   finish length         a cut answer is returned as `MAX_TOKENS` (the JSON retry knows what to do), an empty one is `truncated`;
 *   finish content_filter `safety`;
 *   400 about max_tokens  one more try with the limit the message names, else half (the adapter's only own retry);
 *   a refused redirect    final: the same request gets the same redirect.
 *
 * Two checks on the answer, neither of which Gemini needs:
 *   - `<think>…</think>` in `content` is removed;
 *   - an answer in Chinese, Korean or Japanese is a failed one. These models fall back to their home language, and a
 *     stray Chinese paragraph in an Uzbek deck would be delivered as finished work. `kind: "empty"`: the provider is
 *     healthy, the chain moves on. See `foreignScript`.
 *
 * The key travels only in the Authorization header, redirects are refused so it never reaches another host, and every
 * provider text that enters an Attempt passes `clean()`.
 */
import { redact } from "../../server/log";
import { getProviderKey } from "../../server/providers/resolve";
import type { FailureKind } from "./failure";
import { describeNetError, parseRetryAfter } from "./retry";
import type { AdapterOpts, Attempt, OpenAiCompatId, ProviderAdapter, Usage } from "./types";

export type OpenAiCompatPreset = {
  id: OpenAiCompatId;
  label: string;
  /** Without the trailing `/chat/completions`. */
  baseUrl: string;
  /** Optional env override of `baseUrl`: https on a host ending in `overrideHostSuffix`, or it is ignored. */
  baseUrlEnv?: string;
  overrideHostSuffix?: string;
  /** The model of the default chain, also what a completion probe calls. */
  defaultModel: string;
  /** The body fields that switch this provider's default thinking off. */
  thinkingOff: Record<string, unknown>;
  /** `max_tokens` never exceeds this (a larger value is a 400). */
  maxOutputTokens: number;
  /** A free authenticated GET for «Tekshirish», relative to `baseUrl`. `null`: a one-token completion instead. */
  probePath: string | null;
};

export const OPENAI_COMPAT_PRESETS: Readonly<Record<OpenAiCompatId, OpenAiCompatPreset>> = {
  /*
   * Alibaba Model Studio, Singapore. `dashscope-intl` is the region-wide pay-as-you-go domain: «Legacy shared domain.
   * Still available; migration to a workspace-dedicated domain is recommended», so `DASHSCOPE_BASE_URL` can name
   * `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
   * (https://www.alibabacloud.com/help/en/model-studio/base-url, read 2026-11-05). Keys are per region: a Beijing key
   * answers 401 here. Thinking defaults to ON for Qwen 3.5+ (model-studio/deep-thinking, read 2026-11-05).
   */
  qwen: {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    baseUrlEnv: "DASHSCOPE_BASE_URL",
    overrideHostSuffix: ".aliyuncs.com",
    defaultModel: "qwen3.7-plus",
    thinkingOff: { enable_thinking: false },
    maxOutputTokens: 65_536,
    probePath: null,
  },
  /* https://api-docs.deepseek.com/guides/thinking_mode (read 2026-11-05): thinking is the default, `thinking.type` turns it off. */
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    thinkingOff: { thinking: { type: "disabled" } },
    maxOutputTokens: 65_536,
    probePath: "/user/balance",
  },
};

function allowedOverride(preset: OpenAiCompatPreset, raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(preset.overrideHostSuffix ?? "");
  } catch {
    return false;
  }
}

/** The preset's base URL. A bad override is ignored: the key must never travel in clear text or to a foreign host. */
export function presetBaseUrl(preset: OpenAiCompatPreset, env: NodeJS.ProcessEnv = process.env): string {
  const override = preset.baseUrlEnv ? env[preset.baseUrlEnv]?.trim() : "";
  const base = override && allowedOverride(preset, override) ? override : preset.baseUrl;
  return base.replace(/\/+$/, "");
}

/** Same floor as `geminiBody`: callers size `maxTokens` for a model that always gets at least this much. */
const MIN_MAX_TOKENS = 4096;

const JSON_INSTRUCTION = "\n\nReturn ONLY one complete, valid JSON value as your entire response. No markdown fences, no commentary.";

/** Longest SSE line, and longest answer: 65 536 output tokens stay far below both. Past them the stream is not an answer. */
const MAX_SSE_LINE_CHARS = 1_000_000;
const MAX_STREAM_TEXT_CHARS = 4_000_000;

/** Above this share of the letters an answer counts as written in the wrong script. */
const FOREIGN_SCRIPT_RATIO = 0.02;
/** Fewer characters than this is a quoted term, not a language change. */
const FOREIGN_SCRIPT_MIN_CHARS = 3;

/** Answers without usage (a proxy, a cut stream): rough tokens, so the spend is never a silent $0. */
const CHARS_PER_TOKEN = 3;

function systemText(system: string, opts: AdapterOpts): string {
  if (!opts.json) return system;
  const schema = opts.responseSchema ? `\nThe JSON must match this schema: ${JSON.stringify(opts.responseSchema)}` : "";
  return `${system}${JSON_INSTRUCTION}${schema}`;
}

/** The request body, the same for the streaming and the plain path. */
export function chatBody(preset: OpenAiCompatPreset, model: string, system: string, user: string, opts: AdapterOpts): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: systemText(system, opts) },
      { role: "user", content: user },
    ],
    temperature: opts.json ? 0.4 : 0.5,
    max_tokens: Math.min(Math.max(opts.maxTokens, MIN_MAX_TOKENS), preset.maxOutputTokens),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    ...preset.thinkingOff,
    ...(opts.onText ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

type ApiUsage = { prompt_tokens?: number; completion_tokens?: number };
type ApiChoice = { finish_reason?: string | null; message?: { content?: string | null }; delta?: { content?: string | null } };
type ApiError = { message?: unknown; code?: unknown; type?: unknown };
type ApiBody = { choices?: ApiChoice[]; usage?: ApiUsage | null; error?: ApiError | string; code?: unknown; message?: unknown };

const NO_QUOTA_RE = /insufficient_quota|exceeded your current quota|Arrearage|AllocationQuota|OUT_OF_SERVICE|insufficient balance/i;
const BAD_CONTENT_RE = /data_inspection_failed|DataInspectionFailed|inappropriate content/i;
const TOKEN_LIMIT_RE = /max[_ ]tokens|max_completion_tokens|\brange\b/i;
/** Smallest limit worth another try. */
const MIN_RETRY_TOKENS = 256;

const CJK_RE = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/**
 * The request itself allows CJK: every engine names its output language in the prompt (`languageDirective`, the
 * translation prompts), in English and in the native script. Fail-open on purpose: a topic like «Xitoy tarixi» switches
 * the guard off too, which costs less than rejecting a requested translation.
 */
const CJK_REQUESTED_RE = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]|chinese|japanese|korean|mandarin|xitoy|yapon|koreys|китай|япон|корей/iu;

/** The share of CJK letters in `text` when it is above the limit and the request did not ask for it, else `null`. */
function foreignScript(text: string, system: string, user: string): number | null {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  if (cjk < FOREIGN_SCRIPT_MIN_CHARS) return null;
  const ratio = cjk / (text.match(/\p{L}/gu)?.length ?? cjk);
  return ratio > FOREIGN_SCRIPT_RATIO && !CJK_REQUESTED_RE.test(`${system}\n${user}`) ? ratio : null;
}

/** Reasoning some models write into `content`, also while its closing tag has not arrived yet. */
function stripThink(text: string): string {
  return /<think>/i.test(text) ? text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "") : text;
}

function toUsage(u: ApiUsage | null | undefined): Usage | undefined {
  return u ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 } : undefined;
}

function estimated(system: string, user: string, text: string): Usage {
  return { inputTokens: Math.ceil((system.length + user.length) / CHARS_PER_TOKEN), outputTokens: Math.ceil(text.length / CHARS_PER_TOKEN) };
}

/** Provider text on its way into a log line or the job's error: the key cannot survive this. */
function clean(text: string, key: string): string {
  return redact(key ? text.split(key).join("…") : text).replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Error fields of an OpenAI-shaped (`error.{message,code,type}`) or a DashScope-native (`code`, `message`) body. */
function errorParts(body: ApiBody | null): { message: string; code: string } {
  const e = body?.error;
  const nested = e && typeof e === "object" ? e : null;
  const message = typeof e === "string" ? e : typeof nested?.message === "string" ? nested.message : typeof body?.message === "string" ? body.message : "";
  const code = [nested?.code, nested?.type, body?.code].filter((c) => typeof c === "string").join(" ");
  return { message, code };
}

/** The lower `max_tokens` of the second try after a 400 about the limit, or `null` when the 400 is about something else. */
function loweredLimit(status: number, body: ApiBody | null, requested: number): number | null {
  if (status !== 400 && status !== 422) return null;
  const { message, code } = errorParts(body);
  const text = `${code} ${message}`;
  if (!TOKEN_LIMIT_RE.test(text) || BAD_CONTENT_RE.test(text) || NO_QUOTA_RE.test(text)) return null;
  const named = (text.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n >= MIN_RETRY_TOKENS && n < requested);
  const limit = named.length > 0 ? Math.max(...named) : Math.floor(requested / 2);
  return limit >= MIN_RETRY_TOKENS ? limit : null;
}

function httpFailure(status: number, body: ApiBody | null, headers: Headers | null | undefined, key: string): Attempt & { ok: false } {
  const { message, code } = errorParts(body);
  const text = `${code} ${message}`;
  const error = clean(`${code ? `${code}: ` : ""}${message}`, key) || `HTTP ${status}`;
  if (BAD_CONTENT_RE.test(text)) return { ok: false, error, retryable: false, status, kind: "safety" };
  if (NO_QUOTA_RE.test(text)) return { ok: false, error, retryable: false, status, account: true };
  const retryable = status === 429 || status >= 500;
  const after = retryable && typeof headers?.get === "function" ? parseRetryAfter(headers.get("retry-after")) : undefined;
  return { ok: false, error, retryable, status, ...(after !== undefined ? { retryAfterMs: after } : {}) };
}

/** A finished answer → Attempt. `finish` is the provider's raw `finish_reason`. */
function finished(raw: string, finish: string | null | undefined, usage: Usage | undefined, system: string, user: string): Attempt {
  const text = stripThink(raw).trim();
  const paid = usage ?? estimated(system, user, text);
  if (finish === "content_filter") return { ok: false, error: "content_filter", retryable: false, kind: "safety", finishReason: finish, usage: paid };
  // DeepSeek: the server ran out of capacity mid-answer, the text is incomplete.
  if (finish === "insufficient_system_resource") return { ok: false, error: finish, retryable: true, kind: "other", finishReason: finish, usage: paid };
  const cut = finish === "length";
  if (!text) {
    // DeepSeek's JSON mode blanks an invalid answer to spaces (guides/json_mode): worth another try, unlike a limit hit.
    return { ok: false, error: cut ? "bo'sh javob (max_tokens)" : "bo'sh javob", retryable: !cut, kind: cut ? "truncated" : "empty", ...(finish ? { finishReason: cut ? "MAX_TOKENS" : finish } : {}), usage: paid };
  }
  const foreign = foreignScript(text, system, user);
  if (foreign !== null) return { ok: false, error: `answer in a CJK script (${Math.round(foreign * 100)} % of letters)`, retryable: false, kind: "empty", ...(finish ? { finishReason: finish } : {}), usage: paid };
  return { ok: true, text, usage: paid, ...(finish ? { finishReason: cut ? "MAX_TOKENS" : finish } : {}) };
}

function streamFailure(error: string, kind: FailureKind, text: string, usage: Usage | undefined, system: string, user: string): Attempt {
  return { ok: false, error, retryable: true, kind, usage: usage ?? estimated(system, user, text) };
}

async function readStream(res: Response, onText: (partial: string) => void, system: string, user: string, key: string): Promise<Attempt> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finish: string | undefined;
  let usage: Usage | undefined;
  let dropped = 0;
  const tooLarge = async (): Promise<Attempt> => {
    await reader.cancel().catch(() => {});
    return { ok: false, error: "stream too large", retryable: false, kind: "other", usage: usage ?? estimated(system, user, text) };
  };
  for (;;) {
    const { done, value } = await reader.read();
    buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (done && buf !== "" && !buf.endsWith("\n")) buf += "\n";
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      let chunk: ApiBody;
      try {
        chunk = JSON.parse(payload) as ApiBody;
      } catch {
        dropped += 1;
        continue;
      }
      if (chunk.error) {
        await reader.cancel().catch(() => {});
        const code = typeof chunk.error === "object" ? Number(chunk.error.code) : NaN;
        const fail = httpFailure(Number.isFinite(code) && code >= 400 ? code : 500, chunk, null, key);
        return { ...fail, ...(usage ? { usage } : {}) };
      }
      usage = toUsage(chunk.usage) ?? usage;
      const choice = chunk.choices?.[0];
      // Only `content` is the answer: `reasoning_content` must never reach the text.
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta !== "") {
        text += delta;
        if (text.length > MAX_STREAM_TEXT_CHARS) return tooLarge();
        const shown = stripThink(text);
        if (shown) onText(shown);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    if (buf.length > MAX_SSE_LINE_CHARS) return tooLarge();
    if (done) break;
  }
  // A lost chunk or a stream cut before its finish reason is a hole in the text (fatal for JSON): the chain tries again.
  if (dropped > 0) return streamFailure(`stream lost ${dropped} chunk(s)`, "other", text, usage, system, user);
  if (!finish) return streamFailure("stream ended before finish_reason", "network", text, usage, system, user);
  return finished(text, finish, usage, system, user);
}

export type OpenAiCompatDeps = { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv };

export function makeOpenAiCompatAdapter(preset: OpenAiCompatPreset, deps: OpenAiCompatDeps = {}): ProviderAdapter {
  return {
    id: preset.id,
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const key = getProviderKey(preset.id);
      if (!key) return { ok: false, error: `${preset.label} kaliti yo'q`, retryable: false };
      const fetchImpl = deps.fetchImpl ?? fetch;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const send = (body: Record<string, unknown>) =>
          fetchImpl(`${presetBaseUrl(preset, deps.env)}/chat/completions`, {
            method: "POST",
            signal: ctrl.signal,
            redirect: "error",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          });
        const request = chatBody(preset, model, system, user, opts);
        const errorBody = async (r: Response) => (await r.json().catch(() => null)) as ApiBody | null;
        let res = await send(request);
        if (!res.ok) {
          const body = await errorBody(res);
          const lower = loweredLimit(res.status, body, request.max_tokens as number);
          if (lower === null) return httpFailure(res.status, body, res.headers, key);
          res = await send({ ...request, max_tokens: lower });
          if (!res.ok) return httpFailure(res.status, await errorBody(res), res.headers, key);
        }
        const sse = /event-stream/i.test(res.headers?.get?.("content-type") ?? "");
        if (opts.onText && res.body && sse) return await readStream(res, opts.onText, system, user, key);
        // Not streaming, or a proxy that buffered the stream into one JSON answer.
        const data = (await res.json()) as ApiBody;
        const choice = data.choices?.[0];
        const out = finished(choice?.message?.content ?? "", choice?.finish_reason, toUsage(data.usage), system, user);
        if (out.ok) opts.onText?.(out.text);
        return out;
      } catch (e) {
        if (ctrl.signal.aborted) return { ok: false, error: "aborted (timeout)", retryable: false, kind: "timeout" };
        const error = clean(describeNetError(e), key);
        // `redirect: "error"` refused to follow: the provider would answer the same, and the key must not go there.
        if (/redirect/i.test(error)) return { ok: false, error, retryable: false, kind: "other" };
        return { ok: false, error, retryable: true, kind: "network" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const OPENAI_COMPAT_ADAPTERS: Readonly<Record<OpenAiCompatId, ProviderAdapter>> = {
  qwen: makeOpenAiCompatAdapter(OPENAI_COMPAT_PRESETS.qwen),
  deepseek: makeOpenAiCompatAdapter(OPENAI_COMPAT_PRESETS.deepseek),
};
