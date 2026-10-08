"use client";

import { ExternalLink, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtNumber } from "@/lib/admin-format";
import type { BonusChannel } from "@/lib/admin-api/bonus";
import { BotBadge } from "./BotBadge";
import { bonusText, channelUrl, type BotCheck } from "./format";

export type ChannelRowProps = {
  item: BonusChannel;
  bot: BotCheck;
  canEdit: boolean;
  /** The active switch is waiting for the server. */
  toggling: boolean;
  onToggle: (item: BonusChannel) => void;
  onEdit: (item: BonusChannel) => void;
  onDelete: (item: BonusChannel) => void;
  onRecheck: (id: string) => void;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:justify-start">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const countSum = (count: number, sum: number) => (count > 0 ? `${fmtNumber(count)} ta · ${fmtNumber(sum)}` : "0");

/** One channel: title and link, amounts, active switch, order, claim stats, bot status. */
export function ChannelRow({ item, bot, canEdit, toggling, onToggle, onEdit, onDelete, onRecheck }: ChannelRowProps) {
  const url = channelUrl(item.username);
  const s = item.stats;
  const hasClaims = s.joined > 0;
  return (
    <li data-channel={item.id} className="flex flex-col gap-3 border-t px-4 py-4 first:border-t-0 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-start lg:gap-5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs tabular-nums" title="Tartib">
            #{item.sort}
          </span>
          <span className={cn("min-w-0 text-[14px] font-semibold break-words", !item.active && "text-muted-foreground")}>{item.title}</span>
          {item.active ? null : <Badge>O&apos;chiq</Badge>}
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-info inline-flex w-fit items-center gap-1 text-[13px] underline-offset-2 hover:underline"
          >
            @{item.username}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-muted-foreground text-[13px]">Yopiq kanal · ID {item.chatId}</span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <BotBadge check={bot} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRecheck(item.id)}
            disabled={bot.status === "checking"}
            icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
            aria-label={`${item.title}: botni qayta tekshirish`}
          >
            Qayta tekshirish
          </Button>
        </div>
        {bot.status !== "checking" && bot.status !== "admin" && bot.warning ? (
          <p className="text-badge-warning-text text-xs font-medium">{bot.warning}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-[13px]">
        <span className="text-muted-foreground text-xs">Bonus (ball)</span>
        <span className="font-semibold tabular-nums" data-bonus>
          {bonusText(item)}
        </span>
        {item.stayBonus > 0 ? null : <span className="text-muted-foreground text-xs">qo&apos;shimcha yo&apos;q</span>}
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-1">
        <Stat label="Obuna bo'lgan" value={fmtNumber(s.joined)} />
        <Stat label="Obuna bonusi" value={countSum(s.joinPaidCount, s.joinPaidSum)} />
        <Stat label="Qolish bonusi" value={countSum(s.stayPaidCount, s.stayPaidSum)} />
        <Stat label="Kutilmoqda" value={fmtNumber(s.stayPending)} />
        <Stat label="Chiqib ketgan" value={fmtNumber(s.left)} />
      </dl>

      <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
        {canEdit ? (
          <>
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[13px]">
              <button
                type="button"
                role="switch"
                aria-checked={item.active}
                aria-label={`${item.title}: faol`}
                disabled={toggling}
                onClick={() => onToggle(item)}
                className={cn(
                  "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 disabled:opacity-60",
                  item.active ? "border-primary bg-primary" : "border-input bg-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", item.active ? "translate-x-5" : "translate-x-0")}
                />
              </button>
              <span aria-hidden="true">{item.active ? "Faol" : "O'chiq"}</span>
            </label>
            <div className="flex gap-2">
              <Button onClick={() => onEdit(item)} icon={<Pencil className="size-3.5" aria-hidden="true" />} aria-label={`${item.title}: tahrirlash`}>
                Tahrirlash
              </Button>
              <Button
                variant="dangerOutline"
                onClick={() => onDelete(item)}
                disabled={hasClaims}
                title={hasClaims ? "Bonus olganlar bor — o'chirib bo'lmaydi, faolsizlantiring" : undefined}
                icon={<Trash2 className="size-3.5" aria-hidden="true" />}
                aria-label={`${item.title}: o'chirish`}
              >
                O&apos;chirish
              </Button>
            </div>
          </>
        ) : (
          <Badge tone={item.active ? "success" : "neutral"} dot>
            {item.active ? "Faol" : "O'chiq"}
          </Badge>
        )}
      </div>
    </li>
  );
}
