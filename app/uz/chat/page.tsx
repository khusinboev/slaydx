import type { Metadata } from "next";
import { ChatPage } from "@/components/chat/ChatPage";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata: Metadata = {
  title: "AI yordamchi — SlaydX",
  description: "SlaydX xizmatlari haqida so'rang yoki hujjat yaratishni buyuring: kuniga 10 ta xabar tekin",
};

export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="AI yordamchi" subtitle="Xizmatlar haqida so'rang yoki hujjat buyuring" back contentClassName="max-w-2xl" />
      <ChatPage />
    </div>
  );
}
