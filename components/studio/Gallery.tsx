"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shuffle } from "lucide-react";
import { ApiImg, useApiSrc } from "@/lib/use-api-src";
import { PictureTools, type PictureTool } from "./StudioResults";
import { fetchGallery } from "./studio-api";
import type { GalleryItem } from "./studio-types";

type Status = "loading" | "ready" | "error";

/** `12.10.2026 14:05` — fixed format (no ICU, the same in every browser). Empty for an unreadable date. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A clip's card face (P3): the first frame of the result file itself (`preload="metadata"`, muted, no controls — the
 * card opens the result page), with its length.
 */
function VideoThumb({ src, seconds }: { src: string; seconds: number | null }) {
  const url = useApiSrc(src);
  return (
    <span className="relative block" data-gallery-video>
      <video src={url} muted playsInline preload="metadata" className="bg-muted aspect-square w-full object-cover" aria-hidden />
      <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[12px] font-semibold text-white">▶ {seconds ? `${Math.round(seconds)} s` : "video"}</span>
    </span>
  );
}

/**
 * «Galereya»: the user's finished Studio pictures and clips, newest first, 24 per page (`GET /api/media/gallery?cursor=`).
 * The next page loads when the end of the list scrolls into view (`IntersectionObserver`) and by the «Yana
 * ko'rsatish» button (also the only way where there is no observer, and the keyboard's way). A card opens the full
 * result page; «Boshqa modelda» hands its prompt back to the form with the model picker open.
 */
export function Gallery({ onOtherModel, onCreate, onTool }: { onOtherModel: (item: GalleryItem) => void; onCreate: () => void; onTool?: PictureTool }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One page request at a time: the observer and the button must not both fetch the same cursor.
  const busy = useRef(false);

  const load = useCallback(async (from: string | null) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    if (from === null) setStatus("loading");
    else setMore(true);
    try {
      const page = await fetchGallery(from);
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return from === null ? page.items : [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Galereya yuklanmadi");
      setStatus(from === null ? "error" : "ready");
    } finally {
      busy.current = false;
      setMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  // Infinite scroll: the sentinel under the list asks for the next page when it comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(cursor);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, load]);

  if (status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="status" aria-label="Galereya yuklanmoqda" data-gallery-loading>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-muted/60 aspect-square animate-pulse rounded-[18px]" />
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-destructive text-[14.5px]" data-gallery-error>
        {error}{" "}
        <button type="button" onClick={() => void load(null)} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div className="bg-card rounded-[20px] border p-6 text-center" data-gallery-empty>
        <p className="text-[15px] font-medium">Galereya hozircha bo‘sh</p>
        <p className="text-muted-foreground mt-1 text-[14px]">Yaratgan rasm va videolaringiz shu yerda saqlanadi.</p>
        <button type="button" onClick={onCreate} className="bg-primary text-primary-foreground mt-4 inline-flex h-11 items-center rounded-[14px] px-5 text-[14.5px] font-semibold">
          Rasm yaratish
        </button>
      </div>
    );
  }
  return (
    <div data-gallery>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-gallery-list>
        {items.map((it) => (
          <li key={it.id} data-gallery-item={it.id} className="bg-card flex min-w-0 flex-col overflow-hidden rounded-[18px] border">
            <Link href={`/uz/files/${it.id}`} aria-label={it.prompt || (it.video ? "Videoni ochish" : "Rasmni ochish")} className="focus-visible:ring-ring relative block outline-none focus-visible:ring-2">
              {it.video ? (
                <VideoThumb src={it.video.src} seconds={it.video.seconds} />
              ) : it.thumbs[0] ? (
                <ApiImg src={it.thumbs[0]} alt={it.prompt} loading="lazy" className="bg-muted aspect-square w-full object-cover" />
              ) : (
                <div aria-hidden className="bg-muted aspect-square w-full" data-gallery-no-thumb />
              )}
              {it.count > 1 ? (
                <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[12px] font-semibold text-white" data-gallery-count>
                  ×{it.count}
                </span>
              ) : null}
            </Link>
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              <p className="line-clamp-2 text-[13.5px] leading-snug break-words">{it.prompt}</p>
              <p className="text-muted-foreground text-[12px]">{[it.modelLabel, formatStamp(it.createdAt)].filter(Boolean).join(" · ")}</p>
              <button
                type="button"
                data-gallery-other-model
                onClick={() => onOtherModel(it)}
                className="focus-visible:ring-ring hover:bg-muted pointer-coarse:min-h-11 mt-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-semibold outline-none focus-visible:ring-2"
              >
                <Shuffle className="size-3.5" aria-hidden />
                {it.video ? "Yana yaratish" : "Boshqa modelda"}
              </button>
              {/* P2b: the tools work on the card's first picture (the result page shows every picture); never on a video. */}
              {onTool && !it.video && it.thumbs[0] ? <PictureTools url={it.thumbs[0]} onTool={onTool} index={0} many={false} inline /> : null}
            </div>
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden className="h-px" />
      {error ? (
        <p role="alert" className="text-destructive mt-3 text-center text-[14px]" data-gallery-error>
          {error}
        </p>
      ) : null}
      {cursor ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            data-gallery-more
            disabled={more}
            onClick={() => void load(cursor)}
            className="bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-11 items-center rounded-[14px] border px-5 text-[14.5px] font-semibold disabled:opacity-60"
          >
            {more ? "Yuklanmoqda..." : "Yana ko‘rsatish"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
