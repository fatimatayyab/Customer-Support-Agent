import type {
  AiProvider,
  AiReplyResult,
  AiToolCallOutcome,
  GenerateReplyInput,
  GenerateReplyOutcome,
  SummarizeResult,
} from "../modules/ai/ai-provider.js";

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
  private replyResult: GenerateReplyOutcome | Error | undefined;
  // Consumed FIFO before falling back to replyResult - lets a test
  // exercising the bounded two-call tool flow express a first call and
  // second call that return different things (e.g. mockToolCall then
  // mockReply), which a single replyResult can't.
  private replyQueue: (GenerateReplyOutcome | Error)[] = [];
  private summarizeResult: SummarizeResult | Error | undefined;
  // Counts every summarize() invocation - lets a test assert "generated
  // exactly once for this escalation" / "not regenerated for the same one".
  summarizeCalls = 0;
  // Captured on every call, not just the configured output - lets a test
  // assert on what the orchestrator/AI Service actually sent (e.g.
  // pageContext threading) without needing a second fake mechanism. On
  // the bounded two-call tool flow (Stage 1), this holds only the most
  // recent call - a test that needs both calls' inputs should read
  // generateReplyInputs instead.
  lastGenerateReplyInput: GenerateReplyInput | undefined;
  generateReplyInputs: GenerateReplyInput[] = [];

  mockReply(overrides: Partial<AiReplyResult> = {}): this {
    this.replyResult = {
      kind: "reply",
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

  // For a test verifying the eligibility-gated tool-call path (Stage 1) -
  // simulates the model requesting lookup_contact on the first call.
  mockToolCall(overrides: Partial<Omit<AiToolCallOutcome, "kind" | "tool">> = {}): this {
    this.replyResult = {
      kind: "tool_call",
      tool: "lookup_contact",
      args: { email: "customer@example.com" },
      provider: "fake",
      model: "fake-model",
      promptVersion: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
      ...overrides,
    };
    return this;
  }

  mockReplyError(error: Error): this {
    this.replyResult = error;
    return this;
  }

  // Queues a one-shot outcome for the next generateReply call, consumed
  // before replyResult and before any earlier-queued entry. Build a
  // GenerateReplyOutcome literal directly (kind: "tool_call" or
  // kind: "reply") rather than via mockReply/mockToolCall, since those
  // set the repeatable fallback, not a one-shot queue entry.
  queueReply(outcome: GenerateReplyOutcome | Error): this {
    this.replyQueue.push(outcome);
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

  // Mirrors mockReplyError: the error is what summarize() throws, so a
  // test can exercise "the auto-summary failed" without a live provider.
  mockSummarizeError(error: Error): this {
    this.summarizeResult = error;
    return this;
  }

  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutcome> {
    this.lastGenerateReplyInput = input;
    this.generateReplyInputs.push(input);
    const next = this.replyQueue.length > 0 ? this.replyQueue.shift() : this.replyResult;
    if (next === undefined) {
      throw new Error(
        "FakeAiProvider.generateReply called without a configured response - call fake.mockReply(...) before using it in a test.",
      );
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }

  async summarize(): Promise<SummarizeResult> {
    this.summarizeCalls += 1;
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
