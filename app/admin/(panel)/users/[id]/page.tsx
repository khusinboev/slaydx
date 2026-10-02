import type { Metadata } from "next";
import { UserDetail } from "@/components/admin/users/UserDetail";
import { adminToolOptions } from "@/lib/server/admin-generations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Foydalanuvchi" };

/**
 * S5: one user (permission `users.view`, tabs by permission, enforced by the
 * API; a bad id is the API's 404). Tool options for the embedded jobs table
 * come from the server registry (WP3's reuse contract).
 */
export default async function AdminUserRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetail id={id} tools={adminToolOptions()} />;
}
