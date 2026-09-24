import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { ProSlideForm } from "../../components/forms/ProSlideForm.tsx";
import { TOOL_BY_ID, formatTanga, priceFor } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Ixcham slayd formasi (Formalar 2) — jsdom.
 *
 * Sinaladigan shartnoma: «Sozlamalar» yopiq holda joriy tanlovlar
 * ko'rinadi va tanlov o'zgarsa yangilanadi; slayder narxni darhol
 * o'zgartiradi (`priceFor` bilan bir xil); muallif maydonlari profildan
 * to'ladi.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Aliyev Ali", language: "uz", points: 0, quota: 0, balance: 100000, premium: false, plan: "free",
  university: "TDPU", faculty: "", department: "", group: "", course: "", author: "Aliyev Ali", subject: "Biologiya",
  teacher: "", city: "Toshkent", position: "Katta o‘qituvchi", organization: "",
};
function mount(kind: "slide" | "pro-slide") {
  const Form = kind === "slide" ? SlideForm : ProSlideForm;
  render(h(AppRouterContext.Provider, { value: router }, h(Form, { tool: TOOL_BY_ID[kind], profile })));
}
const chips = () => (document.querySelector("[data-summary-chips]")?.textContent ?? "");
const price = () => document.querySelector("[data-price]")?.textContent ?? "";
const slider = () => document.querySelector('input[type="range"]') as HTMLInputElement;

test("Sozlamalar yopiq: sarlavhada joriy tanlovlar (Avtomatik · Umumiy · 5 band · Standart · Testsiz · Titul · Reja · Izohlar)", () => {
  mount("slide");
  const d = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(d, "Sozlamalar details bo'lishi kerak");
  assert.equal(d.open, false, "standart holatda yopiq");
  for (const t of ["Avtomatik", "Umumiy taqdimot", "5 band", "Standart", "Testsiz", "Titul", "Reja", "Izohlar"]) {
    assert.ok(chips().includes(t), `«${t}» yig'iq sarlavhada bo'lishi kerak: ${chips()}`);
  }
  assert.ok(!chips().includes("Misollar") && !chips().includes("Internet"), "o'chiq kalitlar sarlavhada ko'rinmaydi");
});

test("tanlov o'zgarsa yig'iq sarlavha ergashadi: auditoriya select, test segmenti, titul kaliti", () => {
  mount("slide");
  fireEvent.change(screen.getByLabelText("Auditoriya"), { target: { value: "school_1_4" } });
  assert.ok(chips().includes("Boshlang‘ich sinf (1–4)") || chips().includes("1–4"), `auditoriya yangilanishi kerak: ${chips()}`);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "5" }));
  assert.ok(chips().includes("5 savol"), `test soni sarlavhada: ${chips()}`);
  fireEvent.click(screen.getByRole("switch", { name: "Titul slaydi" }));
  // MUTATSIYA: `settingsSummary` da `values[id] !== false` sharti buzilsa — «Titul» qoladi.
  assert.ok(!chips().includes("Titul"), `titul o'chirilgach sarlavhadan ketadi: ${chips()}`);
});

test("slayder narxni DARHOL o'zgartiradi — priceFor bilan bir xil (oddiy: 25 → 5 500, pro: 25 → 50 000)", () => {
  mount("slide");
  assert.equal(price(), formatTanga(priceFor(TOOL_BY_ID.slide, { slideCount: 10 })));
  fireEvent.change(slider(), { target: { value: "25" } });
  assert.equal(price(), formatTanga(5500));
  fireEvent.change(slider(), { target: { value: "30" } });
  assert.equal(price(), formatTanga(8000));
  cleanup();
  mount("pro-slide");
  fireEvent.change(slider(), { target: { value: "25" } });
  assert.equal(price(), formatTanga(50000));
});

test("muallif kartasi profildan to'ladi (tashkilot bo'lmasa universitet); pro'da lavozim ham", () => {
  mount("pro-slide");
  assert.equal((screen.getByLabelText("Muallif") as HTMLInputElement).value, "Aliyev Ali");
  assert.equal((screen.getByLabelText("Lavozim") as HTMLInputElement).value, "Katta o‘qituvchi");
  assert.equal((screen.getByLabelText("Tashkilot") as HTMLInputElement).value, "TDPU", "tashkilot bo'sh — universitet zaxira");
  assert.equal((screen.getByLabelText("Fan") as HTMLInputElement).value, "Biologiya");
  cleanup();
  mount("slide");
  assert.equal(screen.queryByLabelText("Lavozim") === null, true, "oddiyda lavozim yo'q");
  assert.equal(screen.queryByLabelText("Rasm uslubi") === null, true, "oddiyda rasm uslubi yo'q");
});

// ───────────────────── WP-E (AUDIT-24): qoralama, ColorDots, SourceFileRow ─────

test("qoralama: kirgan foydalanuvchida oldin saqlangan qiymatlar qayta ochilganda tiklanadi", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const realFetch = globalThis.fetch;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") {
      return json(200, { draft: { data: { topic: "Saqlangan mavzu", slideCount: 22 }, updatedAt: "now" } });
    }
    if (url === "/api/forms/slide/draft") return json(200, { ok: true, updatedAt: "now" });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  try {
    mount("slide");
    await waitFor(() => {
      assert.equal((screen.getByLabelText("Taqdimot mavzusini kiriting") as HTMLInputElement).value, "Saqlangan mavzu");
    });
    // MUTATSIYA: `restored` effekti `draft`ni qo'llamasa — yuqoridagi qator qizaradi.
    assert.equal(slider().value, "22", "slideCount ham qoralamadan tiklanadi");
  } finally {
    globalThis.fetch = realFetch;
    useAppStore.setState({ loggedIn: false, sessionChecked: false });
  }
});

test("Shablon va rang: rang tanlagich umumiy ColorDots — role=radio/aria-checked, bosilsa slideTheme o'zgaradi", () => {
  mount("slide");
  const group = screen.getByRole("radiogroup", { name: "Rang" });
  const radios = within(group).getAllByRole("radio");
  assert.ok(radios.length >= 6, "bir nechta mavzu bo'lishi kerak");
  const active = radios.find((r) => r.getAttribute("aria-checked") === "true");
  assert.ok(active, "standart mavzu (atlas) tanlangan ko'rinishi kerak");
  const next = radios.find((r) => r !== active)!;
  assert.equal(next.getAttribute("aria-checked"), "false");
  fireEvent.click(next);
  // MUTATSIYA: `ColorDots` ichida `aria-checked`/`role="radio"` olib tashlansa — bu ikki qator qizaradi.
  assert.equal(next.getAttribute("aria-checked"), "true", "bosilgan doira tanlangan holatga o'tadi");
  assert.equal(active!.getAttribute("aria-checked"), "false", "avvalgi tanlov bo'shaydi");
});

test("Fayl rejimi: umumiy SourceFileRow bitta qatorda — matn sourceText ga tushadi, mavzu bo'sh bo'lsa fayl nomidan to'ladi", async () => {
  const EXTRACTED = "Fayldan olingan matn";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text: EXTRACTED }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    mount("slide");
    fireEvent.click(screen.getByRole("tab", { name: "Fayl asosida" }));
    const input = screen.getByLabelText("Fayl biriktirish") as HTMLInputElement;
    const file = new File(["x"], "mavzu-fayli.docx");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => assert.ok(screen.getByText("mavzu-fayli.docx")));
    await waitFor(() => assert.ok(screen.getByText(`${EXTRACTED.length.toLocaleString("uz-UZ")} belgi`)), { timeout: 3000 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ───────────────────── AUDIT-25 P4: planItems sig'im (planCapacity) ─────────
// Reviewer AUDIT-25-P4 (CHANGES) 2026-09-24 dagi tuzatishlar: qavat 1 (stub
// `effectivePlanItems`), chegara sinovlari (item 3/4), simlanish sinovi
// (item 5), `Segmented`ga o'tish (item 6), tooltip/hint/apostrof (item 7).

const planHint = () => document.querySelector("[data-plan-capacity-hint]")?.textContent ?? "";
const planGroup = () => screen.getByRole("radiogroup", { name: "Reja bandlari" });
const planTooltip = () => (planGroup().closest(".grid") as HTMLElement).querySelector("[title]")?.getAttribute("title") ?? "";
const checkedRadios = () => within(planGroup()).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");

test("sig'im yetganda barcha variant yoqilgan; past bo'lsa yuqorilari o'chadi, qiymat sig'imga tushadi, «1» o'zi o'chmaydi", () => {
  mount("slide");
  // Standart: slideCount=10, blocks=["reja"] (yemaydigan blok yo'q), agendaSlide=true → sig'im 10-2-1=7, hammasi yoqilgan.
  for (const n of ["3", "4", "5", "6"]) {
    assert.equal(within(planGroup()).getByRole("radio", { name: n }).getAttribute("aria-disabled"), "false", `${n}: boshida yoqilgan bo'lishi kerak`);
  }
  assert.equal(planHint(), "", "sig'im yetganda izoh chiqmasligi kerak");
  // Slayder minimal (4) ga tushiriladi: sig'im = 4 - 2 - 1 (reja slaydi) - 0 = 1.
  fireEvent.change(slider(), { target: { value: "4" } });
  const six = within(planGroup()).getByRole("radio", { name: "6" });
  assert.equal(six.getAttribute("aria-disabled"), "true", "6 band 1 ga sig'im bo'lganda o'chgan bo'lishi kerak");
  assert.ok((six as HTMLButtonElement).disabled, "o'chgan variant haqiqatan ham disabled");
  const one = within(planGroup()).getByRole("radio", { name: "1" });
  // MUTATSIYA (review CHANGES-3): `n > capacity` → `n >= capacity` bo'lsa, sig'im 1 dagi YAGONA yaroqli variant «1» ham o'chib qoladi.
  assert.equal(one.getAttribute("aria-disabled"), "false", "sig'imga aynan teng variant («1» sig'im 1 da) o'chmasligi kerak");
  assert.equal(one.getAttribute("aria-checked"), "true", "joriy (standart 5) sig'imga (1) tushirilib ko'rsatilishi kerak");
  assert.equal(planHint(), "Tanlangan 5 band sig‘maydi — 1 band yoziladi.", `izoh matni: «${planHint()}»`);
  // Yig'iq sarlavha ham SAMARALI (qisilgan) qiymatni ko'rsatishi kerak — server aynan shunday yozadi.
  assert.ok(chips().includes("1 band"), `yig'iq sarlavha samarali qiymatni ko'rsatishi kerak: ${chips()}`);
  assert.ok(!chips().includes("5 band"), `yig'iq sarlavha eski (qisilmagan) qiymatni ko'rsatmasligi kerak: ${chips()}`);
  // Slayder qaytarilsa (30) — sig'im yana yetadi, izoh yo'qoladi, standart 5 band qayta ko'rinadi (foydalanuvchi hech qachon «1»ni bosmagan edi).
  fireEvent.change(slider(), { target: { value: "30" } });
  assert.equal(planHint(), "", "sig'im qayta yetganda izoh yo'qolishi kerak");
  assert.equal(within(planGroup()).getByRole("radio", { name: "6" }).getAttribute("aria-disabled"), "false", "sig'im qaytgach variantlar qayta yoqiladi");
  assert.equal(within(planGroup()).getByRole("radio", { name: "5" }).getAttribute("aria-checked"), "true", "planItems o'zi o'zgarmagan edi (5) — endi sig'gani uchun ko'rinadi");
});

test("sig'im 3 dan kichik bo'lsa variantlar 1 gacha kengayadi", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // sig'im = 1
  const values = within(planGroup())
    .getAllByRole("radio")
    .map((r) => r.textContent);
  assert.deepEqual(values, ["1", "2", "3", "4", "5", "6"], `variantlar 1 dan boshlab kengaygan bo'lishi kerak: ${values.join(",")}`);
});

test("chegara: sig'im aynan 4 bo'lganda «4» yoqilgan, «5» o'chgan; yoqilgan variantni bosish HAQIQATAN chip'ni o'zgartiradi", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "7" } }); // sig'im = 7-2-1-0 = 4
  assert.equal(within(planGroup()).getByRole("radio", { name: "4" }).getAttribute("aria-disabled"), "false", "sig'imga teng variant yoqilgan bo'lishi kerak");
  assert.equal(within(planGroup()).getByRole("radio", { name: "5" }).getAttribute("aria-disabled"), "true", "sig'imdan katta variant o'chgan bo'lishi kerak");
  assert.ok(chips().includes("4 band"), `standart (5) sig'im 4 ga qisilgach: ${chips()}`);
  // «3» ham yoqilgan (< sig'im) — uni bosish HAQIQIY tanlov, «4» dan farqli natija berishi kerak.
  fireEvent.click(within(planGroup()).getByRole("radio", { name: "3" }));
  assert.equal(within(planGroup()).getByRole("radio", { name: "3" }).getAttribute("aria-checked"), "true");
  assert.equal(within(planGroup()).getByRole("radio", { name: "4" }).getAttribute("aria-checked"), "false");
  assert.ok(chips().includes("3 band"), `«3» bosilgach chip yangilanishi kerak: ${chips()}`);
});

test("qavat 1 (review CHANGES-1): «1»ni bosib tanlash sig'im keyin katta bo'lsa ham saqlanadi — aynan bitta radio belgilangan va u chip bilan mos", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // sig'im = 1
  fireEvent.click(within(planGroup()).getByRole("radio", { name: "1" })); // haqiqiy, ongli tanlov — raw=1 saqlanadi
  fireEvent.change(slider(), { target: { value: "30" } }); // sig'im katta (27) — «1» endi ham to'liq yaroqli tanlov
  const checked = checkedRadios();
  assert.equal(checked.length, 1, `aynan bitta radio belgilangan bo'lishi kerak: ${checked.map((r) => r.textContent).join(",")}`);
  const label = checked[0].textContent ?? "";
  assert.equal(label, "1", "ongli tanlangan «1» standart (5) ga qaytmasligi kerak");
  assert.ok(chips().includes(`${label} band`), `chip belgilangan radio bilan mos bo'lishi kerak: ${chips()}`);
});

test("native disabled (review CHANGES-4): o'chgan variantni bosish HECH NARSANI o'zgartirmaydi — sig'im qaytgach standart (5) qoladi, bosilgan (4) emas", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // sig'im = 1
  const four = within(planGroup()).getByRole("radio", { name: "4" });
  assert.ok((four as HTMLButtonElement).disabled, "«4» sig'im 1 da disabled bo'lishi kerak");
  fireEvent.click(four); // disabled tugma — hech narsa o'zgarmasligi kerak
  assert.ok(chips().includes("1 band"), `o'chgan variant bosilgach ham 1 band qolishi kerak: ${chips()}`);
  // MUTATSIYA (review CHANGES-4): `disabled={disabled}` olib tashlansa, klik `planItems=4` yozadi — sig'im qaytganda «4» chiqadi, «5» emas.
  fireEvent.change(slider(), { target: { value: "30" } });
  assert.equal(within(planGroup()).getByRole("radio", { name: "5" }).getAttribute("aria-checked"), "true", "standart (5) o'zgarmagan bo'lishi kerak");
  assert.equal(within(planGroup()).getByRole("radio", { name: "4" }).getAttribute("aria-checked"), "false", "o'chgan variantga bosish saqlanmasligi kerak");
  assert.ok(chips().includes("5 band"), `chip standart qiymatga qaytishi kerak: ${chips()}`);
});

test("tooltip izohi (A3-06): «har biri o‘z slaydi bilan», raqam 6 dan oshmaydi, tirik yangilanadi", () => {
  mount("slide");
  // Standart: slideCount=10 → sig'im 7, lekin ko'rsatiladigan raqam max variantdan (6) oshmaydi.
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 10 slaydga 6 band sig‘adi.", `tooltip: «${planTooltip()}»`);
  fireEvent.change(slider(), { target: { value: "4" } });
  // MUTATSIYA: hint statik qolsa (eski matn yoki eski slideCount/sig'im) — bu qator qizaradi.
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 4 slaydga 1 band sig‘adi.", `tooltip yangilanmadi: «${planTooltip()}»`);
});

test("simlanish (review CHANGES-5): «Reja slaydi» o'chirilsa sig'im +1, «Nazorat testi» yoqilsa −1", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "7" } }); // sig'im = 7-2-1-0 = 4
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 4 band sig‘adi.", `boshlang'ich: «${planTooltip()}»`);
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // agendaSlide: true → false, reserved -1 → sig'im +1
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 5 band sig‘adi.", `«Reja slaydi» o'chgach: «${planTooltip()}»`);
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // qaytarish — sanity: 4 ga qaytadi
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 4 band sig‘adi.", "«Reja slaydi» qaytarilgach asl holatga qaytishi kerak");
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "3" })); // quizCount: 0 → 3, "test" bloki qo'shiladi → -1
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 3 band sig‘adi.", `«Nazorat testi» yoqilgach: «${planTooltip()}»`);
});

// AUDIT-25: P1 merge'dan keyin yoqiladi — real `planCapacity`/`effectivePlanItems` bilan pro-slide standart 12 slayd sig'imini tekshiradi.
test("TODO (P1 merge'dan keyin): pro-slide standart 12 slayd → tooltip «12 slaydga 9 band sig‘adi»", { skip: "AUDIT-25: stub formula P1 dvigateli bilan mos emas — merge'da yoqiladi" }, () => {
  mount("pro-slide");
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 12 slaydga 9 band sig‘adi.");
});

// ───────── AUDIT-25 P1 A3-01/A3-02: quizCount/agendaSlide FAQAT tegilganda yuboriladi ─────────
// Server endi ANIQ 0/`false`ni "aniq yo'q" deb o'qiydi; tegilmagan (`undefined`)
// bo'lsa taqdimot turi standartidan (`test`/`reja` blok bor-yo'qligi) o'zi
// hisoblaydi. Forma shu sabab bu ikki maydonni foydalanuvchi tegmaguncha
// umuman yubormasligi kerak (`JSON.stringify` `undefined` kalitni tashlaydi).

/** POST /api/generations ni ushlab, yuborilgan `values` obyektini qaytaradi — boshqa so'rovlar zararsiz 404. */
function captureSubmittedValues(): { posts: Record<string, unknown>[]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    if (url === "/api/generations" && (opts?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(opts?.body ?? "{}")) as { values?: Record<string, unknown> };
      posts.push(body.values ?? {});
      return new Response(JSON.stringify({ id: "gen1", price: 1000, status: "QUEUED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as typeof fetch;
  return {
    posts,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

function fillTopicAndSubmit(tool: "slide" | "pro-slide") {
  const t = TOOL_BY_ID[tool];
  fireEvent.change(screen.getByPlaceholderText(t.topicPlaceholder ?? ""), { target: { value: "Mavzu" } });
  // Accessible nomga narx ham qo'shiladi (`<span>{price}</span>`) — aniq emas, qism moslik bilan qidiramiz.
  fireEvent.click(screen.getByRole("button", { name: new RegExp(String(t.submitLabel)) }));
}

test("boshlang'ich pro-slide (open_lesson) so'rovida quizCount/agendaSlide kaliti YO'Q — tegilmagan", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("pro-slide");
    // «Ochiq dars / attestatsiya» — standart bloklarida HAM «test», HAM «reja» bor,
    // lekin foydalanuvchi «Nazorat testi»/«Reja slaydi»ga hali tegmagan.
    fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "open_lesson" } });
    fillTopicAndSubmit("pro-slide");
    await waitFor(() => assert.ok(cap.posts.length > 0, "so'rov yuborilishi kerak"));
    const sent = cap.posts[0];
    // MUTATSIYA: `SlideComposer` `initialValues` ga `quizCount: 0`/`agendaSlide: true` qaytarilsa — bu ikki qator qizaradi.
    assert.ok(!("quizCount" in sent), `quizCount kaliti bo'lmasligi kerak: ${JSON.stringify(sent)}`);
    assert.ok(!("agendaSlide" in sent), `agendaSlide kaliti bo'lmasligi kerak: ${JSON.stringify(sent)}`);
  } finally {
    cap.restore();
  }
});

test("«Tuzilma bloklari»da «Test» yoqilsa (Nazorat testi tegilmagan holda) quizCount=3 (QUIZ_COUNT_FALLBACK) yuboriladi", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("pro-slide"); // standart taqdimot turi «Umumiy» — bloklarida «test» YO'Q
    fireEvent.click(screen.getByRole("button", { name: "Test" })); // «Tuzilma bloklari» chip'i
    fillTopicAndSubmit("pro-slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].quizCount, 3, `blok orqali yoqilgan test 3 yuborishi kerak: ${JSON.stringify(cap.posts[0])}`);
  } finally {
    cap.restore();
  }
});

test("«Testsiz» chip'i bosilsa quizCount ANIQ 0 yuboriladi", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("pro-slide");
    fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "open_lesson" } }); // standartida test bor
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "Testsiz" }));
    fillTopicAndSubmit("pro-slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].quizCount, 0, `«Testsiz» ANIQ 0 yuborishi kerak: ${JSON.stringify(cap.posts[0])}`);
    assert.ok("quizCount" in cap.posts[0], "quizCount kaliti ANIQ 0 bilan bo'lishi kerak — yo'q bo'lib qolmasligi kerak");
  } finally {
    cap.restore();
  }
});

test("«Reja slaydi» o'chirilsa agendaSlide ANIQ false yuboriladi", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("slide");
    fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" }));
    fillTopicAndSubmit("slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].agendaSlide, false, `«Reja slaydi» o'chirilgach ANIQ false yuborishi kerak: ${JSON.stringify(cap.posts[0])}`);
  } finally {
    cap.restore();
  }
});

test("sig'im yetganda variant bosilsa oddiy tanlov ishlaydi (regressiya)", () => {
  mount("slide"); // standart sig'im 7 — hammasi yoqilgan
  fireEvent.click(within(planGroup()).getByRole("radio", { name: "6" }));
  assert.ok(chips().includes("6 band"), `6 tanlangach yig'iq sarlavhada ko'rinishi kerak: ${chips()}`);
  assert.equal(planHint(), "", "sig'gan tanlovda izoh chiqmaydi");
});

test("qoralama PUT tanasida sourceText/logoAssetId/templateAssetId YO'Q (katta matn va sessiyaga bog'liq aktivlar saqlanmaydi)", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const puts: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") return json(200, { draft: null });
    if (url === "/api/forms/slide/draft") {
      puts.push((JSON.parse(String(opts?.body ?? "{}")) as { data?: Record<string, unknown> }).data ?? {});
      return json(200, { ok: true, updatedAt: "now" });
    }
    return json(200, {});
  }) as typeof fetch;
  try {
    render(h(AppRouterContext.Provider, { value: router }, h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
    const topic = (await screen.findByPlaceholderText(TOOL_BY_ID.slide.topicPlaceholder ?? "")) as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "Qoralama sinovi" } });
    await waitFor(() => assert.ok(puts.length > 0, "qoralama saqlandi"), { timeout: 5000 });
    const last = puts[puts.length - 1];
    assert.equal(last.topic, "Qoralama sinovi");
    // MUTATSIYA: `draftOf` o'rniga `save(values)` qaytarilsa — uchala kalit tanada paydo bo'lib, qizaradi.
    for (const k of ["sourceText", "logoAssetId", "templateAssetId"]) assert.ok(!(k in last), `${k} qoralamaga tushmasin`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
