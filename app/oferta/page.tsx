import type { Metadata } from "next";
import { Fragment } from "react";
import { renderOferta, runsOf } from "@/lib/oferta/text";
import { ofertaConfig } from "@/lib/server/oferta";

export const metadata: Metadata = {
  title: "Ommaviy oferta",
  description: "SlaydX xizmatlaridan foydalanish bo'yicha ommaviy oferta",
};

export const dynamic = "force-dynamic";

/**
 * The public offer (D6): readable on a phone, no session needed. Content comes from the single text
 * module (`lib/oferta/text.ts`) with the Ijrochi requisites from the admin setting filled in -- the same
 * data the PDF (`/api/oferta/pdf`) and the bot use.
 */
export default async function OfertaPage() {
  const cfg = await ofertaConfig();
  const view = renderOferta(cfg.requisites, cfg.version);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <h1 className="text-[20px] leading-snug font-bold sm:text-2xl">{view.title}</h1>
      <p className="mt-2">
        <a href="/api/oferta/pdf" className="text-primary text-sm font-semibold underline underline-offset-2">
          PDF yuklab olish
        </a>
      </p>
      {view.sections.map((s) => (
        <section key={s.heading} className="mt-6">
          <h2 className="text-base font-bold sm:text-lg">{s.heading}</h2>
          <div className="mt-2 flex flex-col gap-2 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {s.clauses.map((c, i) => (
              <p key={`${c.no}${i}`}>
                {c.no ? <span className="text-muted-foreground mr-1.5 tabular-nums">{c.no}</span> : null}
                {runsOf(c.text).map((r, j) => (
                  <Fragment key={j}>{r.bold ? <strong>{r.text}</strong> : r.text}</Fragment>
                ))}
              </p>
            ))}
          </div>
        </section>
      ))}
      <p className="text-muted-foreground mt-8 text-sm">
        Tahrir: v{view.version} · {view.editionDate}
      </p>
    </main>
  );
}
