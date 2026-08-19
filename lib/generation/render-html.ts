import { docLabels } from "./i18n";
import type { AcademicDoc, Block } from "./types";

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "h1":
      return `<h2>${esc(b.text)}</h2>`;
    case "h2":
      return `<h3>${esc(b.text)}</h3>`;
    case "h3":
      return `<h4>${esc(b.text)}</h4>`;
    case "li":
      return `<li>${esc(b.text)}</li>`;
    case "quote":
      return `<blockquote>${esc(b.text)}</blockquote>`;
    case "code":
      return `${b.caption ? `<p class="cap">${esc(b.caption)}</p>` : ""}<pre><code>${esc(b.text)}</code></pre>`;
    default:
      return `<p>${esc(b.text)}</p>`;
  }
}

export function renderHtml(doc: AcademicDoc): string {
  const { meta } = doc;
  const L = docLabels(meta.language);
  const year = new Date().getFullYear();
  const ministry = (meta.ministry === "maktab" ? L.ministrySchool : L.ministryHigher).replaceAll("\n", "<br/>");
  const cover = doc.titlePage
    ? `<section class="cover">
        <p class="caps">${ministry}</p>
        <p>${esc(meta.university)}</p>
        ${meta.faculty ? `<p>${esc(meta.faculty)}</p>` : ""}
        ${meta.department ? `<p>${esc(meta.department)}</p>` : ""}
        <h1>${esc(meta.workLabel.toUpperCase())}</h1>
        <h2>«${esc(meta.topic)}»</h2>
        <div class="meta">
          ${meta.author ? `<p>${L.doneBy}: ${esc(meta.author)}</p>` : ""}
          ${meta.teacher ? `<p>${L.supervisor}: ${esc(meta.teacher)}</p>` : ""}
          ${meta.subject ? `<p>${L.subject}: ${esc(meta.subject)}</p>` : ""}
          <p>${esc(meta.city)} — ${year}</p>
        </div>
      </section>`
    : "";

  const toc = doc.toc
    ? `<section><h2>${L.toc}</h2><ol>${doc.sections.map((s) => `<li>${esc(s.title)}</li>`).join("")}${
        doc.references?.length ? `<li>${L.references}</li>` : ""
      }</ol></section>`
    : "";

  const abs = (doc.abstracts ?? [])
    .map(
      (a) =>
        `<section><h3>${esc(a.label)}</h3><p>${esc(a.text)}</p><p><em>${L.keywords}:</em> ${esc(a.keywords)}</p></section>`,
    )
    .join("");

  const body = doc.sections
    .map((s) => {
      const lis = s.blocks.filter((b) => b.kind === "li");
      const rest = s.blocks.filter((b) => b.kind !== "li");
      return `<section><h2>${esc(s.title)}</h2>${rest.map(blockHtml).join("")}${
        lis.length ? `<ul>${lis.map(blockHtml).join("")}</ul>` : ""
      }</section>`;
    })
    .join("");

  const tables = (doc.tables ?? [])
    .map((tb) => {
      const head = `<tr>${tb.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
      const rows = tb.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
      return `<section>${tb.caption ? `<h3>${esc(tb.caption)}</h3>` : ""}<table>${head}${rows}</table></section>`;
    })
    .join("");

  const refs = doc.references?.length
    ? `<section><h2>${L.references}</h2><ol>${doc.references.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></section>`
    : "";

  return `<!doctype html><html lang="${esc(meta.language || "uz")}"><head><meta charset="utf-8"/><title>${esc(meta.topic)}</title>
  <style>
    body{font-family:"Times New Roman",Times,serif;max-width:780px;margin:40px auto;line-height:1.6;color:#111}
    .cover{text-align:center;padding:36px 12px 28px}
    .caps{letter-spacing:.06em;font-size:13px;text-transform:uppercase}
    h1{font-size:20px;margin:40px 0 12px}
    h2{font-size:16px;margin:22px 0 10px}
    h3,h4{font-size:15px}
    p{text-align:justify;text-indent:1.25cm}
    .cover p,.cover h1,.cover h2,.meta p{text-indent:0}
    .meta{margin-top:56px;text-align:left;display:inline-block}
    table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
    td,th{border:1px solid #333;padding:6px 8px;vertical-align:top;text-align:left}
    ol,ul{padding-left:1.4em}
    pre{background:#f2f2f2;border:1px solid #ccc;padding:10px 12px;font-family:Consolas,monospace;font-size:13px;overflow:auto}
    .cap{text-align:center;font-style:italic;text-indent:0}
  </style></head><body>${cover}${toc}${abs}${body}${tables}${refs}</body></html>`;
}
