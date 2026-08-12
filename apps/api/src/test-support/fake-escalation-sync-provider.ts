import type {
  EscalationContactSyncInput,
  EscalationContactSyncResult,
  EscalationSyncProvider,
} from "../modules/ops/escalation-sync-provider.js";

/**
 * Same "throw loudly if unconfigured" discipline as FakeIntegrationProvider.
 * Plugs directly into OrchestratorDeps.escalationSyncProvider - a direct
 * instance override, not a factory, since the real thing is a platform
 * singleton (modules/ops/escalation-sync.service.ts), not constructed
 * per-workspace.
 */
export class FakeEscalationSyncProvider implements EscalationSyncProvider {
  private result: EscalationContactSyncResult | Error | undefined;
  // Records every call's input so a test can assert the orchestrator
  // passed existingRecordId on a resync instead of always creating.
  readonly calls: EscalationContactSyncInput[] = [];

  mockSynced(overrides: Partial<EscalationContactSyncResult> = {}): this {
    this.result = { recordId: "fake-record-id", sourceProvider: "fake", ...overrides };
    return this;
  }

  mockError(error: Error): this {
    this.result = error;
    return this;
  }

  async syncEscalationContact(input: EscalationContactSyncInput): Promise<EscalationContactSyncResult> {
    this.calls.push(input);
    if (this.result === undefined) {
      throw new Error(
        "FakeEscalationSyncProvider.syncEscalationContact called without a configured response - call fake.mockSynced(...)/.mockError(...) first.",
      );
    }
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}
