import type { Metadata } from "next";
import { UsersPage } from "@/components/admin/users/UsersPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Foydalanuvchilar" };

/** S4: find users (permission `users.view`, enforced by the API). */
export default function AdminUsersRoute() {
  return <UsersPage />;
}
