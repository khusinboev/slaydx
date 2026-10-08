"use client";

import { Badge, type Tone } from "@/components/admin/ui";
import { BOT_STATUS_TEXT, type BotCheck } from "./format";

const TONE: Record<BotCheck["status"], Tone> = {
  checking: "neutral",
  admin: "success",
  not_admin: "danger",
  unknown: "warning",
};

/** The bot's admin status in a channel; the warning (why it matters) is the tooltip. */
export function BotBadge({ check }: { check: BotCheck }) {
  const title = check.status === "checking" ? undefined : (check.warning ?? undefined);
  return (
    <Badge tone={TONE[check.status]} dot title={title}>
      {BOT_STATUS_TEXT[check.status]}
    </Badge>
  );
}
