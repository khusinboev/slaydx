"use client";

import { useRouter } from "next/navigation";
import { backTo } from "@/lib/nav/history";
import type { ProfileStep as ProfileStepRoute } from "@/lib/nav/tabs";
import { ProfileStep } from "./ProfileStep";
import { profileHref, type ProfileTarget } from "./profile-model";

/**
 * `/uz/profile/<step>`: the W4 step screen (it carries its own «←» header,
 * hidden while Telegram's BackButton is shown) with real routes behind
 * `onNavigate`, so the phone / Telegram / trackpad back walks the same path:
 * the next step is pushed; «home» goes back to the profile index when that is
 * the previous entry, otherwise replaces this entry with it (`backTo`).
 */
export function ProfileStepPage({ step }: { step: ProfileStepRoute }) {
  const router = useRouter();
  const go = (to: ProfileTarget) => {
    if (to === "home") void backTo("/uz/profile");
    else router.push(profileHref(to));
  };
  return (
    <div className="slx-step-enter flex w-full flex-col" data-profile-step={step}>
      <ProfileStep step={step} onNavigate={go} />
    </div>
  );
}
