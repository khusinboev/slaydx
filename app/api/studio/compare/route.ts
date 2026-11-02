import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { sanitizeValues } from "@/lib/server/validate";
import { startInlineWorker } from "@/lib/server/worker";
import { env } from "@/lib/server/env";
import { COMPARE_MAX, COMPARE_MIN, submitCompare, type CompareKind, type CompareMember } from "@/lib/server/studio-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Studio «Solishtirish» (docs/studio/P7-SPEC.md P7a): one prompt, 2–4 models, charged and queued together.
 *
 * Body: `{ kind: "image" | "video", members: [{ values, expectedPrice? }], expectedTotal? }`; header `Idempotency-Key`
 * (UUID, optional — as `POST /api/generations`). 202 `{ group, total, items: [{ id, modelId, price }] }`; 400 / 402 /
 * 403 / 409 / 422 / 503 before anything is charged; 429 = admission (`Retry-After`) or the rate limit.
 *
 * Rate limits: the batch is N generations — it takes N slots of the same per-user buckets as the single submit.
 */
export const POST = handler("studio/compare", async (req) => {
  const { user } = await requireUser(req);
  const idempotencyKey = readIdempotencyKey(req);
  const body = await readJson<{ kind?: unknown; members?: unknown; expectedTotal?: unknown }>(req, 64_000);
  const kind: CompareKind | null = body.kind === "image" || body.kind === "video" ? body.kind : null;
  if (!kind) throw new ApiError("Noma'lum bo'lim", 400);
  if (!Array.isArray(body.members) || body.members.length < COMPARE_MIN || body.members.length > COMPARE_MAX) {
    throw new ApiError(`Solishtirish uchun ${COMPARE_MIN}–${COMPARE_MAX} ta model tanlang`, 400, { code: "compare_invalid" });
  }
  const members: CompareMember[] = body.members.map((raw) => {
    const m = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const values = sanitizeValues(m.values);
    if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);
    const expectedPrice = readPrice(m.expectedPrice);
    return expectedPrice === undefined ? { values } : { values, expectedPrice };
  });
  const expectedTotal = readPrice(body.expectedTotal);

  // N generations = N slots of the single submit's buckets (no bypass of the burst / hourly limit).
  for (let i = 0; i < members.length; i++) {
    await limit(`gen:burst:${user.id}`, 5, 60);
    await limit(`gen:hour:${user.id}`, 60, 3600);
  }

  const result = await submitCompare({ userId: user.id, kind, members, expectedTotal, idempotencyKey });
  if (result.kind === "admission") {
    const { code, retryAfterSec, error } = result;
    return json({ error, code, retryAfterSec }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }
  if (env.worker.inline) startInlineWorker();
  return json(
    { group: result.group, total: result.total, items: result.items, status: "QUEUED" },
    { status: 202, headers: result.replayed ? { "Idempotent-Replayed": "true" } : undefined },
  );
});

/** Optional shown price: absent = `undefined`; present but not a non-negative safe integer = 400. */
function readPrice(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) throw new ApiError("Kutilgan narx noto'g'ri", 400);
  return raw;
}

function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.headers.get("idempotency-key");
  if (raw === null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new ApiError("Idempotency-Key UUID bo'lishi kerak", 400);
  return key;
}
