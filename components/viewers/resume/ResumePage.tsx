import type { CSSProperties, ReactNode } from "react";
import { Link2, Mail, MapPin, Phone, Plus, Sparkles, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { ResumeItem, ResumeLayout, ResumePath, ResumeZoneId } from "@/lib/generation/resume/layout";
import type { ResumeSectionId } from "@/lib/generation/resume/model";
import type { ResumeRowSection } from "@/lib/generation/resume/edit";
import { RESUME_PAD_MM, mmPx, resumeMainPadMm } from "@/lib/viewers/metrics";

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
 * qo'shimcha matn (ajratgich, «•», yorliq) yozilmaydi: nuqta CSS
 * `::before` dan, kalit/qiymat oralig'i esa `justify-content` dan.
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
  | { t: "sectionMove"; section: ResumeSectionId; to: number }
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
      <Items items={pageItems} ctx={ctx} />
    </main>
  );

  return (
    <div
      className="word-sheet"
      style={{ background: "#fff", display: "flex", flexDirection: "column" }}
      data-resume-page={pageIndex}
    >
      {side ? (
        <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
          {order.map((z) => (z === "aside" ? asideNode : mainNode))}
        </div>
      ) : (
        <div
          style={{
            height: "100%",
            boxSizing: "border-box",
            paddingTop: t.columns === "banner" ? 0 : `${t.marginsMm.top}mm`,
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

  if (t.columns !== "banner") {
    return (
      <header style={{ marginBottom: "6mm" }} data-resume-zone="header">
        <Items items={items} ctx={ctx} />
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

function Items({ items, ctx, banner = false }: { items: ResumeItem[]; ctx: Ctx; banner?: boolean }) {
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
  return (
    <>
      {items.map((it, i) => (
        <Item key={i} it={it} ctx={ctx} />
      ))}
    </>
  );
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
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5mm", margin: "0 0 2mm" }} data-resume-chips>
          {it.items.map((c, j) => (
            <span
              key={j}
              data-chip={j}
              style={{
                fontSize: ptPx(t.type.small),
                padding: "0.6mm 1.8mm",
                borderRadius: "1mm",
                // Fon DOCX bilan bir xil (`accentSoft`) — ochiq `panel` LibreOffice da
                // deyarli oq chiqib, chip umuman ko'rinmasdi.
                background: hex(dark ? P.accent : P.accentSoft),
                color: hex(dark ? P.onDark : P.ink),
              }}
            >
              {c.text}
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
        </div>
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
  };
  return (
    <h2 className="group" style={styles[t.heading] ?? base} data-resume-h2={it.section}>
      {it.text}
      {editable ? (
        <>
          <IconBtn label="Bo‘limni yuqoriga" onClick={() => onEdit?.({ t: "sectionMove", section: it.section, to: Math.max(0, sectionPos(layout, it.section) - 1) })}>
            <ChevronUp className="size-3" />
          </IconBtn>
          <IconBtn label="Bo‘limni pastga" onClick={() => onEdit?.({ t: "sectionMove", section: it.section, to: sectionPos(layout, it.section) + 1 })}>
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

function sectionPos(layout: ResumeLayout, id: ResumeSectionId): number {
  // `order` maketda emas, modelda — `h2` itemi faqat `section` ni biladi.
  const zone = layout.zones.find((z) => z.id === "main");
  const heads = (zone?.items ?? []).filter((x) => x.k === "h2") as Extract<ResumeItem, { k: "h2" }>[];
  const at = heads.findIndex((x) => x.section === id);
  return at < 0 ? 0 : at;
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
