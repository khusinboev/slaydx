import type { Metadata } from "next";
import { EnrollForm } from "@/components/admin/shell/EnrollForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "2FA sozlash",
  // The URL carries a one-time enrollment token: never send it to another site.
  referrer: "no-referrer",
};

/** S2: authenticator enrollment from the one-time link printed by `admin:create`. */
export default async function AdminEnrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && raw ? raw : null;
  return <EnrollForm token={token} />;
}
