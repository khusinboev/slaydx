import "server-only";
import { TOOL_GROUPS } from "../../tools";
import { formatBonusSom, formatSom } from "../../format";
import { REFERRAL_TIERS } from "../../referral";
import { OFERTA_SUMMARY } from "../../oferta/text";
import type { ToolConfig } from "../../types";
import { env } from "../env";
import { effectivePrice } from "../pricing";
import { getSetting } from "../settings";
import { SIGNUP_BONUS_POINTS } from "../auth";
import { chatTools, describeRule, paramHints } from "./toolspec";

/**
 * The assistant's product knowledge pack (owner request 8): GENERATED from code and settings at run time, never hand-written,
 * so the assistant can only quote the prices, rules and links the product really has right now.
 *
 *   - tool titles / descriptions / prices: `TOOLS` + the server price (`priceFor` through the admin adjustment);
 *   - the form values it may propose per tool: the same registries the proposal validator uses;
 *   - wallet, bonus, referral, ambassador, rating and free-chat rules: `app_settings` + the referral tiers;
 *   - the support link and the offer summary.
 *
 * Cached for 30 seconds per process (one round of settings reads and ~25 price lookups); an admin's change shows within
 * that window, `invalidateKnowledgeCache()` drops it at once (tests).
 */

const TTL_MS = 30_000;
let cached: { at: number; text: string } | null = null;
let inflight: Promise<string> | null = null;

export function invalidateKnowledgeCache(): void {
  cached = null;
  inflight = null;
}

/** Sample values of the one parameter that drives a tool's price, or `null` when the price is flat. */
function priceAxis(tool: ToolConfig): { key: string; values: Array<string | number> } | null {
  for (const hint of paramHints(tool.id)) {
    if (!["pages", "slideCount", "imageCount"].includes(hint.key)) continue;
    const rule = hint.rule;
    if (rule.values) return { key: hint.key, values: rule.values.slice(0, 7) };
    if (rule.type === "number" && rule.min !== undefined && rule.max !== undefined) {
      const mid = Math.round((rule.min + rule.max) / 2);
      return { key: hint.key, values: [...new Set([rule.min, mid, rule.max])] };
    }
  }
  return null;
}

async function toolLines(): Promise<string[]> {
  const lines: string[] = [];
  for (const group of TOOL_GROUPS) {
    const tools = chatTools().filter((t) => t.group === group.id);
    if (!tools.length) continue;
    lines.push(`\n[${group.label}]`);
    for (const tool of tools) {
      const base = await effectivePrice(tool, {});
      const axis = priceAxis(tool);
      let prices = `narx: ${formatSom(base)} dan`;
      if (axis) {
        const parts: string[] = [];
        for (const v of axis.values) parts.push(`${axis.key}=${v}: ${formatSom(await effectivePrice(tool, { [axis.key]: v }))}`);
        prices = `narx (${parts.join("; ")})`;
      }
      const hints = paramHints(tool.id)
        .map((h) => `${h.key}${h.required ? "*" : ""}=${describeRule(h.rule)}`)
        .join(", ");
      lines.push(`- ${tool.id} | ${tool.title} | ${tool.description} | ${prices} | values: ${hints}`);
    }
  }
  return lines;
}

async function build(): Promise<string> {
  const [paymentBonus, ambassador, rating, quizOn, quizReward, price, freeDaily, enabled] = await Promise.all([
    getSetting("payment_bonus_percent"),
    getSetting("ambassador.percent"),
    getSetting("bonus.rating_points"),
    getSetting("daily_quiz.enabled"),
    getSetting("daily_quiz.reward"),
    getSetting("chat.price_per_message"),
    getSetting("free_llm.daily.chat"),
    getSetting("chat.enabled"),
  ]);
  const app = env.appUrl;
  const out: string[] = [];
  out.push("SLAYDX MAHSULOT BILIMI (kod va sozlamalardan avtomatik yig'ilgan; faqat shu raqamlardan foydalaning)");
  out.push("SlaydX — taqdimot, referat, insho, maqola, rasm, o'yin va boshqa hujjatlarni AI yordamida tayyorlaydigan o'zbek xizmati (sayt, Telegram bot va Mini App).");
  out.push(`Hamma narxlar so'mda. Hujjat tayyorlash pullik; narx tanlovlarga qarab hisoblanadi va tasdiqlash kartasida aniq ko'rsatiladi.`);
  out.push("\nVOSITALAR (id | nomi | tavsifi | narx | proposal uchun values; * — majburiy)");
  out.push(...(await toolLines()));
  out.push("Qo'shimcha vositalar (rezyume, tarjimon, bitiruvchi portreti) fayl yoki ko'p maydon talab qiladi — ularni faqat saytdagi formadan yaratish mumkin.");
  out.push("\nHAMYON VA BONUSLAR");
  out.push(`- 1 bonus so'm = 1 so'm, lekin bonus faqat SlaydX ichida ishlatiladi, naqdlashtirilmaydi. Hujjat uchun avval bonus, keyin balans yechiladi.`);
  out.push(`- Ro'yxatdan o'tganda ${formatBonusSom(SIGNUP_BONUS_POINTS)} sovg'a qilinadi.`);
  out.push(paymentBonus > 0 ? `- Hamyonni to'ldirganda har to'lovga ${paymentBonus}% bonus so'm qo'shiladi.` : "- Hozir to'lovga qo'shimcha bonus yo'q.");
  out.push(`- To'ldirish: ${app}/uz/wallet (Click orqali karta yoki ilova bilan).`);
  const tiers = REFERRAL_TIERS.map((t, i) => {
    const from = i === 0 ? 1 : REFERRAL_TIERS[i - 1]!.upTo + 1;
    return Number.isFinite(t.upTo) ? `${from}–${t.upTo}-do'st: ${formatBonusSom(t.points)}` : `${from}-do'stdan: ${formatBonusSom(t.points)}`;
  });
  out.push(`- Do'st taklif qilish: yangi do'st ro'yxatdan o'tganda taklif qilgan kishiga bonus (${tiers.join("; ")}).`);
  out.push(ambassador > 0 ? `- Taklif qilingan do'st to'lov qilsa, taklif qilgan kishiga to'langan summaning ${ambassador}% i bonus so'm bo'lib qo'shiladi.` : "- Do'st to'lovidan foiz bonusi hozir o'chirilgan.");
  out.push(rating > 0 ? `- Ilovani baholab, fikr yozgan foydalanuvchiga bir marta ${formatBonusSom(rating)} beriladi.` : "- Baholash uchun bonus hozir o'chirilgan.");
  out.push(quizOn ? `- Kunlik 3 ta mantiqiy savol (botda /savol): hammasiga to'g'ri javob uchun ${formatBonusSom(quizReward)}.` : "- Kunlik savollar (bonus) hozir o'chirilgan.");
  out.push(`- Bepul kanallarga obuna bo'lish ham bonus berishi mumkin (botda «Hamyon / Bonus»).`);
  out.push("\nAI CHAT (siz)");
  out.push(
    enabled
      ? `- Har kuni (Toshkent vaqti) ${freeDaily} ta xabar tekin. Undan keyin har xabar ${formatSom(price)}. ${price > 0 ? "" : "Tekin xabarlar tugasa chat yopiladi."}`
      : "- AI chat hozir o'chirilgan.",
  );
  out.push(`- Sahifa: ${app}/uz/chat, botda /chat (to'xtatish: /stop).`);
  out.push("\nHAVOLALAR");
  out.push(`- Bosh sahifa: ${app}/uz ; Ishlarim: ${app}/uz/files ; Hamyon: ${app}/uz/wallet ; Profil: ${app}/uz/profile`);
  out.push(`- Yordam (admin bilan aloqa): ${env.supportUrl}`);
  out.push("\nOFERTA QISQACHA");
  for (const line of OFERTA_SUMMARY) out.push(`- ${line}`);
  return out.join("\n");
}

/** The pack text; builds on a miss, shares one build between concurrent callers. */
export async function knowledgePack(now: number = Date.now()): Promise<string> {
  if (cached && now - cached.at < TTL_MS) return cached.text;
  if (!inflight) {
    inflight = build()
      .then((text) => {
        cached = { at: Date.now(), text };
        return text;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
