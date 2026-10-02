import type { Metadata } from "next";
import { ErrorsPage } from "@/components/admin/errors/ErrorsPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Xatolar" };

/** S16: persisted error log (permission `errors.view`, enforced by the API). */
export default function AdminErrorsRoute() {
  return <ErrorsPage />;
}
