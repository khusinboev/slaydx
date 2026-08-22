import { notFound } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { isAdminPhone } from "@/lib/server/admin-phones";
import { AdminPage } from "@/components/admin/AdminPage";

export const dynamic = "force-dynamic";

/**
 * Server tomonlama tekshiruv.
 *
 * `requireAdmin` API darajasida (mutatsiya va ro'yxat so'rovlarida) ham
 * bor — bu yerdagi tekshiruv ikkinchi qatlam: admin bo'lmagan
 * foydalanuvchi klient qobig'ini ham ko'rmaydi. `notFound()` ataylab
 * (403 emas) — admin panelining borligi oshkor bo'lmasin.
 */
export default async function Page() {
  const user = await currentUser();
  if (!user || !isAdminPhone(user.phone)) notFound();
  return <AdminPage />;
}
