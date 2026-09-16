# R2 — Kalitlar / Keys-stadi (vaziyatli topshiriqlar to'plami, maktab yuqori sinf + OTM)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan; URL yo'q joyda
"aniqlanmadi" deb ochiq qoldirilgan — o'ylab topilmagan.

## 1. Rasmiy shakl/standart

| Hujjat | Raqam/sana | Nima beradi | Manba |
|---|---|---|---|
| Talabalar bilimini nazorat qilish va baholashning reyting tizimi to'g'risidagi Nizom | VM 3069-son, 26.09.2018 (1981-son, 10.07.2009 o'rniga) | OTM da 5 ballik va 100 ballik tizim mosligi; keys-stadi kabi amaliy mashg'ulot/seminar nazorat turlari uchun aniq foiz taqsimoti **belgilanmagan** — "o'quv mashg'ulotlari davomida olgan baholari inobatga olinadi" deb umumiy yozilgan | [lex.uz/docs/-3916793](https://lex.uz/docs/-3916793) |
| 100 balli tizim — 5 balli moslik jadvali (OTM) | shu Nizom, 1-jadval | "5" = 90–100 ball, "4" = 70–89,9, "3" = 60–69,9, "2" = 0–59,9; 60 balldan kam — muvaffaqiyatsiz | [lex.uz/docs/-3916793](https://lex.uz/docs/-3916793) |
| 5–11-sinf o'quvchilari bilimini reyting tizimida nazorat qilish Nizomi | [lex.uz/docs/1650580](https://lex.uz/docs/1650580) | Maktab (5–11-sinf) uchun 100 balli — 5 balli moslik: "5" = 86–100, "4" = 66–85, "3" = 30–65, "2" = 0–29 — **OTM jadvalidan farqli chegaralar**, ikkalasi aralashtirilmasligi kerak | [lex.uz/docs/1650580](https://lex.uz/docs/1650580) |
| Yangi baholash tizimi (BSB/ChSB) | 72-son buyruq, 27.02.2025 | Chorak baho 100 ball ichida: 10 ball formativ, 50 ball bob bo'yicha summativ, 40 ball chorak oxiri summativ (faqat joriy 1500–3068 maktabda, 2024/25) — keys-stadi shu formativ/summativ tarkibiga kirishi mumkin, ammo bevosita "keys" bandi topilmadi | [talimxabarlari.uz/16160](https://talimxabarlari.uz/16160/) (R1 hisobotidan) |

**Muhim topilma (halollik uchun):** keys-stadi uchun ham (R1 dagi dars
rejasi kabi) **bitta rasmiy, majburiy DOCX shakli** topilmadi. Mavjud
manbalar ikki toifaga bo'linadi: (1) OTM pedagogika kafedralari nashr
etgan **uslubiy tavsiyalar/maqolalar** (TDPU va boshqa universitetlarga
tegishli domenlar — `oriens.uz`, `tdpu.uz` bog'lanishlari qidiruvda
chiqdi, lekin `reja.tdpu.uz` sahifasi SSL sertifikat xatosi bilan
ochilmadi va aniq matn **tasdiqlanmadi**); (2) umumiy pedagogika
referatlari (`oefen.uz`, `docx.uz`) — bular rasmiy hujjat emas, lekin
ikkalasi ham bir-biriga mos ikki xil **tuzilma darajasi**ni tasvirlaydi
(pastda). Baholash foizlari (nechchi ball qaysi mezonga) hech bir
manbada **aniq ko'rsatilmagan** — faqat "ballar yig'indisi" umumiy
tamoyil sifatida tilga olinadi.

### Amaldagi (konvensional) ikki darajali tuzilma

| Daraja | Bo'limlar | Manba |
|---|---|---|
| **To'liq (murakkab) keys** — 10 komponent | 1. Pedagogik annotatsiya · 2. Kirish · 3. Keys (muammo) bayoni · 4. Topshiriq/savollar · 5. Adabiyotlar ro'yxati · 6. Metodik ko'rsatmalar · 7. Yechish jarayoni (tahlil+variantlar) · 8. Taqdimot tashkili · 9. Yechimni tahlil qilish · 10. O'qituvchining yechimi | [oefen.uz](https://oefen.uz/uz/documents/referatlar/umumiy/ta-lim-jarayonida-keys-stadi-texnologiyasi) |
| **Mini keys** — 8 komponent | Pedagogik annotatsiya va kirishsiz; "Keys bayoni" bilan boshlanib "O'qituvchi yechimi" bilan tugaydi | [oefen.uz](https://oefen.uz/uz/documents/referatlar/umumiy/ta-lim-jarayonida-keys-stadi-texnologiyasi) |
| Bosqichli metodika (muqobil manba, 8 bosqich) | 1. Didaktik maqsad · 2. Muammoli vaziyatlarni aniqlash · 3. Dastur xaritasi · 4. Keys modulini tanlash/tuzish · 5. Matnni yozish · 6. Sinovdan o'tkazish · 7. Xulosa · 8. Uslubiy tavsiyalar | [docx.uz](https://docx.uz/document/keys-stady-texnologiyalari-va-ulardan-foydalanish-d900006f?lang=uz) |

Ikkala manba ham "yechim tahlili sabab-oqibat munosabati asosida
bo'lishi" va tahlil 5 usuldan biriga (pragmatik, aksiologik, prognostik,
vaziyatga xos, tavsiyaviy) tayanishi mumkinligini ta'kidlaydi
([docx.uz](https://docx.uz/document/keys-stady-texnologiyalari-va-ulardan-foydalanish-d900006f?lang=uz)).
Bizning hozirgi model (`situation` + `tasks[]` + `key` + `rubric[]`) —
**mini keys**ning soddalashtirilgan formasi (annotatsiya/adabiyotlar/
taqdimot yo'q, chunki bu o'quv hujjati, konferensiya materiali emas).

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai | Xalqaro (case-study generic tools) | Biz olamizmi |
|---|---|---|---|
| Narx | Sahifa deyarli bo'sh render (JS talab qiladi), narx **aniqlanmadi** ([slaydtop-public.md](./slaydtop-public.md)) | — | o'zgarmaydi (6000, PM qarori) |
| Fan/mavzu | aniqlanmadi | universal (istalgan fan uchun moslashadigan umumiy vosita) | bor |
| Keys turi | aniqlanmadi | Harvard Business School uslubida: "teaching note" bilan birga — o'qituvchiga alohida qo'llanma, talabaga alohida keys matni ([hbs.edu](https://www.hbs.edu/case-method-project/about/Pages/case-method-teaching.aspx)) | bizda yo'q — bitta hujjatda hammasi (o'qituvchi ham, talaba ham o'sha faylni ko'radi); ajratish murakkablashtirar, hozircha kerak emas |
| Keys soni | aniqlanmadi | — | bizda hozir 3–5 (kod ichida qattiq, foydalanuvchiga ko'rinmaydi) |
| Baholash rubrikasi | aniqlanmadi | **standart amaliyot** — nashr etilgan business-case rubrikalari mavjud (masalan iRubric namunasi, mezon+ball ustunlari) ([rcampus.com](https://www.rcampus.com/rubricshowc.cfm?sp=yes&code=T92B68)); akademik nashrda ham rasmiy rubrika tuzilishi tavsiya etiladi ([researchgate.net](https://www.researchgate.net/publication/301831813_A_Rubric_for_Evaluating_Student_Analyses_of_Business_Cases)) | bor (`rubricBlocks`, 3–5 mezon, ball yig'indisi=10) — bizniki allaqachon shu andozaga mos |
| Keys turi (tahliliy/muammoli/qaror/rolli) | aniqlanmadi | Umumiy pedagogikada tan olingan tiplar: "muammoli vaziyat" (identify problem), "qaror qabul qilish" (decision-forcing), "rolli o'yin" (role-play negotiation) — case method adabiyotida keng tarqalgan tasnif, lekin O'zbekiston domenidagi rasmiy hujjatda **aniqlanmadi** | keyin — reyestrga tur sifatida kiritish tavsiya etiladi (pastda) |
| Vaziyat manbai (real/fiktiv) | aniqlanmadi | Real (haqiqiy kompaniya nomi bilan, litsenziyalangan) yoki fiktiv (o'quv uchun yaratilgan) — ikkalasi ham qonuniy, lekin real holda faktlar TEKSHIRILGAN bo'lishi kerak ([emeraldgrouppublishing.com](https://www.emeraldgrouppublishing.com/how-to/authoring-editing-reviewing/write-a-teaching-case-study)) | bizda — **faqat fiktiv/generik**, real tashkilot nomi/statistika uydirilmasligi kerak (mavjud yondashuv, kengaytirish kerak) |
| Interaktivlik | aniqlanmadi | — | keyin (AUDIT-22, "rolli" o'yin runtime bilan bog'lanishi mumkin, ammo hozircha DOCX statik) |

## 3. Bizga tavsiya — reyestr

**Turlar** (`KeysModel.type`):

- `tahliliy` (standart) — mavjud vaziyatni tahlil qilib, sabab-oqibatni
  aniqlash (nima nima uchun sodir bo'ldi), yechim shart emas.
- `muammoli` — vaziyatda aniq, hal qilinmagan muammo bor, topshiriq —
  muammoni aniqlash va yechim variantlarini taklif qilish (hozirgi
  standart xatti-harakatga yaqin).
- `qaror-qabul-qilish` (decision-forcing) — vaziyat bir necha yechim
  yo'li oldida turgan qahramon bilan tugaydi ("… nima qilishi kerak?"),
  topshiriq — variantlarni solishtirib, asoslangan qaror tanlash.
- `rolli` — talaba/o'quvchi vaziyatdagi bir tomon nuqtai nazaridan
  ishlaydi (masalan "siz maktab direktorisiz..."), topshiriq shu rol
  nuqtai nazaridan javob talab qiladi.

Har tur `tasks[]` (topshiriqlar) formulировкасini o'zgartiradi: masalan
`qaror-qabul-qilish` da oxirgi topshiriq doim "eng maqbul variantni
tanlang va asoslang" bo'lishi kerak.

**Parametrlar** (`id`, tur, variantlar, standart, majburiy, `impacts`):

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `topic` | text | — | — | ha | prompt |
| `type` | select | tahliliy/muammoli/qaror-qabul-qilish/rolli | muammoli | ha | prompt, structure (tasks formulировкаси) |
| `caseCount` | chips | 3/5/8 | 5 | ha | prompt, price (**hozir narxga ta'sir qilmaydi — narx o'zgarmaydi, faqat son o'zgaradi**, glossariy `termCount` naqshiga o'xshash) |
| `audience` | select (ixtiyoriy) | maktab-yuqori-sinf / OTM | OTM | yo'q | prompt (til murakkabligi, misol tanlovi) |
| `subject` | text (ixtiyoriy) | — | — | yo'q | prompt |
| `language` | select | uz/ru/en | uz | ha | prompt, structure |
| `extra` | textarea | — | — | yo'q | prompt (bor, ishlaydi) |

**Bo'limlar skeleti (mini-keys, bizning hajmimizga mos):** sarlavha →
kirish → har keys uchun: sarlavha (`Keys N. Nomi`) → vaziyat bayoni →
topshiriqlar (3–4) → namunaviy kalit → baholash rubrikasi (3–5 mezon,
jami 10 ball). To'liq (10 komponentli) shakl bizning hajmimiz uchun
ortiqcha — pedagogik annotatsiya/adabiyotlar ro'yxati/taqdimot tashkili
kabi bandlar o'quv (talaba/o'quvchiga tarqatiladigan) hujjatda emas,
o'qituvchi metodik ishlanmasida bo'ladi (bizning mahsulot pozitsiyasi —
"tayyor DOCX", metodik jurnal maqolasi emas).

**Jadval ustunlari:** rubrika jadval emas, ro'yxat (`li`) + jami qator —
hozirgi holat (`rubricBlocks`) o'zgarmasin, chunki 3–5 qatorlik jadval
qo'shimcha qiymat bermaydi.

**Hajm chegaralari:** keys soni 3–8 (hozir 3–5 kod ichida qattiq),
topshiriq soni 3–4 (hozir shunday), rubrika mezoni 3–5 (hozir shunday,
o'zgarmasin).

## 4. Sifat mezonlari

**Deterministik qoidalar** (`ReviewCheck` uslubida):

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `caseCount` | Yetkazilgan keys soni va'da qilinganga teng/yaqin | ≥3 (mavjud, `cases.length < 3 → null`) |
| `hasQuestions` | Har keysda kamida 2 topshiriq bor | ≥2 (hozir `.slice(0,4)` — pastki chegara tekshiruvi yo'q, **qo'shish tavsiya etiladi**) |
| `hasSolution` | `key` (namunaviy kalit) bo'sh emas | bo'sh emas (hozir tekshirilmaydi — **qo'shish tavsiya etiladi**, ayniqsa `data.cases` dan bo'sh `key` kelishi mumkin) |
| `rubricSum` | Rubrika ball yig'indisi aniq 10 ga teng | qat'iy (mavjud, `normalizeMinutes` orqali) |
| `situationLength` | Vaziyat matni juda qisqa (bir jumlali stub) emas | ≥120 belgi (hozir faqat `clip(…, 420)` yuqori chegara, pastki yo'q — **qo'shish tavsiya etiladi**) |
| `realism` | Vaziyatda aniq ism/rol/kontekst bor (umumiy "bir korxona bor edi..." emas) | kamida 1 aniq ism/lavozim/joy so'zi — deterministik regex qiyin, ko'proq judge zimmasida |
| `noDuplicateCase` | Keyslar bir-birining nusxasi emas (sarlavha/vaziyat boshlanishi bo'yicha) | title/situation dastlabki 40 belgi bo'yicha takrorlanmasin |

**Judge mezonlari** (3–6, ingliz tilida):

1. `situationRealism` — is the situation concrete (named roles/context/numbers where appropriate) rather than a generic "a company faced a problem" template?
2. `taskAlignment` — do the tasks require applying the case's specific facts, not answerable without reading the situation at all?
3. `keyQuality` — does the model answer directly resolve the tasks with reasoning, not just restate the situation?
4. `rubricSpecificity` — are the rubric criteria specific to this case (not generic "correctness"/"clarity" that would fit any case)?
5. `levelFit` — is the complexity appropriate for the stated audience (school senior grades vs university)?

**Halollik chegarasi:** real tashkilot nomi, real statistik ko'rsatkich
yoki "haqiqiy voqea"ga asoslanganlik **da'vo qilinmasin** — model
uydirgan vaziyat sifatida taqdim etilishi kerak (masalan "quyidagi
vaziyat o'quv maqsadida tuzilgan" kabi ochiq belgi shart emas, lekin
aniq sana/firma/statistika "haqiqiy" deb ko'rsatilmasligi kerak).
Hozirgi `keysSystemPrompt` da bu qoida **aniq yozilmagan** — dars
rejasidagi "Uydirma muallif va dastur nomi yozmang" naqshi bo'yicha
kengaytirilishi tavsiya etiladi: "Real tashkilot/statistika/voqea
uydirmang, fiktiv vaziyat sifatida yozing."

## 5. Namunalar

- Business case grading rubric namunasi (mezon → ball, tuzilma uchun
  foydali, biznes kontekstida ammo mezon shakli universal):
  [iRubric T92B68](https://www.rcampus.com/rubricshowc.cfm?sp=yes&code=T92B68).
- Harvard Business School case method — "teaching note" tushunchasi
  (o'qituvchi uchun alohida qo'llanma g'oyasi, bizga hozircha kerak
  emas, lekin kontekst uchun foydali):
  [hbs.edu/case-method-project](https://www.hbs.edu/case-method-project/about/Pages/case-method-teaching.aspx).
- Keys-stadi 10-komponentli tuzilma tavsifi (o'zbek tilida, umumiy
  pedagogika manbai): [oefen.uz](https://oefen.uz/uz/documents/referatlar/umumiy/ta-lim-jarayonida-keys-stadi-texnologiyasi).

**LLM uchun yaxshi/yomon misol:**

- ✅ Yaxshi (vaziyat, pedagogika fani uchun `muammoli` tur): «5-sinf
  o'qituvchisi Nilufar opa yangi mavzuni tushuntirgach, sinfning yarmi
  topshiriqni bajara olmadi. Sinf jurnalida bu mavzu bo'yicha oldingi
  ikki darsda ham past ball qayd etilgan. Nilufar opa darsni qanday
  qayta rejalashtirishi kerak?» — aniq rol, aniq muammo belgisi
  (jurnal ma'lumoti), ochiq savol.
- ❌ Yomon: «Bir maktabda muammo yuzaga keldi. O'qituvchi nima qilishi
  kerak edi?» — na ism, na aniq muammo, na kontekst; `situationLength`
  va judge `situationRealism` buni rad etishi kerak.

## 6. Ochiq savollar / egasidan kerak narsalar

1. Rasmiy keys-stadi shakli (band raqamlari bilan) topilmadi — R1dagi
   kabi savol: amaldagi "mini-keys" konventsiyasi bilan davom etamizmi,
   yoki egasi OTM metodkabinetidan real namunaviy hujjat topib bera
   oladimi (`reja.tdpu.uz` sahifasi SSL xatosi bilan ochilmadi — qo'lda
   tekshirish kerak bo'lishi mumkin)?
2. `caseCount` (3/5/8) — glossariy `termCount` kabi narxga bog'lab
   qo'yish kerakmi, yoki hozirgi "narx o'zgarmaydi" qarori (AUDIT-20 §1
   band 6: "parametrlar narxga ta'sir qilmaydi") shu yerda ham
   qat'iymi? (Eslatma: AUDIT-20 umumiy qarorlari — bu 9 YANGI xizmatga
   tegishli, mavjud 4 vosita narxi allaqachon o'zgarmas deb belgilangan;
   `caseCount` shunchaki son o'zgarishi, narx pog'onasi emas — lekin
   aniqlashtirish kerak.)
3. `audience` (maktab yuqori sinf / OTM) qo'shish — 5-ball (OTM,
   86-emas 90-100) va 5-ball (maktab, 86-100) tizimlari FARQLI
   ([lex.uz/docs/-3916793](https://lex.uz/docs/-3916793) vs
   [lex.uz/docs/1650580](https://lex.uz/docs/1650580)); agar kelajakda
   rubrika ballarini rasmiy shkalaga moslashtirish kerak bo'lsa (hozir
   ichki 10 ballik, rasmiy tizimga bog'liq emas), qaysi audiyToriya
   uchun qaysi shkala ishlatilishi aniqlanishi kerak.
4. Keys turlari (`tahliliy`/`muammoli`/`qaror-qabul-qilish`/`rolli`) —
   xalqaro case-method adabiyotidan olingan tasnif, O'zbekiston rasmiy
   hujjatida topilmadi. Shu 4 turni qabul qilishga roziIikmi, yoki
   sodda.ai/boshqa manbadan aniq tur nomlari kelib chiqishi kerakmi
   (ularning sahifasi JS orqali yuklanadi, statik tekshiruvda
   ko'rinmadi)?
