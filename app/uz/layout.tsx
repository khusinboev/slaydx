import { AppShell } from "@/components/shell/AppShell";

export default function UzLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
