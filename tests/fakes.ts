import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { LlmClient, LlmTurnResult, ToolExecutor } from '../src/llm/claude.js';
import type { QuoClient } from '../src/providers/quo.js';

/**
 * A scripted LLM: each turn returns the next step in a queue. A step is either
 * a plain text reply, or a tool call (name + input) whose result is fed back
 * and followed by a final text reply. This drives the pipeline deterministically
 * without calling the real Anthropic API.
 */
export type LlmStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown; thenText: string };

export class ScriptedLlm implements LlmClient {
  private queue: LlmStep[];
  /** Records tool results the pipeline returned, for assertions. */
  toolResults: string[] = [];

  constructor(steps: LlmStep[]) {
    this.queue = [...steps];
  }

  async runTurn(
    _system: string,
    _history: MessageParam[],
    executeTool: ToolExecutor,
  ): Promise<LlmTurnResult> {
    const step = this.queue.shift();
    if (!step) return { reply: '', toolRounds: 0, usage: { inputTokens: 0, outputTokens: 0 } };

    if (step.kind === 'text') {
      return { reply: step.text, toolRounds: 0, usage: { inputTokens: 10, outputTokens: 5 } };
    }

    // Execute the tool through the pipeline's executor (records lookups, etc.).
    const result = await executeTool(step.name, step.input);
    this.toolResults.push(result);
    return { reply: step.thenText, toolRounds: 1, usage: { inputTokens: 20, outputTokens: 10 } };
  }
}

/** An LLM that always throws — simulates an API failure. */
export class ThrowingLlm implements LlmClient {
  async runTurn(): Promise<LlmTurnResult> {
    throw new Error('llm unavailable');
  }
}

/** Spy that captures outbound sends instead of hitting Quo. */
export class SpyQuo {
  sent: { to: string; content: string }[] = [];
  async sendMessage(to: string, content: string): Promise<{ id: string }> {
    this.sent.push({ to, content });
    return { id: `sent-${this.sent.length}` };
  }
}

export function asQuo(spy: SpyQuo): QuoClient {
  return spy as unknown as QuoClient;
}
