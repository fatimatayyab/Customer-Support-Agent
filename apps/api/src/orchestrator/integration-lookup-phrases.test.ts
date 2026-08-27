import { describe, expect, it } from "vitest";
import { extractEmails, hasIdentifiableEmail, isAccountLookupQuestion } from "./integration-lookup-phrases.js";

describe("isAccountLookupQuestion", () => {
  it.each([
    "Am I an existing customer?",
    "Are we already a customer?",
    "What's my account status?",
    "Is my account active?",
    "Can you check my account status",
    "Do you have my info on file?",
    "Do you have my details on file",
    "Is my information on file?",
    "Who's my account manager?",
    "Who is my point of contact?",
    "What company am I with?",
    "What company am I associated with?",
  ])("flags a plausible account-identity question: %s", (message) => {
    expect(isAccountLookupQuestion(message)).toBe(true);
  });

  it.each([
    "What's your return policy?",
    "Do you ship internationally?",
    "What's the weather like today?",
    "Can I get a refund for my order?",
    "What's the status of my order?",
    "I'd like to speak with someone",
    "Do you have this in stock?",
    "What are your business hours?",
    "Can you tell me about your pricing plans?",
    "Is my package on file at the post office?",
  ])("does not flag an unrelated question: %s", (message) => {
    expect(isAccountLookupQuestion(message)).toBe(false);
  });
});

describe("hasIdentifiableEmail", () => {
  it("finds an email anywhere in the given texts", () => {
    expect(hasIdentifiableEmail(["no email here", "reach me at jane@example.com please"])).toBe(true);
  });

  it("returns false when no text contains an email", () => {
    expect(hasIdentifiableEmail(["no email here", "still nothing"])).toBe(false);
  });
});

describe("extractEmails", () => {
  it("extracts every email-shaped string across the given texts", () => {
    expect(extractEmails(["jane@example.com and also john@example.com", "no email here"])).toEqual([
      "jane@example.com",
      "john@example.com",
    ]);
  });

  it("returns an empty array when there is nothing to extract", () => {
    expect(extractEmails(["no email here", "still nothing"])).toEqual([]);
  });
});
