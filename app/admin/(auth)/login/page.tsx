import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentAdminContextFromCookies } from "@/lib/server/admin-session";
import { env } from "@/lib/server/env";
import { AdminAutoEnter } from "@/components/admin/shell/AdminAutoEnter";
import { LoginForm } from "@/components/admin/shell/LoginForm";
import { sanitizeAdminNext } from "@/components/admin/shell/nav-registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Kirish" };

/**
 * S1: TOTP login. An admin who already has a live admin session goes straight
 * to `next`. With the 2FA switch off there is no code: the page auto-enters
 * and then goes to the (sanitised) `next`.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).next;
  const next = sanitizeAdminNext(Array.isArray(raw) ? raw[0] : raw);
  const resolved = await currentAdminContextFromCookies();
  if (resolved.ok) redirect(next);
  // `app/admin/layout.tsx` already 404s non-admins; this keeps the page safe on its own.
  if (!resolved.user) notFound();
  if (!env.admin2faRequired) return <AdminAutoEnter next={next} />;
  return <LoginForm next={next} userName={resolved.user.name} />;
}
