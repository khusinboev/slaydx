# AUDIT-7 — Slayd shablonlari: «har xilini tanlasam ham bittasi chiqadi»

`AUDIT-6` ni DAVOM ETTIRADI. U yerda yopilgan bandlar qayta sanalmaydi.

Shikoyat: *«shablonlarda hozirda turli shablon tanlasam ham bitta narsa
chiqayotganday ko'rindi»*. Quyida shikoyat o'lchov bilan tasdiqlangan,
ildiz sabablari topilgan va yopilgan.

## 1. Shikoyat o'lchandi — u haqiqat edi

O'lchov 21 ta shablonning `beats` ketma-ketligi va `planSlide` bergan
reja (layer'lar) ustida qilindi.

### 1.1 Shablonlar bir-birining nusxasi edi

Layout XALTASI (Jaccard) va ketma-ketlik (LCS) bo'yicha eng yaqin juftlar:

| Juftlik | xalta | LCS |
|---|---|---|
| `lesson` ~ `problem` | **1.00** | 0.86 |
| `faq` ~ `literature` | **1.00** | 0.75 |
| `process` ~ `workshop` | 0.78 | 0.88 |
| `timeline` ~ `faq` | 0.78 | 0.88 |
| `bio` ~ `science` | 0.78 | 0.88 |
| `bio` ~ `literature` | 0.78 | 0.88 |

21 shablondan 78 juftlik xalta bo'yicha ≥ 0.62 chiqdi.

### 1.2 Sifat paketi shablonlarni bir-biriga YAQINLASHTIRARDI

`FILLER_BEATS` — HAMMA shablon uchun bitta generik ro'yxat edi. Paket
uzayganda deka aynan shu ro'yxat bilan to'ldirilardi, rol matni ham
bir xil:

| Paket | Deka | Generik to'ldirgich ulushi |
|---|---|---|
| standart | 10 slayd | 22% |
| uzun | 14 slayd | 39% |
| premium uzun | 16 slayd | **51%** (`briefing` da 63%) |

16 slaydli dekada har juft shablon o'rtacha **8.0 / 16** pozitsiyada
AYNAN bir xil (layout + rol) edi. Ya'ni 8 000 tanga to'lagan
foydalanuvchi shablonlar ORASIDAGI farqi eng kam bo'lgan deka olardi.

### 1.3 `visual` maydonining yarmi yolg'on va'da edi

`SlideVisual` da 6 qiymat bor edi, `slide-layout.ts` da esa 4 tasiga
tarmoq bor edi:

| visual | shablon | kodda tarmoq |
|---|---|---|
| `classic` | 3 | bazaviy |
| `cards` | **5** | **YO'Q — `classic` bilan piksel-bapiksel bir xil** |
| `dense` | 3 | faqat `stats` |
| `timeline` | 2 | faqat `process` |
| `magazine` | 5 | faqat `title`, va faqat rasm kelgan bo'lsa |
| `hero-split` | 2 | faqat `title` |

Bir xil MAZMUN 21 shablonda chizilganda: 11 layoutdan **7 tasi**
(`section`, `twoCol`, `compare`, `quote`, `table`, `closing`, va
rasmsiz `title`) hamma shablonda bir xil chiqardi.

## 2. Nima qilindi

### 2.1 21 → 14 shablon (+`auto`)

Olib tashlangani `LEGACY_TEMPLATE_ALIASES` orqali o'rnini bosganiga
yo'naltiriladi — bazadagi eski `doc_json` buzilmaydi
(`normalizeTemplateId`, `meta.ts` shu orqali o'tadi):

| Olib tashlandi | → | Sabab |
|---|---|---|
| `faq` | `lecture` | xalta 1.00 (`literature` bilan), tuzilma ma'ruzaning o'zi |
| `workshop` | `lesson` | xalta 0.88, LCS 0.75 |
| `debate` | `compare` | ikki tomon + pozitsiya — qiyosga qo'shildi |
| `briefing` | `report` | hisobotning qisqartirilgani, 63% generik filler |
| `story` | `case` | xalta 0.88 (`case` bilan) |
| `gallery` | `magazine` | to'la ekran rasm va'da qilardi, lekin `section` sloti yon ustunda edi |

Qolgan 14 tasi 4 guruhga bo'lindi: **Dars va ma'ruza** (`lecture`,
`lesson`, `science`), **Ilmiy ish** (`defense`, `literature`, `bio`),
**Tahlil va qaror** (`compare`, `problem`, `report`, `pitch`), **Bayon va
jarayon** (`process`, `timeline`, `case`, `magazine`).

### 2.2 To'ldirgichlar shablonning O'ZINIKI bo'ldi

`SlideTemplate.fillers` — har shablonda 8 ta, rol matni o'z sohasidan
(`lesson`: «Sinfda 2 daqiqada bajariladigan mashq»; `report`: «Rejadan
chetlanish sabablari»; `timeline`: «Sana va voqea jadvali»). Rol matni
to'g'ridan-to'g'ri LLM promptiga tushadi, ya'ni MAZMUN ham farqlanadi.

16 slaydli dekada juftlar orasidagi ustma-ustlik: **8.0 → 0.01 / 16**
(eng yaqin juftlik `bio` ~ `timeline`, 1/16).

### 2.3 `visual` haqiqiy bo'ldi

- `cards` — bandlar ro'yxat emas, alohida kartalarda (toq sondagi
  oxirgi karta ikki ustunni egallaydi);
- `magazine` — `section` ham to'la ekran kadr + pastki matn tasmasi;
  `photoSlot` ham 16:9 so'raydi, ya'ni fal.ai dan darhol to'g'ri kadr
  keladi. Rasmsiz holatda tasma vertikal markazga ko'chadi;
- `dense` — `table` ham to'q sahifada (`titleBg`), rang juftliklari
  `tests/themes.test.mts` da AA bo'yicha o'lchanganlaridan.

Natija: bir xil mazmunda `bullets` 4 xil, `title` 3 xil, `agenda` 3 xil,
`section`/`stats`/`process`/`table` 2 xil reja beradi.

### 2.4 PDF da ko'rilgan uchta maket nuqsoni

Ko'z bilan ko'rish bosqichida (PPTX → LibreOffice → PDF → PNG) topildi:

- `magazine` bo'lim slaydi rasmsiz holatda yuqori 4 dyuymini bo'sh to'q
  maydon qoldirardi → tasma joyi rasm borligiga qarab hisoblanadi;
- `process` bitta qatorli oqimda karta 5.2" bo'lar, matni 1" ga sig'ardi
  → karta 3.7" gacha va maydon markazida;
- jadval qatori 0.95" ga cheklangan edi: 3 qatorli jadval maydonning
  atigi yarmini egallardi → chegara 1.3", promptda qator poli 2 → 3.

### 2.5 Forma: yig'iluvchi shablon tanlagich

21 ta karta yassi to'rda turardi — formaning eng uzun bo'lagi. Endi:
yopiq holatda faqat tanlangan shablon; ochilganda guruhma-guruh
akkordeon (bir vaqtda bitta guruh). Eskizlar `visual` dan chiziladi,
`id` ro'yxatidan emas — ya'ni eskiz aynan `slide-layout.ts` chizadigan
narsani ko'rsatadi (ilgari `case`/`lesson` «karta» eskizini olardi,
holbuki `cards` kodda yo'q edi).

## 3. Jonli sinov (haqiqiy Gemini, `buildArtifact`)

Bitta mavzu — «Fotosintez jarayoni va uning ahamiyati», uch shablon,
standart paket:

| Shablon | Vaqt | Layout ketma-ketligi | O'rtacha |
|---|---|---|---|
| `lesson` | 16 s | `title>bullets>section>process>twoCol>stats>bullets>twoCol>bullets>closing` | 804 belgi/slayd |
| `report` | 15 s | `title>stats>section>bullets>table>twoCol>process>stats>bullets>closing` | 905 belgi/slayd |
| `magazine` | 14 s | `title>quote>section>twoCol>section>bullets>quote>section>bullets>closing` | 798 belgi/slayd |

Sarlavhalar ham ohang bo'yicha ajraldi:

- `lesson` → «Ushbu darsda o'quvchilar nimalarni o'rganadi», «Sinfda 2
  daqiqada bajariladigan ekspress-topshiriq», «Mavzuni mustahkamlash
  uchun uyga vazifa»
- `report` → «fundamental miqdoriy ko'rsatkichlar», «qiyosiy
  ko'rsatkichlar jadvali», «bosqichma-bosqich tavsiyalar»
- `magazine` → «Yashil bargning koinotdagi roli», «Hujayra ichidagi
  quyosh laboratoriyasi tuzilishi»

## 4. Ochiq qolgan bandlar

- **O-1 (jiddiy).** fal.ai kaliti bloklangan: `[fal] 403 User is locked.
  Reason: TOP_UP.` Jonli sinovda 19 ta rasm so'rovining hammasi rad
  etildi, deka rasmsiz chiqdi. Bu `magazine` va `hero-split`ning to'la
  ta'sirini, va «premium · sifatliroq rasm» paketining va'dasini
  yopadi. Kod to'g'ri ishlaydi (rasmsiz maket buzilmaydi), muammo
  hisobda. Ishlab turgan serverdagi kalit alohida tekshirilishi kerak.
- **O-2.** `twoCol`, `compare`, `quote`, `closing` layoutlari 14
  shablonning hech birida farq qilmaydi. Deka uzunligining ~35% i shu
  to'rttasiga to'g'ri keladi.
- **O-3.** `science` ning `visual` i `lecture` bilan bir xil
  (`classic`) — farqi faqat tuzilma va rol matnida.
- **O-4.** `classic` band slaydi qisqa matnda (band ~75 belgi) pastki
  yarmini bo'sh qoldiradi. `cards` bunday emas.

## 5. Bajarilish yozuvi

| Band | Holat |
|---|---|
| 1.1 shablonlar nusxaligi | ✅ 21 → 14, aliaslar bilan |
| 1.2 umumiy filler | ✅ har shablonga o'z `fillers` i |
| 1.3 `cards` tarmog'i yo'q | ✅ `planBulletCards` |
| 1.3 `magazine` faqat titulda | ✅ `planSectionMagazine` + `photoSlot` |
| 1.3 `dense` faqat statsda | ✅ `planTable` dense tarmog'i |
| 2.4 maket nuqsonlari | ✅ uchtasi ham |
| 2.5 forma uzunligi | ✅ yig'iluvchi akkordeon |
| O-1 fal.ai hisobi | ⛔ ochiq (kod emas, hisob) |
| O-2/O-3/O-4 | ⛔ ochiq |

Testlar: `tests/generation.test.mts` (+5), `tests/slide-layout.test.mts`
(+3). Hammasi mutatsiya bilan tekshirildi — tegishli tarmoq o'chirilsa
aynan o'sha test yiqiladi.
