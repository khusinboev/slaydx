-- Studio package G (docs/studio/P11-SPEC.md «G. Templates and automatic prompts»): the library grows from the «Rasm» tab to
-- every prompt box, and its text becomes English (owner decision 2026-11-07).
--
-- studio_prompts.media / studio_templates.media: which box a row opens from. A prompt is image, video, music or sfx; a
--   template is image or video. Existing rows are pictures (the default). The categories of each kind are in
--   lib/media/library.ts categoriesOf (checked by the app, as 067 does).
-- Video templates: `model_id` is a SUGGESTED model. The public read lists them whichever clip models are on; the page applies
--   one to the suggested model, else to the model on screen (lib/server/media/library.ts publicTemplates, VideoTab).
-- Slots: `fallback` (English) is what an empty slot puts into the prompt; `placeholder` stays the Uzbek example of the input.
--
-- Data, idempotent and safe for admin edits:
--   * the 40 prompts and 10 skeletons of 067 turn English ONLY where `seed_key` matches AND the text is still the seeded text,
--     so a row an admin changed is left alone. Titles stay Uzbek. Quoted on-screen text stays verbatim.
--   * the slots of the 10 templates gain `fallback` under the same rule.
--   * new seeds: 12 video templates, 24 video prompts, 8 music prompts, 8 sound effect prompts, ON CONFLICT (seed_key) DO NOTHING.
--     Uzbek titles and slot labels, English text; no real people, no brands. tests/studio-library.test.mts validates every
--     seeded template against the catalog.
--
-- Additive: two columns with a default, new rows. The English text replaces seeded data only, which 067 still holds; a
-- rollback keeps it (the same content in English). A rollback deletes every non-image row, an admin's too: without the column
-- such a row would turn into a picture row.
--
-- ROLLBACK:
--   DELETE FROM studio_templates WHERE media <> 'image';
--   DELETE FROM studio_prompts WHERE media <> 'image';
--   ALTER TABLE studio_templates DROP COLUMN IF EXISTS media;
--   ALTER TABLE studio_prompts DROP COLUMN IF EXISTS media;
--   DELETE FROM schema_migrations WHERE name = '076_studio_library_media.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE studio_prompts ADD COLUMN IF NOT EXISTS media TEXT NOT NULL DEFAULT 'image' CHECK (media IN ('image', 'video', 'music', 'sfx'));
ALTER TABLE studio_templates ADD COLUMN IF NOT EXISTS media TEXT NOT NULL DEFAULT 'image' CHECK (media IN ('image', 'video'));

UPDATE studio_prompts p SET prompt = v.en, updated_at = now()
  FROM (VALUES
    ('p01', 'Yosh ayolning studiya portreti, yumshoq yon yorug''lik, kulrang fon, tabiiy teri, kulimsirab turibdi, yelkagacha kadr',
     'Studio portrait of a young woman, soft side light, grey background, natural skin, gentle smile, framed from the shoulders up'),
    ('p02', 'Keksa kulol ustaxonasida, qo''llarida loy ko''za, derazadan tushgan iliq tong nuri, yuzida chuqur ajinlar, hujjatli foto uslubida',
     'Elderly potter in his workshop holding a clay jug, warm morning light through the window, deep wrinkles on his face, documentary photo style'),
    ('p03', 'Ofis fonida o''ttiz yoshlardagi erkak, to''q ko''k kostyum, ishonchli nigoh, xira fon, rezyume va ish profili uchun surat',
     'Man in his thirties in an office setting, dark blue suit, confident gaze, blurred background, a photo for a resume and work profile'),
    ('p04', 'Kutubxonada katta kitobni ochib o''tirgan qiz bola, hayratlangan yuz, iliq lampa nuri, yumshoq bokeh',
     'Little girl sitting in a library with a big open book, amazed face, warm lamp light, soft bokeh'),
    ('p05', 'Oq marmar ustida shisha atir flakoni, orqada yumshoq soya, yon tomonda gul barglari, minimal reklama fotosurati',
     'Glass perfume bottle on white marble, soft shadow behind it, flower petals to one side, minimal advertising photo'),
    ('p06', 'Qora charm tasmali erkaklar qo''l soati, to''q yog''och stol, yon yorug''lik metallda yaltiraydi, makro foto',
     'Men''s wristwatch with a black leather strap on a dark wooden table, side light glinting on the metal, macro photo'),
    ('p07', 'Havoda suzib turgan oq-yashil yugurish krossovkasi, rangli gradient fon, tez harakat izlari, dinamik reklama kadri',
     'White and green running shoe floating in the air, colourful gradient background, fast motion trails, dynamic advertising shot'),
    ('p08', 'Shisha bankadagi tog'' asali, yog''och qoshiqdan oqib tushayotgan asal, yonida yong''oq va bodom, qishloq uslubidagi stol',
     'Mountain honey in a glass jar, honey dripping from a wooden spoon, walnuts and almonds beside it, rustic table'),
    ('p09', 'Qahvaxona uchun sodda logotip: qahva donasi va bug'' chizig''i, ikki rang — jigarrang va krem, tekis vektor uslub, oq fon',
     'Simple logo for a coffee shop: a coffee bean and a line of steam, two colours brown and cream, flat vector style, white background'),
    ('p10', 'Texnologiya kompaniyasi uchun geometrik belgi, bir-biriga ulangan uchburchaklar, ko''k va binafsha gradient, oq fon, minimal',
     'Geometric mark for a technology company, interlocking triangles, blue and purple gradient, white background, minimal'),
    ('p11', 'Bolalar bog''chasi uchun quvnoq logotip: quyosh va kichik uycha, yorqin sariq va moviy ranglar, yumaloq shakllar',
     'Cheerful logo for a kindergarten: a sun and a small house, bright yellow and sky blue, rounded shapes'),
    ('p12', 'Futbol klubi uchun qalqon shaklidagi emblema, burgut boshi, qizil va oq ranglar, aniq kontur, vektor uslub',
     'Shield-shaped emblem for a football club, eagle head, red and white, clean outline, vector style'),
    ('p13', 'Jazz kechasi afishasi, saksofon siluyeti, to''q ko''k fon, oltin rangli chiziqlar, retro 1960-yillar uslubi, katta «JAZZ KECHASI» yozuvi',
     'Jazz night poster, saxophone silhouette, dark blue background, golden lines, retro 1960s style, large «JAZZ KECHASI» lettering'),
    ('p14', 'Tabiatni asrash haqida plakat: yer shari ichida yashil o''rmon, toza daryo, sodda tekis illyustratsiya, «Yerni asraylik» yozuvi',
     'Poster about protecting nature: a green forest and a clean river inside the globe, simple flat illustration, the lettering «Yerni asraylik»'),
    ('p15', 'Fantastik film plakati, tun osmonida ulkan sayyora, tepalikda turgan yolg''iz yo''lovchi, kinematografik yorug''lik',
     'Science fiction film poster, a giant planet in the night sky, a lone traveller standing on a hill, cinematic lighting'),
    ('p16', 'Kitob yarmarkasi e''loni, ochiq kitobdan uchib chiqayotgan qushlar, pastel ranglar, «Kitob bayrami» yozuvi, toza tipografiya',
     'Book fair announcement, birds flying out of an open book, pastel colours, the lettering «Kitob bayrami», clean typography'),
    ('p17', 'Tug''ilgan kun tabriknomasi: rangli sharlar, konfetti, shamli tort, iliq ranglar, «Tug''ilgan kuningiz bilan!» yozuvi',
     'Birthday greeting card: colourful balloons, confetti, a cake with candles, warm colours, the lettering «Tug''ilgan kuningiz bilan!»'),
    ('p18', 'Navro''z bayrami tabriknomasi: sumalak qozoni, lolalar, bahor ko''katlari, milliy naqshli hoshiya, «Navro''z muborak!» yozuvi',
     'Navruz holiday greeting card: a pot of sumalak, tulips, spring greens, a border of national ornament, the lettering «Navro''z muborak!»'),
    ('p19', 'To''y taklifnomasi uchun nafis fon: oq atirgullar, oltin rangli ingichka naqsh, krem rang qog''oz teksturasi, matn uchun bo''sh joy',
     'Elegant background for a wedding invitation: white roses, a thin golden ornament, cream paper texture, empty space for text'),
    ('p20', 'Ustoz va murabbiylar kuni tabriknomasi: kitoblar, gul guldasta, sinf doskasi, iliq kuzgi ranglar, «Ustozim, rahmat!» yozuvi',
     'Teachers'' Day greeting card: books, a bouquet of flowers, a classroom blackboard, warm autumn colours, the lettering «Ustozim, rahmat!»'),
    ('p21', 'Quyosh tizimi sxemasi: sayyoralar tartib bilan, o''lchamlar nisbati, qora fon, darslik illyustratsiyasi uslubida, aniq va yorqin',
     'Diagram of the solar system: planets in order, relative sizes, black background, textbook illustration style, clear and bright'),
    ('p22', 'O''simlik hujayrasining kesimi: yadro, xloroplastlar, vakuola, hujayra devori, rangli o''quv illyustratsiyasi, oq fon',
     'Cross-section of a plant cell: nucleus, chloroplasts, vacuole, cell wall, colourful educational illustration, white background'),
    ('p23', 'Qadimiy karvon yo''li: tuyalar karvoni cho''l bo''ylab, uzoqda qal''a devorlari, quyosh botishi, tarix darsligi illyustratsiyasi',
     'Ancient caravan route: a camel caravan crossing the desert, fortress walls in the distance, sunset, history textbook illustration'),
    ('p24', 'Maktab kimyo laboratoriyasi: kolbalarda rangli suyuqliklar, mikroskop, himoya ko''zoynagi, yorug'' va toza muhit',
     'School chemistry lab: flasks of coloured liquids, a microscope, safety goggles, bright and clean setting'),
    ('p25', 'Yangi kafe ochilishi uchun reklama: issiq qahva va yangi pishgan non, iliq ichki makon, deraza ortida ertalabki shahar',
     'Advertisement for a new cafe opening: hot coffee and freshly baked bread, warm interior, the morning city behind the window'),
    ('p26', 'Onlayn dasturlash kursi reklamasi: noutbuk ekranida kod, yonida qahva, zamonaviy ish stoli, ko''k-binafsha neon yorug''lik',
     'Advertisement for an online programming course: code on a laptop screen, coffee beside it, modern desk, blue and purple neon light'),
    ('p27', 'Muzli stakanda apelsin sharbati, atrofida kesilgan apelsin bo''laklari va suv tomchilari, yorqin sariq fon, yozgi kayfiyat',
     'Orange juice in a glass with ice, sliced oranges and water droplets around it, bright yellow background, summer mood'),
    ('p28', 'Fitnes zali reklamasi: gantel ko''tarayotgan sportchi, dramatik yon yorug''lik, qora fon, kuch va harakat hissi',
     'Gym advertisement: an athlete lifting a dumbbell, dramatic side light, black background, a feeling of strength and motion'),
    ('p29', 'Qorli tog''lar orasidagi moviy ko''l, suvda tog''larning aksi, tiniq tong havosi, yashil archalar, keng panorama',
     'Blue lake among snowy mountains, the mountains reflected in the water, crisp morning air, green spruces, wide panorama'),
    ('p30', 'Bahorda qizil lolalar bilan qoplangan adir, uzoqda tog'' etagi, ochiq havo, oq bulutlar, yorqin quyosh',
     'Hillside covered with red tulips in spring, foothills in the distance, open air, white clouds, bright sun'),
    ('p31', 'Kuzgi o''rmon so''qmog''i, sariq va qizil barglar, daraxtlar orasidan tushayotgan quyosh nurlari, tumanli havo',
     'Autumn forest path, yellow and red leaves, sunbeams falling between the trees, misty air'),
    ('p32', 'Cho''l ustida yulduzli tun osmoni, Somon yo''li aniq ko''rinadi, qum barxanlari, sokin va sirli kayfiyat',
     'Starry night sky over the desert, the Milky Way clearly visible, sand dunes, calm and mysterious mood'),
    ('p33', 'Zamonaviy ikki qavatli uy, katta shisha oynalar, yog''och va beton, hovlida basseyn, kechki iliq yoritish, arxitektura vizualizatsiyasi',
     'Modern two-storey house, large glass windows, wood and concrete, a pool in the yard, warm evening lighting, architectural visualization'),
    ('p34', 'Moviy koshinli gumbaz va peshtoqli qadimiy madrasa, naqshinkor devorlar, quyosh botishi, keng burchakli kadr',
     'Ancient madrasa with a blue tiled dome and a tall portal, ornate walls, sunset, wide-angle shot'),
    ('p35', 'Skandinaviya uslubidagi mehmonxona: yorug'' devorlar, yog''och mebel, yumshoq gilam, derazadan kunduzgi yorug''lik, o''simliklar',
     'Scandinavian-style living room: light walls, wooden furniture, a soft rug, daylight through the window, plants'),
    ('p36', 'Kelajak shahri: yashil o''simliklar bilan qoplangan baland binolar, havoda uchuvchi transport, quyoshli kun, keng panorama',
     'City of the future: tall buildings covered with green plants, flying transport in the air, sunny day, wide panorama'),
    ('p37', 'Sehrli o''rmondagi kichik tulki, katta ko''zlar, yorqin qo''ziqorinlar, bolalar kitobi illyustratsiyasi, akvarel uslubi',
     'Little fox in a magic forest, big eyes, bright mushrooms, children''s book illustration, watercolour style'),
    ('p38', 'Skafandr kiygan mushuk Oy yuzasida turibdi, orqada Yer sayyorasi, quvnoq multfilm uslubi, yorqin ranglar',
     'Cat in a spacesuit standing on the surface of the Moon, planet Earth behind it, cheerful cartoon style, bright colours'),
    ('p39', 'O''zbek milliy naqshlari asosida simmetrik bezak, ko''k, firuza va oltin ranglar, tekis vektor uslub, takrorlanuvchi naqsh',
     'Symmetric ornament based on Uzbek national patterns, blue, turquoise and gold, flat vector style, repeating pattern'),
    ('p40', 'Yomg''irli kechada shahar ko''chasi, chiroqlarning ho''l asfaltdagi aksi, soyabonli yo''lovchilar, raqamli rasm uslubi',
     'City street on a rainy night, street lights reflected on the wet asphalt, passers-by with umbrellas, digital painting style')
  ) AS v(seed_key, seeded, en)
 WHERE p.seed_key = v.seed_key AND p.prompt = v.seeded;

UPDATE studio_templates t SET skeleton = v.en, updated_at = now()
  FROM (VALUES
    ('t01', 'Tug''ilgan kun tabriknomasi, {bezak}, iliq va quvnoq ranglar, markazda «{ism}, tug''ilgan kuningiz bilan!» yozuvi',
     'Birthday greeting card, {bezak}, warm and cheerful colours, the lettering «{ism}, tug''ilgan kuningiz bilan!» in the centre'),
    ('t02', '{bayram} tabriknomasi, {belgilar}, milliy naqshli hoshiya, «{bayram} muborak!» yozuvi',
     '{bayram} greeting card, {belgilar}, a border of national ornament, the lettering «{bayram} muborak!»'),
    ('t03', '{soha} uchun sodda logotip: {belgi}, ranglar — {ranglar}, tekis vektor uslub, oq fon',
     'Simple logo for {soha}: {belgi}, colours {ranglar}, flat vector style, white background'),
    ('t04', '{nom} uchun qalqon shaklidagi emblema, markazda {belgi}, {ranglar} ranglar, aniq kontur, vektor uslub',
     'Shield-shaped emblem for {nom}, {belgi} in the centre, {ranglar} colours, clean outline, vector style'),
    ('t05', '{mahsulot}, {fon} ustida, yumshoq studiya yorug''ligi, aniq soya, reklama fotosurati',
     '{mahsulot} on {fon}, soft studio light, crisp shadow, advertising photo'),
    ('t06', '{kim}ning professional portreti, {kiyim}, {fon} fonida, yumshoq yon yorug''lik, yelkagacha kadr',
     'Professional portrait of {kim}, {kiyim}, {fon} background, soft side light, framed from the shoulders up'),
    ('t07', '{tadbir} afishasi, {tasvir}, {uslub} uslubida, yuqorida katta «{sarlavha}» yozuvi, pastda «{sana}» yozuvi',
     '{tadbir} poster, {tasvir}, {uslub} style, large «{sarlavha}» lettering at the top, «{sana}» lettering at the bottom'),
    ('t08', '{mahsulot} reklamasi, {joy}, {kayfiyat} kayfiyat, matn uchun yuqorida bo''sh joy',
     'Advertisement for {mahsulot}, {joy}, {kayfiyat} mood, empty space for text at the top'),
    ('t09', '{mavzu} bo''yicha darslik illyustratsiyasi: {tafsilot}, aniq va yorqin, oq fon',
     'Textbook illustration on {mavzu}: {tafsilot}, clear and bright, white background'),
    ('t10', '{joy} manzarasi, {fasl}, {vaqt}, keng panorama, tabiiy ranglar',
     'Landscape of {joy}, {fasl}, {vaqt}, wide panorama, natural colours')
  ) AS v(seed_key, seeded, en)
 WHERE t.seed_key = v.seed_key AND t.skeleton = v.seeded;

UPDATE studio_templates t SET slots = v.en::jsonb, updated_at = now()
  FROM (VALUES
    ('t01', '[{"name": "ism", "label": "Ism", "placeholder": "Dilnoza", "max": 30}, {"name": "bezak", "label": "Bezak", "placeholder": "rangli sharlar va konfetti", "max": 80}]',
     '[{"name": "ism", "label": "Ism", "placeholder": "Dilnoza", "max": 30}, {"name": "bezak", "label": "Bezak", "placeholder": "rangli sharlar va konfetti", "max": 80, "fallback": "colourful balloons and confetti"}]'),
    ('t02', '[{"name": "bayram", "label": "Bayram", "placeholder": "Navro''z", "max": 30}, {"name": "belgilar", "label": "Ramzlar", "placeholder": "lolalar va sumalak qozoni", "max": 80}]',
     '[{"name": "bayram", "label": "Bayram", "placeholder": "Navro''z", "max": 30}, {"name": "belgilar", "label": "Ramzlar", "placeholder": "lolalar va sumalak qozoni", "max": 80, "fallback": "tulips and a pot of sumalak"}]'),
    ('t03', '[{"name": "soha", "label": "Soha", "placeholder": "qahvaxona", "max": 40}, {"name": "belgi", "label": "Belgi", "placeholder": "qahva donasi va bug'' chizig''i", "max": 80}, {"name": "ranglar", "label": "Ranglar", "placeholder": "jigarrang va krem", "max": 40}]',
     '[{"name": "soha", "label": "Soha", "placeholder": "qahvaxona", "max": 40, "fallback": "a coffee shop"}, {"name": "belgi", "label": "Belgi", "placeholder": "qahva donasi va bug'' chizig''i", "max": 80, "fallback": "a coffee bean and a line of steam"}, {"name": "ranglar", "label": "Ranglar", "placeholder": "jigarrang va krem", "max": 40, "fallback": "brown and cream"}]'),
    ('t04', '[{"name": "nom", "label": "Tashkilot turi", "placeholder": "sport klubi", "max": 40}, {"name": "belgi", "label": "Markaziy belgi", "placeholder": "burgut boshi", "max": 60}, {"name": "ranglar", "label": "Ranglar", "placeholder": "qizil va oq", "max": 40}]',
     '[{"name": "nom", "label": "Tashkilot turi", "placeholder": "sport klubi", "max": 40, "fallback": "a sports club"}, {"name": "belgi", "label": "Markaziy belgi", "placeholder": "burgut boshi", "max": 60, "fallback": "an eagle head"}, {"name": "ranglar", "label": "Ranglar", "placeholder": "qizil va oq", "max": 40, "fallback": "red and white"}]'),
    ('t05', '[{"name": "mahsulot", "label": "Mahsulot", "placeholder": "shisha atir flakoni", "max": 80}, {"name": "fon", "label": "Fon", "placeholder": "oq marmar", "max": 40}]',
     '[{"name": "mahsulot", "label": "Mahsulot", "placeholder": "shisha atir flakoni", "max": 80, "fallback": "a glass perfume bottle"}, {"name": "fon", "label": "Fon", "placeholder": "oq marmar", "max": 40, "fallback": "white marble"}]'),
    ('t06', '[{"name": "kim", "label": "Kim", "placeholder": "o''ttiz yoshlardagi ayol", "max": 60}, {"name": "kiyim", "label": "Kiyim", "placeholder": "to''q ko''k kostyum", "max": 50}, {"name": "fon", "label": "Fon", "placeholder": "xira ofis", "max": 40}]',
     '[{"name": "kim", "label": "Kim", "placeholder": "o''ttiz yoshlardagi ayol", "max": 60, "fallback": "a woman in her thirties"}, {"name": "kiyim", "label": "Kiyim", "placeholder": "to''q ko''k kostyum", "max": 50, "fallback": "dark blue suit"}, {"name": "fon", "label": "Fon", "placeholder": "xira ofis", "max": 40, "fallback": "blurred office"}]'),
    ('t07', '[{"name": "tadbir", "label": "Tadbir", "placeholder": "jazz kechasi", "max": 40}, {"name": "tasvir", "label": "Tasvir", "placeholder": "saksofon siluyeti", "max": 60}, {"name": "uslub", "label": "Uslub", "placeholder": "retro 1960-yillar", "max": 40}, {"name": "sarlavha", "label": "Sarlavha", "placeholder": "JAZZ KECHASI", "max": 40}, {"name": "sana", "label": "Sana", "placeholder": "15-noyabr, 19:00", "max": 30}]',
     '[{"name": "tadbir", "label": "Tadbir", "placeholder": "jazz kechasi", "max": 40, "fallback": "jazz night"}, {"name": "tasvir", "label": "Tasvir", "placeholder": "saksofon siluyeti", "max": 60, "fallback": "saxophone silhouette"}, {"name": "uslub", "label": "Uslub", "placeholder": "retro 1960-yillar", "max": 40, "fallback": "retro 1960s"}, {"name": "sarlavha", "label": "Sarlavha", "placeholder": "JAZZ KECHASI", "max": 40}, {"name": "sana", "label": "Sana", "placeholder": "15-noyabr, 19:00", "max": 30}]'),
    ('t08', '[{"name": "mahsulot", "label": "Nima reklama qilinadi", "placeholder": "issiq qahva va yangi non", "max": 80}, {"name": "joy", "label": "Joy", "placeholder": "iliq kafe ichida", "max": 60}, {"name": "kayfiyat", "label": "Kayfiyat", "placeholder": "ertalabki iliq", "max": 30}]',
     '[{"name": "mahsulot", "label": "Nima reklama qilinadi", "placeholder": "issiq qahva va yangi non", "max": 80, "fallback": "hot coffee and fresh bread"}, {"name": "joy", "label": "Joy", "placeholder": "iliq kafe ichida", "max": 60, "fallback": "inside a warm cafe"}, {"name": "kayfiyat", "label": "Kayfiyat", "placeholder": "ertalabki iliq", "max": 30, "fallback": "warm morning"}]'),
    ('t09', '[{"name": "mavzu", "label": "Mavzu", "placeholder": "o''simlik hujayrasi", "max": 60}, {"name": "tafsilot", "label": "Nimalar ko''rinsin", "placeholder": "yadro, xloroplastlar, vakuola", "max": 120}]',
     '[{"name": "mavzu", "label": "Mavzu", "placeholder": "o''simlik hujayrasi", "max": 60, "fallback": "a plant cell"}, {"name": "tafsilot", "label": "Nimalar ko''rinsin", "placeholder": "yadro, xloroplastlar, vakuola", "max": 120, "fallback": "nucleus, chloroplasts, vacuole"}]'),
    ('t10', '[{"name": "joy", "label": "Joy", "placeholder": "qorli tog''lar orasidagi ko''l", "max": 80}, {"name": "fasl", "label": "Fasl", "placeholder": "erta bahor", "max": 30}, {"name": "vaqt", "label": "Kun vaqti", "placeholder": "tong", "max": 30}]',
     '[{"name": "joy", "label": "Joy", "placeholder": "qorli tog''lar orasidagi ko''l", "max": 80, "fallback": "a lake among snowy mountains"}, {"name": "fasl", "label": "Fasl", "placeholder": "erta bahor", "max": 30, "fallback": "early spring"}, {"name": "vaqt", "label": "Kun vaqti", "placeholder": "tong", "max": 30, "fallback": "dawn"}]')
  ) AS v(seed_key, seeded, en)
 WHERE t.seed_key = v.seed_key AND t.slots = v.seeded::jsonb;

INSERT INTO studio_prompts (seed_key, media, category, sort, title, prompt) VALUES
  ('vp01', 'video', 'reklama', 10, 'Mahsulot aylanmasi',
   'One continuous shot: a perfume bottle turns slowly on a black mirrored table, the camera orbits it at eye level, a thin line of warm light slides across the glass, fine dust glows in the beam, calm and premium mood'),
  ('vp02', 'video', 'reklama', 20, 'Issiq qahva',
   'One continuous shot: coffee pours into a white cup in slow motion on a wooden counter, the camera pushes in slowly as steam rises, soft morning window light from the left, shallow depth of field, cosy mood'),
  ('vp03', 'video', 'reklama', 30, 'Yugurish krossovkasi',
   'One continuous shot: a runner''s shoe strikes a wet city pavement in slow motion, the low camera tracks beside it, water drops fly up, neon reflections on the ground, night light, energetic pace'),
  ('vp04', 'video', 'reklama', 40, 'Yangi non',
   'One continuous shot: hands lift a round flatbread from a clay oven, the camera rises from the embers to the golden crust, warm firelight, flour in the air, smoke drifting, honest and appetising mood'),
  ('vp05', 'video', 'tabrik', 10, 'Tug''ilgan kun shamlari',
   'One continuous shot: candles on a birthday cake glow in a dark room, the camera drifts slowly closer, a soft breath blows them out and smoke curls upward, warm candlelight, confetti falling, joyful mood'),
  ('vp06', 'video', 'tabrik', 20, 'To''y gullari',
   'One continuous shot: white rose petals fall in slow motion over a long decorated table, the camera glides along it, golden evening light through tall windows, soft focus background, tender mood'),
  ('vp07', 'video', 'tabrik', 30, 'Navro''z bahori',
   'One continuous shot: red tulips open in the sun on a green hillside, the camera moves slowly forward at flower height, a warm spring breeze moves the grass, soft morning light, festive mood'),
  ('vp08', 'video', 'tabrik', 40, 'Yangi yil oqshomi',
   'One continuous shot: snow falls past a window with a glowing fir tree inside, the camera slowly pulls back into the snowy street, warm lights against blue dusk, quiet and happy mood'),
  ('vp09', 'video', 'talim', 10, 'Quyosh tizimi sayohati',
   'One continuous shot: the camera flies past the planets of the solar system in order, from Mercury to Saturn''s rings, sunlight falling from behind, deep black space, smooth steady motion, clear educational style'),
  ('vp10', 'video', 'talim', 20, 'Hujayra ichida',
   'One continuous shot: the camera travels through a plant cell, past green chloroplasts toward the glowing nucleus, translucent soft light, slow floating movement, clean educational animation style'),
  ('vp11', 'video', 'talim', 30, 'Yomg''ir qanday yog''adi',
   'One continuous shot: water rises from a lake as mist, forms a white cloud and falls as rain on a hill, the camera slowly tilts from the lake up to the sky and back, soft daylight, clear educational animation'),
  ('vp12', 'video', 'talim', 40, 'Kitobdan dunyo',
   'One continuous shot: pages of an open book turn by themselves on a school desk, small paper mountains and rivers rise from them, the camera descends into the pages, warm lamp light, magical mood'),
  ('vp13', 'video', 'tabiat', 10, 'Tog'' ko''li tongi',
   'One continuous shot: dawn over a still blue mountain lake, the camera glides low over the water toward snowy peaks, mist lifts from the surface, the first pink sunlight touches the summits, silent mood'),
  ('vp14', 'video', 'tabiat', 20, 'Lola adiri',
   'One continuous shot: wind ripples across a hillside of red tulips, the drone camera rises slowly to reveal distant mountains, white clouds drift, bright spring sunlight'),
  ('vp15', 'video', 'tabiat', 30, 'Kuzgi o''rmon',
   'One continuous shot: the camera walks along an autumn forest path, yellow leaves fall slowly, sunbeams cut through morning mist between the trees, gentle handheld motion, peaceful mood'),
  ('vp16', 'video', 'tabiat', 40, 'Yulduzli cho''l',
   'One continuous shot: the Milky Way wheels slowly above desert dunes in a time-lapse, the camera creeps forward along a dune ridge, deep blue night, faint moonlight on the sand, mysterious mood'),
  ('vp17', 'video', 'sayohat', 10, 'Tog'' yo''lida',
   'One continuous shot: a small car drives along a winding mountain road, the drone camera follows from behind and rises over the pass, long afternoon shadows, golden light, sense of freedom'),
  ('vp18', 'video', 'sayohat', 20, 'Qishloq bozori',
   'One continuous shot: the camera walks through a village market at a slow pace, piles of dried fruit and spices, sellers in the background, warm sunlight through canvas awnings, lively documentary feel'),
  ('vp19', 'video', 'sayohat', 30, 'Poyezd oynasidan',
   'One continuous shot: from inside a moving train, the camera looks through the window at steppe rolling past, rain drops streak the glass, soft grey light, then the sun breaks through the clouds, quiet mood'),
  ('vp20', 'video', 'sayohat', 40, 'Choyxonada oqshom',
   'One continuous shot: tea is poured into a blue bowl on a low wooden table, the camera rises to show a courtyard at dusk with warm lanterns, soft evening light, relaxed and friendly mood'),
  ('vp21', 'video', 'shahar', 10, 'Kechki shahar',
   'One continuous shot: the camera moves down a rainy city street at night, shop lights reflect on wet asphalt, people with umbrellas pass by, slow steady glide, blue and amber light, cinematic mood'),
  ('vp22', 'video', 'shahar', 20, 'Tarixiy gumbaz',
   'One continuous shot: the camera rises slowly along an ancient portal covered in blue tiles until a turquoise dome fills the frame, warm sunset light, doves circling, majestic mood'),
  ('vp23', 'video', 'shahar', 30, 'Kulol ustaxonasi',
   'One continuous shot: a potter''s hands shape wet clay on a spinning wheel, the camera slowly circles the wheel, soft window light in a dusty workshop, patient and focused mood, documentary style'),
  ('vp24', 'video', 'shahar', 40, 'Milliy raqs',
   'One continuous shot: a dancer in a bright national dress spins on a stage, the skirt opens like a flower, the camera circles her at waist height, warm stage light, festive mood')
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO studio_prompts (seed_key, media, category, sort, title, prompt) VALUES
  ('mp01', 'music', 'fon', 10, 'Sokin fortepiano',
   'Calm instrumental piano background, soft felt piano, gentle strings, slow tempo around 70 BPM, warm and reflective mood'),
  ('mp02', 'music', 'fon', 20, 'Lo-fi dars uchun',
   'Lo-fi hip hop instrumental for studying, dusty drums, mellow electric piano, vinyl crackle, relaxed tempo around 80 BPM'),
  ('mp03', 'music', 'fon', 30, 'Kino kirishi',
   'Cinematic instrumental intro, deep strings, soft piano, slow build to a warm orchestral swell, hopeful mood'),
  ('mp04', 'music', 'reklama', 10, 'Quvnoq reklama',
   'Upbeat instrumental for an advertisement, bright acoustic guitar, hand claps, light percussion, 120 BPM, cheerful and modern'),
  ('mp05', 'music', 'reklama', 20, 'Texnologiya',
   'Modern electronic instrumental for a technology video, clean synth pulses, tight drums, 110 BPM, confident and optimistic'),
  ('mp06', 'music', 'milliy', 10, 'Doira va dutor',
   'Instrumental in Central Asian folk style, dutar melody over a doira rhythm, medium tempo, warm and festive'),
  ('mp07', 'music', 'milliy', 20, 'Tong kuyi',
   'Slow instrumental in Central Asian style, nay flute and rubab, soft drone, calm morning mood'),
  ('mp08', 'music', 'milliy', 30, 'To''y kuyi',
   'Festive Central Asian wedding instrumental, karnay and surnay fanfare, fast doira rhythm, joyful crowd energy')
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO studio_prompts (seed_key, media, category, sort, title, prompt) VALUES
  ('sp01', 'sfx', 'tabiat', 10, 'Yomg''ir va momaqaldiroq',
   'Steady rain on a tin roof, distant rolling thunder, wide outdoor space, medium distance'),
  ('sp02', 'sfx', 'tabiat', 20, 'O''rmon tongi',
   'Birds singing in a quiet forest at dawn, light wind in the leaves, open and airy space'),
  ('sp03', 'sfx', 'tabiat', 30, 'Dengiz to''lqinlari',
   'Slow ocean waves breaking on a sandy beach, soft hiss of foam, wide open space'),
  ('sp04', 'sfx', 'shahar', 10, 'Eski eshik',
   'An old wooden door creaks open slowly in a quiet room, close distance, small room acoustics'),
  ('sp05', 'sfx', 'shahar', 20, 'Shahar shovqini',
   'Busy city street ambience, passing cars, distant horns, people talking far away, outdoor acoustics'),
  ('sp06', 'sfx', 'shahar', 30, 'Soat chiqillashi',
   'Mechanical wall clock ticking in a silent room, close distance, slight room echo'),
  ('sp07', 'sfx', 'interfeys', 10, 'Bildirishnoma',
   'A short soft digital notification chime, two rising notes, clean and dry, very close'),
  ('sp08', 'sfx', 'interfeys', 20, 'Muvaffaqiyat',
   'A short bright success jingle with a soft synth bell, clean and dry, very close')
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO studio_templates (seed_key, media, category, sort, title, model_id, params, skeleton, slots) VALUES
  ('vt01', 'video', 'reklama', 10, 'Mahsulot reklamasi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: {mahsulot} on {fon}, the camera orbits it slowly at eye level, a line of soft light slides across the surface, shallow depth of field, {kayfiyat} mood, clean advertising look',
   '[{"name": "mahsulot", "label": "Mahsulot", "placeholder": "shisha atir flakoni", "max": 80, "fallback": "a glass perfume bottle"}, {"name": "fon", "label": "Fon", "placeholder": "oq marmar", "max": 50, "fallback": "white marble"}, {"name": "kayfiyat", "label": "Kayfiyat", "placeholder": "nafis", "max": 30, "fallback": "elegant"}]'),
  ('vt02', 'video', 'reklama', 20, 'Kafe yoki do''kon', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: the camera enters {joy} through the door and glides toward {nima}, warm morning light, people softly out of focus, inviting and friendly mood',
   '[{"name": "joy", "label": "Joy", "placeholder": "shinam qahvaxona", "max": 60, "fallback": "a cosy coffee shop"}, {"name": "nima", "label": "Nima ko''rsatilsin", "placeholder": "yangi pishgan non", "max": 80, "fallback": "a counter with fresh bread"}]'),
  ('vt03', 'video', 'reklama', 30, 'Taom sahnasi', 'kling/kling-4',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: close-up of {taom} on {stol}, steam rises slowly, the camera pushes in, warm side light, rich colours, appetising food commercial look',
   '[{"name": "taom", "label": "Taom", "placeholder": "palov", "max": 60, "fallback": "a plate of pilaf"}, {"name": "stol", "label": "Stol", "placeholder": "yog''och stol", "max": 40, "fallback": "a wooden table"}]'),
  ('vt04', 'video', 'tabrik', 40, 'Tug''ilgan kun tabrigi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: {bezak} in a softly lit room, the camera drifts toward a cake with glowing candles, confetti falls in slow motion, warm light, a joyful mood, the lettering «{ism}, tug''ilgan kuningiz bilan!» fades in at the end',
   '[{"name": "ism", "label": "Ism", "placeholder": "Dilnoza", "max": 30}, {"name": "bezak", "label": "Bezak", "placeholder": "rangli sharlar", "max": 60, "fallback": "colourful balloons"}]'),
  ('vt05', 'video', 'tabrik', 50, 'Bayram tabrigi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: {belgilar} in soft morning light, the camera rises slowly with petals in the air, warm festive colours, the lettering «{bayram} muborak!» appears in the centre',
   '[{"name": "bayram", "label": "Bayram", "placeholder": "Navro''z", "max": 30}, {"name": "belgilar", "label": "Ramzlar", "placeholder": "lolalar va sumalak qozoni", "max": 80, "fallback": "tulips and a pot of sumalak"}]'),
  ('vt06', 'video', 'talim', 60, 'Dars mavzusi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: an animated explanation of {mavzu}, the camera moves slowly through {tafsilot}, soft even light, clean educational animation style, clear shapes and bright colours',
   '[{"name": "mavzu", "label": "Mavzu", "placeholder": "suvning aylanishi", "max": 60, "fallback": "the water cycle"}, {"name": "tafsilot", "label": "Nimalar ko''rinsin", "placeholder": "bug''lanish, bulut, yomg''ir", "max": 100, "fallback": "evaporation, clouds and rain"}]'),
  ('vt07', 'video', 'tabiat', 70, 'Tabiat manzarasi', 'kling/kling-4',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: {joy} in {fasl} at {vaqt}, the drone camera glides forward slowly and rises, natural light, gentle wind moving the scene, calm cinematic mood',
   '[{"name": "joy", "label": "Joy", "placeholder": "qorli tog''lar orasidagi ko''l", "max": 80, "fallback": "a lake among snowy mountains"}, {"name": "fasl", "label": "Fasl", "placeholder": "erta bahor", "max": 30, "fallback": "early spring"}, {"name": "vaqt", "label": "Kun vaqti", "placeholder": "tong", "max": 30, "fallback": "dawn"}]'),
  ('vt08', 'video', 'tabiat', 80, 'Hayvon kadri', 'kling/kling-4',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: {hayvon} in {joy}, the camera tracks it slowly from a low angle, soft golden hour light, shallow depth of field, a quiet nature documentary style',
   '[{"name": "hayvon", "label": "Hayvon", "placeholder": "tog'' burguti", "max": 60, "fallback": "a mountain eagle"}, {"name": "joy", "label": "Joy", "placeholder": "qoyali cho''qqi", "max": 60, "fallback": "a rocky peak"}]'),
  ('vt09', 'video', 'sayohat', 90, 'Sayohat lavhasi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: a traveller walks through {joy}, the camera follows from behind at a steady pace and rises to reveal the view, {yoruglik}, a sense of freedom, travel film look',
   '[{"name": "joy", "label": "Joy", "placeholder": "tog'' qishlog''i", "max": 80, "fallback": "a mountain village"}, {"name": "yoruglik", "label": "Yorug''lik", "placeholder": "quyosh botishi", "max": 40, "fallback": "warm sunset light"}]'),
  ('vt10', 'video', 'shahar', 100, 'Shahar oqshomi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: the camera glides along {joy} at dusk, street lights come on, people pass softly out of focus, blue and amber light, smooth cinematic movement',
   '[{"name": "joy", "label": "Joy", "placeholder": "eski shahar ko''chasi", "max": 80, "fallback": "an old city street"}]'),
  ('vt11', 'video', 'shahar', 110, 'Tarixiy obida', 'kling/kling-4',
   '{"seconds": 5, "aspect": "16:9"}',
   'One continuous shot: the camera rises slowly toward {obida}, detailed tile patterns fill the frame, {yoruglik}, birds circling above, a majestic documentary look',
   '[{"name": "obida", "label": "Obida", "placeholder": "koshinli madrasa peshtoqi", "max": 80, "fallback": "a tiled madrasa portal"}, {"name": "yoruglik", "label": "Yorug''lik", "placeholder": "iliq quyosh botishi", "max": 40, "fallback": "warm sunset light"}]'),
  ('vt12', 'video', 'shahar', 120, 'Hunarmand ishi', 'kling/kling-4-flash',
   '{"seconds": 5, "aspect": "9:16"}',
   'One continuous shot: close-up of a craftsman''s hands making {nima}, the camera circles slowly, soft window light in a workshop, fine dust in the air, patient documentary mood',
   '[{"name": "nima", "label": "Nima yasaladi", "placeholder": "naqshli ko''za", "max": 80, "fallback": "a patterned clay jug"}]')
ON CONFLICT (seed_key) DO NOTHING;
