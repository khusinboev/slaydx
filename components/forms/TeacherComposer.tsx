/**
 * ESKI YO'L — `components/forms/teacher/` ga ko'chirildi (AUDIT-24 WP-B).
 *
 * Fayl 831 qator edi va 5 vositaning hamma qatorini o'zida saqlardi;
 * endi qobiq `teacher/TeacherComposer.tsx` da, kind-qatorlari esa
 * `teacher/{Lesson,Map,Glossary,Keys,Test}Fields.tsx` da. Bu re-eksport
 * `ToolWorkspace` va mavjud testlar importini buzmaslik uchun qoladi
 * (`tests/client-boundary.test.mts` ham shu yo'lni yuradi).
 */
export { TeacherComposer } from "./teacher/TeacherComposer";
