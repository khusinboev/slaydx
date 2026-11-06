"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clapperboard, FileText, Mic, Music, Shuffle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiImg, useApiSrc } from "@/lib/use-api-src";
import { languageLabel } from "@/lib/media/catalog-transcribe";
import { FavoriteButton } from "./Favorite";
import { AGAIN_LABEL } from "./JobResult";
import { PictureTools, type PictureTool } from "./StudioResults";
import { fetchGallery } from "./studio-api";
import { GALLERY_KINDS, type GalleryItem, type GalleryKind } from "./studio-types";

type Status = "loading" | "ready" | "error";
/** P7b: the whole gallery or only the starred items («Sevimlilar»); P11 §D: one kind (Rasm / Video / Audio / Matn). */
type Filter = "all" | "favorites" | GalleryKind;
const isKind = (f: Filter): f is GalleryKind => (GALLERY_KINDS as readonly string[]).includes(f);
/** The chips, in order: everything, each kind, the stars. */
export const GALLERY_FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "Hammasi" },
  { value: "image", label: "Rasm" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Matn" },
  { value: "favorites", label: "Sevimlilar" },
];

/** P7b «Keyingi qadam» from a gallery card (absent = no button). */
export type GalleryNext = {
  /** «Videoga aylantirish»: the card's first picture (its stored result URL) and prompt → the Video tab. */
  onVideo?: (url: string, prompt: string) => void;
  /** «Ovoz qo'shish»: the prompt → the «Ovoz» tab. */
  onVoice?: (text: string) => void;
  /** «Musiqa yaratish» on a clip: its prompt → the «Audio» tab. */
  onMusic?: (prompt: string) => void;
};

const NEXT_BTN =
  "focus-visible:ring-ring hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border px-2 text-[13px] font-semibold outline-none focus-visible:ring-2";

/**
 * A card's «Keyingi qadam» (P7b): a disclosure button that shows the chain actions of the item inside the card — a picture:
 * «Videoga aylantirish», «Ovoz qo'shish»; a clip made from a prompt: «Musiqa yaratish», «Ovoz qo'shish». Nothing for an
 * audio item or an effect clip (no prompt of their own to hand over).
 */
function NextStep({ item, onVideo, onVoice, onMusic }: { item: GalleryItem } & GalleryNext) {
  const [open, setOpen] = useState(false);
  const prompt = item.video?.effect || item.video?.derived || item.text ? "" : item.prompt.trim();
  const picture = !item.video && !item.audio && !item.text ? (item.thumbs[0] ?? null) : null;
  const actions: { key: string; label: string; Icon: typeof Mic; run: () => void }[] = [];
  if (picture && onVideo) actions.push({ key: "to-video", label: "Videoga aylantirish", Icon: Clapperboard, run: () => onVideo(picture, prompt) });
  if (item.video && prompt && onMusic) actions.push({ key: "to-music", label: "Musiqa yaratish", Icon: Music, run: () => onMusic(prompt) });
  if (!item.audio && prompt && onVoice) actions.push({ key: "to-voice", label: "Ovoz qo‘shish", Icon: Mic, run: () => onVoice(prompt) });
  if (actions.length === 0) return null;
  return (
    <div data-gallery-next>
      <button type="button" data-gallery-next-toggle aria-expanded={open} onClick={() => setOpen((v) => !v)} className={NEXT_BTN}>
        Keyingi qadam
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1" role="group" aria-label="Keyingi qadam">
          {actions.map(({ key, label, Icon, run }) => (
            <button key={key} type="button" data-gallery-action={key} onClick={run} className={NEXT_BTN}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

/** A speech result's card face (P5): the length and voices on a tile; the player sits in the card body. */
function AudioThumb({ seconds, voices }: { seconds: number | null; voices: string[] }) {
  return (
    <span className="bg-accent-soft text-accent-soft-foreground flex aspect-square w-full flex-col items-center justify-center gap-1.5 p-3 text-center" data-gallery-audio>
      <Mic className="size-8" aria-hidden />
      <span className="text-[13px] font-semibold">{seconds ? `${Math.round(seconds)} s` : "audio"}</span>
      {voices.length ? <span className="line-clamp-1 text-[12px]">{voices.join(" · ")}</span> : null}
    </span>
  );
}

/** A transcript's card face (P11 §D): the text's head on a tile; the result page has the whole text and the subtitles. */
function TextThumb({ excerpt, language }: { excerpt: string; language: string | null }) {
  return (
    <span className="bg-muted flex aspect-square w-full flex-col gap-1.5 p-3 text-left" data-gallery-text>
      <span className="text-muted-foreground flex items-center gap-1 text-[12px] font-semibold">
        <FileText className="size-3.5" aria-hidden />
        Matn{language ? ` · ${languageLabel(language)}` : ""}
      </span>
      <span className="line-clamp-6 text-[13px] leading-snug break-words">{excerpt || "Nutq topilmadi."}</span>
    </span>
  );
}

/** The card's player: the job's own MP3, nothing loaded until play (`preload="none"`). */
function AudioPlayer({ src }: { src: string }) {
  const url = useApiSrc(src);
  return (
    <audio controls preload="none" src={url} className="w-full" data-gallery-audio-player>
      Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
    </audio>
  );
}

/**
 * «Galereya»: the user's finished Studio pictures and clips, newest first, 24 per page (`GET /api/media/gallery?cursor=`).
 * The next page loads when the end of the list scrolls into view (`IntersectionObserver`) and by the «Yana
 * ko'rsatish» button (also the only way where there is no observer, and the keyboard's way). A card opens the full
 * result page; «Boshqa modelda» hands its prompt back to the form with the model picker open.
 */
export function Gallery({
  onOtherModel,
  onCreate,
  onTool,
  onVideo,
  onVoice,
  onMusic,
}: { onOtherModel: (item: GalleryItem) => void; onCreate: () => void; onTool?: PictureTool } & GalleryNext) {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One page request at a time: the observer and the button must not both fetch the same cursor.
  const busy = useRef(false);
  // A page of the previous filter that answers after a switch is dropped (the generation counter).
  const epoch = useRef(0);

  const load = useCallback(async (from: string | null) => {
    if (busy.current) return;
    busy.current = true;
    const mine = epoch.current;
    setError(null);
    if (from === null) setStatus("loading");
    else setMore(true);
    try {
      const page = await fetchGallery(from, { favorites: filter === "favorites", kind: isKind(filter) ? filter : null });
      if (mine !== epoch.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return from === null ? page.items : [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
      setStatus("ready");
    } catch (e) {
      if (mine !== epoch.current) return;
      setError(e instanceof Error ? e.message : "Galereya yuklanmadi");
      setStatus(from === null ? "error" : "ready");
    } finally {
      if (mine === epoch.current) {
        busy.current = false;
        setMore(false);
      }
    }
  }, [filter]);

  /** «Hammasi» / «Sevimlilar»: the list starts again from the first page of that filter. */
  function pickFilter(next: Filter) {
    if (next === filter) return;
    epoch.current += 1;
    busy.current = false;
    setCursor(null);
    setItems([]);
    setStatus("loading");
    setFilter(next);
  }

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

  const chips = (
    <div role="radiogroup" aria-label="Galereya filtri" className="mb-3 flex flex-wrap gap-2" data-gallery-filter>
      {GALLERY_FILTERS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={filter === value}
          data-gallery-filter-chip={value}
          onClick={() => pickFilter(value)}
          className={cn(
            "focus-visible:ring-ring min-h-11 rounded-full border px-4 text-[14px] font-semibold outline-none focus-visible:ring-2",
            filter === value ? "bg-primary text-primary-foreground border-transparent" : "bg-card hover:bg-muted",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (status === "loading") {
    return (
      <>
        {chips}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="status" aria-label="Galereya yuklanmoqda" data-gallery-loading>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-muted/60 aspect-square animate-pulse rounded-[18px]" />
          ))}
        </div>
      </>
    );
  }
  if (status === "error") {
    return (
      <>
        {chips}
        <p role="alert" className="text-destructive text-[14.5px]" data-gallery-error>
          {error}{" "}
          <button type="button" onClick={() => void load(null)} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
            Qayta urinish
          </button>
        </p>
      </>
    );
  }
  if (items.length === 0) {
    return filter === "favorites" ? (
      <>
        {chips}
        <div className="bg-card rounded-[20px] border p-6 text-center" data-gallery-empty="favorites">
          <p className="text-[15px] font-medium">Sevimlilar hozircha yo‘q</p>
          <p className="text-muted-foreground mt-1 text-[14px]">Natija yoki galereya kartasidagi yulduzchani bosing — u shu yerda saqlanadi.</p>
        </div>
      </>
    ) : isKind(filter) ? (
      <>
        {chips}
        <div className="bg-card rounded-[20px] border p-6 text-center" data-gallery-empty={filter}>
          <p className="text-[15px] font-medium">Bu turda hozircha natija yo‘q</p>
          <p className="text-muted-foreground mt-1 text-[14px]">{GALLERY_FILTERS.find((f) => f.value === filter)?.label} natijalaringiz shu yerda saqlanadi.</p>
        </div>
      </>
    ) : (
      <>
        {chips}
        <div className="bg-card rounded-[20px] border p-6 text-center" data-gallery-empty>
          <p className="text-[15px] font-medium">Galereya hozircha bo‘sh</p>
          <p className="text-muted-foreground mt-1 text-[14px]">Yaratgan rasm, video va audiolaringiz shu yerda saqlanadi.</p>
          <button type="button" onClick={onCreate} className="bg-primary text-primary-foreground mt-4 inline-flex h-11 items-center rounded-[14px] px-5 text-[14.5px] font-semibold">
            Rasm yaratish
          </button>
        </div>
      </>
    );
  }
  return (
    <div data-gallery>
      {chips}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-gallery-list>
        {items.map((it) => (
          <li key={it.id} data-gallery-item={it.id} className="bg-card flex min-w-0 flex-col overflow-hidden rounded-[18px] border">
            <Link href={`/uz/files/${it.id}`} aria-label={it.prompt || (it.text ? "Matnni ochish" : it.audio ? "Audioni ochish" : it.video ? "Videoni ochish" : "Rasmni ochish")} className="focus-visible:ring-ring relative block outline-none focus-visible:ring-2">
              {it.text ? (
                <TextThumb excerpt={it.text.excerpt} language={it.text.language} />
              ) : it.audio ? (
                <AudioThumb seconds={it.audio.seconds} voices={it.audio.voices} />
              ) : it.video ? (
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
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13.5px] leading-snug break-words">{it.prompt}</p>
                  <p className="text-muted-foreground text-[12px]">{[it.modelLabel, formatStamp(it.createdAt)].filter(Boolean).join(" · ")}</p>
                </div>
                <FavoriteButton id={it.id} initial={it.favorite} onError={setError} className="-mt-1 -mr-1" />
              </div>
              {it.audio ? <AudioPlayer src={it.audio.src} /> : null}
              {/* An audio, a text or a derived clip's card has no «again» action: the gallery does not carry the source (the result page has it). */}
              {it.audio || it.text || it.video?.derived ? null : (
              <button
                type="button"
                data-gallery-other-model
                onClick={() => onOtherModel(it)}
                className="focus-visible:ring-ring hover:bg-muted pointer-coarse:min-h-11 mt-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-semibold outline-none focus-visible:ring-2"
              >
                <Shuffle className="size-3.5" aria-hidden />
                {it.video ? AGAIN_LABEL : "Boshqa modelda"}
              </button>
              )}
              {/* P2b: the tools work on the card's first picture (the result page shows every picture); never on a video. */}
              {onTool && !it.video && !it.audio && it.thumbs[0] ? <PictureTools url={it.thumbs[0]} onTool={onTool} index={0} many={false} inline /> : null}
              <NextStep item={it} onVideo={onVideo} onVoice={onVoice} onMusic={onMusic} />
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
