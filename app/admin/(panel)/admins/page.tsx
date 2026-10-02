import type { Metadata } from "next";
import { AdminsPage } from "@/components/admin/admins/AdminsPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Adminlar" };

/** S18: admin accounts (permission `admins.view`, enforced by the API). */
export default function AdminAdminsRoute() {
  return <AdminsPage />;
}
