import type { ContactLookupResult, IntegrationProvider } from "../modules/integrations/integration-provider.js";

/** Same "throw loudly if unconfigured" discipline as FakeAiProvider. */
export class FakeIntegrationProvider implements IntegrationProvider {
  private result: ContactLookupResult | Error | undefined;

  mockFound(overrides: Partial<ContactLookupResult> = {}): this {
    this.result = {
      found: true,
      name: "Fake Contact",
      email: "fake@example.test",
      phone: null,
      company: null,
      lifecycleStage: null,
      sourceProvider: "fake",
      sourceRecordId: "fake-id",
      ...overrides,
    };
    return this;
  }

  mockNotFound(email: string): this {
    this.result = {
      found: false,
      name: null,
      email,
      phone: null,
      company: null,
      lifecycleStage: null,
      sourceProvider: "fake",
      sourceRecordId: null,
    };
    return this;
  }

  mockError(error: Error): this {
    this.result = error;
    return this;
  }

  async lookupContact(): Promise<ContactLookupResult> {
    if (this.result === undefined) {
      throw new Error(
        "FakeIntegrationProvider.lookupContact called without a configured response - call fake.mockFound(...)/.mockNotFound(...) first.",
      );
    }
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

// Plugs directly into OrchestratorDeps.integrationProviderFactory,
// which is typed as a (credentials) => IntegrationProvider factory
// (mirroring production's per-workspace HubSpotIntegrationProvider
// construction) - a fake instance doesn't need real credentials, so
// this just ignores whatever's passed and always returns the same
// pre-configured fake.
export function fakeIntegrationProviderFactory(provider: FakeIntegrationProvider): () => IntegrationProvider {
  return () => provider;
}
