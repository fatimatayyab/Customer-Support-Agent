import { useState } from "preact/hooks";
import { extractApiKey } from "./config.js";

// Dev-only: shown instead of the real Widget when no API key is available
// from either window.CSAWidgetConfig or the dev-only localStorage fallback
// (see config.ts). A real embed always sets window.CSAWidgetConfig itself,
// so a real customer's site never sees this.
export function ConfigPrompt({ message, onSubmit }: { message?: string | null; onSubmit: (apiKey: string) => void }) {
  const [value, setValue] = useState("");
  const [formatError, setFormatError] = useState<string | null>(null);

  function handleSubmit(event: Event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    // Tolerant of pasting the whole "Copy install snippet" output or a
    // hand-selected value with stray quotes/commas - extractApiKey
    // matches the key shape anywhere in the input. Only a genuinely
    // unrecognizable paste (not this key's shape at all) is a format
    // error; a well-formed but rotated/revoked/suspended key still
    // passes this check and is reported instead by main.tsx's own
    // pre-flight identify check, with its own distinct message - the two
    // failure reasons are deliberately never conflated into one.
    const extracted = extractApiKey(trimmed);
    if (!extracted) {
      setFormatError(
        "Invalid API key format - paste the key itself, or the full install snippet, and it'll be picked out automatically.",
      );
      return;
    }
    setFormatError(null);
    onSubmit(extracted);
  }

  return (
    <div class="config-prompt">
      <p class="config-prompt-title">Widget not configured</p>
      {formatError ? (
        <p class="config-prompt-error">{formatError}</p>
      ) : (
        message && <p class="config-prompt-error">{message}</p>
      )}
      <p class="config-prompt-hint">
        Paste a workspace API key or the full install snippet (Dashboard → Chat Widget → Install). Remembered in this
        browser for next time.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          value={value}
          onInput={(event) => {
            setValue((event.target as HTMLInputElement).value);
            setFormatError(null);
          }}
          placeholder="csa_live_... or paste the whole snippet"
          autofocus
        />
        <button type="submit" disabled={!value.trim()}>
          Save
        </button>
      </form>
    </div>
  );
}
