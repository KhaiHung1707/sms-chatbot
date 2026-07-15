import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.js';
import { toolDefinitions } from './tools.js';

/**
 * Thin wrapper around the Anthropic SDK for the agentic tool loop.
 *
 * The model is injected from config (default: Haiku 4.5 — the cheapest tier,
 * a good fit for short SMS replies and simple year/make/model extraction).
 * Swap LLM_MODEL to a Sonnet tier if multilingual/typo accuracy needs it, with
 * no code change.
 *
 * Prompt caching note: the system prompt is ~700 tokens, below Haiku 4.5's
 * 4096-token minimum cacheable prefix, so cache_control would be a no-op here
 * (it would silently not cache). We therefore don't add it — the tools+system
 * prefix is small and the win would be zero. If the system prompt or tool set
 * grows past ~4K tokens, revisit and add cache_control on the last system block.
 */
const MAX_TOKENS = 400; // SMS replies are short; keep the cap tight.

export type ToolExecutor = (
  name: string,
  input: unknown,
) => Promise<string>;

export interface LlmTurnResult {
  reply: string;
  toolRounds: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  runTurn(
    system: string,
    history: Anthropic.MessageParam[],
    executeTool: ToolExecutor,
  ): Promise<LlmTurnResult>;
}

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Run one full agentic turn: call Claude, execute any requested tools, feed
   * results back, repeat until a text reply — capped at 3 tool rounds (§6) to
   * prevent loops. Returns the final text and token usage (logged for cost).
   */
  async runTurn(
    system: string,
    history: Anthropic.MessageParam[],
    executeTool: ToolExecutor,
  ): Promise<LlmTurnResult> {
    const messages: Anthropic.MessageParam[] = [...history];
    let inputTokens = 0;
    let outputTokens = 0;
    let toolRounds = 0;

    for (let round = 0; round <= 3; round++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        tools: toolDefinitions,
        messages,
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      logger.info(
        { round, in: response.usage.input_tokens, out: response.usage.output_tokens },
        'llm call',
      );

      if (response.stop_reason !== 'tool_use') {
        const reply = extractText(response.content);
        return { reply, toolRounds, usage: { inputTokens, outputTokens } };
      }

      // Cap reached but the model still wants a tool → stop and surface text.
      if (round === 3) {
        const reply = extractText(response.content);
        logger.warn('tool round cap (3) reached; returning text');
        return {
          reply: reply || 'Let me have a staff member follow up with you.',
          toolRounds,
          usage: { inputTokens, outputTokens },
        };
      }

      // Append the assistant turn (with tool_use blocks) before executing.
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          toolRounds++;
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Unreachable in practice; satisfies the type checker.
    return { reply: '', toolRounds, usage: { inputTokens, outputTokens } };
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

/** Map our stored messages (in/out) to Claude's user/assistant roles. */
export function toClaudeHistory(
  messages: { direction: 'in' | 'out'; body: string }[],
): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));
}
