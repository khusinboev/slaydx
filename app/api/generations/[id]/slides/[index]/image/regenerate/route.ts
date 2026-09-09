import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { regenerateSlideImage } from "@/lib/server/slide-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** AI so'rovi 75 s gacha kutishi mumkin (`regenerateSlideImage` deadline) — zaxira bilan 120 s. */
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; index: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `hint` maydoni — `SLIDE_LIMITS.imageHint` bilan bir xil chegara (180). */
const HINT_MAX = 180;

/**
 * Slayd rasmini AI bilan qayta chizadi (E5).
 *
 * Tana: `{baseVersion, hint?}`. Qolgan hamma tekshiruv (egalik, versiya
 * qulfi, maket rasm joyi, bepul limit, provayder xato tasnifi) —
 * `lib/server/slide-image.ts` (`regenerateSlideImage`) da.
 */
export const POST = handler("generations/slide-image-regenerate", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id, index } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  await limit(`redraw:${user.id}`, 20, 3600);

  const body = await readJson<Record<string, unknown>>(req, 4096);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  }
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError("«baseVersion» yaroqsiz", 400);
  }
  let hint: string | undefined;
  if (body.hint !== undefined) {
    if (typeof body.hint !== "string" || body.hint.length > HINT_MAX) {
      throw new ApiError("«hint» yaroqsiz", 400);
    }
    hint = body.hint;
  }

  const generation = await regenerateSlideImage(id, user.id, Number(index), baseVersion, hint);
  return json({ generation });
});
