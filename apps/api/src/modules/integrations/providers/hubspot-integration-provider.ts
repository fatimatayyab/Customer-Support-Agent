import type { ContactLookupResult, IntegrationProvider, LookupContactInput } from "../integration-provider.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const CONTACT_PROPERTIES = ["firstname", "lastname", "email", "phone", "company", "lifecyclestage"];
// Without this, an unresponsive HubSpot endpoint could hang the calling
// request/job indefinitely - fetch has no default timeout.
const REQUEST_TIMEOUT_MS = 10_000;

interface HubspotCredentials {
  accessToken: string;
}

interface HubspotContactResponse {
  id: string;
  properties: Record<string, string | null>;
}

/**
 * A private-app access token, not the OAuth2 authorization-code flow -
 * the business generates a static token in their own HubSpot account
 * settings and pastes it into the connect form. No redirect/callback
 * route, no refresh-token rotation. OAuth2 only becomes necessary if this
 * platform later wants a one-click "Connect with HubSpot" experience
 * listed in HubSpot's App Marketplace - a meaningfully bigger scope,
 * deliberately deferred until a real reason to build it exists.
 */
export class HubSpotIntegrationProvider implements IntegrationProvider {
  constructor(private readonly credentials: HubspotCredentials) {}

  async lookupContact(input: LookupContactInput): Promise<ContactLookupResult> {
    const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${encodeURIComponent(input.email)}`);
    url.searchParams.set("idProperty", "email");
    url.searchParams.set("properties", CONTACT_PROPERTIES.join(","));

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) {
      return {
        found: false,
        name: null,
        email: input.email,
        phone: null,
        company: null,
        lifecycleStage: null,
        sourceProvider: "hubspot",
        sourceRecordId: null,
      };
    }

    if (!response.ok) {
      throw new Error(`HubSpot contact lookup failed with status ${response.status}.`);
    }

    const body = (await response.json()) as HubspotContactResponse;
    const properties = body.properties;
    const name = [properties.firstname, properties.lastname].filter(Boolean).join(" ") || null;

    return {
      found: true,
      name,
      email: properties.email ?? input.email,
      phone: properties.phone ?? null,
      company: properties.company ?? null,
      lifecycleStage: properties.lifecyclestage ?? null,
      sourceProvider: "hubspot",
      sourceRecordId: body.id,
    };
  }

  /**
   * Not part of IntegrationProvider - connect-time only (integration.service.ts),
   * so it doesn't force every future provider to implement a "verify"
   * concept before it's actually needed. Uses the same read scope the
   * real feature needs (crm.objects.contacts.read), not a lighter
   * account-info endpoint, so a token missing that scope fails loudly at
   * connect time instead of silently the first time an agent uses it.
   */
  async verifyConnection(): Promise<void> {
    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1`, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HubSpot connection check failed with status ${response.status}.`);
    }
  }
}
