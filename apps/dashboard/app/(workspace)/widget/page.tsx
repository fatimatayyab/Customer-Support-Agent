"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useSession } from "@/lib/session-context";
import { ApiError, apiFetch } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
// The URL a REAL embedded widget (someone else's actual website) uses -
// distinct from API_URL above, which is only this dashboard's own
// internal traffic and must keep working purely locally regardless of
// whether a public widget host exists. Falls back to API_URL/the same
// placeholder pattern when unset, so local dev without a tunnel/real
// host configured behaves exactly as it always has.
const WIDGET_API_URL = process.env.NEXT_PUBLIC_WIDGET_API_URL ?? API_URL;
const WIDGET_HOST = process.env.NEXT_PUBLIC_WIDGET_HOST ?? "https://YOUR-WIDGET-HOST";
const DEFAULT_INSTALL_NAME = "Website";
// Matches widget.css's own fallback (var(--csa-primary-color, #0f172a)) -
// the color picker always needs a concrete value to display, so "still
// at this value" is how the form represents "not customized" without a
// separate reset toggle. Saving at this exact value sends null, not the
// literal hex string, so a workspace that's never touched this field
// keeps behaving exactly as it did before this feature existed.
const BUILTIN_DEFAULT_COLOR = "#0f172a";
// Same permission boundary the backend already enforces on every
// widget-management route (POST/DELETE/rotate /workspaces/api-keys,
// PUT /workspaces/widget-settings) - one shared constant so Install,
// Advanced, and Appearance can never drift out of sync on who's allowed
// to manage this page's controls.
const MANAGE_WIDGET_ROLES = ["owner", "administrator"];

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  allowedOrigins: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface WidgetSettings {
  assistantName: string | null;
  greetingMessage: string | null;
  primaryColor: string | null;
  position: "left" | "right";
  avatarUrl: string | null;
  updatedAt: string | null;
}

function embedSnippet(apiKey: string): string {
  return `<script>
  window.CSAWidgetConfig = {
    apiKey: "${apiKey}",
    apiUrl: "${WIDGET_API_URL}"
  };
</script>
<script src="${WIDGET_HOST}/widget.js" async></script>`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function WidgetPage() {
  const router = useRouter();
  const { user: sessionUser } = useSession();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[] | null>(null);
  // hasEverProvisioned distinguishes "never installed" (auto-provision a
  // default) from "installed once, then explicitly removed" (don't
  // silently recreate it) - both look identical as an empty apiKeys
  // array otherwise. Comes from GET /workspaces/api-keys's everProvisioned.
  const [hasEverProvisioned, setHasEverProvisioned] = useState(false);
  // revealedKey/revealedKeyId represent the ONE primary install snippet
  // shown at the top of the Install section. Gated on revealedKeyId
  // matching the current primary's id (not just "is revealedKey set") so
  // this box can never keep showing a snippet for a key that's since been
  // rotated away from, or removed - see the render check below.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  // A secondary (non-primary) site's just-created/just-rotated raw key,
  // shown inline in its own Advanced row - deliberately never shares the
  // top Install box with the primary install, so "add another site" or
  // rotating a secondary site can never be mistaken for replacing the
  // main install code.
  const [revealedSiteKey, setRevealedSiteKey] = useState<{ id: string; rawKey: string } | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteDomains, setNewSiteDomains] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [advancedBusy, setAdvancedBusy] = useState<string | null>(null);

  const [assistantName, setAssistantName] = useState("");
  const [greetingMessage, setGreetingMessage] = useState("");
  const [primaryColor, setPrimaryColor] = useState(BUILTIN_DEFAULT_COLOR);
  const [position, setPosition] = useState<"left" | "right">("right");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceSaved, setAppearanceSaved] = useState(false);

  async function refresh(): Promise<{ keys: ApiKeySummary[]; everProvisioned: boolean }> {
    const data = await apiFetch<{ apiKeys: ApiKeySummary[]; everProvisioned: boolean }>("/workspaces/api-keys");
    const keys = data?.apiKeys ?? [];
    const everProvisioned = data?.everProvisioned ?? false;
    setApiKeys(keys);
    setHasEverProvisioned(everProvisioned);
    return { keys, everProvisioned };
  }

  // Shared by the first-visit auto-provision below and the manual
  // "Create an install code" button (shown once a workspace has
  // explicitly removed its only install - see the !primary branch in the
  // render). Always creates the default-named install, which becomes the
  // primary by virtue of being the workspace's only/oldest key.
  async function handleCreateDefaultInstall() {
    setInstallBusy(true);
    setInstallError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: DEFAULT_INSTALL_NAME }),
      });
      if (result) {
        setRevealedKey(result.apiKey.rawKey);
        setRevealedKeyId(result.apiKey.id);
        setApiKeys((keys) => (keys ? [...keys, result.apiKey] : [result.apiKey]));
        setHasEverProvisioned(true);
      }
    } catch (err) {
      setInstallError(err instanceof ApiError ? err.message : "Could not set up your install code.");
    } finally {
      setInstallBusy(false);
    }
  }

  useEffect(() => {
    apiFetch<{ settings: WidgetSettings }>("/workspaces/widget-settings").then((data) => {
      if (!data) return;
      setAssistantName(data.settings.assistantName ?? "");
      setGreetingMessage(data.settings.greetingMessage ?? "");
      setPrimaryColor(data.settings.primaryColor ?? BUILTIN_DEFAULT_COLOR);
      setPosition(data.settings.position);
      setAvatarUrl(data.settings.avatarUrl ?? "");
      setAppearanceLoaded(true);
    });

    refresh()
      .then(async ({ keys, everProvisioned }) => {
        // Only true first visit auto-provisions: nothing installed yet
        // AND this workspace has never had a key row at all. If it has
        // (everProvisioned, from a key that was later explicitly
        // removed), an empty list means "removed on purpose" - showing
        // the manual !primary/"Create an install code" state instead,
        // not silently undoing that removal on every reload.
        if (keys.length === 0 && !everProvisioned) {
          await handleCreateDefaultInstall();
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveAppearance(event: FormEvent) {
    event.preventDefault();
    setAppearanceSaving(true);
    setAppearanceError(null);
    setAppearanceSaved(false);
    try {
      const result = await apiFetch<{ settings: WidgetSettings }>("/workspaces/widget-settings", {
        method: "PUT",
        body: JSON.stringify({
          assistantName: assistantName.trim() || null,
          greetingMessage: greetingMessage.trim() || null,
          primaryColor: primaryColor === BUILTIN_DEFAULT_COLOR ? null : primaryColor,
          position,
          avatarUrl: avatarUrl.trim() || null,
        }),
      });
      if (result) {
        setAssistantName(result.settings.assistantName ?? "");
        setGreetingMessage(result.settings.greetingMessage ?? "");
        setPrimaryColor(result.settings.primaryColor ?? BUILTIN_DEFAULT_COLOR);
        setPosition(result.settings.position);
        setAvatarUrl(result.settings.avatarUrl ?? "");
        setAppearanceSaved(true);
      }
    } catch (err) {
      setAppearanceError(err instanceof ApiError ? err.message : "Could not save appearance settings.");
    } finally {
      setAppearanceSaving(false);
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  // Handles rotation for BOTH the Install section's primary button and
  // Advanced's per-row "Rotate" - which box the new code lands in depends
  // on whether the rotated key is the current primary, not on which
  // button was clicked, so the two stay behaviorally identical for the
  // primary's own row.
  async function handleGetNewCode(id: string) {
    const isPrimary = id === primary?.id;
    setInstallBusy(true);
    setInstallError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>(
        `/workspaces/api-keys/${id}/rotate`,
        { method: "POST" },
      );
      if (result) {
        if (isPrimary) {
          setRevealedKey(result.apiKey.rawKey);
          setRevealedKeyId(result.apiKey.id);
        } else {
          setRevealedSiteKey({ id: result.apiKey.id, rawKey: result.apiKey.rawKey });
        }
        setApiKeys((keys) => (keys ? keys.map((key) => (key.id === id ? result.apiKey : key)) : [result.apiKey]));
      }
    } catch (err) {
      setInstallError(err instanceof ApiError ? err.message : "Could not get a new install code.");
    } finally {
      setInstallBusy(false);
    }
  }

  // Always reveals into the Advanced-row box (revealedSiteKey), never the
  // top Install snippet - "add another site" creates a second, distinct
  // credential for the same assistant, it never replaces the primary
  // install, so its raw key should never appear in that box.
  async function handleAddSite(event: FormEvent) {
    event.preventDefault();
    setAdvancedError(null);
    const allowedOrigins = newSiteDomains
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);
    try {
      const result = await apiFetch<{ apiKey: ApiKeySummary & { rawKey: string } }>("/workspaces/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newSiteName, ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}) }),
      });
      if (result) {
        setRevealedSiteKey({ id: result.apiKey.id, rawKey: result.apiKey.rawKey });
        setApiKeys((keys) => (keys ? [...keys, result.apiKey] : [result.apiKey]));
        setHasEverProvisioned(true);
        setNewSiteName("");
        setNewSiteDomains("");
      }
    } catch (err) {
      setAdvancedError(err instanceof ApiError ? err.message : "Could not add this site.");
    }
  }

  async function handleRevoke(id: string) {
    setAdvancedBusy(id);
    setAdvancedError(null);
    try {
      await apiFetch(`/workspaces/api-keys/${id}`, { method: "DELETE" });
      setApiKeys((keys) => (keys ? keys.filter((key) => key.id !== id) : keys));
      // Clear a reveal box that belonged to whatever was just removed -
      // the render conditions below already re-derive from apiKeys/primary
      // and would hide these on their own, but clearing explicitly avoids
      // holding a removed key's raw value in memory any longer than needed.
      setRevealedKeyId((current) => {
        if (current === id) {
          setRevealedKey(null);
          return null;
        }
        return current;
      });
      setRevealedSiteKey((current) => (current?.id === id ? null : current));
    } catch (err) {
      setAdvancedError(err instanceof ApiError ? err.message : "Could not remove this site.");
    } finally {
      setAdvancedBusy(null);
    }
  }

  if (apiKeys === null) {
    return null;
  }

  // The primary/default install. Prefer matching by name over "oldest
  // createdAt": rotating a key creates a new row with a fresh createdAt,
  // which would otherwise silently hand "primary" status to a different
  // site the next time this key is rotated. The auto-provisioned default
  // always keeps its name across rotation (the backend copies it), so
  // name is the stable identity here, not creation order.
  const byOldest = [...apiKeys].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const primary = apiKeys.find((key) => key.name === DEFAULT_INSTALL_NAME) ?? byOldest[0];
  // Gated client-side in addition to, never instead of, the backend's
  // own requireRole checks - a support_agent can still see the install
  // status, the site list, and current appearance settings, just not
  // the actions that change any of them (rotate/remove/add a site, save
  // appearance). Matches this page's every management route exactly.
  const canManageWidget = MANAGE_WIDGET_ROLES.includes(sessionUser.role);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Chat Widget</h1>

      <Card>
        <CardHeader title="Install" />
        <CardBody className="flex flex-col gap-3">
          {installError && <InlineError message={installError} />}

          {installBusy && !revealedKey && <p className="text-sm text-slate-500">Setting up your install code...</p>}

          {/* Gated on revealedKeyId matching the current primary's id, not
              just "is revealedKey set" - if the primary is later rotated
              again or removed, this box must stop showing this stale raw
              value rather than keep displaying a code that's no longer the
              active credential. */}
          {revealedKey && revealedKeyId === primary?.id && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="mb-1 font-medium text-amber-800">
                Add this to your site to turn your assistant on. This code identifies your widget - it&apos;s fine
                for it to live in your site&apos;s public source, it isn&apos;t a password.
              </p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 overflow-x-auto rounded bg-white p-2 text-xs">{embedSnippet(revealedKey)}</pre>
                <div className="flex shrink-0 flex-col items-stretch gap-1">
                  <button
                    onClick={() => copyToClipboard(embedSnippet(revealedKey))}
                    className="rounded-md border border-amber-300 px-2 py-1 text-xs"
                  >
                    Copy install snippet
                  </button>
                  <button
                    onClick={() => copyToClipboard(revealedKey)}
                    title="Copies just the bare key, for developer/testing use (e.g. the widget dev harness) - not what you'd put on a real site."
                    className="px-2 py-0.5 text-right text-xs text-amber-800 underline"
                  >
                    Copy key
                  </button>
                </div>
              </div>
            </div>
          )}

          {primary && !installBusy && (
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <Badge tone="success">✓ Installed</Badge>
                  <div className="mt-1 text-slate-500">Last customer interaction: {formatRelativeTime(primary.lastUsedAt)}</div>
                </div>
                {!revealedKey && canManageWidget && (
                  <Button size="sm" variant="outline" onClick={() => handleGetNewCode(primary.id)}>
                    Get a new install code
                  </Button>
                )}
              </div>
              {!revealedKey && canManageWidget && (
                <p className="mt-2 text-xs text-slate-500">
                  This replaces your current code for this same install - it doesn&apos;t add a second one. The old
                  code stops working the moment you do this, so update your site with the new one right away.
                </p>
              )}
            </div>
          )}

          {/* Not the same as "loading" (apiKeys === null, handled above by
              returning null): this is a workspace that has explicitly
              removed its only install and hasn't recreated one - the empty
              apiKeys array here must NOT silently auto-provision a
              replacement (that's exactly the bug this state exists to
              avoid; see hasEverProvisioned/refresh()'s mount-effect check). */}
          {!primary && !installBusy && (
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="font-medium text-slate-700">Not installed</div>
              <div className="text-slate-500">No active install code for this workspace right now.</div>
              {canManageWidget && (
                <Button size="sm" className="mt-2" onClick={handleCreateDefaultInstall}>
                  Create an install code
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Appearance" />
        <CardBody>
          {!appearanceLoaded && <p className="text-sm text-slate-500">Loading...</p>}

          {appearanceLoaded && (
            <form onSubmit={handleSaveAppearance} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Assistant name</span>
                <Input
                  value={assistantName}
                  onChange={(event) => setAssistantName(event.target.value)}
                  placeholder="Defaults to your workspace name"
                  disabled={!canManageWidget}
                  maxLength={100}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Greeting message</span>
                <Textarea
                  value={greetingMessage}
                  onChange={(event) => setGreetingMessage(event.target.value)}
                  placeholder="Shown as the first message when a customer opens the chat"
                  disabled={!canManageWidget}
                  maxLength={500}
                  rows={2}
                />
              </label>

              <div className="flex items-end gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Color</span>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    disabled={!canManageWidget}
                    className="h-9 w-14 cursor-pointer rounded border border-slate-300 disabled:opacity-50"
                  />
                </label>
                {canManageWidget && primaryColor !== BUILTIN_DEFAULT_COLOR && (
                  <button
                    type="button"
                    onClick={() => setPrimaryColor(BUILTIN_DEFAULT_COLOR)}
                    className="pb-2 text-xs text-slate-500 underline"
                  >
                    Reset to default
                  </button>
                )}

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Position</span>
                  <Select
                    value={position}
                    onChange={(event) => setPosition(event.target.value as "left" | "right")}
                    disabled={!canManageWidget}
                  >
                    <option value="right">Bottom right</option>
                    <option value="left">Bottom left</option>
                  </Select>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Avatar URL</span>
                <div className="flex items-center gap-2">
                  {avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  )}
                  <Input
                    value={avatarUrl}
                    onChange={(event) => setAvatarUrl(event.target.value)}
                    placeholder="https://example.com/avatar.png (optional)"
                    disabled={!canManageWidget}
                    className="flex-1"
                  />
                </div>
                <span className="text-xs text-slate-500">
                  Must be a link to an image that&apos;s already publicly reachable online, not a file on your
                  computer - uploading an image directly isn&apos;t supported yet.
                </span>
              </label>

              {appearanceError && <InlineError message={appearanceError} />}
              {appearanceSaved && <p className="text-sm text-emerald-700">Saved.</p>}

              {canManageWidget && (
                <Button type="submit" disabled={appearanceSaving} className="self-start">
                  {appearanceSaving ? "Saving..." : "Save"}
                </Button>
              )}
            </form>
          )}
        </CardBody>
      </Card>

      <Accordion title="Advanced">
        {advancedError && (
          <div className="mb-3">
            <InlineError message={advancedError} />
          </div>
        )}

        <ul className="mb-4 divide-y divide-slate-100 rounded-md border border-slate-200">
          {apiKeys.length === 0 && <li className="p-3 text-sm text-slate-500">No sites yet.</li>}
          {apiKeys.map((key) => (
            <li key={key.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-slate-900">
                    {key.name} <code className="text-slate-500">{key.keyPrefix}...</code>
                  </div>
                  <div className="text-slate-500">
                    {key.allowedOrigins && key.allowedOrigins.length > 0
                      ? `restricted to ${key.allowedOrigins.join(", ")}`
                      : "not restricted to any domain"}
                  </div>
                </div>
                {canManageWidget && (
                  <div className="flex shrink-0 gap-3">
                    <button
                      onClick={() => handleGetNewCode(key.id)}
                      disabled={advancedBusy === key.id}
                      title="Replaces this site's code - the old one stops working immediately."
                      className="text-slate-600 hover:underline disabled:opacity-50"
                    >
                      Rotate
                    </button>
                    <button
                      onClick={() => handleRevoke(key.id)}
                      disabled={advancedBusy === key.id}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {/* A secondary site's own reveal, scoped to its row - never
                  the top Install box, so it can't be mistaken for a
                  replacement of the primary install's code. */}
              {revealedSiteKey?.id === key.id && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="mb-1 font-medium text-amber-800">
                    Code for &ldquo;{key.name}&rdquo; - add this to that site. It&apos;s a separate credential from
                    your main install; it doesn&apos;t replace it.
                  </p>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 overflow-x-auto rounded bg-white p-2 text-xs">
                      {embedSnippet(revealedSiteKey.rawKey)}
                    </pre>
                    <div className="flex shrink-0 flex-col items-stretch gap-1">
                      <button
                        onClick={() => copyToClipboard(embedSnippet(revealedSiteKey.rawKey))}
                        className="rounded-md border border-amber-300 px-2 py-1 text-xs"
                      >
                        Copy install snippet
                      </button>
                      <button
                        onClick={() => copyToClipboard(revealedSiteKey.rawKey)}
                        title="Copies just the bare key, for developer/testing use - not what you'd put on a real site."
                        className="px-2 py-0.5 text-right text-xs text-amber-800 underline"
                      >
                        Copy key
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {canManageWidget && (
          <form onSubmit={handleAddSite} className="flex flex-col gap-2">
            <p className="text-xs text-slate-500">
              A site is a separate domain that gets its own code and can be restricted to its own origin - it still
              shares this same assistant, knowledge base, and Appearance settings. This doesn&apos;t rotate or
              replace your existing codes.
            </p>
            <div className="flex gap-2">
              <Input
                value={newSiteName}
                onChange={(event) => setNewSiteName(event.target.value)}
                placeholder="Site name (e.g. Blog)"
                required
                className="flex-1"
              />
              <Button type="submit">Add another site</Button>
            </div>
            <Input
              value={newSiteDomains}
              onChange={(event) => setNewSiteDomains(event.target.value)}
              placeholder="Restrict to domains, comma-separated (optional)"
            />
            <p className="text-xs text-slate-500">
              Enter the exact hostname your site uses - www.example.com and example.com are treated as different
              domains, so include both if your site answers to either.
            </p>
          </form>
        )}
      </Accordion>
    </div>
  );
}
