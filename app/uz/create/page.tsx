import { CreateGrid } from "@/components/home/CreateGrid";
import { catalogueGroupOf } from "@/components/home/catalogue-filter";

/** «Barchasi». `?group=<id>` opens one group's chip (the home «O'yinlar» cell); the key restarts the filter when it changes. */
export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const group = catalogueGroupOf((await searchParams).group);
  return <CreateGrid key={group} initialGroup={group} />;
}
