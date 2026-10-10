"use client";

import { useEffect, type ReactNode } from "react";
import { Briefcase, Gift, GraduationCap, LifeBuoy, Lock, Moon, ShieldCheck, Sun, SunMoon, UserRound, Wallet } from "lucide-react";
import * as api from "@/lib/api-client";
import { creditTotal, useAppStore } from "@/lib/store";
import { Avatar, Group, ProfileSkeleton, RowExternal, RowLink, SectionLabel, SignedOutCard } from "./parts";
import { identityLine, profileHref, rowHint, type ProfileStepId, type ProfileTarget } from "./profile-model";
import { themeChoiceLabel, useThemeChoice } from "./theme";
import { groupDigits } from "@/lib/format";
import { SUPPORT_URL } from "@/lib/support";
import { onSupportClick } from "@/lib/support-link";

export type ProfileHomeProps = {
  /**
   * Opens a step (or the index). The route wiring pushes `/uz/profile/<step>`;
   * without it the rows are plain links to the same URLs.
   */
  onNavigate?: (to: ProfileTarget) => void;
  /** Replaces the default «Profil» title; `null` = no title (the route renders the shell's `PageHeader`). */
  header?: ReactNode;
};

const WALLET = "/uz/wallet";

/**
 * Profil tab index (redesign W4): avatar, name, @username / phone, then
 * «Sozlamalar» (the 4 steps, each with a value hint) and «Hisob» (Hamyon,
 * invite friends → Hamyon, Admin panel for admins, Yordam → the support group, Xavfsizlik va chiqish).
 * The ledger, top-up and referral card live in Hamyon now.
 */
export function ProfileHome({ onNavigate, header }: ProfileHomeProps) {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [themeChoice] = useThemeChoice();

  // Fresh writer fields (edited on another device) — the session copy may be old.
  useEffect(() => {
    if (!loggedIn) return;
    void api
      .fetchMe()
      .then((r) => setUser(r.user))
      .catch(() => {});
  }, [loggedIn, setUser]);

  // `undefined` → the default title; `null` → none. (A `<></>` from a server page arrives as `null`.)
  const title = header !== undefined ? header : <h1 className="pt-1.5 pb-3 text-[24px] font-semibold tracking-[-0.02em]">Profil</h1>;

  let body: ReactNode;
  if (!sessionChecked) body = <ProfileSkeleton />;
  else if (!loggedIn || !user) body = <SignedOutCard returnTo="/uz/profile" />;
  else {
    const step = (id: ProfileStepId) => ({
      id,
      href: profileHref(id),
      hint: rowHint(id, user, themeChoiceLabel(themeChoice)),
      onClick: onNavigate
        ? (e: React.MouseEvent) => {
            e.preventDefault();
            onNavigate(id);
          }
        : undefined,
    });
    const ThemeIcon = themeChoice === "auto" ? SunMoon : themeChoice === "dark" ? Moon : Sun;
    const identity = identityLine(user);
    body = (
      <>
        <div className="flex items-center gap-3.5 py-1.5">
          <Avatar name={user.name} photoUrl={user.photoUrl} />
          <div className="min-w-0">
            <p data-profile-name className="truncate text-[20px] leading-tight font-semibold">
              {user.name || "Foydalanuvchi"}
            </p>
            {identity ? (
              <p data-profile-identity className="text-muted-foreground mt-1 truncate text-[14px]">
                {identity}
              </p>
            ) : null}
          </div>
        </div>

        <SectionLabel>Sozlamalar</SectionLabel>
        <Group label="Sozlamalar">
          <RowLink {...step("shaxsiy")} icon={UserRound} label="Shaxsiy ma'lumotlar" />
          <RowLink {...step("oqish")} icon={GraduationCap} label="O'qish joyi" />
          <RowLink {...step("ish")} icon={Briefcase} label="Ish joyi" />
          <RowLink {...step("korinish")} icon={ThemeIcon} label="Ko'rinish" />
        </Group>

        <SectionLabel>Hisob</SectionLabel>
        <Group label="Hisob">
          <RowLink id="hamyon" href={WALLET} icon={Wallet} label="Hamyon" hint={`${groupDigits(creditTotal(user))} tanga`} />
          <RowLink id="taklif" href={WALLET} icon={Gift} label="Do'stlarni taklif qilish" hint="Bonus ball" />
          {user.isAdmin ? <RowLink id="admin" href="/admin" icon={ShieldCheck} label="Admin panel" /> : null}
          <RowExternal id="yordam" href={SUPPORT_URL} icon={LifeBuoy} label="Yordam" hint="Admin bilan bog'lanish" onClick={onSupportClick} />
          <RowLink {...step("xavfsizlik")} icon={Lock} label="Xavfsizlik va chiqish" />
        </Group>
      </>
    );
  }

  return (
    <div data-profile-home className="mx-auto w-full max-w-xl px-4 pt-3 pb-10">
      {title}
      {body}
    </div>
  );
}
