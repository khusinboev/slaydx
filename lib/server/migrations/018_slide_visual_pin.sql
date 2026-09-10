-- Eski slayd dekalariga RENDER QILINGAN vizualni qadash (Shablonlar 2 → AUDIT-14).
--
-- `doc_json` da faqat `slideTemplate` bor edi; vizual har safar joriy
-- reyestrdan olinardi. Shablonlar 2 da shablon → dizayn xaritasi o'zgargach
-- (defense: dense → formal, lesson: cards → circle …) eski PPTX fayl
-- eski dizaynda, sayt ko'ruvchisi yangi dizaynda chizardi. Yakunlash
-- vaqtida saqlangan `preview.slide.visual` — o'sha paytdagi HAQIQIY
-- vizual; undan `doc_json.slideVisual` to'ldiriladi (`doc_prev` ham).
UPDATE generations
   SET doc_json = doc_json || jsonb_build_object('slideVisual', preview->'slide'->>'visual')
 WHERE tool_id IN ('slide', 'pro-slide')
   AND doc_json ? 'slides'
   AND NOT (doc_json ? 'slideVisual')
   AND preview->'slide'->>'visual' IS NOT NULL;

UPDATE generations
   SET doc_prev = doc_prev || jsonb_build_object('slideVisual', preview->'slide'->>'visual')
 WHERE tool_id IN ('slide', 'pro-slide')
   AND doc_prev IS NOT NULL
   AND doc_prev ? 'slides'
   AND NOT (doc_prev ? 'slideVisual')
   AND preview->'slide'->>'visual' IS NOT NULL;
