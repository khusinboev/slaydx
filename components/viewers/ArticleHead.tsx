import type { CiteSpan } from "@/lib/generation/article/layout";
import type { FlowItem } from "@/lib/viewers/flow";

/**
 * Maqola 2 bosh bloki — UDK, sarlavha, mualliflar, annotatsiya ×3,
 * highlights. Har band `planArticle` → `articleFlow` dan keladi; bu yerda
 * FAQAT chizish (`render-docx.ts drawArticle` bilan bir juft):
 *
 *   • UDK — chapda, kichik;
 *   • sarlavha — markazda qalin, BOSH HARFSIZ (`<w:t>` matni o'zgarmaydi);
 *   • muallif — ism+unvon qalin, tashkilot/email/ORCID kursiv kichik;
 *   • annotatsiya — «**Annotatsiya.** matn» bitta paragrafda, so'ng
 *     «**Kalit so‘zlar:** …» — yorliqlar annotatsiyaning O'Z tilida;
 *   • highlights — yorliq qalin + bandlar.
 *
 * Matn tugunlari ketma-ketligi DOCX `<w:t>` bilan aynan bir xil bo'lishi
 * shart (`tests/viewer/article-parity.test.mts`).
 */
export type ArticleHeadFlowItem = Extract<FlowItem, { type: "udk" | "articleTitle" | "authors" | "abstract" | "highlights" }>;

export function ArticleHeadItem({ item }: { item: ArticleHeadFlowItem }) {
  switch (item.type) {
    case "udk":
      // DOCX: chapda, `size - 4` (14 → 12 pt).
      return (
        <div className="word-udk" data-article="udk">
          {item.text}
        </div>
      );
    case "articleTitle":
      return (
        <div className="word-article-title" data-article="title">
          {item.text}
        </div>
      );
    case "authors":
      return (
        <div className="word-authors" data-article="authors">
          {item.authors.map((a) => (
            <div key={a.index} className="word-author">
              <div className="word-author-line">{a.line}</div>
              {a.affiliation ? <div className="word-author-aff">{a.affiliation}</div> : null}
            </div>
          ))}
        </div>
      );
    case "abstract":
      return (
        <div className="word-abstract" data-article="abstract" lang={item.lang}>
          <p className="word-p word-abstract-p">
            <b>{item.label}.</b> {item.text}
          </p>
          <p className="word-p word-abstract-p">
            <b>{item.keywordsLabel ?? item.label}:</b> {item.keywords}
          </p>
        </div>
      );
    case "highlights":
      return (
        <div className="word-highlights" data-article="highlights">
          <div className="word-highlights-label">{item.label}</div>
          {item.items.map((t, i) => (
            <div key={i} className="word-li word-highlight">
              <span>•</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/** Butun bosh blok — galereya/eskiz uchun qulay o'ram. */
export function ArticleHead({ items }: { items: ArticleHeadFlowItem[] }) {
  return (
    <>
      {items.map((it) => (
        <ArticleHeadItem key={it.id} item={it} />
      ))}
    </>
  );
}

const VERIFIED_TITLE: Record<NonNullable<CiteSpan["cite"]>["verified"], string> = {
  openalex: "Manba OpenAlex da tasdiqlangan",
  crossref: "Manba Crossref (DOI) orqali tasdiqlangan",
  user: "Foydalanuvchi bergan manba",
  unverified: "Manba TEKSHIRILMAGAN — hisobotga qarang",
};

/**
 * Iqtibosli matn: `[1; 25-b.]` bo'laklari `data-ref-verified` bilan
 * o'raladi (✅/⚠️ belgisi CSS `::after` dan — matn tuguniga kirmaydi,
 * DOCX bilan paritet buzilmaydi). `spans` bo'lmasa oddiy matn.
 */
export function CiteText({ text, spans }: { text: string; spans?: CiteSpan[] }) {
  if (!spans?.length) return <>{text}</>;
  return (
    <>
      {spans.map((s, i) =>
        s.cite ? (
          <span
            key={i}
            className="word-cite"
            data-ref-verified={s.cite.verified}
            data-ref-ids={s.cite.ids.join(" ")}
            title={VERIFIED_TITLE[s.cite.verified]}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
