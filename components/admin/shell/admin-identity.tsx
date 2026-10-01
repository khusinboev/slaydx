"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Who is signed in to the panel, as resolved by the server layout
 * (`app/admin/(panel)/layout.tsx`). UI-only: it decides what to show, never
 * what is allowed (the server checks every request).
 */
export type AdminIdentity = {
  role: string;
  permissions: ReadonlyArray<string>;
  name: string;
  username: string | null;
};

const AdminIdentityContext = createContext<AdminIdentity | null>(null);

export function AdminIdentityProvider({ value, children }: { value: AdminIdentity; children: ReactNode }) {
  return <AdminIdentityContext.Provider value={value}>{children}</AdminIdentityContext.Provider>;
}

/** The signed-in admin. Only valid inside the panel layout. */
export function useAdminIdentity(): AdminIdentity {
  const v = useContext(AdminIdentityContext);
  if (!v) throw new Error("useAdminIdentity must be used inside AdminShell");
  return v;
}

/** Cosmetic permission check for showing or hiding UI. */
export function useCan(permission: string): boolean {
  const v = useContext(AdminIdentityContext);
  return Boolean(v?.permissions.includes(permission));
}
