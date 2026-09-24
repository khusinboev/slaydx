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

test("Sozlamalar yopiq: sarlavhada joriy tanlovlar (Avtomatik · Umumiy · 3 band · Standart · Testsiz · Titul · Reja · Izohlar)", () => {
  mount("slide");
  const d = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(d, "Sozlamalar details bo'lishi kerak");
  assert.equal(d.open, false, "standart holatda yopiq");
  // AUDIT-25 N3: `planItems` endi yubormaydi — standart 10 slaydga moslashuvchan `defaultPlanItems(10)` = 3 (qattiq 5 emas).
  for (const t of ["Avtomatik", "Umumiy taqdimot", "3 band", "Standart", "Testsiz", "Titul", "Reja", "Izohlar"]) {
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
// Reviewer AUDIT-25-P4 (CHANGES + re-review) dagi tuzatishlar: qavat 1
// (`effectivePlanItems`), chegara sinovlari (item 3/4), simlanish sinovi
// (item 5), `Segmented`ga o'tish (item 6), tooltip/hint/apostrof (item 7),
// N1 (blocks faqat pro-slayd), N2 (bloklar ⇄ quizCount/agendaSlide ikki
// tomonlama sinxron), N3 (moslashuvchan standart), N4 (defense+8 yoqildi).
// P1 merge'dan keyin — HAQIQIY `lib/generation/slide-params.ts` dvigateli
// (planCapacity/effectivePlanItems/defaultPlanItems/resolvePlanFlags/
// activeBlockIds), stub emas.

const planHint = () => document.querySelector("[data-plan-capacity-hint]")?.textContent ?? "";
const planGroup = () => screen.getByRole("radiogroup", { name: "Reja bandlari" });
const planTooltip = () => (planGroup().closest(".grid") as HTMLElement).querySelector("[title]")?.getAttribute("title") ?? "";
const checkedRadios = () => within(planGroup()).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");

test("sig'im yetganda barcha variant yoqilgan; past bo'lsa yuqorilari o'chadi, standart (tanlanmagan) qiymat sig'imga tushadi, «1» o'zi o'chmaydi, izoh chiqmaydi", () => {
  mount("slide");
  // Standart: slideCount=10, blocks=["reja"] (test yo'q), agendaSlide=true → bodyWant=10-titul(1)-yakun(1)=8, room=8-agenda(1)=7, hammasi yoqilgan.
  // planItems TEGILMAGAN — standart `defaultPlanItems(10)` = 3 (AUDIT-25 N3: moslashuvchan, qattiq 5 emas).
  for (const n of ["3", "4", "5", "6"]) {
    assert.ok(!within(planGroup()).getByRole("radio", { name: n }).hasAttribute("aria-disabled"), `${n}: boshida yoqilgan bo'lishi kerak (aria-disabled yo'q)`);
  }
  assert.equal(within(planGroup()).getByRole("radio", { name: "3" }).getAttribute("aria-checked"), "true", "tegilmagan standart defaultPlanItems(10)=3 bo'lishi kerak");
  assert.equal(planHint(), "", "sig'im yetganda izoh chiqmasligi kerak");
  // Slayder minimal (4) ga tushiriladi: bodyWant=4-1-1=2, room=2-agenda(1)=1. Standart QAYTA hisoblanadi: defaultPlanItems(4)=3.
  fireEvent.change(slider(), { target: { value: "4" } });
  const six = within(planGroup()).getByRole("radio", { name: "6" });
  assert.equal(six.getAttribute("aria-disabled"), "true", "6 band 1 ga sig'im bo'lganda o'chgan bo'lishi kerak");
  assert.ok((six as HTMLButtonElement).disabled, "o'chgan variant haqiqatan ham disabled");
  const one = within(planGroup()).getByRole("radio", { name: "1" });
  // MUTATSIYA (review CHANGES-3): `n > capacity` → `n >= capacity` bo'lsa, sig'im 1 dagi YAGONA yaroqli variant «1» ham o'chib qoladi.
  assert.ok(!one.hasAttribute("aria-disabled"), "sig'imga aynan teng variant («1» sig'im 1 da) o'chmasligi kerak");
  assert.equal(one.getAttribute("aria-checked"), "true", "tegilmagan standart (3) sig'imga (1) tushirilib ko'rsatilishi kerak");
  // AUDIT-25 N3: foydalanuvchi HECH QACHON tanlamagan — «Tanlangan …» izohi haqiqatga to'g'ri kelmaydi, shu sabab chiqmaydi.
  assert.equal(planHint(), "", "standart (tanlanmagan) qiymat qisilganda ham izoh chiqmasligi kerak");
  // Yig'iq sarlavha ham SAMARALI (qisilgan) qiymatni ko'rsatishi kerak — server aynan shunday yozadi.
  assert.ok(chips().includes("1 band"), `yig'iq sarlavha samarali qiymatni ko'rsatishi kerak: ${chips()}`);
  assert.ok(!chips().includes("3 band"), `yig'iq sarlavha eski (qisilmagan) standart qiymatni ko'rsatmasligi kerak: ${chips()}`);
  // Slayder qaytarilsa (30) — sig'im yana yetadi, standart QAYTA hisoblanadi: defaultPlanItems(30)=6 (foydalanuvchi hech qachon tegmagan edi).
  fireEvent.change(slider(), { target: { value: "30" } });
  assert.equal(planHint(), "", "sig'im qayta yetganda izoh yo'qolishi kerak");
  assert.ok(!within(planGroup()).getByRole("radio", { name: "6" }).hasAttribute("aria-disabled"), "sig'im qaytgach variantlar qayta yoqiladi");
  assert.equal(within(planGroup()).getByRole("radio", { name: "6" }).getAttribute("aria-checked"), "true", "planItems tegilmagan edi — 30 slaydga standart endi defaultPlanItems(30)=6");
});

test("sig'im 3 dan kichik bo'lsa variantlar 1 gacha kengayadi", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // sig'im = 1
  const values = within(planGroup())
    .getAllByRole("radio")
    .map((r) => r.textContent);
  assert.deepEqual(values, ["1", "2", "3", "4", "5", "6"], `variantlar 1 dan boshlab kengaygan bo'lishi kerak: ${values.join(",")}`);
});

test("chegara: sig'im aynan 4 bo'lganda «4» yoqilgan, «5» o'chgan; standart (tanlanmagan) «3»da turadi, uni haqiqiy tanlov bilan almashtirish chip'ni o'zgartiradi", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "7" } }); // bodyWant=7-1-1=5, room=5-agenda(1)=4; standart planItems = defaultPlanItems(7) = 3 (tegilmagan)
  assert.ok(!within(planGroup()).getByRole("radio", { name: "4" }).hasAttribute("aria-disabled"), "sig'imga teng variant yoqilgan bo'lishi kerak");
  assert.equal(within(planGroup()).getByRole("radio", { name: "5" }).getAttribute("aria-disabled"), "true", "sig'imdan katta variant o'chgan bo'lishi kerak");
  assert.equal(within(planGroup()).getByRole("radio", { name: "3" }).getAttribute("aria-checked"), "true", "tegilmagan standart defaultPlanItems(7)=3 bo'lishi kerak");
  assert.ok(chips().includes("3 band"), `standart (tanlanmagan, defaultPlanItems(7)=3) sig'imga (4) sig'gani uchun o'zgarishsiz: ${chips()}`);
  // «4»ni bosish — HAQIQIY, ONGLI tanlov: «3» standart edi (bosish no-op bo'lardi), «4» farqli natija berishi kerak.
  fireEvent.click(within(planGroup()).getByRole("radio", { name: "4" }));
  assert.equal(within(planGroup()).getByRole("radio", { name: "4" }).getAttribute("aria-checked"), "true");
  assert.equal(within(planGroup()).getByRole("radio", { name: "3" }).getAttribute("aria-checked"), "false");
  assert.ok(chips().includes("4 band"), `«4» bosilgach chip yangilanishi kerak: ${chips()}`);
});

test("qavat 1 (review CHANGES-1): «1»ni bosib tanlash sig'im keyin katta bo'lsa ham saqlanadi — aynan bitta radio belgilangan va u chip bilan mos", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // sig'im = 1
  fireEvent.click(within(planGroup()).getByRole("radio", { name: "1" })); // haqiqiy, ongli tanlov — raw=1 saqlanadi
  fireEvent.change(slider(), { target: { value: "30" } }); // sig'im katta (27) — «1» endi ham to'liq yaroqli tanlov
  const checked = checkedRadios();
  assert.equal(checked.length, 1, `aynan bitta radio belgilangan bo'lishi kerak: ${checked.map((r) => r.textContent).join(",")}`);
  const label = checked[0].textContent ?? "";
  assert.equal(label, "1", "ongli tanlangan «1» tegilmagan standart qiymatga qaytmasligi kerak");
  assert.ok(chips().includes(`${label} band`), `chip belgilangan radio bilan mos bo'lishi kerak: ${chips()}`);
});

test("native disabled (review CHANGES-4): o'chgan variantni bosish HECH NARSANI o'zgartirmaydi — sig'im qaytgach standart (tegilmagan) qiymat qoladi, bosilgan (4) emas", () => {
  mount("slide");
  fireEvent.change(slider(), { target: { value: "4" } }); // bodyWant=4-1-1=2, room=2-agenda(1)=1; standart planItems = defaultPlanItems(4) = 3 (tegilmagan)
  const four = within(planGroup()).getByRole("radio", { name: "4" });
  assert.ok((four as HTMLButtonElement).disabled, "«4» sig'im 1 da disabled bo'lishi kerak");
  fireEvent.click(four); // disabled tugma — hech narsa o'zgarmasligi kerak
  assert.ok(chips().includes("1 band"), `o'chgan variant bosilgach ham 1 band qolishi kerak: ${chips()}`);
  // MUTATSIYA (review CHANGES-4): `disabled={disabled}` olib tashlansa, klik `planItems=4` yozadi — sig'im qaytganda «4» chiqadi, standart (6) emas.
  fireEvent.change(slider(), { target: { value: "30" } });
  // planItems HALI HAM tegilmagan (disabled klik hech narsa yozmadi) — standart QAYTA hisoblanadi: defaultPlanItems(30) = 6.
  assert.equal(within(planGroup()).getByRole("radio", { name: "6" }).getAttribute("aria-checked"), "true", "tegilmagan standart (defaultPlanItems(30)=6) ko'rinishi kerak edi");
  assert.equal(within(planGroup()).getByRole("radio", { name: "4" }).getAttribute("aria-checked"), "false", "o'chgan variantga bosish saqlanmasligi kerak");
  assert.ok(chips().includes("6 band"), `chip standart (tegilmagan) qiymatga mos bo'lishi kerak: ${chips()}`);
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
  fireEvent.change(slider(), { target: { value: "7" } }); // bodyWant=7-1-1=5, room=5-agenda(1)=4
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 4 band sig‘adi.", `boshlang'ich: «${planTooltip()}»`);
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // agendaSlide: true → false, reserved -1 → sig'im +1
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 5 band sig‘adi.", `«Reja slaydi» o'chgach: «${planTooltip()}»`);
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // qaytarish — sanity: 4 ga qaytadi
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 4 band sig‘adi.", "«Reja slaydi» qaytarilgach asl holatga qaytishi kerak");
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "3" })); // quizCount: 0 → 3, "test" bloki qo'shiladi → -1
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 7 slaydga 3 band sig‘adi.", `«Nazorat testi» yoqilgach: «${planTooltip()}»`);
});

// AUDIT-25 N4 (reviewer, re-review 8e4603e) — YOQILDI (P1 swap, real dvigatel bilan tekshirildi):
// pro-slide + «Himoya» (defense, blocks=[reja,diagramma,jadval,adabiyotlar], «test» yo'q) + 8 slayd.
// Real hisob: bodyWant = 8 - titul(1) - yakun(1) = 6; on = {reja,diagramma,jadval,adabiyotlar}
// («test» yo'q); agenda = on.has(reja) && agendaSlide!==false = true; room = 6 - test(0) - agenda(1) = 5.
// capacity = 5 — aynan shu qiymat, «6» esa 5 dan katta bo'lgani uchun o'chgan.
test("pro-slide + Himoya (defense) + 8 slayd → tooltip «8 slaydga 5 band sig‘adi», «6» o'chgan", () => {
  mount("pro-slide");
  fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "defense" } });
  fireEvent.change(slider(), { target: { value: "8" } });
  assert.equal(planTooltip(), "Reja bandlari — har biri o‘z slaydi bilan; 8 slaydga 5 band sig‘adi.");
  assert.equal(within(planGroup()).getByRole("radio", { name: "6" }).getAttribute("aria-disabled"), "true");
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
    assert.ok(String(cap.posts[0].blocks ?? "").split(",").includes("test"), `blocks «test»ni o'z ichiga olishi kerak: ${JSON.stringify(cap.posts[0])}`);
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
    // AUDIT-25 N2a: pro-slaydda `blocks` ham «test»siz bo'lishi kerak — aks holda `resolvePlanFlags`
    // ANIQ 0ni neytrallab, «Testsiz» dekorativ bo'lib qolardi (re-review 8e4603e, (a)).
    assert.ok(!String(cap.posts[0].blocks ?? "").split(",").includes("test"), `blocks «test»siz bo'lishi kerak: ${JSON.stringify(cap.posts[0])}`);
  } finally {
    cap.restore();
  }
});

test("N2b: «Test» chipini yoqib keyin o'chirsa — quizCount 0ga qaytadi, chip va son sinxron", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("pro-slide"); // standart «Umumiy» — bloklarida «test» yo'q
    const testChip = screen.getByRole("button", { name: "Test" });
    fireEvent.click(testChip); // yoqish — avtomatik quizCount=3
    assert.equal(
      within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "3" }).getAttribute("aria-checked"),
      "true",
      "chip yoqilgach «3» belgilangan bo'lishi kerak",
    );
    fireEvent.click(testChip); // o'chirish
    assert.equal(testChip.getAttribute("aria-pressed"), "false", "chip o'chgan bo'lishi kerak");
    // MUTATSIYA (N2): blocks-onChange'dagi «!hasTestNow && hadTest → quizCount:0» qatori olib tashlansa — bu ikki qator qizaradi.
    assert.equal(
      within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "Testsiz" }).getAttribute("aria-checked"),
      "true",
      "chip o'chgach «Testsiz» ko'rinishi kerak — eskicha «3» qolib ketmasligi kerak",
    );
    fillTopicAndSubmit("pro-slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].quizCount, 0, `chip o'chgach quizCount 0 yuborishi kerak: ${JSON.stringify(cap.posts[0])}`);
    assert.ok(!String(cap.posts[0].blocks ?? "").split(",").includes("test"), `blocks «test»siz bo'lishi kerak: ${JSON.stringify(cap.posts[0])}`);
  } finally {
    cap.restore();
  }
});

test("N2a (teskari yo'nalish): «Nazorat testi»da son tanlansa (pro-slide) «Test» chipi HAM yonadi", () => {
  mount("pro-slide"); // standart «Umumiy» — bloklarida «test» yo'q
  const testChip = screen.getByRole("button", { name: "Test" });
  assert.equal(testChip.getAttribute("aria-pressed"), "false", "boshida o'chgan bo'lishi kerak");
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "5" }));
  // MUTATSIYA (N2): quizCount-onChange'dagi blocks-sinxron qatorlari olib tashlansa — bu qator qizaradi.
  assert.equal(testChip.getAttribute("aria-pressed"), "true", "son tanlangach «Test» chipi HAM yonishi kerak");
});

test("N2c: «Reja» chipi o'chirilsa — «Reja slaydi» kaliti HAM o'chgan ko'rinadi (switch chip bilan sinxron)", () => {
  mount("pro-slide"); // standart «Umumiy» — bloklarida «reja» bor
  assert.equal(screen.getByRole("switch", { name: "Reja slaydi" }).getAttribute("aria-checked"), "true", "boshida yoqilgan bo'lishi kerak");
  fireEvent.click(screen.getByRole("button", { name: "Reja" })); // «Tuzilma bloklari» chip'ini o'chiramiz
  /*
   * Tekshiruv: `resolvedAgendaSlide` `blocks`dan JONLI o'qiydi (kesh emas) — chip o'chishi
   * bilanoq «reja» `blocks`dan chiqadi va kalit HAM o'chadi. Diqqat (final review caf9fcb,
   * «Notes»): buni ta'minlaydigan qator `blocks`-onChange'dagi `set("blocks", ...)`ning o'zi
   * (`activeBlockIds` «reja»ni FAQAT `agendaSlide===true`da qo'shadi, hech qachon olib
   * tashlamaydi) — pastroqdagi `set("agendaSlide", false)` sinxron qatori bu aniq ssenariyda
   * ORTIQCHA (blocks allaqachon «reja»siz); u F1/stiklik holatlari uchun kerak, bu test uchun
   * emas. Shu sabab shu qatorni MUTATSIYA sifatida sinamaymiz — pastdagi F1 testlari sinaydi.
   */
  assert.equal(screen.getByRole("switch", { name: "Reja slaydi" }).getAttribute("aria-checked"), "false", "chip o'chgach kalit HAM o'chgan ko'rinishi kerak (re-review 8e4603e, (c))");
});

test("N2d: «Reja» chipi o'chgan holda «Reja slaydi» kaliti yoqilsa — chip HAM qayta yonadi", () => {
  mount("pro-slide");
  fireEvent.click(screen.getByRole("button", { name: "Reja" })); // avval o'chiramiz
  assert.equal(screen.getByRole("button", { name: "Reja" }).getAttribute("aria-pressed"), "false");
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // kalitni yoqamiz
  // MUTATSIYA (N2): agendaSlide-onChange'dagi blocks-sinxron qatorlari olib tashlansa — bu qator qizaradi
  // (re-review 8e4603e, (d): kalit yoqilib turib chip o'chgan qolardi — dekorativ).
  assert.equal(screen.getByRole("button", { name: "Reja" }).getAttribute("aria-pressed"), "true", "kalit yoqilgach chip HAM qayta yonishi kerak (re-review 8e4603e, (d))");
  assert.equal(screen.getByRole("switch", { name: "Reja slaydi" }).getAttribute("aria-checked"), "true");
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

test("F1: pro-slide + «Nazorat testi»=5, keyin tur o'zgartirilsa — «Test» chipi va son yana sinxron qoladi", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("pro-slide"); // standart «Umumiy» — bloklarida «test» yo'q
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "5" }));
    assert.equal(screen.getByRole("button", { name: "Test" }).getAttribute("aria-pressed"), "true", "5 tanlangach «Test» chipi yonishi kerak");
    fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "lecture" } }); // «Ma'ruza» — standartida «test» yo'q
    // MUTATSIYA (F1): slidePurpose-onChange'dagi quizCount-sinxron qatori olib tashlansa — bu ikki qator qizaradi.
    assert.equal(screen.getByRole("button", { name: "Test" }).getAttribute("aria-pressed"), "false", "tur o'zgargach «Test» chipi HAM o'chishi kerak");
    assert.equal(
      within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "Testsiz" }).getAttribute("aria-checked"),
      "true",
      "tur o'zgargach «Nazorat testi» ham «Testsiz» ko'rsatishi kerak",
    );
    fillTopicAndSubmit("pro-slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].quizCount, 0, `tur o'zgargach quizCount 0 yuborishi kerak: ${JSON.stringify(cap.posts[0])}`);
    assert.ok(!String(cap.posts[0].blocks ?? "").split(",").includes("test"), `blocks «test»siz bo'lishi kerak: ${JSON.stringify(cap.posts[0])}`);
  } finally {
    cap.restore();
  }
});

test("F1 (oyna): pro-slide + «Reja slaydi» OFF, keyin tur o'zgartirilsa — «Reja» chipi va kalit sinxron qoladi", () => {
  mount("pro-slide"); // standart «Umumiy» — bloklarida «reja» bor
  fireEvent.click(screen.getByRole("switch", { name: "Reja slaydi" })); // o'chiramiz — blocks'dan «reja» chiqadi
  assert.equal(screen.getByRole("button", { name: "Reja" }).getAttribute("aria-pressed"), "false");
  fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "lesson" } }); // «Dars» — standartida «reja» bor
  // MUTATSIYA (F1): slidePurpose-onChange'dagi agendaSlide-sinxron qatori olib tashlansa — bu qator qizaradi
  // (chip yonadi, chunki `blocks` yangi turdan «reja» oladi, lekin eski `agendaSlide:false` yopishib qolib kalitni o'chirib turaveradi).
  assert.equal(screen.getByRole("button", { name: "Reja" }).getAttribute("aria-pressed"), "true", "tur o'zgargach «Reja» chipi qayta yonadi");
  assert.equal(screen.getByRole("switch", { name: "Reja slaydi" }).getAttribute("aria-checked"), "true", "tur o'zgargach kalit HAM yonishi kerak (F1)");
});

test("N1: «Slayd» (oddiy) + open_lesson + «Testsiz» — POST'da blocks kaliti YO'Q, quizCount ANIQ 0", async () => {
  const cap = captureSubmittedValues();
  try {
    mount("slide"); // oddiy «Slayd» — «Tuzilma bloklari» qatori umuman yo'q, lekin slidePurpose bor
    fireEvent.change(screen.getByLabelText("Taqdimot turi"), { target: { value: "open_lesson" } }); // standartida test bor
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "Testsiz" }));
    fillTopicAndSubmit("slide");
    await waitFor(() => assert.ok(cap.posts.length > 0));
    const sent = cap.posts[0];
    // MUTATSIYA (review N1): `case "slidePurpose"` onChange'i shartsiz `set("blocks", ...)` chaqirsa — bu qator qizaradi
    // (server `resolvePlanFlags` `blocks` bor-yo'qligidan "pro"ni aniqlaydi — oddiy «Slayd»da bu kalit UMUMAN bo'lmasligi kerak).
    assert.ok(!("blocks" in sent), `oddiy «Slayd»da blocks kaliti bo'lmasligi kerak: ${JSON.stringify(sent)}`);
    assert.equal(sent.quizCount, 0, `«Testsiz» ANIQ 0 yuborishi kerak: ${JSON.stringify(sent)}`);
  } finally {
    cap.restore();
  }
});

test("N1/N3: eski (versiyasiz) qoralama tiklanganda blocks/planItems/quizCount/agendaSlide E'TIBORGA OLINMAYDI", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const realFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") {
      // ESKI (versiyasiz) qoralama — `v` yo'q. Ilgari `initialValues` `blocks`/`planItems`/`quizCount`/`agendaSlide`
      // ni har doim yozgani uchun bunday qoralamalar ular "ANIQ tanlov" sifatida saqlangan bo'lishi mumkin.
      return json(200, {
        draft: {
          data: {
            topic: "Eski mavzu",
            slideCount: 10,
            blocks: "reja,test",
            planItems: 5,
            quizCount: 0,
            agendaSlide: true,
            slidePurpose: "open_lesson",
          },
          updatedAt: "now",
        },
      });
    }
    if (url === "/api/forms/slide/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") {
      const body = JSON.parse(String(opts?.body ?? "{}")) as { values?: Record<string, unknown> };
      posts.push(body.values ?? {});
      return json(200, { id: "gen1", price: 1000, status: "QUEUED" });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  try {
    mount("slide");
    await waitFor(() => assert.equal((screen.getByLabelText("Taqdimot mavzusini kiriting") as HTMLInputElement).value, "Eski mavzu"));
    fillTopicAndSubmit("slide");
    await waitFor(() => assert.ok(posts.length > 0, "so'rov yuborilishi kerak"));
    const sent = posts[0];
    // MUTATSIYA (N1/N3): `sanitizeRestoredDraft` chaqirilmasa (yoki `v` tekshiruvi olib tashlansa) — bu uch qator qizaradi.
    assert.ok(!("blocks" in sent), `eski qoralamadan tiklangan blocks (oddiy «Slayd»da) tashlab yuborilishi kerak: ${JSON.stringify(sent)}`);
    assert.ok(!("quizCount" in sent), `eski (versiyasiz) qoralamadan tiklangan quizCount tashlab yuborilishi kerak: ${JSON.stringify(sent)}`);
    assert.ok(!("agendaSlide" in sent), `eski (versiyasiz) qoralamadan tiklangan agendaSlide tashlab yuborilishi kerak: ${JSON.stringify(sent)}`);
    assert.ok(!("planItems" in sent), `eski (versiyasiz) qoralamadan tiklangan planItems tashlab yuborilishi kerak: ${JSON.stringify(sent)}`);
  } finally {
    globalThis.fetch = realFetch;
    useAppStore.setState({ loggedIn: false, sessionChecked: false });
  }
});

test("N3 versiya (final review caf9fcb): v:2 qoralama ANIQ tanlovlarni (quizCount/planItems) SAQLAYDI", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const realFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") {
      // YANGI (v:2) qoralama — `quizCount`/`planItems` ANIQ tanlov sifatida yozilgan, «eski qoralama» emas.
      return json(200, { draft: { data: { topic: "Yangi mavzu", slideCount: 10, v: 2, quizCount: 5, planItems: 4 }, updatedAt: "now" } });
    }
    if (url === "/api/forms/slide/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") {
      const body = JSON.parse(String(opts?.body ?? "{}")) as { values?: Record<string, unknown> };
      posts.push(body.values ?? {});
      return json(200, { id: "gen1", price: 1000, status: "QUEUED" });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  try {
    mount("slide");
    await waitFor(() => assert.equal((screen.getByLabelText("Taqdimot mavzusini kiriting") as HTMLInputElement).value, "Yangi mavzu"));
    fillTopicAndSubmit("slide");
    await waitFor(() => assert.ok(posts.length > 0, "so'rov yuborilishi kerak"));
    const sent = posts[0];
    // MUTATSIYA: `sanitizeRestoredDraft` versiyadan qat'i nazar uchtasini har doim o'chirsa — bu ikki qator qizaradi.
    assert.equal(sent.quizCount, 5, `v:2 qoralamadagi ANIQ quizCount saqlanishi kerak: ${JSON.stringify(sent)}`);
    assert.equal(sent.planItems, 4, `v:2 qoralamadagi ANIQ planItems saqlanishi kerak: ${JSON.stringify(sent)}`);
  } finally {
    globalThis.fetch = realFetch;
    useAppStore.setState({ loggedIn: false, sessionChecked: false });
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
    // AUDIT-25 N3: yangi saqlanadigan qoralamalar versiya belgisi bilan — eski (versiyasiz)
    // qoralamalardan farqlash uchun (MUTATSIYA: `v: DRAFT_VERSION` olib tashlansa qizaradi).
    assert.equal(last.v, 2, `qoralama versiya belgisi bilan saqlanishi kerak: ${JSON.stringify(last)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
