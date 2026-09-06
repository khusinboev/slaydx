"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { docLabels } from "@/lib/generation/i18n";
import { ESSAY_DESIGNS } from "@/lib/languages";
import type { AcademicDoc } from "@/lib/generation/types";
import { docToFlow, titleModel, tocRows, type FlowItem, type TocRow } from "@/lib/viewers/flow";
import type { ViewerKind } from "@/lib/viewers/kind";
import { A4, contentHeightPx } from "@/lib/viewers/metrics";
import { packPages } from "@/lib/viewers/paginate";
import { ZoomFrame, Workspace } from "./sheet";
import { TitlePage } from "./TitlePage";
import { ViewerToolbar } from "./toolbar";

export function WordViewer({
  doc,
  variant,
}: {
  doc: AcademicDoc;
  variant: Extract<ViewerKind, "academic" | "essay" | "article" | "translation">;
}) {
  const items = useMemo(() => docToFlow(doc), [doc]);
  const title = useMemo(() => titleModel(doc), [doc]);
  const toc = useMemo(() => tocRows(doc), [doc]);
  const labels = useMemo(() => docLabels(doc.meta.language), [doc.meta.language]);
  /**
   * Sahifa ramkasi ko'ruvchida ham FAQAT inshoda — `render-docx.ts`
   * dagi shart bilan bir xil. Aks holda ekranda ramka ko'rinib,
   * yuklab olingan faylda bo'lmasdi.
   */
  const frame = useMemo(() => {
    if (doc.meta.toolId !== "essay") return null;
    return ESSAY_DESIGNS.find((d) => d.value === doc.meta.design)?.from ?? null;
  }, [doc.meta.toolId, doc.meta.design]);
  const [zoom, setZoom] = useState(100);
  const [pages, setPages] = useState<FlowItem[][] | null>(null);
  const [page, setPage] = useState(1);
  const measureRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  const fit = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const w = el.clientWidth - 32;
    const next = Math.max(50, Math.min(150, Math.round((w / A4.wPx) * 100)));
    const snap = [50, 75, 90, 100, 125, 150].reduce((a, b) => (Math.abs(b - next) < Math.abs(a - next) ? b : a));
    setZoom(snap);
  }, []);

  useEffect(() => {
    fit();
    const on = () => fit();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [fit]);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const kids = Array.from(root.children) as HTMLElement[];
    const hs = kids.map((el) => el.getBoundingClientRect().height);
    setPages(packPages(items, hs, contentHeightPx({ footer: true })));
  }, [items]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pages) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const idx = vis ? Number((vis.target as HTMLElement).dataset.page) : NaN;
        if (Number.isFinite(idx)) setPage(idx);
      },
      { root, threshold: [0.4, 0.6] },
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [pages, zoom]);

  function go(n: number) {
    const next = Math.max(1, Math.min(pages?.length ?? 1, n));
    setPage(next);
    pageRefs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const ribbon =
    variant === "translation" ? (
      <div className="mb-3 rounded-sm bg-emerald-700 px-2 py-1 text-center text-[11pt] font-bold text-white" style={{ textIndent: 0 }}>
        TARJIMA
      </div>
    ) : variant === "essay" ? (
      <div className="text-muted-foreground mb-2 text-center text-[11pt] italic" style={{ textIndent: 0 }}>
        Badiiy-ilmiy insho
      </div>
    ) : variant === "article" ? (
      <div className="mb-2 text-center text-[11pt]" style={{ textIndent: 0 }}>
        {doc.meta.organization || doc.meta.university}
        {doc.meta.email ? ` · ${doc.meta.email}` : ""}
      </div>
    ) : null;

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar
        zoom={zoom}
        onZoom={setZoom}
        page={page}
        pages={pages?.length ?? 1}
        onPage={go}
        onFit={fit}
      />
      <div ref={hostRef} className="min-h-0 flex-1">
        <Workspace ref={scrollRef} className="h-full">
          <div ref={stackRef} className="flex flex-col items-center gap-8">
            {!pages ? <p className="text-sm text-white/70">Sahifalar tayyorlanmoqda…</p> : null}
            {(pages ?? []).map((pg, i) => {
              const isTitle = pg.length === 1 && pg[0]?.type === "title";
              return (
                <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
                  <div
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    data-page={i + 1}
                    className={frame ? "word-sheet word-sheet--framed" : "word-sheet"}
                    style={frame ? ({ "--sheet-frame": frame } as React.CSSProperties) : undefined}
                  >
                    {isTitle ? (
                      <TitlePage title={title} ribbon={ribbon} />
                    ) : (
                      <div className="word-inner">
                        {i === 1 && ribbon && pages?.[0]?.[0]?.type === "title" ? null : i === 0 ? ribbon : null}
                        {pg.map((it) => (
                          <FlowBlock key={it.id} item={it} toc={toc} labels={labels} />
                        ))}
                      </div>
                    )}
                    {!isTitle ? <div className="word-footer-num">{i + 1}</div> : null}
                  </div>
                </ZoomFrame>
              );
            })}
          </div>
        </Workspace>
      </div>

      <div
        aria-hidden
        className="pointer-events-none fixed top-0 -left-[12000px] w-[165mm] font-[family-name:var(--font-doc)] text-[14pt] leading-[1.5]"
        ref={measureRef}
      >
        {items.map((it) => (
          /*
           * `flow-root` — muhim: usiz bolaning vertikal chegarasi (masalan
           * `.word-p` ning 10pt pastki margin'i) o'ram div'dan TASHQARIGA
           * chiqib ketadi va `getBoundingClientRect()` uni hisoblamaydi.
           * Natijada har band ~13–32 px kam o'lchanib, sahifaga haddan
           * ziyod band joylanardi va matn varaqdan chiqib ketardi.
           */
          <div key={it.id} style={{ display: "flow-root" }}>
            <FlowBlock item={it} toc={toc} labels={labels} />
          </div>
        ))}
      </div>
    </div>
  );
}



function FlowBlock({
  item,
  toc,
  labels,
}: {
  item: FlowItem;
  toc: TocRow[];
  labels: ReturnType<typeof docLabels>;
}) {
  switch (item.type) {
    case "title":
      return <div className="h-[40mm]" />;
    case "toc":
      /*
       * Mundarija — DOCX bilan bir xil: raqamlangan ro'yxat, SAHIFA
       * RAQAMISIZ.
       *
       * Ilgari bu yerda sahifa raqami va nuqtali yetakchi bor edi, DOCX
       * da esa yo'q — ekran fayldan farq qilardi. Bundan tashqari
       * sarlavha `shrink-0` bilan flex ichida turardi: uzun bob nomi
       * o'ralmay, yetakchi va raqamni varaq chetidan tashqariga itarardi
       * (aynan shu sababli mundarija ramkadan chiqib ketardi).
       */
      return (
        <div>
          <div className="word-h1">{labels.toc}</div>
          {toc.map((row, i) => (
            <div
              key={`${i}-${row.text}`}
              // DOCX `tocLine`: `spacing: { line, after: 0 }` — qatorlar
              // orasida qo'shimcha bo'shliq yo'q.
              className="text-[14pt] break-words hyphens-auto"
              style={{
                textIndent: 0,
                fontWeight: row.level === 1 ? 700 : 400,
                // DOCX dagi 0,75 sm bilan bir xil.
                marginLeft: row.level === 2 ? "0.75cm" : 0,
              }}
            >
              {row.level === 1 ? row.text.toUpperCase() : row.text}
            </div>
          ))}
        </div>
      );
    case "abstract":
      return (
        <div>
          <div className="word-h1">{item.label}</div>
          <p className="word-p">{item.text}</p>
          {/* DOCX da bu qator oddiy `bodyP` — kursivsiz. */}
          <p className="word-p">
            {labels.keywords}: {item.keywords}
          </p>
        </div>
      );
    case "h1":
      return <div className="word-h1">{item.text}</div>;
    case "h2":
      return <div className="word-h2">{item.text}</div>;
    case "h3":
      return <div className="word-h3">{item.text}</div>;
    case "p":
      return <p className="word-p">{item.text}</p>;
    case "li":
      return (
        <div className="word-li">
          <span>•</span>
          <span>{item.text}</span>
        </div>
      );
    case "quote":
      return <p className="word-quote">{item.text}</p>;
    case "code":
      return (
        <div className="mb-3" style={{ textIndent: 0 }}>
          {item.caption ? (
            // DOCX: `centerP(caption, { italics: true, size: 22 })` = 11 pt.
            <div className="mb-1 text-center text-[11pt] italic">{item.caption}</div>
          ) : null}
          {/* DOCX: Consolas, size 20 yarim-punkt = 10 pt. */}
          <pre className="overflow-x-auto rounded-sm border border-neutral-300 bg-[#f2f2f2] px-3 py-2 font-mono text-[10pt] leading-snug whitespace-pre-wrap">
            {item.text}
          </pre>
        </div>
      );
    case "table":
      return (
        <div>
          {item.table.caption ? (
            <div className="mb-1 text-center text-[12pt] italic" style={{ textIndent: 0 }}>
              {item.table.caption}
            </div>
          ) : null}
          <table className="word-table">
            <thead>
              <tr>
                {item.table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "refNote":
      /*
       * Manba ogohlantirishi DOCX da bor edi, ko'ruvchida yo'q (P1-6).
       * Foydalanuvchi saytda ishonchli ko'rinadigan ro'yxatni ko'rar,
       * «TEKSHIRILMAGAN» yozuvini esa faqat faylni ochgandan keyin
       * topardi — bu aynan akademik halollik uchun qo'shilgan matn,
       * shuning uchun u KO'RINISHDA ham turishi kerak.
       */
      // DOCX da u oddiy `bodyP` — 14 pt, justify, 1.25 sm chekinish,
      // kursivsiz. Ilgari bu yerda 12 pt kursiv edi va faylga mos kelmasdi.
      return <p className="word-p">{item.text}</p>;
    case "ref":
      return (
        <p className="word-p">
          {item.n}. {item.text}
        </p>
      );
    default:
      return null;
  }
}
