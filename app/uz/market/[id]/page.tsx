import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketItemPage } from "@/components/market/MarketItemPage";
import { metaLine } from "@/components/market/market-model";
import type { MarketItemView } from "@/lib/market/types";
import { getMarketItem, marketEnabled } from "@/lib/server/market/items";
import { isUuid } from "@/lib/server/market/store";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** The anonymous view: built without the document, so nothing of the body can reach this page (§3.1). One read per render: metadata and page share it. */
const publicItem = cache(async (id: string): Promise<{ enabled: boolean; item: MarketItemView | null }> => {
  const enabled = await marketEnabled().catch(() => false);
  if (!enabled) return { enabled, item: null };
  return { enabled, item: await getMarketItem(id, null).catch(() => null) };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const { item } = isUuid(id) ? await publicItem(id) : { item: null };
  if (!item) return { title: "Ishlar bozori", robots: { index: false, follow: false } };
  const description = `${metaLine(item)}. ${item.summary}`.slice(0, 200);
  return {
    title: item.title,
    description,
    alternates: { canonical: `/uz/market/${id}` },
    openGraph: { title: item.title, description, images: [{ url: item.cover }] },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { enabled, item } = await publicItem(id);
  // No public item is not the end: a buyer keeps reaching his retired work, and only the browser knows who he is (noindex above).
  return (
    <Suspense>
      <MarketItemPage id={id} enabled={enabled} initial={item} />
    </Suspense>
  );
}
