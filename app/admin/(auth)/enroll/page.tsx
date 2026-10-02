import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/server/env";
import { EnrollForm } from "@/components/admin/shell/EnrollForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "2FA sozlash",
  // The URL carries a one-time enrollment token: never send it to another site.
  referrer: "no-referrer",
};

/**
 * S2: authenticator enrollment from the one-time link printed by `admin:create`.
 * Not used with the 2FA switch off (no links exist): the panel entry takes over.
 */
export default async function AdminEnrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!env.admin2faRequired) redirect("/admin");
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && raw ? raw : null;
  return <EnrollForm token={token} />;
}
