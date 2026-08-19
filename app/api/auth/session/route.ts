import { handler, json, optionalUser, requireUser } from "@/lib/server/api";
import { clearSessionCookie, revokeAllSessions, revokeCurrentSession } from "@/lib/server/session";
import { env, llmConfigured, paymentsConfigured } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Joriy sessiya. Kirmagan foydalanuvchi uchun `user: null` — 401 emas. */
export const GET = handler("auth/session", async (req) => {
  const { user } = await optionalUser(req);
  return json({
    user,
    features: {
      llm: llmConfigured(),
      images: Boolean(env.fal.key),
      telegram: Boolean(env.telegramBotToken),
      telegramBot: env.telegramBotUsername || null,
      devLogin: env.devLoginEnabled,
      payments: paymentsConfigured(),
    },
  });
});

/** Chiqish. `?all=1` — barcha qurilmalardan. */
export const DELETE = handler("auth/logout", async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    const { user } = await requireUser(req);
    await revokeAllSessions(user.id);
  } else {
    await revokeCurrentSession();
  }
  await clearSessionCookie();
  return json({ ok: true });
});
