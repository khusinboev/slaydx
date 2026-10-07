"use client";

import { useState } from "react";
import { ProfileHome } from "./ProfileHome";
import { ProfileStep } from "./ProfileStep";
import type { ProfileStepId, ProfileTarget } from "./profile-model";

/**
 * `/uz/profile` until the shell wires the step routes (`/uz/profile/<step>`):
 * the index, with the steps switched in place. Once the routes exist the
 * pages render `ProfileHome` / `ProfileStep` directly with a router-backed
 * `onNavigate`.
 */
export function ProfilePage({ initialStep }: { initialStep?: ProfileStepId } = {}) {
  const [at, setAt] = useState<ProfileTarget>(initialStep ?? "home");
  const go = (to: ProfileTarget) => {
    setAt(to);
    const main = typeof document === "undefined" ? null : document.getElementById("main");
    main?.scrollTo?.({ top: 0 });
  };
  return at === "home" ? <ProfileHome onNavigate={go} /> : <ProfileStep step={at} onNavigate={go} />;
}
