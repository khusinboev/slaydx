"use client";

import { Suspense, useCallback, useState } from "react";
import { getMarketItemDoc, marketPreviewUrl, type MarketItemDetail } from "@/lib/admin-api/market";
import { Button, ErrorState, Forbidden, Skeleton, useLoad } from "@/components/admin/ui";
import { retryableLazy, ViewerBoundary, ViewerLoading } from "@/components/viewers/ViewerBoundary";

const SlideViewer = retryableLazy(() => import("@/components/viewers/SlideViewer").then((m) => ({ default: m.SlideViewer })));
const WordViewer = retryableLazy(() => import("@/components/viewers/WordViewer").then((m) => ({ default: m.WordViewer })));

/** The sanitised document through the real viewers: the admin reads what a buyer's copy will say. */
function FullDocument({ id, deck }: { id: string; deck: boolean }) {
  const load = useCallback((signal: AbortSignal) => getMarketItemDoc(id, { signal }), [id]);
  const [state, retry] = useLoad(load);
  if (state.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (state.status === "forbidden") return <Forbidden />;
  if (state.status === "error") return <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />;
  const { doc } = state.data;
  return (
    <div className={deck ? "bg-muted h-[60dvh] min-h-[320px] overflow-hidden rounded-lg" : "bg-muted max-h-[70dvh] overflow-auto rounded-lg"} data-market-doc>
      <ViewerBoundary attempt={0} onRetry={retry}>
        <Suspense fallback={<ViewerLoading onRetry={retry} />}>{deck ? <SlideViewer doc={doc} /> : <WordViewer doc={doc} />}</Suspense>
      </ViewerBoundary>
    </div>
  );
}

/** The watermarked rasters a visitor gets; for a candidate too (`admin: true` on the server). */
function Rasters({ item }: { item: MarketItemDetail }) {
  const pages = Array.from({ length: item.previewPages }, (_, i) => i + 1);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-market-rasters>
      {pages.map((p) => (
        // Admin-only raster behind a session cookie: `next/image` would proxy it through the optimiser without the cookie.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={p}
          src={marketPreviewUrl(item.id, p, item.previewVersion)}
          alt={`${p}-sahifa`}
          loading="lazy"
          className="bg-muted aspect-[3/4] w-full rounded-md border object-cover object-top"
        />
      ))}
    </div>
  );
}

/**
 * The left column of the review drawer. `market.manage` opens the sanitised document straight away (a review needs the
 * full text, §9); a view-only role gets the same rasters as the shop window.
 */
export function ItemPreview({ item, canManage }: { item: MarketItemDetail; canManage: boolean }) {
  const [mode, setMode] = useState<"doc" | "rasters">(canManage ? "doc" : "rasters");
  const deck = item.toolId === "slide" || item.toolId === "pro-slide";
  if (!item.hasDoc) return <p className="text-muted-foreground text-[13px]">Bu ishda ko&apos;rsatiladigan hujjat yo&apos;q.</p>;
  if (!canManage && item.status !== "active" && item.status !== "sold_out") {
    return <p data-market-no-rasters className="text-muted-foreground text-[13px]">Sotuvda bo&apos;lmagan ishning namunasi faqat bozorni boshqaruvchilarga ochiq.</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Tozalangan nusxa</h3>
        {canManage ? (
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "doc" ? "rasters" : "doc")}>
            {mode === "doc" ? "Namuna rasmlari" : "To'liq hujjat"}
          </Button>
        ) : null}
      </div>
      {mode === "doc" ? <FullDocument key={`${item.id}:${item.previewVersion}`} id={item.id} deck={deck} /> : <Rasters item={item} />}
    </div>
  );
}
