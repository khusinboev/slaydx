import type { Metadata } from "next";
import { AuditPage } from "@/components/admin/audit/AuditPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Audit jurnali" };

/** S17: audit trail (permission `audit.view`, enforced by the API). */
export default function AdminAuditRoute() {
  return <AuditPage />;
}
