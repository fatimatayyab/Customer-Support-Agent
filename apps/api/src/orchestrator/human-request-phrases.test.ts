import { describe, expect, it } from "vitest";
import { isExplicitHumanRequest } from "./human-request-phrases.js";

describe("isExplicitHumanRequest", () => {
  it.each([
    "Can I talk to a human please?",
    "I want to speak to a real person",
    "Please connect me with an agent",
    "Can you put me in touch with a representative",
    "I'd like to speak with someone",
    "Get me a human agent right now",
    "Is a live agent available?",
    "Can you transfer me to a person",
    "escalate this to a human",
    "Just give me an actual human, not a bot",
    "I need to talk to a real person about my order",
    "I'd like to keep chatting with a representative",
  ])("flags a clear request: %s", (message) => {
    expect(isExplicitHumanRequest(message)).toBe(true);
  });

  it.each([
    "I'm only human, I make mistakes sometimes",
    "This looks like a human error on your end",
    "What's your policy for a person who lost their receipt?",
    "Is your agent available for a demo of the travel package?",
    "The human resources team handles that internally",
    "Can a human review my application at some point?",
    "I spoke with your team yesterday about this",
    "Our real estate agent recommended this neighborhood",
    "As a human being I appreciate the quick reply",
    "Do you have an insurance agent who covers this?",
    "What time are you open?",
    "Can I get a refund for my order?",
    "Can you get me a human-readable export of my order history?",
    "I need a human-readable version of this invoice",
  ])("does not flag generic/unrelated use: %s", (message) => {
    expect(isExplicitHumanRequest(message)).toBe(false);
  });
});
