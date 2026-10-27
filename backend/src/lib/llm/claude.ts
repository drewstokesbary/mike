import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock as AnthropicContentBlock,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type {
  StreamChatParams,
  StreamChatResult,
  NormalizedToolCall,
  NormalizedToolResult,
} from "./types";
import { toClaudeTools } from "./tools";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";
import {
  ANTHROPIC_WEB_TOOLS,
  extractWebCitations,
  serverToolName,
  type WebCitation,
} from "./anthropicServerTools";
import { withWebResearchPolicy } from "./webResearchPolicy";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };

type NativeMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

const MAX_TOKENS = 16384;
const SHORT_PROMPT_CACHE_CONTROL = { type: "ephemeral" } as const;
const CONVERSATION_PROMPT_CACHE_CONTROL = {
  type: "ephemeral",
  ttl: "1h",
} as const;
const MAX_STALLED_TOOL_RECOVERIES = 1;
const MAX_INCOMPLETE_RESPONSE_RECOVERIES = 1;
const TOOL_INTENT_AT_END =
  /(?:^|[.!?]\s+)(?:let me|i['’]?ll|i will)(?:\s+now)?\s+(?:read|review|inspect|analy[sz]e|check|search|fetch|open|look\s+up|examine|compare|retrieve)\b[\s\S]{0,500}$/i;

/**
 * Claude occasionally ends a turn immediately after announcing a tool action
 * (for example, "Let me read the PDF in full.") without emitting tool_use.
 * Keep this deliberately narrow so ordinary answers and offers of future help
 * are never auto-continued.
 */
export function endsWithUnperformedToolIntent(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 800 &&
    TOOL_INTENT_AT_END.test(trimmed)
  );
}

export function incompleteResponseReason(args: {
  stopReason: string | null;
  turnText: string;
  completedToolRounds: number;
}): "max_tokens" | "empty_after_tools" | null {
  if (args.stopReason === "max_tokens") return "max_tokens";
  if (
    args.stopReason === "end_turn" &&
    args.completedToolRounds > 0 &&
    !args.turnText.trim()
  ) {
    return "empty_after_tools";
  }
  return null;
}

export function claudeTurnProtocolAction(args: {
  stopReason: string | null;
  toolCallCount: number;
  turnText: string;
  completedToolRounds: number;
}): "run_tools" | "continue_pause_turn" | "recover_incomplete" | "finish" {
  // Anthropic requires every client tool_use block to be followed immediately
  // by its tool_result. A tool call can accompany max_tokens or pause_turn, so
  // the content blocks—not only stop_reason—must control this decision.
  if (args.toolCallCount > 0) return "run_tools";
  if (args.stopReason === "pause_turn") return "continue_pause_turn";
  if (incompleteResponseReason(args)) return "recover_incomplete";
  return "finish";
}

function apiKey(override?: string | null): string {
  const key = override?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "Anthropic API key is not configured. Set ANTHROPIC_API_KEY or add a user Anthropic key.",
    );
  }
  return key;
}

function client(override?: string | null): Anthropic {
  const apiKeyValue = apiKey(override);
  return new Anthropic({ apiKey: apiKeyValue });
}

function toNativeMessages(
  messages: StreamChatParams["messages"],
): NativeMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function claudeErrorMessage(error: unknown): string {
  const parsedObject = claudeStreamFailureMessage(error);
  if (parsedObject) return parsedObject;
  if (error instanceof Error && error.message) {
    const parsed = parseClaudeErrorPayload(error.message);
    if (parsed) return parsed;
    return error.message.startsWith("Claude error:")
      ? error.message
      : `Claude error: ${error.message}`;
  }
  const parsed = parseClaudeErrorPayload(String(error));
  if (parsed) return parsed;
  return `Claude error: ${String(error)}`;
}

function parseClaudeErrorPayload(value: string): string | null {
  const trimmed = value.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonEnd <= jsonStart) return null;
  const payload = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(payload) as unknown;
    return claudeStreamFailureMessage(parsed);
  } catch {
    return null;
  }
}

function claudeStreamFailureMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const error = record.error;
  if (record.type !== "error" || !error || typeof error !== "object") {
    return null;
  }
  const err = error as Record<string, unknown>;
  const type =
    typeof err.type === "string" && err.type.trim() ? err.type.trim() : null;
  const message =
    typeof err.message === "string" && err.message.trim()
      ? err.message.trim()
      : "Claude stream failed.";
  return type
    ? `Claude error (${type}): ${message}`
    : `Claude error: ${message}`;
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export async function streamClaude(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const {
    model,
    systemPrompt,
    tools = [],
    callbacks = {},
    runTools,
    apiKeys,
    enableThinking,
  } = params;
  const maxIter = params.maxIterations ?? 10;
  const anthropic = client(apiKeys?.claude);
  const claudeTools = toClaudeTools(tools);
  const nativeTools = [...claudeTools, ...ANTHROPIC_WEB_TOOLS] as ToolUnion[];

  const messages: NativeMessage[] = toNativeMessages(params.messages);
  let fullText = "";
  let webCitations: WebCitation[] = [];
  let stalledToolRecoveries = 0;
  let incompleteResponseRecoveries = 0;
  let completedToolRounds = 0;
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "claude",
    model,
  });

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);
      const stream = anthropic.messages.stream({
        model,
        cache_control: CONVERSATION_PROMPT_CACHE_CONTROL,
        system: withWebResearchPolicy(systemPrompt),
        messages: messages as Anthropic.MessageParam[],
        tools: nativeTools,
        max_tokens: MAX_TOKENS,
        // Claude 4.x models require `thinking.type: "adaptive"` and
        // drive effort via `output_config.effort` rather than a fixed
        // token budget. We only opt in when the caller requested it.
        ...(enableThinking
          ? ({
              thinking: { type: "adaptive" },
              output_config: { effort: "high" },
            } as unknown as Record<string, unknown>)
          : {}),
        // Extended thinking requires temperature to be default (omitted).
      });

      let sawThinking = false;
      let streamFailureMessage: string | null = null;
      const abortStream = () => stream.abort();
      params.abortSignal?.addEventListener("abort", abortStream, {
        once: true,
      });

      stream.on("streamEvent", (event) => {
        logRawLlmStream({
          provider: "claude",
          model,
          iteration: iter,
          label: "streamEvent",
          payload: event,
        });
        rawStreamRecorder?.record({
          iteration: iter,
          label: "streamEvent",
          payload: event,
        });
        const failureMessage = claudeStreamFailureMessage(event);
        if (failureMessage) {
          streamFailureMessage = failureMessage;
          stream.abort();
        }
      });
      stream.on("error", (error) => {
        logRawLlmStream({
          provider: "claude",
          model,
          iteration: iter,
          label: "error",
          payload: error,
        });
        rawStreamRecorder?.record({
          iteration: iter,
          label: "error",
          payload: error,
        });
      });

      stream.on("text", (delta) => {
        callbacks.onContentDelta?.(delta);
      });
      if (enableThinking) {
        stream.on("thinking", (delta) => {
          sawThinking = true;
          callbacks.onReasoningDelta?.(delta);
        });
      }

      let final: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        final = await stream.finalMessage();
      } catch (error) {
        if (params.abortSignal?.aborted) throw abortError();
        if (streamFailureMessage) throw new Error(streamFailureMessage);
        throw new Error(claudeErrorMessage(error));
      } finally {
        params.abortSignal?.removeEventListener("abort", abortStream);
      }
      if (sawThinking) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);
      const stopReason = final.stop_reason;
      const assistantBlocks = final.content as ContentBlock[];
      webCitations = extractWebCitations(
        final.content as AnthropicContentBlock[],
        webCitations,
      );

      // Extract text content and tool_use calls from the final assistant
      // message so we can accumulate text and drive the tool-call loop.
      const toolCalls: NormalizedToolCall[] = [];
      for (const block of assistantBlocks) {
        if (block.type === "text") {
          const txt = (block as { text: string }).text;
          if (typeof txt === "string") fullText += txt;
        } else if (block.type === "tool_use") {
          const tu = block as {
            id: string;
            name: string;
            input: unknown;
          };
          const call: NormalizedToolCall = {
            id: tu.id,
            name: tu.name,
            input: (tu.input as Record<string, unknown>) ?? {},
          };
          callbacks.onToolCallStart?.(call);
          toolCalls.push(call);
        } else {
          const name = serverToolName(block as AnthropicContentBlock);
          if (name) callbacks.onServerToolStart?.(name);
        }
      }

      const turnText = assistantBlocks
        .filter(
          (block): block is Extract<ContentBlock, { type: "text" }> =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");
      const protocolAction = claudeTurnProtocolAction({
        stopReason,
        toolCallCount: toolCalls.length,
        turnText,
        completedToolRounds,
      });

      if (protocolAction === "run_tools") {
        if (!runTools) {
          throw new Error(
            "Claude requested a client tool, but no tool runner is configured.",
          );
        }

        const results = await runTools(toolCalls);
        completedToolRounds += 1;
        throwIfAborted(params.abortSignal);

        // Anthropic requires this assistant tool_use turn and the corresponding
        // user tool_result turn to be adjacent, regardless of stop_reason.
        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({
          role: "user",
          content: results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.tool_use_id,
            content: r.content,
          })),
        });
        continue;
      }

      if (protocolAction === "continue_pause_turn") {
        messages.push({ role: "assistant", content: assistantBlocks });
        continue;
      }

      const stalledBeforeTool =
        stopReason === "end_turn" &&
        toolCalls.length === 0 &&
        !!runTools &&
        claudeTools.length > 0 &&
        endsWithUnperformedToolIntent(turnText);

      if (stalledBeforeTool) {
        if (stalledToolRecoveries >= MAX_STALLED_TOOL_RECOVERIES) {
          throw new Error(
            "Claude stopped before performing the document or research action it announced. Please retry the request.",
          );
        }
        stalledToolRecoveries += 1;
        console.warn("[claude] recovering stalled tool-intent turn", {
          model,
          iteration: iter,
          stopReason,
        });
        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({
          role: "user",
          content:
            "Continue with the action you just described. Use the available tool now, then complete the user's request. Do not merely restate the plan.",
        });
        continue;
      }

      const incompleteReason =
        protocolAction === "recover_incomplete"
          ? incompleteResponseReason({
              stopReason,
              turnText,
              completedToolRounds,
            })
          : null;
      if (incompleteReason) {
        if (
          incompleteResponseRecoveries >= MAX_INCOMPLETE_RESPONSE_RECOVERIES
        ) {
          throw new Error(
            incompleteReason === "max_tokens"
              ? "Claude reached its response limit before completing the answer. Please retry with a narrower request or fewer documents."
              : "Claude stopped after using its tools without producing a final answer. Please retry the request.",
          );
        }
        incompleteResponseRecoveries += 1;
        console.warn("[claude] continuing incomplete response", {
          model,
          iteration: iter,
          stopReason,
          reason: incompleteReason,
          completedToolRounds,
        });
        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({
          role: "user",
          content:
            incompleteReason === "max_tokens"
              ? "Continue from where you stopped and complete the final answer now. Do not repeat material already provided."
              : "Complete the user's requested final answer now using the tool results you already obtained.",
        });
        continue;
      }

      break;
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText, webCitations };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

export async function completeClaudeText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { claude?: string | null };
}): Promise<string> {
  const anthropic = client(params.apiKeys?.claude);
  let resp: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    resp = await anthropic.messages.create({
      model: params.model,
      cache_control: SHORT_PROMPT_CACHE_CONTROL,
      max_tokens: params.maxTokens ?? 512,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.user }],
    });
  } catch (error) {
    throw new Error(claudeErrorMessage(error));
  }
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

// Helper re-export for callers wanting to hand normalized results back in.
export type { NormalizedToolResult };
