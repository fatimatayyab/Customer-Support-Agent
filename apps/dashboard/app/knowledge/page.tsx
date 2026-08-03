"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface KnowledgeSource {
  id: string;
  type: string;
  title: string;
  status: "pending" | "processing" | "completed" | "failed";
  failureReason: string | null;
  createdAt: string;
}

interface SearchResult {
  id: string;
  content: string;
  knowledgeSourceId: string;
  similarity: number;
}

const POLL_INTERVAL_MS = 2000;

export default function KnowledgePage() {
  const router = useRouter();
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  async function refreshSources() {
    const data = await apiFetch<{ sources: KnowledgeSource[] }>("/knowledge/sources");
    setSources(data?.sources ?? []);
  }

  useEffect(() => {
    refreshSources().catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hasInFlight = sources?.some((source) => source.status === "pending" || source.status === "processing");
    if (!hasInFlight) {
      return;
    }

    pollRef.current = window.setInterval(() => {
      refreshSources();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [sources]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await apiFetch("/knowledge/sources", {
        method: "POST",
        body: JSON.stringify({ type: "plain_text", title, content }),
      });
      setTitle("");
      setContent("");
      await refreshSources();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    await apiFetch(`/knowledge/sources/${id}`, { method: "DELETE" });
    await refreshSources();
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const data = await apiFetch<{ results: SearchResult[] }>("/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      setResults(data?.results ?? []);
    } catch (error) {
      setSearchError(error instanceof ApiError ? error.message : "Search failed.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  if (!sources) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Knowledge</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Sources</h2>
        <ul className="mb-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {sources.length === 0 && <li className="p-3 text-sm text-slate-500">No knowledge sources yet.</li>}
          {sources.map((source) => (
            <li key={source.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div>
                <div className="font-medium">{source.title}</div>
                <div className="text-slate-500">
                  {source.type} · <StatusBadge status={source.status} />
                  {source.status === "failed" && source.failureReason && (
                    <span className="text-red-600"> - {source.failureReason}</span>
                  )}
                </div>
              </div>
              <button onClick={() => handleDelete(source.id)} className="shrink-0 text-red-600 underline">
                Delete
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (e.g. Refund Policy)"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste the knowledge text here..."
            required
            rows={5}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? "Adding..." : "Add source"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Search</h2>
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask a question..."
            required
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchError && <p className="mb-4 text-sm text-red-600">{searchError}</p>}

        {results && (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {results.length === 0 && <li className="p-3 text-sm text-slate-500">No matches.</li>}
            {results.map((result) => (
              <li key={result.id} className="p-3 text-sm">
                <div className="mb-1 text-xs text-slate-500">similarity: {result.similarity.toFixed(3)}</div>
                <div>{result.content}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: KnowledgeSource["status"] }) {
  const colors: Record<KnowledgeSource["status"], string> = {
    pending: "text-slate-500",
    processing: "text-amber-600",
    completed: "text-green-600",
    failed: "text-red-600",
  };
  return <span className={colors[status]}>{status}</span>;
}
