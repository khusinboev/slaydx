-- Studio P2b (docs/studio/P2B-SPEC.md, PLAN §5.6): the prompt library («Namuna promptlar») and image templates
-- («Shablonlar») of the Studio «Rasm» tab, edited in the admin «Studio kutubxonasi» page.
--
-- studio_prompts: curated prompts by category; tapping one fills the prompt box.
--   category     one of lib/media/library.ts LIBRARY_CATEGORIES (checked by the app, so a new category needs no
--                migration); title / prompt: Uzbek text (prompt ≤ 500 = the Studio prompt limit, IMAGE_PROMPT_LIMIT).
--   preview_id   optional preview picture (studio_library_previews.id, served publicly by
--                GET /api/media/library/preview/<id>).
--   sort         display order inside the category (smaller first); enabled = FALSE hides it from the public read.
--   seed_key     set on the rows seeded below, so a re-run never duplicates them (ON CONFLICT DO NOTHING).
-- studio_templates: a Studio picture model + preset values of its ParamSchema + a prompt skeleton with `{slot}`
--   placeholders and the slot declarations [{name, label, placeholder?, max}]. The app validates every write against
--   the live catalog (lib/media/library.ts templateError); the public read hides a template that no longer validates
--   or whose model is unavailable right now.
-- studio_library_previews: the preview pictures (PNG / JPEG ≤ 512 KB, id = sha256 prefix of the bytes).
--
-- Seed (data, idempotent): 40 library prompts (4 per category) and 10 templates on the current catalog models
-- (Nano Banana, FLUX 3, Seedream 5 Lite / Pro, Ideogram 4.5, Recraft 4.1 / Pro). No real people, no brands.
-- tests/studio-library.test.mts validates every seeded template against the catalog.
--
-- Additive only: three new tables, nothing existing changes.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS studio_templates;
--   DROP TABLE IF EXISTS studio_prompts;
--   DROP TABLE IF EXISTS studio_library_previews;
--   DELETE FROM schema_migrations WHERE name = '067_studio_library.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS studio_library_previews (
  id          TEXT        PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  mime        TEXT        NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  size_bytes  INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 524288),
  bytes       BYTEA       NOT NULL,
  created_by  BIGINT      REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_prompts (
  id          BIGSERIAL   PRIMARY KEY,
  category    TEXT        NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  title       TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  prompt      TEXT        NOT NULL CHECK (length(prompt) BETWEEN 3 AND 500),
  preview_id  TEXT        REFERENCES studio_library_previews(id) ON DELETE SET NULL,
  sort        INTEGER     NOT NULL DEFAULT 0,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  seed_key    TEXT        UNIQUE,
  updated_by  BIGINT      REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_prompts_public_idx ON studio_prompts (category, sort, id) WHERE enabled;

CREATE TABLE IF NOT EXISTS studio_templates (
  id          BIGSERIAL   PRIMARY KEY,
  category    TEXT        NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  title       TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  model_id    TEXT        NOT NULL CHECK (length(model_id) BETWEEN 1 AND 80),
  params      JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  skeleton    TEXT        NOT NULL CHECK (length(skeleton) BETWEEN 3 AND 500),
  slots       JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slots) = 'array'),
  preview_id  TEXT        REFERENCES studio_library_previews(id) ON DELETE SET NULL,
  sort        INTEGER     NOT NULL DEFAULT 0,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  seed_key    TEXT        UNIQUE,
  updated_by  BIGINT      REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_templates_public_idx ON studio_templates (sort, id) WHERE enabled;

INSERT INTO studio_prompts (seed_key, category, sort, title, prompt) VALUES
  ('p01', 'portret', 10, 'Studiyadagi portret', 'Yosh ayolning studiya portreti, yumshoq yon yorug''lik, kulrang fon, tabiiy teri, kulimsirab turibdi, yelkagacha kadr'),
  ('p02', 'portret', 20, 'Keksa usta', 'Keksa kulol ustaxonasida, qo''llarida loy ko''za, derazadan tushgan iliq tong nuri, yuzida chuqur ajinlar, hujjatli foto uslubida'),
  ('p03', 'portret', 30, 'Biznes portret', 'Ofis fonida o''ttiz yoshlardagi erkak, to''q ko''k kostyum, ishonchli nigoh, xira fon, LinkedIn profil surati uchun'),
  ('p04', 'portret', 40, 'Bola va kitob', 'Kutubxonada katta kitobni ochib o''tirgan qiz bola, hayratlangan yuz, iliq lampa nuri, yumshoq bokeh'),
  ('p05', 'mahsulot', 10, 'Atir shishasi', 'Oq marmar ustida shisha atir flakoni, orqada yumshoq soya, yon tomonda gul barglari, minimal reklama fotosurati'),
  ('p06', 'mahsulot', 20, 'Qo''l soati', 'Qora charm tasmali erkaklar qo''l soati, to''q yog''och stol, yon yorug''lik metallda yaltiraydi, makro foto'),
  ('p07', 'mahsulot', 30, 'Sport krossovkasi', 'Havoda suzib turgan oq-yashil yugurish krossovkasi, rangli gradient fon, tez harakat izlari, dinamik reklama kadri'),
  ('p08', 'mahsulot', 40, 'Asal bankasi', 'Shisha bankadagi tog'' asali, yog''och qoshiqdan oqib tushayotgan asal, yonida yong''oq va bodom, qishloq uslubidagi stol'),
  ('p09', 'logo', 10, 'Qahvaxona logotipi', 'Qahvaxona uchun sodda logotip: qahva donasi va bug'' chizig''i, ikki rang — jigarrang va krem, tekis vektor uslub, oq fon'),
  ('p10', 'logo', 20, 'IT kompaniya belgisi', 'Texnologiya kompaniyasi uchun geometrik belgi, bir-biriga ulangan uchburchaklar, ko''k va binafsha gradient, oq fon, minimal'),
  ('p11', 'logo', 30, 'Bolalar bog''chasi', 'Bolalar bog''chasi uchun quvnoq logotip: quyosh va kichik uycha, yorqin sariq va moviy ranglar, yumaloq shakllar'),
  ('p12', 'logo', 40, 'Sport klubi emblemasi', 'Futbol klubi uchun qalqon shaklidagi emblema, burgut boshi, qizil va oq ranglar, aniq kontur, vektor uslub'),
  ('p13', 'plakat', 10, 'Konsert afishasi', 'Jazz kechasi afishasi, saksofon siluyeti, to''q ko''k fon, oltin rangli chiziqlar, retro 1960-yillar uslubi, katta «JAZZ KECHASI» yozuvi'),
  ('p14', 'plakat', 20, 'Ekologik plakat', 'Tabiatni asrash haqida plakat: yer shari ichida yashil o''rmon, toza daryo, sodda tekis illyustratsiya, «Yerni asraylik» yozuvi'),
  ('p15', 'plakat', 30, 'Kino plakati', 'Fantastik film plakati, tun osmonida ulkan sayyora, tepalikda turgan yolg''iz yo''lovchi, kinematografik yorug''lik'),
  ('p16', 'plakat', 40, 'Kitob yarmarkasi', 'Kitob yarmarkasi e''loni, ochiq kitobdan uchib chiqayotgan qushlar, pastel ranglar, «Kitob bayrami» yozuvi, toza tipografiya'),
  ('p17', 'tabriknoma', 10, 'Tug''ilgan kun', 'Tug''ilgan kun tabriknomasi: rangli sharlar, konfetti, shamli tort, iliq ranglar, «Tug''ilgan kuningiz bilan!» yozuvi'),
  ('p18', 'tabriknoma', 20, 'Navro''z tabrigi', 'Navro''z bayrami tabriknomasi: sumalak qozoni, lolalar, bahor ko''katlari, milliy naqshli hoshiya, «Navro''z muborak!» yozuvi'),
  ('p19', 'tabriknoma', 30, 'To''y taklifnomasi', 'To''y taklifnomasi uchun nafis fon: oq atirgullar, oltin rangli ingichka naqsh, krem rang qog''oz teksturasi, matn uchun bo''sh joy'),
  ('p20', 'tabriknoma', 40, 'Ustozlar kuni', 'Ustoz va murabbiylar kuni tabriknomasi: kitoblar, gul guldasta, sinf doskasi, iliq kuzgi ranglar, «Ustozim, rahmat!» yozuvi'),
  ('p21', 'talim', 10, 'Quyosh tizimi', 'Quyosh tizimi sxemasi: sayyoralar tartib bilan, o''lchamlar nisbati, qora fon, darslik illyustratsiyasi uslubida, aniq va yorqin'),
  ('p22', 'talim', 20, 'Hujayra tuzilishi', 'O''simlik hujayrasining kesimi: yadro, xloroplastlar, vakuola, hujayra devori, rangli o''quv illyustratsiyasi, oq fon'),
  ('p23', 'talim', 30, 'Tarix darsi', 'Qadimiy karvon yo''li: tuyalar karvoni cho''l bo''ylab, uzoqda qal''a devorlari, quyosh botishi, tarix darsligi illyustratsiyasi'),
  ('p24', 'talim', 40, 'Kimyo laboratoriyasi', 'Maktab kimyo laboratoriyasi: kolbalarda rangli suyuqliklar, mikroskop, himoya ko''zoynagi, yorug'' va toza muhit'),
  ('p25', 'reklama', 10, 'Yangi kafe ochilishi', 'Yangi kafe ochilishi uchun reklama: issiq qahva va yangi pishgan non, iliq ichki makon, deraza ortida ertalabki shahar'),
  ('p26', 'reklama', 20, 'Onlayn kurs', 'Onlayn dasturlash kursi reklamasi: noutbuk ekranida kod, yonida qahva, zamonaviy ish stoli, ko''k-binafsha neon yorug''lik'),
  ('p27', 'reklama', 30, 'Mevali sharbat', 'Muzli stakanda apelsin sharbati, atrofida kesilgan apelsin bo''laklari va suv tomchilari, yorqin sariq fon, yozgi kayfiyat'),
  ('p28', 'reklama', 40, 'Fitnes zali', 'Fitnes zali reklamasi: gantel ko''tarayotgan sportchi, dramatik yon yorug''lik, qora fon, kuch va harakat hissi'),
  ('p29', 'tabiat', 10, 'Tog'' ko''li', 'Qorli tog''lar orasidagi moviy ko''l, suvda tog''larning aksi, tiniq tong havosi, yashil archalar, keng panorama'),
  ('p30', 'tabiat', 20, 'Lola dalasi', 'Bahorda qizil lolalar bilan qoplangan adir, uzoqda tog'' etagi, ochiq havo, oq bulutlar, yorqin quyosh'),
  ('p31', 'tabiat', 30, 'Kuzgi o''rmon', 'Kuzgi o''rmon so''qmog''i, sariq va qizil barglar, daraxtlar orasidan tushayotgan quyosh nurlari, tumanli havo'),
  ('p32', 'tabiat', 40, 'Cho''lda tun', 'Cho''l ustida yulduzli tun osmoni, Somon yo''li aniq ko''rinadi, qum barxanlari, sokin va sirli kayfiyat'),
  ('p33', 'arxitektura', 10, 'Zamonaviy uy', 'Zamonaviy ikki qavatli uy, katta shisha oynalar, yog''och va beton, hovlida basseyn, kechki iliq yoritish, arxitektura vizualizatsiyasi'),
  ('p34', 'arxitektura', 20, 'Tarixiy madrasa', 'Moviy koshinli gumbaz va peshtoqli qadimiy madrasa, naqshinkor devorlar, quyosh botishi, keng burchakli kadr'),
  ('p35', 'arxitektura', 30, 'Shinam interyer', 'Skandinaviya uslubidagi mehmonxona: yorug'' devorlar, yog''och mebel, yumshoq gilam, derazadan kunduzgi yorug''lik, o''simliklar'),
  ('p36', 'arxitektura', 40, 'Kelajak shahri', 'Kelajak shahri: yashil o''simliklar bilan qoplangan baland binolar, havoda uchuvchi transport, quyoshli kun, keng panorama'),
  ('p37', 'illyustratsiya', 10, 'Ertak qahramoni', 'Sehrli o''rmondagi kichik tulki, katta ko''zlar, yorqin qo''ziqorinlar, bolalar kitobi illyustratsiyasi, akvarel uslubi'),
  ('p38', 'illyustratsiya', 20, 'Kosmonavt mushuk', 'Skafandr kiygan mushuk Oy yuzasida turibdi, orqada Yer sayyorasi, quvnoq multfilm uslubi, yorqin ranglar'),
  ('p39', 'illyustratsiya', 30, 'Milliy naqsh', 'O''zbek milliy naqshlari asosida simmetrik bezak, ko''k, firuza va oltin ranglar, tekis vektor uslub, takrorlanuvchi naqsh'),
  ('p40', 'illyustratsiya', 40, 'Shahar kechasi', 'Yomg''irli kechada shahar ko''chasi, chiroqlarning ho''l asfaltdagi aksi, soyabonli yo''lovchilar, raqamli rasm uslubi')
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO studio_templates (seed_key, category, sort, title, model_id, params, skeleton, slots) VALUES
  ('t01', 'tabriknoma', 10, 'Tug''ilgan kun tabrigi', 'ideogram/ideogram',
   '{"imageRatio": "4:3", "imageCount": 1, "imageStyle": "illustration", "quality": "medium"}',
   'Tug''ilgan kun tabriknomasi, {bezak}, iliq va quvnoq ranglar, markazda «{ism}, tug''ilgan kuningiz bilan!» yozuvi',
   '[{"name": "ism", "label": "Ism", "placeholder": "Dilnoza", "max": 30}, {"name": "bezak", "label": "Bezak", "placeholder": "rangli sharlar va konfetti", "max": 80}]'),
  ('t02', 'tabriknoma', 20, 'Bayram tabriknomasi', 'ideogram/ideogram',
   '{"imageRatio": "1:1", "imageCount": 1, "imageStyle": "illustration", "quality": "medium"}',
   '{bayram} tabriknomasi, {belgilar}, milliy naqshli hoshiya, «{bayram} muborak!» yozuvi',
   '[{"name": "bayram", "label": "Bayram", "placeholder": "Navro''z", "max": 30}, {"name": "belgilar", "label": "Ramzlar", "placeholder": "lolalar va sumalak qozoni", "max": 80}]'),
  ('t03', 'logo', 10, 'Logotip', 'recraft/recraft',
   '{"imageRatio": "1:1", "imageCount": 2, "imageStyle": "minimal"}',
   '{soha} uchun sodda logotip: {belgi}, ranglar — {ranglar}, tekis vektor uslub, oq fon',
   '[{"name": "soha", "label": "Soha", "placeholder": "qahvaxona", "max": 40}, {"name": "belgi", "label": "Belgi", "placeholder": "qahva donasi va bug'' chizig''i", "max": 80}, {"name": "ranglar", "label": "Ranglar", "placeholder": "jigarrang va krem", "max": 40}]'),
  ('t04', 'logo', 20, 'Premium emblema', 'recraft/recraft-pro',
   '{"imageRatio": "1:1", "imageCount": 1, "imageStyle": "minimal"}',
   '{nom} uchun qalqon shaklidagi emblema, markazda {belgi}, {ranglar} ranglar, aniq kontur, vektor uslub',
   '[{"name": "nom", "label": "Tashkilot turi", "placeholder": "sport klubi", "max": 40}, {"name": "belgi", "label": "Markaziy belgi", "placeholder": "burgut boshi", "max": 60}, {"name": "ranglar", "label": "Ranglar", "placeholder": "qizil va oq", "max": 40}]'),
  ('t05', 'mahsulot', 10, 'Mahsulot fotosurati', 'bytedance/seedream-pro',
   '{"imageRatio": "1:1", "imageCount": 2, "imageStyle": "product"}',
   '{mahsulot}, {fon} ustida, yumshoq studiya yorug''ligi, aniq soya, reklama fotosurati',
   '[{"name": "mahsulot", "label": "Mahsulot", "placeholder": "shisha atir flakoni", "max": 80}, {"name": "fon", "label": "Fon", "placeholder": "oq marmar", "max": 40}]'),
  ('t06', 'portret', 10, 'Professional portret', 'bfl/flux',
   '{"imageRatio": "3:4", "imageCount": 2, "imageStyle": "photo"}',
   '{kim}ning professional portreti, {kiyim}, {fon} fonida, yumshoq yon yorug''lik, yelkagacha kadr',
   '[{"name": "kim", "label": "Kim", "placeholder": "o''ttiz yoshlardagi ayol", "max": 60}, {"name": "kiyim", "label": "Kiyim", "placeholder": "to''q ko''k kostyum", "max": 50}, {"name": "fon", "label": "Fon", "placeholder": "xira ofis", "max": 40}]'),
  ('t07', 'plakat', 10, 'Tadbir afishasi', 'ideogram/ideogram',
   '{"imageRatio": "3:4", "imageCount": 1, "imageStyle": "illustration", "quality": "medium"}',
   '{tadbir} afishasi, {tasvir}, {uslub} uslubida, yuqorida katta «{sarlavha}» yozuvi, pastda «{sana}» yozuvi',
   '[{"name": "tadbir", "label": "Tadbir", "placeholder": "jazz kechasi", "max": 40}, {"name": "tasvir", "label": "Tasvir", "placeholder": "saksofon siluyeti", "max": 60}, {"name": "uslub", "label": "Uslub", "placeholder": "retro 1960-yillar", "max": 40}, {"name": "sarlavha", "label": "Sarlavha", "placeholder": "JAZZ KECHASI", "max": 40}, {"name": "sana", "label": "Sana", "placeholder": "15-noyabr, 19:00", "max": 30}]'),
  ('t08', 'reklama', 10, 'Ijtimoiy tarmoq posti', 'google/nano-banana',
   '{"imageRatio": "9:16", "imageCount": 2, "imageStyle": "photo"}',
   '{mahsulot} reklamasi, {joy}, {kayfiyat} kayfiyat, matn uchun yuqorida bo''sh joy',
   '[{"name": "mahsulot", "label": "Nima reklama qilinadi", "placeholder": "issiq qahva va yangi non", "max": 80}, {"name": "joy", "label": "Joy", "placeholder": "iliq kafe ichida", "max": 60}, {"name": "kayfiyat", "label": "Kayfiyat", "placeholder": "ertalabki iliq", "max": 30}]'),
  ('t09', 'talim', 10, 'Dars uchun illyustratsiya', 'bytedance/seedream',
   '{"imageRatio": "16:9", "imageCount": 1, "imageStyle": "illustration"}',
   '{mavzu} bo''yicha darslik illyustratsiyasi: {tafsilot}, aniq va yorqin, oq fon',
   '[{"name": "mavzu", "label": "Mavzu", "placeholder": "o''simlik hujayrasi", "max": 60}, {"name": "tafsilot", "label": "Nimalar ko''rinsin", "placeholder": "yadro, xloroplastlar, vakuola", "max": 120}]'),
  ('t10', 'tabiat', 10, 'Manzara', 'bytedance/seedream',
   '{"imageRatio": "16:9", "imageCount": 2, "imageStyle": "cinematic"}',
   '{joy} manzarasi, {fasl}, {vaqt}, keng panorama, tabiiy ranglar',
   '[{"name": "joy", "label": "Joy", "placeholder": "qorli tog''lar orasidagi ko''l", "max": 80}, {"name": "fasl", "label": "Fasl", "placeholder": "erta bahor", "max": 30}, {"name": "vaqt", "label": "Kun vaqti", "placeholder": "tong", "max": 30}]')
ON CONFLICT (seed_key) DO NOTHING;
