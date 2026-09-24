import { ApiError, handler } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { getAsset } from "@/lib/server/assets";
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";
import { getGameSessionByToken, TOKEN_RE } from "@/lib/server/game-sessions";
import { publicGameView } from "@/lib/game/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; assetId: string }> };

const ASSET_ID = /^[0-9a-f]{8,64}$/i;
/** Faqat audio — boshqa MIME `octet-stream` bo'lib ketadi (XSS/sniff yo'q). */
const ALLOWED = new Set(["audio/mpeg", "audio/wav"]);

/**
 * OCHIQ TINGLASH AUDIOSI (loginsiz) — `/api/o/[token]/audio/[assetId]`.
 *
 * Egasining `/api/generations/[id]/assets/[assetId]` route'i sessiya
 * talab qiladi; o'quvchi esa loginsiz (egasi qarori 8). Shuning uchun
 * bu yerda egalik TOKEN orqali o'tadi: sessiya → generatsiya → aktiv
 * (`getAsset` egalik SQL ini sessiyadagi `userId` bilan yuradi).
 *
 * Ikkinchi darvoza — aktiv HAQIQATAN shu o'yinning tinglash parchasi
 * bo'lishi kerak (`publicGameView` ro'yxatida bor): token bitta
 * generatsiyaning BOSHQA aktivlariga (kelajakda rasm/kelajak fayllar)
 * kalit bo'lib qolmasin. Har qanday nomuvofiqlik — 404, sabab aytilmaydi.
 *
 * Kesh (C08): route `next.config.ts` dagi `/api` no-store qoidasidan
 * istisno — `public` kesh faqat haqiqiy baytga, har 404 esa
 * `private, no-store` (`noStoreOnError`).
 */
export const GET = noStoreOnError(handler("o/audio", async (req, ctx: Ctx) => {
  await ensureMigrated();
  const { token, assetId } = await ctx.params;
  if (!TOKEN_RE.test(token) || !ASSET_ID.test(assetId)) throw new ApiError("Topilmadi", 404);

  const session = await getGameSessionByToken(token);
  if (!session || !session.doc || session.status !== "COMPLETED") throw new ApiError("Topilmadi", 404);
  const view = publicGameView(session.doc, session.kind, { seed: token });
  if (!view || view.kind !== "listening" || !audioAssetIds(view).has(assetId.toLowerCase())) throw new ApiError("Topilmadi", 404);

  const asset = await getAsset(session.generationId, assetId.toLowerCase(), session.userId);
  if (!asset) throw new ApiError("Topilmadi", 404);

  const mime = ALLOWED.has(asset.mime) ? asset.mime : "application/octet-stream";
  return new Response(bytesBody(asset.bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(asset.bytes.byteLength),
      // Aktiv id — kontent hashi; havola ochiq bo'lgani uchun `public` kesh xavfsiz.
      // 1 soat (1 kun/immutable emas): o'yin havolasi yopilsa, oraliq kesh uni
      // ko'pi bilan bir soat berib turadi (review W2-B N2).
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex",
    },
  });
}));

/** Ochiq ko'rinishdagi tinglash parchalarining aktiv id lari (kichik harf). */
export function audioAssetIds(view: { kind: "listening"; items: { audioAssetId?: string }[] }): Set<string> {
  return new Set(view.items.map((it) => it.audioAssetId?.toLowerCase()).filter((x): x is string => Boolean(x)));
}
