// One coaching turn: one model call per user message, plus tool-call round trips.
// No retries, no answer rewriting: the model's text is streamed and saved as-is.
import { config } from "../config";
import { prisma } from "../db";
import { createProvider, modelFor, ProviderError, type ChatMessage, type ContentPart } from "../llm";
import { estimateMessageTokens, estimateTokens } from "../llm/types";
import { log } from "../log";
import { buildSystem, loadHistory, trimHistory } from "./context";
import { checkSpend, recordUsage } from "./spend";
import { executeTool, toolDefs } from "./tools";

export type CoachEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; ok: boolean }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface TurnInput {
  userId: string;
  text: string;
  image?: { mimeType: string; data: string };
  onEvent?: (e: CoachEvent) => void;
  now?: Date;
  signal?: AbortSignal;
}

export const NO_VISION_MESSAGE =
  "I can't view photos with the current setup. Could you describe the meal instead (foods, rough portions, brand or restaurant if any)? I'll estimate it from that.";
export const NO_PHOTOS_ON_PLAN = "Photo logging isn't included on your current plan. Describe the meal in words and I'll estimate it.";
export const EMPTY_REPLY_MESSAGE =
  "Sorry, I couldn't finish that reply. Please try again, or ask for a shorter answer.";
export const PROVIDER_ERROR_MESSAGE = "Sorry, I couldn't reach the coach just now. Please try again in a moment.";

export async function runCoachTurn(input: TurnInput) {
  const c = config();
  const now = input.now ?? new Date();
  const emit = input.onEvent ?? (() => {});
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const tz = user.timezone;

  const userMsg = await prisma.message.create({
    data: { userId: user.id, role: "user", content: input.text, hasImage: !!input.image },
  });

  const finishWithNotice = (text: string) => {
    emit({ type: "notice", text });
    emit({ type: "done" });
    return { reply: text, notice: true, rounds: 0, costUsd: 0 };
  };

  // Pick the model for this turn.
  const purpose = input.image ? "photo" : "chat";
  if (input.image && c.billing.enabled && !(c.billing.plans[user.plan] ?? c.billing.plans.free).photos) {
    return finishWithNotice(NO_PHOTOS_ON_PLAN);
  }
  const choice = modelFor(purpose);
  if (!choice) return finishWithNotice(NO_VISION_MESSAGE);
  const provider = createProvider(choice.provider);

  // Build context.
  const system = await buildSystem(user.id, tz, now);
  const tools = toolDefs();
  const content: ContentPart[] = [];
  if (input.text) content.push({ type: "text", text: input.text });
  if (input.image) content.push({ type: "image", mimeType: input.image.mimeType, data: input.image.data });
  if (!input.text && input.image) content.unshift({ type: "text", text: "(photo)" });
  const newMsg: ChatMessage = { role: "user", content };

  const fixed =
    system.reduce((n, s) => n + estimateTokens(s.text), 0) + estimateTokens(JSON.stringify(tools)) + estimateMessageTokens(newMsg);
  const historyBudget = Math.max(0, c.limits.maxInputTokens - fixed);
  const history = await loadHistory(user.id, c.limits.historyMessages, userMsg.id);
  const messages = trimHistory([...trimHistory(history, historyBudget), newMsg], Number.POSITIVE_INFINITY);

  let fullText = "";
  let costUsd = 0;
  let rounds = 0;
  let lastStop = "";
  let lastOut = 0;

  try {
    for (let round = 0; round < c.limits.maxToolRounds; round++) {
      const blocked = await checkSpend(user.id, user.plan, now);
      if (blocked) {
        if (round === 0) return finishWithNotice(blocked);
        emit({ type: "notice", text: blocked });
        break;
      }

      const lastRound = round === c.limits.maxToolRounds - 1;
      let started = false;
      const res = await provider.chat({
        model: choice.model,
        system,
        messages,
        tools: lastRound ? undefined : tools,
        maxTokens: c.limits.maxOutputTokens,
        signal: input.signal,
        onText: (d) => {
          if (!started && fullText && !fullText.endsWith("\n")) {
            fullText += "\n\n";
            emit({ type: "text", delta: "\n\n" });
          }
          started = true;
          fullText += d;
          emit({ type: "text", delta: d });
        },
      });
      rounds++;
      lastStop = res.stopReason;
      lastOut = res.usage.outputTokens;
      // Providers that don't stream still return text; make sure it is captured.
      if (!started && res.text) {
        const sep = fullText ? "\n\n" : "";
        fullText += sep + res.text;
        emit({ type: "text", delta: sep + res.text });
      }
      costUsd += await recordUsage({ userId: user.id, kind: purpose, provider: provider.name, model: choice.model, usage: res.usage });

      if (!res.toolCalls.length) break;

      messages.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls });
      const results = [];
      for (const call of res.toolCalls) {
        const r = await executeTool({ userId: user.id, tz, now }, call);
        results.push(r);
        emit({ type: "tool", name: call.name, ok: !r.isError });
        if (r.isError) log.warn("tool_error", { tool: call.name });
      }
      messages.push({ role: "tool", results });
    }
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 0;
    log.error("provider_error", { provider: provider.name, model: choice.model, status });
    if (fullText.trim()) await prisma.message.create({ data: { userId: user.id, role: "assistant", content: fullText } });
    emit({ type: "error", message: PROVIDER_ERROR_MESSAGE });
    emit({ type: "done" });
    return { reply: fullText, error: true, rounds, costUsd };
  }

  if (fullText.trim()) {
    await prisma.message.create({ data: { userId: user.id, role: "assistant", content: fullText } });
  } else {
    // Never fail silently: an empty reply usually means the output token limit was hit.
    log.warn("empty_reply", { model: choice.model, stop: lastStop, outputTokens: lastOut });
    emit({ type: "error", message: EMPTY_REPLY_MESSAGE });
  }
  log.info("turn", { rounds, model: choice.model, photo: !!input.image, stop: lastStop, outputTokens: lastOut });
  emit({ type: "done" });
  return { reply: fullText, rounds, costUsd };
}
