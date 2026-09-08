# AUDIT-8 — Slayd maketlari: shablon endi HAR SLAYDDA ko'rinadi

`AUDIT-7` ni DAVOM ETTIRADI. U yerdagi **O-1…O-4** bandlari shu sprintda
yopildi. Sprint to'rtta parallel ish oqimi bilan olib borildi (uchtasi
alohida git worktree'da, biri faqat audit).

## 1. Jonli audit: reja bajarilyapti, MAKET bajarilmayapti

14 shablonning hammasi bitta neytral mavzuda («Suvning tabiatdagi
aylanishi») haqiqiy Gemini bilan yaratildi va PDF gacha ko'rildi.

**Yaxshi tomoni.** Reja **140/140** pozitsiyada bajarildi — `coerceLayout`
birorta slaydni majburlamadi, `table` beat'i 6 shablonda ham haqiqiy
jadval bilan chiqdi. Bo'sh maydon **0**: 140 slaydda bironta ham bo'sh
`subtitle`, «—» li `stats`, `bullets` ga tushib qolgan `table` yoki
ikkitadan kam bandli ustun topilmadi. O'rtacha 571–737 belgi/slayd.

**Yomon tomoni.** `planSlide` ni har `visual` bilan chaqirib
solishtirganda: **117/140 = 84%** slayd shablondan QAT'I NAZAR bir xil
chizilardi. `AUDIT-7` bu ko'rsatkichni ~35% deb baholagan edi — baho
past chiqqan, chunki u `agenda` ni hisobga olmagan (`planBullets`
dagi `cards` tarmog'i `!agenda` sharti bilan qo'riqlangan) va
`lecture`/`science` ning 10/10 neytralligini ko'rmagan.

## 2. PDF da topilgan 10 nuqson

| № | Nuqson | Holat |
|---|---|---|
| N-1 | `planStatChart` `dense` ni bilmasdi: yorug' yo'lakcha to'q sahifada, `accent2` esa ko'p temada `titleBg` ning O'ZI → 2- va 3-ustun ko'rinmasdi | ✅ |
| N-2 | «97.5%», «2.5%» va «4 bosqich» bitta o'qda — yolg'on taqqoslash | ✅ |
| N-3 | Diagramma maydonning yarmini bo'sh qoldiradi (`rowH = min(1.15, …)`) | ⛔ |
| N-4 | `planStats` yorlig'i 2.3″ quti tepasiga yopishardi | ✅ |
| N-5 | `planSection` (classic) pastki ~2.7″ bo'sh — 12 shablonga tegadi | ⛔ |
| N-6 | `planSectionMagazine` rasmsiz hamon siyrak | ⛔ |
| N-7 | `magazine` titul rasmsiz `classic` ning AYNAN o'zi edi | ✅ |
| N-8 | `steps.text` 120 belgida kesilardi — jonli dekada bitta slaydning to'rtala kartasi «…» bilan tugagan | ✅ |
| N-9 | `stats.label` 60 belgida kesilardi | ✅ |
| N-10 | `timeline` relsi sarlavha chizig'i bilan qo'sh chiziq beradi | ⛔ |

Chegaralar (N-8/N-9) MAKETDAN emas, promptdagi «10–15 so'z»
ko'rsatmasidan chiqarilgan edi — ya'ni ko'rsatmaga TO'LIQ rioya qilgan
model ham kesilardi. Qutilar qayta o'lchandi; yangi chegaralar
`STEP_TEXT_MAX`/`STAT_LABEL_MAX` konstantasida va testda IKKI tomondan
qulflangan (sig'imdan oshmasin, so'ralgan hajmdan kam bo'lmasin).

## 3. AUDIT-7 ning ochiq bandlari yopildi

**O-2 — `twoCol`/`compare`/`quote`/`closing` hech qanday shablonda
farq qilmasdi.** `planTwoCol` ga oltala, `planOverlay` ga uchta tarmoq
qo'shildi: `dense` (to'q sahifa, kartasiz, 6 band sig'adi), `magazine`
(tarqatma tipografikasi, tik ajratgich, nuqtasiz abzaslar), `cards`
(har band alohida kartada), `timeline` (tik o'q va nuqtalar),
`hero-split` (chap yarim to'q panel).

**O-3 — `science` maketi `lecture` bilan bir xil edi.** Yangi `lab`
maketi (`planLabRows`): daftar varag'i, chap chekkada bo'linmali o'lchov
chizig'i, raqamlangan kuzatuv qatorlari. Mavjud qiymatlardan birini
qayta taqsimlash O-3 ni yopa olmasdi — u faqat `science` qaysi shablonni
takrorlashini almashtirardi.

**O-4 — `classic` band slaydi qisqa matnda bo'sh ko'rinardi.** Shrift
avvalgidek tanlanadi, keyin QOLGAN balandlik bandlar orasiga
taqsimlanadi (`size × 1.6` chegarasi bilan) va blok markazlashtiriladi.
Siyoh qoplami: 3 × 48 belgi **26% → 41%**, 4 × 165 (Slide Law chegarasi)
**83% → 100%**.

**O-1 — rasm kelmagani jim o'tardi.** fal.ai hisobi bloklangan
(`403 User is locked. Reason: TOP_UP.`); 401/403 farqi bilan bu KALIT
emas, HISOB muammosi ekani isbotlandi (buzilgan kalit 401 beradi).
Kod muammosi boshqa joyda edi: har yiqilish bitta `console.warn` bo'lib,
`delivered` slayd yo'lida faqat SLAYD sonidan hisoblanardi. 16 slayd +
0 rasm → foydalanuvchi hech nima ko'rmasdi va 8 000 tanga to'liq
olinardi. Endi rasm kamomadi `delivered` ga tushadi, natija sahifasida
ko'rinadi va `refundPartial` orqali qisman qaytariladi; blok
aniqlangach qolgan so'rovlar yuborilmaydi (19 → 3 chaqiruv).

## 4. Yo'l-yo'lakay topilgan ikki nuqson

**«Ko'rdim = oldim» buzilishi.** `paraSpace` PUNKTDA o'lchanadi
(`fitLines` uni `box.h * 72` byudjetiga qo'shadi, `render-pptx.ts`
`paraSpaceAfter` ga punkt beradi), `SlideCanvas` esa uni xom son bo'yicha
CSS PIKSELIGA qo'yardi — bandlar orasi ekranda faylga qaraganda ~25%
tor chizilardi. O-4 oraliqni 10 pt dan 26–29 pt ga ko'targani uchun farq
sezilarli bo'lib qolgan edi.

React `react-dom/server` ni `--conditions=react-server` ostida
BLOKLAYDI, shuning uchun ko'ruvchi testlari uchun alohida yo'l ochildi:
`tests/viewer/` + `tsconfig.viewer.json` + `npm run test:viewer`,
`npm run check` ga ulangan. Ko'ruvchi va fayl orasidagi ajralish
loyihaning eng ko'p takrorlangan nuqsoni (AUDIT-5, AUDIT-6, endi bu) —
nihoyat avtomatik tekshiriladi.

**Eskiz yana yolg'on va'da bera boshlagan edi.** AUDIT-7 «eskiz `visual`
dan chiziladi» qoidasini o'rnatgan, lekin yangi `lab` qo'shilganda
`TemplateSketch` ga tarmoq qo'shilmagani uchun «Tajriba» jimgina
`classic` eskizini olardi. Eskiz qo'shildi va qamrov testga bog'landi.

## 5. Natija

| O'lchov | Oldin | Keyin |
|---|---|---|
| Shablondan qat'i nazar bir xil chiziladigan slayd | **84%** | **0%** |
| Bitta variantda qoladigan layout | 11 tadan 5 tasi | **0 ta** |
| `twoCol` / `compare` variantlari | 1 | **6** |
| `quote` / `closing` variantlari | 1 | **4** |
| `bullets` variantlari | 4 | **5** |

Chegara supurishi: 15 tema × 6 visual × 16 namuna — hech bir qatlam
slayddan chiqmaydi.

## 6. Ochiq qolgan bandlar

- **O-1a (kod emas).** fal.ai hisobi to'ldirilmaguncha rasm chiqmaydi.
  Ishlab turgan serverdagi kalit alohida tekshirilishi kerak (SSH ga
  kirilmadi).
- **O-5 (mahsulot qarori).** Rasm kelmaganda qaytariladigan ulush paket
  narxlaridan chiqarilgan: premium va premium-uzun uchun 0.25 (8 000
  dan 2 000), standart va uzun uchun **0** — ularning yorlig'ida rasm
  va'da qilinmagan, faqat kamomad qayd etiladi. Standart paketda ham
  amalda rasm biriktiriladi, shuning uchun bu qaror tasdiqlanishi kerak.
- **N-3, N-5, N-6, N-10** — yuqoridagi jadvalda.
- `quote`/`closing` `timeline` va `hero-split` da hamon `classic`
  panelda (ikkovi `twoCol` da farqlanadi) — ataylab qilingan qamrov
  qarori.
- `problem` ~ `pitch` juftligi hamon yaqin (layout xaltasi 0.88, ikkalasi
  `hero-split`); `lesson`~`bio` 8/10, `science`~`problem` 7/10.
  Sarlavha darajasida ajralish yaxshi (eng yuqori so'z-Jaccard 0.16).

## 7. Bajarilish yozuvi

| Band | Holat |
|---|---|
| AUDIT-7 O-1 (rasm jimligi) | ✅ mexanizm; hisob ochiq |
| AUDIT-7 O-2 (4 layout farqsiz) | ✅ |
| AUDIT-7 O-3 (`science` = `lecture`) | ✅ `lab` |
| AUDIT-7 O-4 (bo'sh band slaydi) | ✅ |
| N-1, N-2, N-4, N-7, N-8, N-9 | ✅ |
| N-3, N-5, N-6, N-10 | ⛔ |
| `paraSpace` birlik nomuvofiqligi | ✅ + ko'ruvchi test yo'li |
| `lab` eskizi va qamrov testi | ✅ |
| O-5 (qaytarish ulushi) | ⛔ tasdiq kutilmoqda |

Testlar: **338 unit + 2 ko'ruvchi**. Har bir yangi assertion mutatsiya
bilan tekshirilgan (jami 30+ buzish, har biri aynan mo'ljallangan testni
yiqitdi). PPTX → LibreOffice → PDF → PNG bosqichi har bir ish oqimida
va birlashtirilgandan keyin qaytadan o'tkazildi.
