import { AppShell } from "@/components/shell/AppShell";
import { ReferralCapture } from "@/components/referral/ReferralCapture";

export default function UzLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ReferralCapture />
      {children}
    </AppShell>
  );
}
