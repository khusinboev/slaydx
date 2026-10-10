"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { fmtNumber } from "@/lib/admin-format";
import { markupText, pctText } from "./shared";

function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group bg-card rounded-xl border">
      <summary className="hover:bg-muted/40 focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        {summary}
      </summary>
      <div className="border-t px-4 py-3 text-[13px]">{children}</div>
    </details>
  );
}

/**
 * The page's fine print, collapsed: a one-line glossary of every figure and the computed
 * data limitations (`caveats`). Nothing here is needed to make a decision; it is there to
 * check one.
 */
export function MethodNotes({
  caveats,
  targetMarkup,
  paymentFeePercent,
  soumPerCoin,
}: {
  caveats: ReadonlyArray<string>;
  targetMarkup: number;
  paymentFeePercent: number;
  soumPerCoin: number;
}) {
  const terms: Array<[string, ReactNode]> = [
    ["Narx", `Amaldagi narx = asosiy (kod formulasi) × tuzatish %, yaxlitlangan. Tangada; 1 tanga = ${fmtNumber(soumPerCoin)} so'm.`],
    ["Tannarx", "Tayyor ishning o'rtacha AI xarajati + xato va tashlab ketilgan ishlar xarajatining ulushi."],
    ["Marja", `(Narx − tannarx − to'lov komissiyasi ${pctText(paymentFeePercent)}) ÷ narx. Ball bilan to'langan ishlar ham kiradi; komissiya faqat naqd qismdan.`],
    ["Naqd marja", "Faqat naqd pul tushumi bo'yicha: ball tushum hisoblanmaydi."],
    ["Ustama", `Narx (komissiyadan keyin) ÷ tannarx. Maqsad: ${markupText(targetMarkup)}.`],
    ["Tavsiya", "Ustamani maqsadga yetkazadigan narx o'zgarishi (5% qadam). 20 tadan kam tayyor ish — «kam ishonch»; narx davr ichida o'zgargan bo'lsa, bir bosishda qo'llanmaydi."],
    ["Bonus xarajati", "Ball bilan to'langan ishlarning AI xarajati."],
    ["Adminlar", "Adminlarning sinov ishlari standart bo'yicha hisobga olinmaydi; «Adminlar bilan» qo'shadi."],
  ];
  return (
    <div className="flex flex-col gap-2">
      <Disclosure summary="Hisob qanday ishlaydi">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">
          {terms.map(([term, text]) => (
            <div key={term} className="contents">
              <dt className="font-semibold">{term}</dt>
              <dd className="text-muted-foreground mb-1 sm:mb-0">{text}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
      {caveats.length > 0 ? (
        <Disclosure summary={`Ma'lumot cheklovlari (${fmtNumber(caveats.length)})`}>
          <ul className="text-muted-foreground ml-4 list-disc space-y-1.5 text-xs">
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
