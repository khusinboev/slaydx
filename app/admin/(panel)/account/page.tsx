import type { Metadata } from "next";
import { AccountPage } from "@/components/admin/shell/AccountPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mening hisobim" };

/** S19: own account (permission `self`; every role has it). */
export default function AdminAccountRoute() {
  return <AccountPage />;
}
