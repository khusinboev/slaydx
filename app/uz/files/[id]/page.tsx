import { ResultView } from "@/components/files/ResultView";

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultView id={id} />;
}
