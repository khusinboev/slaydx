import { Suspense } from "react";
import type { Metadata } from "next";
import { Dashboard } from "@/components/admin/dashboard/Dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bosh sahifa" };

/** S3 `/admin`: the KPI dashboard, the landing page after login (permission `dashboard.view`, every role). */
export default function AdminDashboardRoute() {
  // `useSearchParams` (the period in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
