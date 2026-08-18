import { useState } from "preact/hooks";

// Dev-only: shown instead of the real Widget when no API key is available
// from either window.CSAWidgetConfig or the dev-only localStorage fallback
// (see config.ts). A real embed always sets window.CSAWidgetConfig itself,
// so a real customer's site never sees this.
export function ConfigPrompt({ message, onSubmit }: { message?: string | null; onSubmit: (apiKey: string) => void }) {
  const [value, setValue] = useState("");

  function handleSubmit(event: Event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <div class="config-prompt">
      <p class="config-prompt-title">Widget not configured</p>
      {message && <p class="config-prompt-error">{message}</p>}
      <p class="config-prompt-hint">
        Paste a workspace API key (Dashboard → Home → API Keys → Create). Remembered in this browser for next time.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          value={value}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
          placeholder="csa_live_..."
          autofocus
        />
        <button type="submit" disabled={!value.trim()}>
          Save
        </button>
      </form>
    </div>
  );
}
