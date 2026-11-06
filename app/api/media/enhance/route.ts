import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { assertFreeLlmEnabled, withFreeLlm } from "@/lib/server/spend";
import { ENHANCE_INPUT_MAX, ENHANCE_MIN, enhanceSystemPrompt, enhanceUserPrompt, isEnhanceKind, parseEnhanced, restoreQuoted } from "@/lib/media/enhance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENHANCE_TIMEOUT_MS = 20_000;

/**
 * `POST /api/media/enhance` `{prompt, kind?}` → `{prompt}` (docs/studio/P11-SPEC.md §B, «Yaxshilash (AI)»): one `fast` LLM
 * call detects the language and rewrites the Studio prompt in English; the user sees and edits the result before
 * generating. `kind` is image (default), video, music or sfx. FREE: 10 / 10 min + a daily cap per
 * user (`free_llm.daily.enhance`, default 30) + the global free-LLM cap and kill switch (`lib/server/spend.ts`).
 */
export const POST = handler("media/enhance", async (req) => {
  const { user } = await requireUser(req);
  assertFreeLlmEnabled();
  const body = await readJson<{ prompt?: unknown; kind?: unknown }>(req, 16 * 1024);
  const kind = body?.kind === undefined ? "image" : body.kind;
  if (!isEnhanceKind(kind)) throw new ApiError("Noma'lum tavsif turi", 400);
  const prompt = typeof body?.prompt === "string" ? body.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < ENHANCE_MIN) throw new ApiError("Avval nimani chizish kerakligini yozing", 400);
  if (prompt.length > ENHANCE_INPUT_MAX[kind]) throw new ApiError(`Tavsif ${ENHANCE_INPUT_MAX[kind]} belgidan uzun`, 400);
  const r = await withFreeLlm({ endpoint: "enhance", userId: user.id, signal: req.signal }, (complete) =>
    complete("fast", enhanceSystemPrompt(kind), enhanceUserPrompt(prompt), { json: true, maxTokens: 600, timeoutMs: ENHANCE_TIMEOUT_MS }),
  );
  const out = parseEnhanced(r?.text, kind);
  if (!out) throw new ApiError("Tavsif yaxshilanmadi — qayta urinib ko'ring", 503);
  return json({ prompt: restoreQuoted(prompt, out, kind) });
});
