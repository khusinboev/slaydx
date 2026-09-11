import type { CSSProperties, ReactNode } from "react";
import { Link2, Mail, MapPin, Phone, Plus, Sparkles, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { ResumeItem, ResumeLayout, ResumePath, ResumeZoneId } from "@/lib/generation/resume/layout";
import type { ResumeSectionId } from "@/lib/generation/resume/model";
import type { ResumeRowSection } from "@/lib/generation/resume/edit";
import { CHIP_SEP, RESUME_PAD_MM, mmPx, resumeMainPadMm } from "@/lib/viewers/metrics";

/**
 * Rezyume VARAG'I — sof taqdimot komponenti («ko'rdim = oldim»).
 *
 * Ko'ruvchi (`ResumeViewer`), shablon galereyasi kartasi va tahrir
 * qatlami (`ResumeEditor`) — uchalasi AYNAN shu bitta komponentdan
 * chizadi, ya'ni ekranda uch xil rezyume bo'lishi mumkin emas.
 * Maket mantiqi bu yerda YO'Q: hamma narsa `planResume` bergan
 * `layout.zones` dan keladi (`lib/generation/resume/layout.ts`).
 *
 * RANGLAR — INLINE stil. Palitralar MA'LUMOT (`RESUME_PALETTES`, hex
 * `#`siz), Tailwind esa faqat literal klasslarni ko'radi — `bg-[#${x}]`
 * kabi dinamik klass CSS ga umuman chiqmaydi va panel oq bo'lib qolardi.
 *
 * MATN TUGUNLARI TARTIBI DOCX (`renderResumeDocx`) dagi `<w:t>` tartibi
 * bilan bir xil bo'lishi SHART — `tests/viewer/resume-parity.test.mts`
 * shuni qulflaydi. Shuning uchun bu yerda ko'rinadigan hech qanday
 * qo'shimcha matn yozilmaydi: ro'yxat nuqtasi CSS `::before` dan,
 * kalit/qiymat oralig'i `justify-content` dan keladi. Ko'rinadigan
 * yagona ajratgich — ko'nikmalar oqimidagi `CHIP_SEP`, va u DOCX da ham
 * AYNAN shunday chiziladi.
 *
 * Ikkinchi va undan keyingi varaqlar Word ning xatti-harakatini
 * takrorlaydi: jadval qatori bo'linganda panel FONI davom etadi, lekin
 * paneldagi MATN va bosh banner qayta chizilmaydi.
 */

/** Tahrir hodisasi — `ResumeEditor` uni `ResumeOp` ga o'giradi. */
export type ResumeEditEvent =
  | { t: "open"; path: ResumePath; multiline?: boolean }
  | { t: "bulletAdd"; row: number; at: number }
  | { t: "bulletRemove"; row: number; index: number }
  | { t: "bulletMove"; row: number; from: number; to: number }
  | { t: "rowAdd"; section: ResumeRowSection }
  | { t: "rowRemove"; section: ResumeRowSection; index: number }
  | { t: "rowMove"; section: ResumeRowSection; from: number; to: number }
  | { t: "chipAdd" }
  | { t: "chipRemove"; at: number }
  | { t: "sectionMove"; section: ResumeSectionId; dir: -1 | 1 }
  | { t: "photo" };

export type ResumePageProps = {
  layout: ResumeLayout;
  /** Shu varaqqa tushgan `main` zonasi itemlari (`useMeasuredPages`). */
  pageItems: ResumeItem[];
  pageIndex: number;
  total: number;
  /** Tahrir yoqilganmi — `data-path`, hover boshqaruvlari va sudrash. */
  editable?: boolean;
  onEdit?: (ev: ResumeEditEvent) => void;
};

const ptPx = (pt: number) => Math.round((pt * 96) / 72 * 100) / 100;
const hex = (c: string) => `#${c}`;

const ROW_SECTIONS = new Set(["experience", "education", "certificates"]);

/* ────────────────────────── zona tartibi ────────────────────────── */

/**
 * Zonalar DOM tartibi — DOCX dagi jadval ustunlari tartibi bilan bir xil.
 * `sidebar-right` da asosiy ustun BIRINCHI keladi (o'ngdagi panel ikkinchi
 * katak), shuning uchun matn tugunlari ham shu tartibda chiqadi.
 */
export function resumeZoneOrder(layout: ResumeLayout): ResumeZoneId[] {
  switch (layout.template.columns) {
    case "sidebar-left":
      return ["aside", "main"];
    case "sidebar-right":
      return ["main", "aside"];
    default:
      return ["header", "main"];
  }
}

function itemsOf(layout: ResumeLayout, id: ResumeZoneId): ResumeItem[] {
  return layout.zones.find((z) => z.id === id)?.items ?? [];
}

/* ────────────────────────── komponent ────────────────────────── */

export function ResumePage({ layout, pageItems, pageIndex, total, editable = false, onEdit }: ResumePageProps) {
  const { template: t, palette: P } = layout;
  const first = pageIndex === 0;
  const order = resumeZoneOrder(layout);
  const side = t.columns === "sidebar-left" || t.columns === "sidebar-right";
  const mainPad = resumeMainPadMm(t, pageIndex);

  const ctx: Ctx = { layout, editable, onEdit, dark: false };

  const asideNode = side ? (
    <aside
      key="aside"
      style={{
        width: `${layout.asideWidthMm}mm`,
        flex: "0 0 auto",
        boxSizing: "border-box",
        padding: `${RESUME_PAD_MM.aside.y}mm ${RESUME_PAD_MM.aside.x}mm`,
        background: hex(t.darkAside ? P.dark : P.panel),
        color: hex(t.darkAside ? P.onDark : P.ink),
        fontFamily: t.type.font,
        fontSize: ptPx(t.type.small),
        lineHeight: t.type.line,
      }}
      data-resume-zone="aside"
    >
      {first ? <Items items={itemsOf(layout, "aside")} ctx={{ ...ctx, dark: t.darkAside }} /> : null}
    </aside>
  ) : null;

  const mainNode = (
    <main
      key="main"
      style={{
        flex: "1 1 auto",
        minWidth: 0,
        boxSizing: "border-box",
        padding: side ? `${mainPad.top}mm ${mainPad.x}mm ${mainPad.bottom}mm` : 0,
        color: hex(P.ink),
        fontFamily: t.type.font,
        fontSize: ptPx(t.type.body),
        lineHeight: t.type.line,
      }}
      data-resume-zone="main"
    >
      {/* Sarlavha bloki yon panelda EMAS bo'lsa (`split`) — asosiy
          ustunning boshida, DOCX dagi bilan bir xil. */}
      {first && t.header !== "aside" && side ? <Header layout={layout} ctx={ctx} /> : null}
      <Items items={pageItems} ctx={ctx} />
    </main>
  );

  return (
    <div
      className="word-sheet"
      style={{ background: "#fff", display: "flex", flexDirection: "column" }}
      data-resume-page={pageIndex}
    >
      {t.columns === "split-main" ? (
        /*
         * Ikki TENG huquqli ustun, rangli panel YO'Q (`compact`).
         * DOCX da bu — rangsiz ikki ustunli jadval; sarlavha bloki esa
         * jadvaldan yuqorida, varaq kengligida.
         */
        <div
          style={{
            height: "100%",
            boxSizing: "border-box",
            padding: `${t.marginsMm.top}mm ${t.marginsMm.left}mm ${t.marginsMm.bottom}mm ${t.marginsMm.right}mm`,
            fontFamily: t.type.font,
            fontSize: ptPx(t.type.body),
            lineHeight: t.type.line,
            color: hex(P.ink),
          }}
        >
          {first ? <Header layout={layout} ctx={ctx} /> : null}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "6mm" }}>
            <main style={{ flex: "1 1 auto", minWidth: 0 }} data-resume-zone="main">
              <Items items={pageItems} ctx={ctx} />
            </main>
            <aside style={{ width: `${layout.asideWidthMm}mm`, flex: "0 0 auto" }} data-resume-zone="aside">
              {first ? <Items items={itemsOf(layout, "aside")} ctx={ctx} /> : null}
            </aside>
          </div>
        </div>
      ) : side ? (
        /*
         * PANEL BALANDLIGI Word bilan bir xil.
         *
         * DOCX da panel — jadval qatorining katagi. Qator `ATLEAST
         * contentHeight(P)` bilan chizilgani uchun BIRINCHI varaqda u
         * sahifani to'ldiradi, keyingi varaqlarga o'tgan QOLDIQ esa
         * faqat o'z mazmuni qadar cho'ziladi — LibreOffice ko'zdan
         * kechiruvida (12 ish joyi, 5 varaq) oxirgi varaqda panel
         * o'rtada tugaydi. Ko'ruvchi har varaqda to'liq balandlik
         * chizsa, foydalanuvchi ekranda bir xil, faylda boshqa xil
         * ko'rardi — «ko'rdim = oldim» ning aynan buzilishi.
         *
         * Shuning uchun 1-varaqda balandlik 100%, keyingilarida MAZMUN
         * bo'yicha. (Panelni faylda ham har varaqda to'ldirish — kolontitul
         * ichiga langarlangan suzuvchi shakl bilan — AUDIT-15 ning ochiq
         * bandi: u ortiqcha bo'sh varaq xavfini olib keladi.)
         */
        <div style={{ display: "flex", height: first ? "100%" : undefined, alignItems: "stretch" }}>
          {order.map((z) => (z === "aside" ? asideNode : mainNode))}
        </div>
      ) : (
        <div
          style={{
            height: "100%",
            boxSizing: "border-box",
            paddingTop: t.header === "banner" ? 0 : `${t.marginsMm.top}mm`,
            paddingLeft: `${t.marginsMm.left}mm`,
            paddingRight: `${t.marginsMm.right}mm`,
            paddingBottom: `${t.marginsMm.bottom}mm`,
            fontFamily: t.type.font,
            fontSize: ptPx(t.type.body),
            lineHeight: t.type.line,
            color: hex(P.ink),
          }}
        >
          {first ? <Header layout={layout} ctx={ctx} /> : null}
          <Items items={pageItems} ctx={ctx} />
        </div>
      )}
      {total > 1 ? <div className="word-footer-num">{pageIndex + 1}</div> : null}
    </div>
  );
}

/* ────────────────────────── bosh qism (single / banner) ────────────────────────── */

function Header({ layout, ctx }: { layout: ResumeLayout; ctx: Ctx }) {
  const { template: t, palette: P } = layout;
  const items = itemsOf(layout, "header");
  if (!items.length) return null;

  if (t.header === "plain" || t.header === "centered") {
    const centered = t.header === "centered";
    return (
      <header
        style={{
          marginBottom: "5mm",
          paddingBottom: "2mm",
          textAlign: centered ? "center" : undefined,
          // DOCX da sarlavha ostidagi ajratuvchi chiziq — bu yerda ham.
          borderBottom: `${centered ? 0.3 : 0.5}mm solid ${hex(P.accent)}`,
        }}
        data-resume-zone="header"
        data-resume-header={t.header}
      >
        <Items items={items} ctx={ctx} centered={centered} />
      </header>
    );
  }

  if (t.header === "card") {
    /* Ochiq rangli karta: chapda kvadrat surat, o'ngda ism va aloqa. */
    const photo = items.find((it) => it.k === "photo");
    const rest = items.filter((it) => it.k !== "photo");
    return (
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5mm",
          minHeight: `${t.bannerMm}mm`,
          boxSizing: "border-box",
          padding: "4mm 5mm",
          marginBottom: "4mm",
          background: hex(P.panel),
          color: hex(P.ink),
        }}
        data-resume-zone="header"
        data-resume-header="card"
      >
        {photo ? <Item it={photo} ctx={ctx} /> : null}
        <div style={{ minWidth: 0 }}>
          <Items items={rest} ctx={ctx} />
        </div>
      </header>
    );
  }
  /*
   * Banner — sahifa kengligidagi bo'yalgan blok (DOCX da bitta katakli
   * jadval). Chekinish shu yerda, chunki tashqi o'ram `marginsMm.top = 0`
   * bilan boshlanadi va banner varaq chetiga tegib turishi kerak.
   */
  return (
    <header
      style={{
        marginLeft: `-${t.marginsMm.left}mm`,
        marginRight: `-${t.marginsMm.right}mm`,
        minHeight: `${t.bannerMm}mm`,
        boxSizing: "border-box",
        padding: `${RESUME_PAD_MM.banner.y}mm ${RESUME_PAD_MM.banner.x}mm`,
        marginBottom: `${RESUME_PAD_MM.bannerGap}mm`,
        background: hex(t.darkAside ? P.dark : P.panel),
        color: hex(t.darkAside ? P.onDark : P.ink),
        display: "flex",
        alignItems: "center",
        gap: "6mm",
      }}
      data-resume-zone="header"
    >
      <Items items={items} ctx={{ ...ctx, dark: t.darkAside }} banner />
    </header>
  );
}

/* ────────────────────────── itemlar ────────────────────────── */

type Ctx = {
  layout: ResumeLayout;
  editable: boolean;
  onEdit?: (ev: ResumeEditEvent) => void;
  /** To'q fon ustidami (panel/banner) — matn ranglari almashadi. */
  dark: boolean;
};

function Items({ items, ctx, banner = false, centered = false }: { items: ResumeItem[]; ctx: Ctx; banner?: boolean; centered?: boolean }) {
  /*
   * Bannerda surat matn blokining YONIDA turadi (DOCX da ichki ikki
   * ustunli jadval) — shuning uchun surat itemi ajratib olinadi.
   */
  if (banner) {
    const photo = items.find((it) => it.k === "photo");
    const rest = items.filter((it) => it.k !== "photo");
    return (
      <>
        {photo ? <Item it={photo} ctx={ctx} /> : null}
        <div style={{ minWidth: 0 }}>
          {rest.map((it, i) => (
            <Item key={i} it={it} ctx={ctx} />
          ))}
        </div>
      </>
    );
  }
  const t = ctx.layout.template;
  /*
   * Ikki maxsus qoida — DOCX `drawItems` bilan AYNAN bir xil:
   *  1. `heading: "hanging"` — bo'lim MATNI `railMm` ga chekinadi,
   *     sarlavhaning o'zi chap maydonda qoladi («Xat» uslubi);
   *  2. `rowStyle: "rail"` — qator va unga tegishli bandlar bitta
   *     ikki ustunli blokka yig'iladi: chapda davr, o'ngda mazmun.
   */
  const hanging = t.heading === "hanging" ? t.railMm : 0;
  const out: React.ReactNode[] = [];
  let indent = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.k === "h2") {
      out.push(<Item key={i} it={it} ctx={ctx} />);
      indent = hanging;
      continue;
    }
    if (it.k === "row" && t.rowStyle === "rail") {
      const rest: ResumeItem[] = [];
      while (i + 1 < items.length && items[i + 1].k === "li") rest.push(items[++i]);
      out.push(<RailRow key={i} row={it} rest={rest} ctx={ctx} />);
      continue;
    }
    out.push(
      indent ? (
        <div key={i} style={{ marginLeft: `${indent}mm` }}>
          <Item it={it} ctx={ctx} />
        </div>
      ) : (
        <Item key={i} it={it} ctx={ctx} />
      ),
    );
  }
  return <div style={centered ? { textAlign: "center" } : undefined}>{out}</div>;
}

function Item({ it, ctx }: { it: ResumeItem; ctx: Ctx }) {
  const { layout, editable, onEdit, dark } = ctx;
  const { template: t, palette: P } = layout;
  const ink = hex(dark ? P.onDark : P.ink);
  const muted = hex(dark ? P.accentSoft : P.muted);
  const accent = hex(dark ? P.accentSoft : P.accent);

  /** Tahrir nishoni — FAQAT `data-*`; stil chaqiruv joyida qoladi. */
  const edit = (path: ResumePath, multiline = false) =>
    editable ? { "data-path": path, ...(multiline ? { "data-multiline": "1" } : {}) } : {};
  const cur = editable ? ("text" as const) : undefined;

  switch (it.k) {
    case "photo": {
      const px = mmPx(it.sizeMm);
      return (
        <div style={{ marginBottom: "4mm" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={it.url}
            alt=""
            width={Math.round(px)}
            height={Math.round(px)}
            style={{
              width: `${it.sizeMm}mm`,
              height: `${it.sizeMm}mm`,
              objectFit: "cover",
              display: "block",
              borderRadius: it.shape === "circle" ? "50%" : "2mm",
            }}
            data-resume-photo={it.shape}
          />
          {editable ? (
            <IconBtn label="Rasmni almashtirish" onClick={() => onEdit?.({ t: "photo" })}>
              <Plus className="size-3" />
            </IconBtn>
          ) : null}
        </div>
      );
    }
    case "name":
      return (
        <h1
          {...edit(it.path)}
          style={{ margin: 0, fontSize: ptPx(t.type.h1), lineHeight: 1.1, fontWeight: 700, color: ink, cursor: cur, letterSpacing: t.heading === "caps" ? "0.02em" : undefined }}
        >
          {it.text}
        </h1>
      );
    case "headline":
      return (
        <p {...edit(it.path)} style={{ margin: "1.5mm 0 0", fontSize: ptPx(t.type.body), color: accent, cursor: cur }}>
          {it.text}
        </p>
      );
    case "h2":
      return (
        <SectionHeading it={it} ctx={ctx} />
      );
    case "p":
      return (
        <p {...edit(it.path, true)} style={{ margin: "0 0 2mm", fontSize: ptPx(t.type.body), color: ink, cursor: cur, whiteSpace: "pre-wrap" }}>
          {it.text}
        </p>
      );
    case "row":
      return <Row it={it} ctx={ctx} />;
    case "li":
      return (
        <div className="group" style={{ display: "flex", alignItems: "flex-start", gap: "1mm", margin: "0 0 1mm" }} data-resume-li={it.path}>
          <span
            aria-hidden
            className="before:content-['•']"
            style={{ color: accent, flex: "0 0 auto", width: "3mm" }}
          />
          <span {...edit(it.path, true)} style={{ flex: "1 1 auto", fontSize: ptPx(t.type.body), color: ink, cursor: cur }}>
            {it.text}
          </span>
          {it.ai ? (
            <span
              title="AI qo‘shgan band"
              data-resume-ai="1"
              aria-label="AI qo‘shgan band"
              style={{ flex: "0 0 auto", color: accent, opacity: 0.7 }}
            >
              <Sparkles className="size-3" />
            </span>
          ) : null}
          {editable ? <BulletControls path={it.path} onEdit={onEdit} /> : null}
        </div>
      );
    case "kv":
      return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", margin: "0 0 1mm", fontSize: ptPx(t.type.small) }}>
          <span {...edit(it.path)} style={{ color: ink, cursor: cur }}>
            {it.key}
          </span>
          <span
            {...(editable ? { "data-path": it.path.replace(/\.language$/, ".level") } : {})}
            style={{ color: muted, cursor: cur }}
          >
            {it.val}
          </span>
        </div>
      );
    case "chips":
      /*
       * Ko'nikmalar — ODDIY OQIM, «chip» EMAS.
       *
       * DOCX da haqiqiy chip yo'q: `w:shd` runga tegadi va ko'p so'zli
       * ko'nikma qator uzilishida ramkasidan chiqib ketadi (jonli
       * ko'zdan kechiruvda ko'rilgan). Ekranda chiroyli chip, faylda
       * buzuq ramka bo'lishi «ko'rdim = oldim» ning aynan buzilishi
       * bo'lardi, shuning uchun ikkalasi ham bir xil oqim chizadi va
       * « · » ajratgichi ikkalasida ham HAQIQIY matn.
       */
      return (
        <p style={{ margin: "0 0 2mm", fontSize: ptPx(t.type.small), color: hex(dark ? P.onDark : P.ink) }} data-resume-chips>
          {it.items.map((c, j) => (
            <span key={j}>
              {j ? <span style={{ color: hex(dark ? P.accentSoft : P.muted) }}>{CHIP_SEP}</span> : null}
              {/* Har ko'nikma alohida tahrirlanadi, lekin op BUTUN ro'yxat
                  (`list`) — `ResumeEditor` qolganini modeldan oladi. */}
              <span {...(editable ? { "data-path": "skills", "data-chip": String(j) } : {})} style={{ cursor: cur }}>
                {c.text}
              </span>
              {c.ai ? <Sparkles className="size-3" aria-label="AI qo‘shgan" style={{ display: "inline", marginLeft: 2, opacity: 0.7 }} /> : null}
              {editable ? (
                <IconBtn label="Ko‘nikmani olib tashlash" onClick={() => onEdit?.({ t: "chipRemove", at: j })}>
                  <Trash2 className="size-3" />
                </IconBtn>
              ) : null}
            </span>
          ))}
          {editable ? (
            <IconBtn label="Ko‘nikma qo‘shish" onClick={() => onEdit?.({ t: "chipAdd" })}>
              <Plus className="size-3" />
            </IconBtn>
          ) : null}
        </p>
      );
    case "contact":
      return (
        <div style={{ margin: "0 0 2mm" }}>
          {it.lines.map((l, j) => (
            <div key={j} style={{ display: "flex", alignItems: "center", gap: "1.5mm", margin: "0 0 1mm", fontSize: ptPx(t.type.small) }}>
              <ContactIconView icon={l.icon} color={accent} />
              <span {...edit(l.path)} style={{ color: dark ? hex(P.onDark) : hex(P.muted), cursor: cur, wordBreak: "break-word" }}>
                {l.text}
              </span>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/**
 * Taymlayn qatori (DOCX `railRow` ning ekrandagi egizagi): chapda davr,
 * o'ngda sarlavha/tashkilot va bandlar, orada aksent chizig'i.
 */
function RailRow({
  row,
  rest,
  ctx,
}: {
  row: Extract<ResumeItem, { k: "row" }>;
  rest: ResumeItem[];
  ctx: Ctx;
}) {
  const { template: t, palette: P } = ctx.layout;
  const edit = (path: ResumePath) => (ctx.editable ? { "data-path": path } : {});
  return (
    <div style={{ display: "flex", alignItems: "stretch", margin: "0 0 3mm" }} data-resume-rail={row.path}>
      <div
        style={{
          width: `${t.railMm}mm`,
          flex: "0 0 auto",
          paddingTop: "0.5mm",
          paddingRight: "3mm",
          boxSizing: "border-box",
          fontSize: ptPx(t.type.small),
          fontWeight: 700,
          color: hex(P.accent),
        }}
      >
        {row.period || "—"}
      </div>
      <div
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          borderLeft: `0.3mm solid ${hex(P.accent)}`,
          paddingLeft: "3mm",
          paddingBottom: "1mm",
        }}
      >
        {row.title ? (
          <div {...edit(row.titlePath)} style={{ fontWeight: 700, color: hex(P.ink), cursor: ctx.editable ? "text" : undefined }}>
            {row.title}
          </div>
        ) : null}
        {row.sub ? (
          <div {...edit(row.subPath)} style={{ fontSize: ptPx(t.type.small), color: hex(P.muted), cursor: ctx.editable ? "text" : undefined }}>
            {row.sub}
          </div>
        ) : null}
        {rest.map((it, i) => (
          <Item key={i} it={it} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── bo'lim sarlavhasi ────────────────────────── */

function SectionHeading({ it, ctx }: { it: Extract<ResumeItem, { k: "h2" }>; ctx: Ctx }) {
  const { layout, editable, onEdit, dark } = ctx;
  const { template: t, palette: P } = layout;
  const color = hex(dark ? P.accentSoft : P.accent);
  const base: CSSProperties = {
    margin: "4mm 0 1.5mm",
    fontSize: ptPx(t.type.h2),
    fontWeight: 700,
    color,
    lineHeight: 1.2,
  };
  const styles: Record<string, CSSProperties> = {
    rule: { ...base, borderBottom: `0.6mm solid ${color}`, paddingBottom: "1mm" },
    caps: { ...base, textTransform: "uppercase", letterSpacing: "0.12em" },
    hairline: { ...base, borderBottom: `0.2mm solid ${hex(dark ? P.accentSoft : P.muted)}`, paddingBottom: "1mm", textTransform: "uppercase", letterSpacing: "0.1em" },
    block: {
      ...base,
      background: hex(P.panel),
      borderLeft: `1.2mm solid ${color}`,
      padding: "1mm 2mm",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    // Chapda qalin aksent tasma, fon YO'Q (DOCX: `border.left` 24).
    tab: { ...base, borderLeft: `1.6mm solid ${color}`, paddingLeft: "2mm", textTransform: "uppercase", letterSpacing: "0.08em" },
    // «Xat» uslubi: sarlavha chap maydonda, bo'lim matni chekinadi
    // (chekinishni `Items` beradi — DOCX dagi bilan bir xil qoida).
    hanging: { ...base, textTransform: "uppercase", letterSpacing: "0.1em", margin: "4mm 0 1mm" },
  };
  return (
    <h2 className="group" style={styles[t.heading] ?? base} data-resume-h2={it.section}>
      {it.text}
      {editable ? (
        <>
          {/* Yo'nalish beriladi, INDEKS emas: bo'lim tartibi modeldagi
              `order` da (7 band), maketda esa faqat bo'sh bo'lmaganlari
              ko'rinadi — absolyut indeks ikkovida boshqacha bo'lardi. */}
          <IconBtn label="Bo‘limni yuqoriga" onClick={() => onEdit?.({ t: "sectionMove", section: it.section, dir: -1 })}>
            <ChevronUp className="size-3" />
          </IconBtn>
          <IconBtn label="Bo‘limni pastga" onClick={() => onEdit?.({ t: "sectionMove", section: it.section, dir: 1 })}>
            <ChevronDown className="size-3" />
          </IconBtn>
          {ROW_SECTIONS.has(it.section) ? (
            <IconBtn label="Yangi qator qo‘shish" onClick={() => onEdit?.({ t: "rowAdd", section: it.section as ResumeRowSection })}>
              <Plus className="size-3" />
            </IconBtn>
          ) : null}
        </>
      ) : null}
    </h2>
  );
}

/* ────────────────────────── qator (tajriba/ta'lim/sertifikat) ────────────────────────── */

function Row({ it, ctx }: { it: Extract<ResumeItem, { k: "row" }>; ctx: Ctx }) {
  const { layout, editable, onEdit, dark } = ctx;
  const { template: t, palette: P } = layout;
  const ink = hex(dark ? P.onDark : P.ink);
  const muted = hex(dark ? P.accentSoft : P.muted);
  const ed = (path: ResumePath) => (editable ? { "data-path": path } : {});
  const cur = editable ? ("text" as const) : undefined;

  return (
    <div className="group" style={{ margin: "0 0 1.5mm" }} data-resume-row={it.path}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", alignItems: "baseline" }}>
        {it.title ? (
          <span {...ed(it.titlePath)} style={{ fontWeight: 700, fontSize: ptPx(t.type.body), color: ink, cursor: cur }}>
            {it.title}
          </span>
        ) : null}
        {it.period ? (
          <span
            {...(editable ? { "data-path": `${it.path}.${it.section === "certificates" ? "year" : "start"}` } : {})}
            style={{ fontSize: ptPx(t.type.small), color: muted, cursor: cur, flex: "0 0 auto", whiteSpace: "nowrap" }}
            data-resume-period
          >
            {it.period}
          </span>
        ) : null}
        {editable ? (
          <span style={{ flex: "0 0 auto" }}>
            <IconBtn label="Yuqoriga" onClick={() => onEdit?.({ t: "rowMove", section: it.section, from: it.index, to: Math.max(0, it.index - 1) })}>
              <ChevronUp className="size-3" />
            </IconBtn>
            <IconBtn label="Pastga" onClick={() => onEdit?.({ t: "rowMove", section: it.section, from: it.index, to: it.index + 1 })}>
              <ChevronDown className="size-3" />
            </IconBtn>
            {it.section === "experience" ? (
              <IconBtn label="Band qo‘shish" onClick={() => onEdit?.({ t: "bulletAdd", row: it.index, at: 0 })}>
                <Plus className="size-3" />
              </IconBtn>
            ) : null}
            <IconBtn label="Qatorni o‘chirish" onClick={() => onEdit?.({ t: "rowRemove", section: it.section, index: it.index })}>
              <Trash2 className="size-3" />
            </IconBtn>
          </span>
        ) : null}
      </div>
      {it.sub ? (
        <div {...ed(it.subPath)} style={{ fontSize: ptPx(t.type.small), color: muted, cursor: cur }}>
          {it.sub}
        </div>
      ) : null}
    </div>
  );
}

/** `experience.2.bullets.3.text` → qator/band indeksi. */
function bulletAt(path: string): { row: number; index: number } | null {
  const m = /^experience\.(\d+)\.bullets\.(\d+)\.text$/.exec(path);
  return m ? { row: Number(m[1]), index: Number(m[2]) } : null;
}

function BulletControls({ path, onEdit }: { path: string; onEdit?: (ev: ResumeEditEvent) => void }) {
  const at = bulletAt(path);
  if (!at) return null;
  return (
    <span style={{ flex: "0 0 auto" }}>
      <IconBtn label="Bandni yuqoriga" onClick={() => onEdit?.({ t: "bulletMove", row: at.row, from: at.index, to: Math.max(0, at.index - 1) })}>
        <ChevronUp className="size-3" />
      </IconBtn>
      <IconBtn label="Bandni pastga" onClick={() => onEdit?.({ t: "bulletMove", row: at.row, from: at.index, to: at.index + 1 })}>
        <ChevronDown className="size-3" />
      </IconBtn>
      <IconBtn label="Band qo‘shish" onClick={() => onEdit?.({ t: "bulletAdd", row: at.row, at: at.index + 1 })}>
        <Plus className="size-3" />
      </IconBtn>
      <IconBtn label="Bandni o‘chirish" onClick={() => onEdit?.({ t: "bulletRemove", row: at.row, index: at.index })}>
        <Trash2 className="size-3" />
      </IconBtn>
    </span>
  );
}

/**
 * Hover boshqaruvi — MATNSIZ (faqat `aria-label`).
 *
 * Tugma ichida ko'rinadigan matn bo'lsa u DOCX da yo'q matn tuguni
 * bo'lib qolardi va paritet testi yiqilardi.
 */
function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-resume-ctl
      className="no-print ml-1 inline-flex align-middle opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 focus:opacity-100"
      style={{ color: "inherit" }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function ContactIconView({ icon, color }: { icon: "phone" | "mail" | "pin" | "link"; color: string }) {
  const style = { flex: "0 0 auto", color } as const;
  if (icon === "phone") return <Phone className="size-3" style={style} aria-hidden />;
  if (icon === "mail") return <Mail className="size-3" style={style} aria-hidden />;
  if (icon === "pin") return <MapPin className="size-3" style={style} aria-hidden />;
  return <Link2 className="size-3" style={style} aria-hidden />;
}

/**
 * BITTA itemni asosiy ustun kontekstida chizadi — sahifalash o'lchovi
 * (`useMeasuredPages`) uchun. O'lchov varaqdagi bilan AYNAN bir xil
 * komponentdan bo'lishi shart, aks holda sahifa chegarasi ekrandagidan
 * boshqa joyga tushadi.
 */
export function ResumeItemView({ layout, item }: { layout: ResumeLayout; item: ResumeItem }) {
  return <Item it={item} ctx={{ layout, editable: false, dark: false }} />;
}
