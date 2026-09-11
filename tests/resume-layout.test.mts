import test from "node:test";
import assert from "node:assert/strict";
import {
  RESUME_PATH_RE,
  editablePaths,
  planResume,
  zoneOf,
  type ResumeItem,
  type ResumeLayout,
} from "../lib/generation/resume/layout.ts";
import { RESUME_TEMPLATES, RESUME_TEMPLATE_IDS, type ResumeTemplateId, PHOTOLESS_TEMPLATE_IDS, PHOTO_TEMPLATE_IDS } from "../lib/generation/resume/templates.ts";
import { emptyResume, resumeLabels, type ResumeModel } from "../lib/generation/resume/model.ts";
import { sampleResume } from "../lib/generation/resume/samples.ts";

/**
 * REZYUME MAKETI — «ko'rdim = oldim» ning yagona manbasi.
 *
 * `planResume` natijasini IKKI chizuvchi o'qiydi (DOCX va ko'ruvchi),
 * shuning uchun bu yerdagi invariantlar — zona tarkibi, kenglik
 * yig'indisi, `path` shakli — ikkalasi uchun ham shartnoma. Sinov
 * matritsasi: 6 shablon × surat bor/yo'q × qisqa/uzun model.
 */

/** Qisqa model — faqat ism va qisqacha. */
const SHORT: ResumeModel = {
  ...emptyResume("uz"),
  identity: { fullName: "Karimova Dilnoza", headline: "" },
  contact: { phone: "", email: "", location: "" },
  summary: "Qisqa qisqacha.",
};

function variants(): { name: string; m: ResumeModel }[] {
  const out: { name: string; m: ResumeModel }[] = [];
  for (const id of RESUME_TEMPLATE_IDS) {
    for (const withPhoto of [true, false]) {
      out.push({ name: `${id}/uzun/${withPhoto ? "surat" : "suratsiz"}`, m: sampleResume(id, undefined, withPhoto) });
      const short: ResumeModel = { ...SHORT, template: id, palette: RESUME_TEMPLATES[id].defaultPalette };
      if (withPhoto && RESUME_TEMPLATES[id].photo) {
        short.photo = { url: "data:image/png;base64,AA", shape: RESUME_TEMPLATES[id].photo!.shape, assetId: "" };
      }
      out.push({ name: `${id}/qisqa/${withPhoto ? "surat" : "suratsiz"}`, m: short });
    }
  }
  return out;
}

const kinds = (items: ResumeItem[]) => items.map((i) => i.k);
const headings = (items: ResumeItem[]) => items.filter((i) => i.k === "h2").map((i) => (i as { section: string }).section);

// ───────────────────────────────────────────── umumiy invariantlar

test("6 shablon × surat × hajm: zonalar, kenglik va path shartnomasi", () => {
  for (const { name, m } of variants()) {
    const L = planResume(m);
    // Asosiy zona DOIM bor; sarlavha yoki panel — shablonga qarab.
    assert.ok(L.zones.some((z) => z.id === "main"), `${name}: main zonasi yo'q`);
    assert.ok(L.zones.length <= 3, `${name}: ortiqcha zona`);
    assert.deepEqual(L.pageMm, { w: 210, h: 297 }, `${name}: A4 emas`);

    // Kengliklar yig'indisi — chegaralar ichidagi to'liq kenglik.
    assert.equal(L.mainWidthMm + L.asideWidthMm, L.contentWidthMm, `${name}: kenglik yig'indisi buzildi`);
    assert.equal(L.contentWidthMm, 210 - L.template.marginsMm.left - L.template.marginsMm.right, `${name}: kontent kengligi chekinishga mos emas`);
    assert.ok(L.mainWidthMm > 60, `${name}: asosiy ustun juda tor (${L.mainWidthMm})`);

    // Har tahrirlanuvchi path modeldagi haqiqiy manzil shaklida.
    for (const p of editablePaths(L)) assert.match(p, RESUME_PATH_RE, `${name}: yaroqsiz path «${p}»`);

    // Surat: modelda bor bo'lsa AYNAN bitta item, shakli shablondan.
    const photos = L.zones.flatMap((z) => z.items).filter((i) => i.k === "photo");
    assert.equal(photos.length, m.photo ? 1 : 0, `${name}: surat itemi soni`);
    if (m.photo) {
      const p = photos[0] as { shape: string; sizeMm: number };
      assert.equal(p.shape, L.template.photo!.shape, `${name}: surat shakli shablondan olinmadi`);
      assert.equal(p.sizeMm, L.template.photo!.sizeMm);
      assert.equal(L.photo, true);
    } else {
      assert.equal(L.photo, false);
    }
  }
});

test("ikkinchi ustun SHABLON bo'yicha: panel, oddiy ustun yoki umuman yo'q", () => {
  for (const { name, m } of variants()) {
    const L = planResume(m);
    const t = L.template;
    const aside = zoneOf(L, "aside");
    const main = zoneOf(L, "main");
    const header = zoneOf(L, "header");
    if (t.columns === "sidebar-left" || t.columns === "sidebar-right") {
      assert.equal(L.asideKind, "panel", `${name}: rangli panel kutilgan`);
      /*
       * Panel `header: "aside"` bo'lganda HAR DOIM to'la (ism/aloqa u
       * yerda); `split` da esa panelda faqat bo'limlar bo'lgani uchun
       * qisqa rezyumeda u bo'sh qolishi mumkin.
       */
      if (t.header === "aside" || m.skills.length || m.languages.length) {
        assert.ok(aside.length > 0, `${name}: panelli shablonda aside bo'sh`);
      }
      assert.equal(L.asideWidthMm, t.sidebarMm);
      for (const id of t.asideSections) {
        assert.ok(!headings(main).includes(id), `${name}: «${id}» ikkala zonada`);
      }
      /*
       * Ism qayerda — `header` uslubiga bog'liq (AUDIT-16): `modern`/
       * `twocol` da panelda (`header: "aside"`), `split` da esa asosiy
       * ustun tepasida — shuning uchun alohida `header` zonasi bo'ladi.
       */
      if (t.header === "aside") {
        assert.ok(kinds(aside).includes("name"), `${name}: ism panelda bo'lishi kerak`);
        assert.equal(header.length, 0, `${name}: «aside» sarlavhada alohida header bo'lmaydi`);
      } else {
        assert.ok(kinds(header).includes("name"), `${name}: ism sarlavha zonasida bo'lishi kerak`);
      }
    } else if (t.columns === "split-main") {
      // Rangsiz ikkinchi ustun: bo'limlar taqsimlanadi, fon chizilmaydi.
      assert.equal(L.asideKind, "column", `${name}: rangsiz ustun kutilgan`);
      // Qisqa rezyumeda ko'nikma/til bo'lmasligi mumkin — u holda ikkinchi
      // ustun bo'sh qolishi TO'G'RI; talab faqat taqsimotga tegishli.
      if (m.skills.length || m.languages.length) {
        assert.ok(aside.length > 0, `${name}: ikkinchi ustun bo'sh`);
      }
      assert.ok(kinds(header).includes("name"), `${name}: ism sarlavhada bo'lishi kerak`);
      for (const id of t.asideSections) {
        assert.ok(!headings(main).includes(id), `${name}: «${id}» ikkala ustunda`);
      }
    } else {
      assert.equal(L.asideKind, "none", `${name}: bir ustunli shablon`);
      assert.equal(aside.length, 0, `${name}: bir ustunli shablonda aside bo'lmasligi kerak`);
      assert.equal(L.asideWidthMm, 0);
      assert.ok(kinds(header).includes("name"), `${name}: ism sarlavhada bo'lishi kerak`);
    }
  }
});

test("suratsiz shablonda surat maketga UMUMAN tushmaydi", () => {
  // Mahsulot qarori: 4 shablon (`ats`, `timeline`, `compact`, `letter`)
  // suratsiz; yuklangan surat ularda chizilmaydi.
  for (const id of PHOTOLESS_TEMPLATE_IDS) {
    const m = { ...sampleResume(id, undefined, false), photo: { url: "data:image/png;base64,AA", shape: "circle" as const, assetId: "" } };
    const L = planResume(m);
    assert.equal(L.photo, false, `${id}: suratsiz shablonda surat yoqildi`);
    const all = L.zones.flatMap((z) => z.items);
    assert.ok(!all.some((it) => it.k === "photo"), `${id}: surat itemi chiqdi`);
  }
  assert.equal(PHOTOLESS_TEMPLATE_IDS.length, 4);
  assert.equal(PHOTO_TEMPLATE_IDS.length, 6);
});


test("`order` hurmat qilinadi — asosiy ustun tartibi modeldan", () => {
  const base = sampleResume("ats");
  const a = headings(zoneOf(planResume(base), "main"));
  const flipped: ResumeModel = { ...base, order: ["skills", "education", "experience", "summary", "certificates", "languages", "links"] };
  const b = headings(zoneOf(planResume(flipped), "main"));
  assert.notDeepEqual(a, b, "tartib o'zgarmadi — `order` bezak maydon");
  assert.deepEqual(b.slice(0, 4), ["skills", "education", "experience", "summary"]);
  // Panelli shablonda paneldagi bo'limlar tartibga qo'shilmaydi.
  const modern: ResumeModel = { ...sampleResume("modern"), order: ["skills", "experience", "summary", "education", "certificates", "languages", "links"] };
  assert.deepEqual(headings(zoneOf(planResume(modern), "main")), ["experience", "summary", "education", "certificates"]);
});

test("bo'sh bo'lim sarlavhasi chizilmaydi (qisqa modelda faqat qisqacha)", () => {
  for (const id of RESUME_TEMPLATE_IDS) {
    const m: ResumeModel = { ...SHORT, template: id, palette: RESUME_TEMPLATES[id].defaultPalette };
    const L = planResume(m);
    const all = L.zones.flatMap((z) => z.items);
    assert.deepEqual(headings(zoneOf(L, "main")), ["summary"], `${id}: bo'sh bo'lim sarlavhasi chiqdi`);
    assert.ok(!all.some((i) => i.k === "chips"), `${id}: ko'nikma yo'q, chip chiqmasligi kerak`);
    assert.ok(!all.some((i) => i.k === "row"), `${id}: qator yo'q`);
    // Kontakt bo'sh — kontakt satri ham chizilmaydi.
    assert.ok(!all.some((i) => i.k === "contact"), `${id}: bo'sh kontakt chizildi`);
  }
});

// ───────────────────────────────────────────── path va item tafsilotlari

test("path lar model manzillari: qator, band, kontakt, havola, chip", () => {
  const L = planResume(sampleResume("modern"));
  const paths = editablePaths(L);
  assert.ok(paths.includes("identity.fullName"));
  assert.ok(paths.includes("identity.headline"));
  assert.ok(paths.includes("summary"));
  assert.ok(paths.includes("skills"));
  assert.ok(paths.includes("contact.phone") && paths.includes("contact.email") && paths.includes("contact.location"));
  assert.ok(paths.includes("experience.0.role") && paths.includes("experience.0.company"));
  assert.ok(paths.includes("experience.0.bullets.0.text"));
  assert.ok(paths.includes("education.0.degree") && paths.includes("education.0.institution"));
  assert.ok(paths.includes("certificates.0.name"));
  assert.ok(paths.includes("languages.0.language"));
  assert.ok(paths.includes("links.0.url"));
  // Takrorlanmagan/yaroqsiz shakl o'tmaydi.
  assert.ok(!RESUME_PATH_RE.test("experience.0.bullets.0"));
  assert.ok(!RESUME_PATH_RE.test("identity.email"));
  assert.ok(!RESUME_PATH_RE.test("skills.0"));
  assert.ok(!RESUME_PATH_RE.test("photo.url"));
});

test("qator itemi: davr yorliqdan, ai band bayrog'i uzatiladi", () => {
  const m: ResumeModel = {
    ...sampleResume("ats"),
    labels: { ...resumeLabels("uz"), present: "hozirgacha" },
    experience: [
      {
        id: "e1",
        company: "Artel",
        role: "Tahlilchi",
        start: "2021-03",
        end: "now",
        bullets: [{ text: "Foydalanuvchi bandi." }, { text: "AI qo‘shgan band.", ai: true }],
      },
    ],
  };
  const items = zoneOf(planResume(m), "main");
  const row = items.find((i) => i.k === "row") as { title: string; sub: string; period: string; path: string };
  assert.equal(row.title, "Tahlilchi");
  assert.equal(row.sub, "Artel");
  assert.equal(row.period, "mar 2021 – hozirgacha", "davr yorliqdan olinadi");
  assert.equal(row.path, "experience.0");
  const lis = items.filter((i) => i.k === "li") as { text: string; ai: boolean }[];
  assert.deepEqual(lis.map((l) => l.ai), [false, true], "ai bayrog'i maketga o'tmadi");
});

test("kontakt satri: telefon/pochta havolasi va tartib", () => {
  const L = planResume(sampleResume("modern"));
  const contact = zoneOf(L, "aside").find((i) => i.k === "contact") as { lines: { icon: string; text: string; href?: string }[] };
  assert.deepEqual(contact.lines.map((l) => l.icon), ["phone", "mail", "pin"]);
  assert.equal(contact.lines[0].href, "tel:+998901234567");
  assert.equal(contact.lines[1].href, "mailto:dilnoza.karimova@mail.uz");
  assert.equal(contact.lines[2].href, undefined, "joylashuv havola emas");
  // Havolalar alohida bo'lim — sxema olib tashlanadi.
  const links = zoneOf(L, "aside").filter((i) => i.k === "contact")[1] as { lines: { text: string; href?: string }[] };
  assert.equal(links.lines[0].text, "linkedin.com/in/dilnoza-karimova");
  assert.equal(links.lines[0].href, "https://linkedin.com/in/dilnoza-karimova");
});

test("palitra va tipografika shablondan keladi (chizuvchilar uchun yagona manba)", () => {
  for (const id of RESUME_TEMPLATE_IDS as readonly ResumeTemplateId[]) {
    const L: ResumeLayout = planResume(sampleResume(id));
    assert.equal(L.template.id, id);
    assert.equal(L.palette.id, RESUME_TEMPLATES[id].defaultPalette);
    for (const hex of [L.palette.accent, L.palette.dark, L.palette.ink, L.palette.panel, L.palette.onDark]) {
      assert.match(hex, /^[0-9A-F]{6}$/, `${id}: hex «#» siz bo'lishi kerak (DOCX ham, CSS ham shu shakldan)`);
    }
    assert.ok(L.template.type.body > 0 && L.template.type.line > 1);
  }
  // Aniq palitra tanlansa u ustun.
  assert.equal(planResume(sampleResume("modern", "forest")).palette.id, "forest");
});
