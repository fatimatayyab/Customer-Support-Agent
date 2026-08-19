import type { AiProvider, AiReplyResult, GenerateReplyInput, SummarizeResult } from "../modules/ai/ai-provider.js";

/**
 * Throws loudly if used without being configured, rather than falling
 * back to some plausible-looking default reply. generateAiReply's
 * fire-and-forget errors are swallowed (`.catch(() => {})`), so a fake
 * that silently returned a default on misuse would make "the AI
 * correctly declined to answer" and "this test forgot to call
 * mockReply()" look identical - a real false-negative risk for this
 * codebase's control flow specifically, not a generic nicety.
 */
export class FakeAiProvider implements AiProvider {
  private replyResult: AiReplyResult | Error | undefined;
  private summarizeResult: SummarizeResult | Error | undefined;
  // Captured on every call, not just the configured output - lets a test
  // assert on what the orchestrator/AI Service actually sent (e.g.
  // pageContext threading) without needing a second fake mechanism.
  lastGenerateReplyInput: GenerateReplyInput | undefined;

  mockReply(overrides: Partial<AiReplyResult> = {}): this {
    this.replyResult = {
      reply: "This is a fake AI reply.",
      confidence: 0.9,
      needsEscalation: false,
      citations: [],
      provider: "fake",
      model: "fake-model",
      promptVersion: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
      ...overrides,
    };
    return this;
  }

  mockReplyError(error: Error): this {
    this.replyResult = error;
    return this;
  }

  mockSummarize(overrides: Partial<SummarizeResult> = {}): this {
    this.summarizeResult = {
      summary: "This is a fake summary.",
      provider: "fake",
      model: "fake-model",
      promptVersion: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
      ...overrides,
    };
    return this;
  }

  async generateReply(input: GenerateReplyInput): Promise<AiReplyResult> {
    this.lastGenerateReplyInput = input;
    if (this.replyResult === undefined) {
      throw new Error(
        "FakeAiProvider.generateReply called without a configured response - call fake.mockReply(...) before using it in a test.",
      );
    }
    if (this.replyResult instanceof Error) {
      throw this.replyResult;
    }
    return this.replyResult;
  }

  async summarize(): Promise<SummarizeResult> {
    if (this.summarizeResult === undefined) {
      throw new Error(
        "FakeAiProvider.summarize called without a configured response - call fake.mockSummarize(...) before using it in a test.",
      );
    }
    if (this.summarizeResult instanceof Error) {
      throw this.summarizeResult;
    }
    return this.summarizeResult;
  }
}
