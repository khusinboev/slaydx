"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { docLabels } from "@/lib/generation/i18n";
import { ESSAY_DESIGNS } from "@/lib/languages";
import type { AcademicDoc } from "@/lib/generation/types";
import { docToFlow, titleModel, tocEntries, type FlowItem, type TitleModel } from "@/lib/viewers/flow";
import type { ViewerKind } from "@/lib/viewers/kind";
import { A4, contentHeightPx } from "@/lib/viewers/metrics";
import { ZoomFrame, Workspace } from "./sheet";
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
  const toc = useMemo(() => tocEntries(doc), [doc]);
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
    const limit = contentHeightPx({ footer: true });
    const packed: FlowItem[][] = [];
    let cur: FlowItem[] = [];
    let used = 0;

    items.forEach((item, i) => {
      const h = Math.max(8, hs[i] ?? 20);
      if (item.type === "title") {
        if (cur.length) packed.push(cur);
        packed.push([item]);
        cur = [];
        used = 0;
        return;
      }
      if ((item.type === "toc" || item.type === "abstract") && cur.length) {
        packed.push(cur);
        cur = [];
        used = 0;
      }
      const keep = item.type === "h1" || item.type === "h2" || item.type === "h3";
      const need = keep ? h + 36 : h;
      if (cur.length && used + need > limit) {
        packed.push(cur);
        cur = [item];
        used = h;
      } else {
        cur.push(item);
        used += h;
      }
    });
    if (cur.length) packed.push(cur);
    setPages(packed.length ? packed : [items]);
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

function TitlePage({ title, ribbon }: { title: TitleModel; ribbon: ReactNode }) {
  return (
    <div className="word-inner flex flex-col">
      {ribbon}
      <div className="text-center text-[12pt] font-bold uppercase leading-[1.5]">
        {title.ministry.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="mt-4 text-center text-[12pt] font-bold uppercase">{title.university}</div>
      <div className="mt-3 text-center text-[14pt]">
        {title.faculty ? <div>{title.faculty}</div> : null}
        {title.department ? <div>{title.department}</div> : null}
      </div>
      <div className="flex-1" />
      <div className="text-center">
        <div className="text-[16pt] font-bold uppercase">{title.workLabel}</div>
        <div className="mt-4 text-[14pt] font-bold italic">«{title.topic}»</div>
      </div>
      <div className="flex-1" />
      <div className="text-[14pt] leading-[1.5]">
        {title.author ? <div>{title.labels.doneBy}: {title.author}</div> : null}
        {title.courseLine ? <div>{title.courseLine}</div> : null}
        {title.teacher ? <div>{title.labels.supervisor}: {title.teacher}</div> : null}
        {title.subject ? <div>{title.labels.subject}: {title.subject}</div> : null}
      </div>
      <div className="flex-1" />
      <div className="text-center text-[14pt]">
        {title.labels.academicYear(new Date().getFullYear(), new Date().getFullYear() + 1)}
      </div>
      <div className="pb-2 text-center text-[14pt] font-bold">{title.cityYear}</div>
    </div>
  );
}

function FlowBlock({
  item,
  toc,
  labels,
}: {
  item: FlowItem;
  toc: string[];
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
            <div key={row} className="mb-1 text-[14pt] break-words hyphens-auto" style={{ textIndent: 0 }}>
              {i + 1}. {row}
            </div>
          ))}
        </div>
      );
    case "abstract":
      return (
        <div>
          <div className="word-h1">{item.label}</div>
          <p className="word-p">{item.text}</p>
          <p className="word-p">
            <em>{labels.keywords}:</em> {item.keywords}
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
            <div className="mb-1 text-center text-[12pt] italic">{item.caption}</div>
          ) : null}
          <pre className="overflow-x-auto rounded-sm border border-neutral-300 bg-[#f2f2f2] px-3 py-2 font-mono text-[10.5pt] leading-snug whitespace-pre-wrap">
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
