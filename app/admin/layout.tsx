import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BRAND_NAME } from "@/lib/brand";
import { currentUser } from "@/lib/server/session";
import { getAdminAccountForUser } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} Admin`, template: `%s — ${BRAND_NAME} Admin` },
  robots: { index: false, follow: false },
};

/**
 * Gate for everything under `/admin` (docs/admin/02-plan.md §2, §12): only a
 * signed-in user with a pending or active admin account gets past it; anyone
 * else sees a plain 404, so the panel's existence is not disclosed (T16).
 * The admin session itself is checked one level down, in `(panel)/layout.tsx`.
 * The root layout still owns `<html>`; the consumer AppShell is not mounted here.
 */
export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) notFound();
  const account = await getAdminAccountForUser(user.id);
  if (!account) notFound();
  return children;
}
