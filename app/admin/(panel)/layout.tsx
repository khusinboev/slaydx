import { notFound } from "next/navigation";
import { currentAdminContextFromCookies } from "@/lib/server/admin-session";
import { permissionsOf } from "@/lib/server/admin-rbac";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import { AdminLoginRedirect } from "@/components/admin/shell/AdminLoginRedirect";
import { StepUpProvider, Toaster } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Panel layout (docs/admin/02-plan.md §7.0, §12): requires a live admin
 * session bound to the current user session. Without one, nothing of the
 * panel is rendered and the visitor is sent to `/admin/login?next=<here>`
 * (client-side, see `AdminLoginRedirect`). Toaster and the step-up dialog are
 * mounted exactly once here, for every page of the panel.
 *
 * The identity handed to the shell only drives what the UI shows; every API
 * route re-checks the session and permission on the server.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const resolved = await currentAdminContextFromCookies();
  if (!resolved.ok) {
    // Not an admin (or disabled): same 404 cloak as the parent gate.
    if (resolved.reason === "no_user" || resolved.reason === "not_admin" || resolved.reason === "disabled") notFound();
    return <AdminLoginRedirect />;
  }
  const { account, user } = resolved.ctx;
  return (
    <StepUpProvider>
      <AdminShell role={account.role} permissions={permissionsOf(account.role)} name={user.name} username={user.username}>
        {children}
      </AdminShell>
      <Toaster />
    </StepUpProvider>
  );
}
