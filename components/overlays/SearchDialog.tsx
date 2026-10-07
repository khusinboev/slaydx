"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search, Wallet } from "lucide-react";
import { TOOLS, TOOL_BY_ID } from "@/lib/tools";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { TOOL_ICONS } from "../shell/icons";
import { OverlayClose, OverlayFrame, OverlayScrim } from "./OverlayFrame";
import { PAY_RETURN_PATH } from "./pay-amount";
import { useDialog } from "./useDialog";

const sectionLabel = "text-muted-foreground px-2 pt-2 pb-1.5 text-[13px] font-semibold tracking-[0.06em] uppercase";

/**
 * Qidiruv (Cmd/Ctrl+K, Bosh / Ishlarim sarlavhasi): vositalar, «Balansni
 * to'ldirish» (Hamyon) va yuklangan fayllar.
 *
 * Redesign W5 (variant A): har qator — rangli vosita belgisi (`tc`) + nom +
 * qisqa tavsif, telefonda ≥ 56 px; karta 22–24 px burchakli, fon xiralashib
 * ochiladi. Telefonda yuqorida turadi (klaviatura pastda), kompyuterda 12vh.
 */
export function SearchDialog() {
  const open = useUi((s) => s.overlay === "search");
  const close = useUi((s) => s.close);
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  // Serverda yana sahifa bor — qidiruv hamma fayllarni ko'rmaydi.
  const moreOnServer = useAppStore((s) => s.generationsCursor !== null);
  const openLogin = useUi((s) => s.open);
  const [q, setQ] = useState("");
  const panelRef = useDialog(open, close);
  /** Telefon (docs/mobile/PLAN.md O5): qatorlar ≥ 56 px, kiritish 16 px, ichki aylantirish. */
  const phone = useCoarsePointer();

  const tools = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return TOOLS;
    return TOOLS.filter(
      (t) => t.title.toLowerCase().includes(s) || t.description.toLowerCase().includes(s),
    );
  }, [q]);

  const files = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return generations.slice(0, 6);
    return generations.filter((g) => g.topic.toLowerCase().includes(s)).slice(0, 8);
  }, [q, generations]);

  if (!open) return null;

  const row = cn(
    "hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-[16px] px-2 text-left outline-none transition-colors focus-visible:ring-2",
    phone ? "min-h-14 py-1.5" : "min-h-12 py-1.5",
  );

  return (
    <OverlayFrame
      label="Qidiruv"
      phone={phone}
      className={cn("flex items-start justify-center", !phone && "px-4 pt-[12vh]")}
      topGap="0.5rem"
    >
      <OverlayScrim onClose={close} />
      <div
        ref={panelRef}
        data-overlay-panel={phone ? "card" : "dialog"}
        className={cn(
          "bg-card text-card-foreground relative z-10 w-full max-w-xl overflow-hidden border shadow-2xl motion-safe:animate-[slx-enter-fade_180ms_ease-out_backwards]",
          phone ? "flex max-h-full flex-col rounded-[22px]" : "rounded-[24px]",
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <Search className="text-muted-foreground size-5 shrink-0" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidirish..."
            aria-label="Vosita yoki fayl qidirish"
            enterKeyHint="search"
            className={cn("min-w-0 flex-1 bg-transparent outline-none", phone ? "h-14 text-base" : "h-14 text-[16px]")}
          />
          <OverlayClose onClose={close} phone={phone} />
        </div>
        <div className={cn("overflow-y-auto p-2", phone ? "min-h-0 flex-1 overscroll-contain" : "max-h-[60vh]")}>
          <p className={sectionLabel}>Xizmatlar</p>
          {tools.map((t) => {
            const Icon = TOOL_ICONS[t.icon];
            return (
              <button
                key={t.id}
                type="button"
                data-search-tool={t.id}
                className={row}
                onClick={() => {
                  close();
                  router.push(`/uz/${t.slug}`);
                  if (!loggedIn) openLogin("login", { returnTo: `/uz/${t.slug}` });
                }}
              >
                <IconChip tc={t.tc}>{Icon ? <Icon className="size-5 text-[rgb(var(--tc))]" aria-hidden /> : null}</IconChip>
                <RowText title={t.title} detail={t.description} />
              </button>
            );
          })}
          {/* `tools` is empty only when the query matches nothing: say so instead of an empty heading. */}
          {tools.length === 0 ? <p className="text-muted-foreground px-2 py-3 text-[14.5px]">Bunday vosita topilmadi</p> : null}
          <button
            type="button"
            data-search-wallet
            className={cn(row, "mt-1")}
            onClick={() => {
              close();
              router.push(PAY_RETURN_PATH);
            }}
          >
            <IconChip>
              <Wallet className="text-accent-soft-foreground size-5" aria-hidden />
            </IconChip>
            <RowText title="Balansni to'ldirish" detail="Hamyon — balans va to'lovlar" />
          </button>
          {loggedIn ? (
            <>
              <p className={cn(sectionLabel, "mt-2")}>Fayllar</p>
              {/*
               * W2-E/FE-08: qidiruv faqat yuklangan birinchi sahifa (50 ta)
               * ichida — server qidiruvi yo'q. Eskilari bor bo'lsa halol aytiladi,
               * aks holda «topilmadi» = «hujjat o'chib ketgan» deb o'qilardi.
               */}
              {moreOnServer ? (
                <p className="text-muted-foreground px-2 pb-1 text-[13px] leading-snug" data-search-partial>
                  Qidiruv faqat yuklanganlar orasida (oxirgi {generations.length} ta). Eskiroq fayllarni «Ishlarim»
                  dagi «Yana ko‘rsatish» orqali oching.
                </p>
              ) : null}
              {files.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-[14.5px]">
                  {q.trim() ? "Yuklangan fayllar orasida topilmadi" : "Yaratgan fayllaringiz ichidan qidiring"}
                </p>
              ) : (
                files.map((g) => {
                  const tool = TOOL_BY_ID[g.type as keyof typeof TOOL_BY_ID];
                  const Icon = tool ? TOOL_ICONS[tool.icon] : undefined;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      data-search-file={g.id}
                      className={row}
                      onClick={() => {
                        close();
                        router.push(`/uz/files/${g.id}`);
                      }}
                    >
                      <IconChip tc={tool?.tc}>
                        {Icon ? (
                          <Icon className="size-5 text-[rgb(var(--tc))]" aria-hidden />
                        ) : (
                          <FileText className="text-muted-foreground size-5" aria-hidden />
                        )}
                      </IconChip>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[15.5px] leading-snug font-medium", phone ? "line-clamp-2" : "truncate")}>{g.topic}</span>
                        {tool ? <span className="text-muted-foreground block truncate text-[13px] leading-snug">{tool.title}</span> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </>
          ) : null}
        </div>
      </div>
    </OverlayFrame>
  );
}

/** 40 px rounded icon square, tinted with the tool colour (`tc` = "r g b"), amber soft otherwise. */
function IconChip({ tc, children }: { tc?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-[12px]", tc ? "bg-[rgb(var(--tc)/0.14)]" : "bg-accent-soft")}
      style={tc ? { ["--tc" as string]: tc } : undefined}
    >
      {children}
    </span>
  );
}

function RowText({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15.5px] leading-snug font-medium">{title}</span>
      <span className="text-muted-foreground block truncate text-[13px] leading-snug">{detail}</span>
    </span>
  );
}
