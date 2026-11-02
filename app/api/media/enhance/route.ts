import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { assertFreeLlmEnabled, withFreeLlm } from "@/lib/server/spend";
import { ENHANCE_MAX, ENHANCE_MIN, enhanceSystemPrompt, enhanceUserPrompt, parseEnhanced } from "@/lib/media/enhance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENHANCE_TIMEOUT_MS = 20_000;

/**
 * `POST /api/media/enhance` `{prompt}` → `{prompt}` (docs/studio/P2B-SPEC.md, «Yaxshilash (AI)»): one `fast` LLM call
 * rewrites the Studio prompt; the user sees and edits the result before generating. FREE: 10 / 10 min + a daily cap per
 * user (`free_llm.daily.enhance`, default 30) + the global free-LLM cap and kill switch (`lib/server/spend.ts`).
 */
export const POST = handler("media/enhance", async (req) => {
  const { user } = await requireUser(req);
  assertFreeLlmEnabled();
  const body = await readJson<{ prompt?: unknown }>(req, 8 * 1024);
  const prompt = typeof body?.prompt === "string" ? body.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < ENHANCE_MIN) throw new ApiError("Avval nimani chizish kerakligini yozing", 400);
  if (prompt.length > ENHANCE_MAX) throw new ApiError(`Tavsif ${ENHANCE_MAX} belgidan uzun`, 400);
  const r = await withFreeLlm({ endpoint: "enhance", userId: user.id, signal: req.signal }, (complete) =>
    complete("fast", enhanceSystemPrompt(), enhanceUserPrompt(prompt), { json: true, maxTokens: 400, timeoutMs: ENHANCE_TIMEOUT_MS }),
  );
  const out = parseEnhanced(r?.text);
  if (!out) throw new ApiError("Tavsif yaxshilanmadi — qayta urinib ko'ring", 503);
  return json({ prompt: out });
});
