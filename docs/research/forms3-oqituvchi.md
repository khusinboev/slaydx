# Forma auditi 3 — O'qituvchi (5 vosita) + infografika

Faqat o'qish, kod o'zgartirilmadi. Etalon — AUDIT-12 (`docs/AUDIT-12.md`,
Formalar 2): 4 karta + yig'iq `▸ Sozlamalar` (SummaryChips bilan),
bitta qator = bitta parametr, `compact.tsx` primitivlari, yopiq holda
≈1 100 px @1400. Namuna: `components/forms/WorkComposer.tsx`.

## 1. Inventar

### 1.1 `TeacherComposer.tsx` (831 qator) — 5 vosita bitta faylda

Kartalar tartibi (barcha kind uchun bir xil skelet):
1. **«Mavzu va rejim»** — `TeacherComposer.tsx:718-741`
2. **«Fan, sinf, til»** — `:743-772` (fan/sinf/til/tur + **kind-xos
   sozlamalar shu kartaning ICHIDA**, alohida karta emas)
3. `<details open>` **«Shapka»** — `:774-804` (yig'iq emas — standart
   ochiq, foydalanuvchi o'zi yopishi mumkin, lekin etalon buni
   «Sozlamalar»ga tenglashtirmaydi)
4. `<details>` **«Qo'shimcha»** — `:806-827` (yopiq, faqat `extra`
   matni + «Tozalash»; `SummaryChips` yopiq holda faqat
   `currentType.label.uz` ko'rsatadi — `:813`)

Umumiy maydonlar (barcha kind, `own.has()` orqali shartli):
| Maydon | Joyi | Turi | Majburiy | Reyestrda | Izoh |
|---|---|---|---|---|---|
| `topic` | Karta1 `:720-724` | text | ha (test mode≠topic bo'lsa yashirin `:719`) | `teacher-params.ts:65` | — |
| `subjectId`/`topicIds` (CurriculumPicker) | Karta1 `:736-740` | ixtiyoriy | yo'q | `:110,121` (faqat test) | lesson/map da HAM doim ko'rinadi (`:714`), lekin registrda faqat `test` kind bog'langan `mode`ga |
| `subject` | Karta2 `:744-748` | text | yo'q | `:66` | map'da `topic`dan avto to'ladi (`:391`) |
| `grade` | Karta2 `:749-753` | select 1-11 | yo'q | `:67` | — |
| `gradeLetter` | Karta2 `:754-760` | text 1-harf | yo'q | `:68` | faqat `lesson`/`test` (`own.has`) |
| `language` | Karta2 `:761-765` | segmented 3 | yo'q | `:70` | — |
| Tur (`lessonType`/…) | Karta2 `:766-770` | segmented | yo'q (standart bor) | `:77,84,90,105,111` | `data-field` kindga xos |
| `university` | Shapka `:779-783` | text | **ha** (`CUSTOM_REQUIRED.teacher`, `lib/tools.ts:100-103`) | `:71` | — |
| `author` | Shapka `:784-788` | text | **ha** | `:72` | — |
| `approver` | Shapka `:789-795` | text ixtiyoriy | yo'q | `:73` | ⚠ §4-b da tafsilot |
| `date` | Shapka `:796-802` | date | yo'q | `:69` | faqat `lesson`/`test` |
| `extra` | Qo'shimcha `:816-820` | textarea | yo'q | `:74` | — |

Kind-xos maydonlar (Karta2 ichida, `kindFields`, `:497-679`):

| Kind | Qatorlar (soni) | Fayl:qator | `teacher-params.ts` |
|---|---|---|---|
| **lesson** | davomiylik, bosqichlar, kompetensiyalar (wide textarea), baholash — 4 | `:499-529` | `:78-81` |
| **map** | haftalik soat, yillik soat, nazorat ustuni — 3 | `:530-549` | `:85-87` |
| **glossary** | atama soni (narx chipi bilan!), misol qatori, +shartli tarjima tillari (faqat `uch-tilli`) — 2(+1) | `:550-593` | `:90-102` |
| **keys** | keyslar soni, auditoriya — 2 | `:594-609` | `:105-107` |
| **test** | savol soni, ochiq savol, savol turlari (wide chips), qiyinlik, variantlar, OMR, javoblar kaliti, +shartli mezon jadvali (faqat `criteriaTable` turi), vaqt — **9** (eng og'iri) | `:610-678` | `:111-120` |

Karta1 `modeFields` faqat **test**da: rejim segmentli (mavzu/fayl/
darslik), shartli `SourceFileField`/`CurriculumPicker` (`:684-708`).

**Taxminiy balandlik** (yopiq holatda, Row ≈36-40px): lesson ≈820px,
map ≈760px, glossary ≈780px, keys ≈740px, **test ≈1 050-1 100px** (9
kind-qator + 5 umumiy Karta2 qatori + Karta1 rejim/manba bloki) — eng
og'ir forma, chunki hech narsa yig'ilmaydi.

**Qamrov:** `own = new Set(teacherParamsOf(kind).map(p=>p.id))`
(`:361`) — har `data-field` shu ro'yxatga tekshiriladi
(`tests/ui/teacher-composer.test.mts:96-116`); 38 parametrning barchasi
kamida bitta jsdom testda ko'rinadi (`docs/AUDIT-20.md:519-522`).

### 1.2 Infografika — `StandardForm` (`ToolWorkspace.tsx:132-347`) + `lib/tools.ts`

`custom` YO'Q (`docs/AUDIT-21.md:19`) → `ToolWorkspace.tsx:129` dispatch
oxirigacha tushib, **eski** `StandardForm` chizadi. Maydonlar
`INFOGRAPHIC_FIELDS` (`lib/tools.ts:312-329`): `infographicType`,
`blockCount`, `palette`, `size` — barchasi `kind:"chips"` →
`ChipGroup` (`fields.tsx:54-85`), `language` → `LanguagePicker`
(`fields.tsx:159-205`). Har biri `FieldBlock` orqali OMAT fieldset:
`<Legend>` + kenglik bo'yicha to'liq chiplar (`fields.tsx:302-346`).
`topic` — alohida `needsTopic` fieldset (`ToolWorkspace.tsx:289-312`).
Majburiy maydon YO'Q (`CUSTOM_REQUIRED` da `infographic` yozuvi yo'q —
faqat `output==="docx"` bo'lganlarga avto qo'shiladi, `lib/tools.ts:914`).
Narx tekis 2 000 (`tool.basePrice`, hech qanday maxsus shart).

## 2. Etalon bilan farqlar

**a) Kartalar soni/tuzilishi.** Etalonda 4 doim ochiq karta + 1 yig'iq
«Sozlamalar» (`WorkComposer.tsx:387,424,493,506,536`, yig'iq
`:596-656`, `SummaryChips` to'liq tanlovni ko'rsatadi `:604-611`).
TeacherComposer'da atigi **2** doim-ochiq karta bor, kind-xos
sozlamalar (test uchun 9 qator!) Karta2 ichiga tekis qo'shiladi —
yig'ish yo'q. «Qo'shimcha» details (`:806-827`) faqat `extra`
matnini yashiradi. WP-E buni qisman tan olgan (`docs/AUDIT-20.md:514-518`
— «karta joylashuvi farq qiladi»), lekin faqat joylashuvni aytadi,
yig'ilmaslikni emas. Natija: **test** kindida foydalanuvchi eng zich
blokni (9 qator, uzluksiz) darhol ko'radi — etalonning «asosiy qatorlar
+ yig'iq qolgani» intizomiga zid.

**b) Infografika compact.tsx'da EMAS.** `compact.tsx` o'z docblokida
(`:7-16`) aynan shu muammoni tavsiflaydi: «Eski slayd formalari
3 400-3 900 px edi: har parametr "sarlavha + izoh + chiplar" bloki».
Infografika — AUDIT-21 (TeacherComposer'dan bir kun keyin) yaratilgan
eng yangi vosita, lekin `StandardForm`+`FieldBlock` orqali aynan shu
eski naqshga qaytgan: 5 ta `<fieldset className="mb-6">`
(`fields.tsx:314-346`), Card/Row/Segmented/SummaryChips YO'Q. Taxminiy
balandlik ≈900-1000px, hech narsa yig'ilmagan holda (etalon bilan
solishtirib bo'lmaydi — yig'iq holat umuman yo'q).

**c) Chips uzunligi.** Infografika turi (7)/palitra (6) `ChipGroup`da
`rounded-full` (`fields.tsx:64-85`) — uzun nomlar («Sabab — natija»)
bir necha qatorga tushadi, `Segmented`dagi kabi ixcham emas
(`compact.tsx:68-101`). TeacherComposer'da ham test turi nomlari uzun
(«Bob bo'yicha ish (BSB uslubida)», `registry.ts:654`) — `Segmented`
`whitespace-nowrap` (`compact.tsx:91`) bilan siqiladi, mobilda ko'p
qatorga bo'linadi (6 test turi, `registry.ts:621-805`).

**d) Tooltip/a11y.** TeacherComposer `Row hint` `title`+`aria-label`
tooltip beradi (`compact.tsx:56-60`). Infografika `Legend`da tooltip
yo'q, `ToolField.hint` esa `FieldBlock`da UMUMAN CHIZILMAYDI
(`fields.tsx:302-346`) — `blockCount`ning «tur chegarasidan oshsa
kesiladi» izohi (`lib/tools.ts:319`) hech qachon ko'rinmaydi.

**e) Qorong'i/mobil.** Ikkalasi ham Tailwind token bilan avtomatik
qorong'i; mobilda ikkalasi ham ishlaydi, lekin infografikaning uzun
chiplari balandlikni yanada oshiradi.

**f) Profil standartlari.** `emptyUi` (`TeacherComposer.tsx:176-189`)
`profile.subject/university/author`ni to'g'ridan-to'g'ri o'qiydi,
`profileDefaults()` (`lib/tools.ts:1278`) orqali emas — WorkComposer/
StandardForm esa shu funksiyani ishlatadi (`ToolWorkspace.tsx:33`).
Amaliy farq yo'q, lekin manba ikkiga bo'lingan.

**g) Qoralama (draft).** TeacherComposer `useFormDraft` ishlatadi
(`:368`); infografika `StandardForm`da qoralama UMUMAN YO'Q
(`ToolWorkspace.tsx:134-141` faqat `useState`) — sahifa yopilsa
tanlovlar yo'qoladi.

**h) CurriculumPicker UX.** Qidiruv yo'q (ikkita `<select>`,
`:96-113`), bo'sh/yuklanish/xato holatlari bor (`:157,123,124`), lekin
mavzu chiplari filtrlanmaydi (`:127-149`) — uzun ro'yxat qidiruvsiz.

## 3. Takrorlanishlar

- **Shapka bloki** uchtala composerda BOR, lekin bir xil EMAS:
  WorkComposer «Titul» — 10 maydon (universitet/fakultet/kafedra/
  guruh/kurs/muallif/o'qituvchi+daraja/shahar/vazirlik,
  `WorkComposer.tsx:424-491`); ArticleComposer — «Mualliflar» dinamik
  ro'yxat (`ArticleComposer.tsx:480`); TeacherComposer — «Shapka»
  4 maydon (`:774-804`). Umumiy bo'lgani — FAQAT konteyner naqshi
  (`<details open>` + `Row` ro'yxati), maydonlar tarkibi har birida
  boshqa. **`AuthorBlock` nomzodi** — faqat qobiq (details+summary+Row
  ro'yxati) darajasida oqlanadi, maydon ro'yxati emas (chunki
  «Tasdiqlayman» faqat o'qituvchida, «Vazirlik» faqat talaba ishida
  bor).
- **Fan/sinf/til tanlovi o'yinlar bilan bir xilmi?** Yo'q — o'yinlar
  (`crossword`/`flashcards`) `StandardForm` orqali `topic`+fayl rejimi
  ishlatadi, alohida fan/sinf maydoni yo'q (`GAME_FIELDS`,
  `lib/tools.ts:216-224` atrofida). Solishtiriladigan umumiylik yo'q.
- **Ikki alohida "Fan" tanlovi bir formada (lesson/map).**
  Karta2'da `subject` — erkin matn (`TeacherComposer.tsx:744-748`);
  Karta1'dagi `CurriculumPicker` — o'z fan `<select>`i
  (`CurriculumPicker.tsx:97-104`, `ui.subjectId`). Ikkalasi **sinxron
  EMAS**: CurriculumPicker'da fan tanlash `subject` matn maydonini
  to'ldirmaydi va aksincha. `grade` esa ikkalasida ORTAQ holat
  (`curriculumValue()` `ui.grade`ni qaytaradi, `TeacherComposer.tsx:442-444`)
  — demak faqat sinf sinxron, fan emas. Foydalanuvchi ikkita "fan"
  maydonini alohida to'ldirishi kerakligini formadan bilib bo'lmaydi.

## 4. UX kamchiliklari

**a) `blockCount` hint hech qachon ko'rinmaydi** — `ToolField.hint`
(`lib/tools.ts:319`, «Tanlangan tur chegarasidan oshsa avtomatik
kamaytiriladi») `FieldBlock`da chizilmaydi (`field.hint` o'qilmaydi,
`fields.tsx:302-346`). Foydalanuvchi 8 blokni tanlab `process`da
(maks 6) sababsiz 6 ga kesilganini ko'radi.

**b) `approver` (Tasdiqlayman) — TEST kindida qisman "o'lik" maydon.**
Forma `own.has("approver")` KIND darajasida (`TeacherComposer.tsx:789`,
`teacher-params.ts:73`) — maydon **barcha 6 test turida** bir xil
ko'rinadi, lekin `registry.ts:621-805`da faqat `bsb`/`chsb`
`limits.approver: true`, qolgan to'rttasida `false`. Dvigatel TUR
bo'yicha kesadi: `lib/generation/teacher/test/input.ts:156` —
`approver: L.approver ? s(values.approver, 160) : ""` — ya'ni
`nazorat`/`dtm`/`olimpiada`/`diagnostika`da foydalanuvchi yozgan matn
**jimgina tashlanadi**, ogohlantirishsiz. Buni zondning o'zi ham
bilvosita tan oladi — `probeWith: { testType: "bsb" }` (`:73`) FARQNI
o'lchash uchun ataylab `bsb`ga majburlaydi (aks holda 4/6 turda farq
nol bo'lib, zond «bezak maydon» deb qizarardi). Bu — «har parametr
ishlashi kerak» qoidasining qisman buzilishi: ishlaydi, lekin faqat
2/6 sharoitda, forma buni hech qanday tarzda ko'rsatmaydi.

**c) Infografika natija sahifasi — noto'g'ri yorliqlar.** `viewerKind`
`"image"`ga tushadi (`lib/viewers/kind.ts:79`), `ImageViewer.tsx` AI-rasm
vositasi uchun yozilgan. Sarlavha `{style.name} · {ratio.label} · N
rasm` (`ImageViewer.tsx:36`) `doc.imageStyle`/`imageRatio`ni o'qiydi,
lekin infografika dvigateli bu maydonlarni hech qachon yozmaydi →
standart qiymatga tushadi (`image-studio.ts:108-114`,
`IMAGE_STYLES[0]="Foto"`, `IMAGE_RATIOS[0]="1:1"`). Natijada A4/A3
**portret vektor plakat** sahifasida **«Foto · 1:1 · N rasm»** deb
chiqadi — mazmunga aloqasi yo'q, chalg'ituvchi.

**d) Majburiylik noaniqligi.** `approver`/`date`/`gradeLetter`
(`:789-802`) hammasi «ixtiyoriy» ko'rinadi, lekin qay biri hujjatga
real ta'sir qilishini forma hech qanday belgi bilan ajratmaydi.

**e) `SummaryChips` sayoz.** Yopiq «Qo'shimcha»da faqat tur nomi
ko'rinadi (`:813`) — WorkComposer'dagi kabi joriy sozlamalar (savol
soni/qiyinlik/variant) aks etmaydi, chunki bu maydonlar «Qo'shimcha»ga
umuman kirmagan (2-a bandga qarang).

## 5. Tavsiya

1. **Test kind uchun eng katta ta'sir**: 9 kind-qatorni (`:610-678`)
   alohida yig'iq «▸ Sozlamalar» kartasiga ko'chirish (WorkComposer
   naqshi, `SummaryChips` = `[turi, "N savol", "N variant", omr?"OMR":null]`).
   Boshqa kindlar (lesson 4, map 3, glossary 2-3, keys 2) hozirgi
   holatda ham etalon chegarasiga (≈800px) yaqin — ularni majburiy
   ko'chirish shart emas, lekin bir xillik uchun barcha 5 kind bir xil
   qobiqni (Karta1/Karta2/Sozlamalar/Shapka) ishlatsa fayl bo'lish
   rejasi (pastda) osonlashadi.
2. **`FormValues` nomlari o'zgarmasin** — `count`/`questionKinds`/
   `omr`/… `teacher-params.ts` zondiga va dvigatelga qulflangan
   (`docs/AUDIT-20.md:449-460`; tekshirildi — `TeacherInput`
   (`lib/generation/teacher/input.ts`) bu 10 maydonni hali ham olmagan).
   Faqat JSX joylashuvi o'zgarishi kerak — past xavfli refaktor.
3. **831 qatorli faylni bo'lish**: `kindFields` blokini
   (`:497-679`, ≈180 qator) 5 alohida faylga (`teacher/composer/
   LessonFields.tsx`, `MapFields.tsx`, … yoki bitta
   `KindSettings.tsx` switch bilan) chiqarish — har biri `Ui`/`set`
   propi bilan ishlaydi, `data-field` shartnomasi saqlanadi. Xavf: past
   (sof JSX ko'chirish), lekin `own`/`t.limits` bog'liqligi har joyda
   qayta hisoblanishi kerak (kichik takrorlash xavfi).
4. **Infografikani compact'ga o'tkazish** — eng katta ISH HAJMI: yangi
   `InfographicComposer.tsx` (`custom:"infographic"`) yozish, 5
   maydonni Card/Row/Segmented (chiplar — 7 va 6 ta variant, Segmented
   ko'proq mos, `blockCount` uchun narx yo'qligi sababli oddiy chiplar
   yetarli) bilan qayta chizish, `useFormDraft` qo'shish. Xavf: past-o'rta
   (yangi komponent, lekin `INFOGRAPHIC_FIELDS`/`FormValues` maydon
   nomlari o'zgarmaydi — `infographic-params.ts` zondi ham buzilmaydi).
5. **Tezkor, arzon tuzatishlar** (alohida, kod o'zgartirmasdan
   TAVSIYA sifatida): (a) `approver`ni `own.has("approver")` o'rniga
   `currentType.limits?.approver` (faqat test kindida mavjud) bilan
   shartli ko'rsatish — lesson/map'da hozirgidek doim, test'da faqat
   bsb/chsb; (b) `ImageViewer` sarlavhasini `doc.infographic` bo'lsa
   boshqa matn bilan almashtirish («A4 portret · N blok» kabi) yoki
   infografika uchun mini-variant chiqarish; (c) `FieldBlock`ga
   `field.hint` chizishni qo'shish (barcha `StandardForm` vositalariga
   foydali, faqat infografikaga emas).

## Manba fayllar (asosiy)

`components/forms/TeacherComposer.tsx`, `CurriculumPicker.tsx`,
`compact.tsx`, `fields.tsx`, `ToolWorkspace.tsx`, `WorkComposer.tsx`;
`lib/tools.ts`, `lib/generation/teacher/registry.ts`, `teacher-params.ts`,
`teacher/input.ts`, `teacher/test/input.ts`, `infographic/registry.ts`,
`infographic-params.ts`; `lib/curriculum.ts`; `components/files/
ResultView.tsx`, `useTeacherEdit.ts`; `components/viewers/ImageViewer.tsx`;
`docs/AUDIT-20.md`, `docs/AUDIT-21.md`; `tests/ui/teacher-composer.test.mts`.
