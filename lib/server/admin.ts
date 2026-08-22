import "server-only";
import { ApiError, checkOrigin, type AuthedContext } from "./api";
import { clientIp } from "./ratelimit";
import { currentUser } from "./session";
import { ensureMigrated } from "./db";
import { isAdminPhone } from "./admin-phones";

export { isAdminPhone, normalizePhone } from "./admin-phones";

/**
 * `requireUser` bilan bir xil, lekin admin ro'yxatida bo'lishni ham
 * talab qiladi. Admin bo'lmagan foydalanuvchi uchun 404 qaytariladi
 * (403 emas) — shunda admin panelining borligi ham oshkor bo'lmaydi.
 */
export async function requireAdmin(req: Request): Promise<AuthedContext> {
  await ensureMigrated();
  if (req.method !== "GET" && req.method !== "HEAD" && !checkOrigin(req)) {
    throw new ApiError("So'rov manbasi noto'g'ri", 403);
  }
  const user = await currentUser();
  if (!user || !isAdminPhone(user.phone)) throw new ApiError("Topilmadi", 404);
  return { user, ip: clientIp(req) };
}
