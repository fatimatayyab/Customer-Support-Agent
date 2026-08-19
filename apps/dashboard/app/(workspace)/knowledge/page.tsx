"use client";

import { BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";

interface KnowledgeSource {
  id: string;
  type: string;
  title: string;
  sourceLocation: string | null;
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

const STATUS_TONES: Record<KnowledgeSource["status"], BadgeTone> = {
  pending: "neutral",
  processing: "warning",
  completed: "success",
  failed: "danger",
};

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

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [websiteUrls, setWebsiteUrls] = useState("");
  const [addingWebsites, setAddingWebsites] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [websiteSkipped, setWebsiteSkipped] = useState<string[]>([]);

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

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!uploadFile) {
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("title", uploadTitle);
      formData.append("file", uploadFile);
      await apiFetch("/knowledge/sources/upload", { method: "POST", body: formData });
      setUploadTitle("");
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refreshSources();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleAddWebsites(event: FormEvent) {
    event.preventDefault();
    const urls = websiteUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      return;
    }
    setAddingWebsites(true);
    setWebsiteError(null);
    setWebsiteSkipped([]);
    try {
      const result = await apiFetch<{ skipped: string[] }>("/knowledge/sources/website", {
        method: "POST",
        body: JSON.stringify({ urls }),
      });
      setWebsiteUrls("");
      setWebsiteSkipped(result?.skipped ?? []);
      await refreshSources();
    } catch (err) {
      setWebsiteError(err instanceof ApiError ? err.message : "Could not add these URLs.");
    } finally {
      setAddingWebsites(false);
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
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <Skeleton className="mb-6 h-7 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Knowledge</h1>

      <Card>
        <CardHeader title="Sources" />
        <CardBody className="flex flex-col gap-6">
          {sources.length === 0 ? (
            <EmptyState icon={BookOpen} title="No knowledge sources yet" description="Add text, upload a file, or pull in website pages below." />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{source.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-slate-500">
                      <span>{source.type}</span>
                      <Badge tone={STATUS_TONES[source.status]}>{source.status}</Badge>
                      {source.status === "failed" && source.failureReason && (
                        <span className="text-red-600">{source.failureReason}</span>
                      )}
                    </div>
                    {source.sourceLocation && <div className="mt-0.5 text-xs text-slate-400">{source.sourceLocation}</div>}
                  </div>
                  <button onClick={() => handleDelete(source.id)} className="shrink-0 text-sm text-red-600 hover:underline">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreate} className="flex flex-col gap-2">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (e.g. Refund Policy)" required />
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste the knowledge text here..."
              required
              rows={5}
            />
            <Button type="submit" disabled={creating} className="self-start">
              {creating ? "Adding..." : "Add source"}
            </Button>
          </form>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-6">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Upload a file</h3>
            <form onSubmit={handleUpload} className="flex flex-col gap-2">
              <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Title" required />
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.pdf,.docx"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                required
                className="text-sm"
              />
              <p className="text-xs text-slate-400">.txt, .md, .pdf, or .docx</p>
              {uploadError && <InlineError message={uploadError} />}
              <Button type="submit" disabled={uploading} className="self-start">
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </form>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-6">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Add website pages</h3>
            <form onSubmit={handleAddWebsites} className="flex flex-col gap-2">
              <Textarea
                value={websiteUrls}
                onChange={(event) => setWebsiteUrls(event.target.value)}
                placeholder={"https://example.com/help/refunds\nhttps://example.com/help/shipping"}
                rows={3}
              />
              <p className="text-xs text-slate-400">One URL per line. Each page is fetched and added separately.</p>
              {websiteError && <InlineError message={websiteError} />}
              {websiteSkipped.length > 0 && (
                <p className="text-sm text-amber-700">
                  Already in your knowledge base, skipped: {websiteSkipped.join(", ")}
                </p>
              )}
              <Button type="submit" disabled={addingWebsites} className="self-start">
                {addingWebsites ? "Adding..." : "Add pages"}
              </Button>
            </form>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Search" description="Test what your assistant would retrieve for a question." />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask a question..." required className="flex-1" />
            <Button type="submit" disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </Button>
          </form>

          {searchError && <InlineError message={searchError} />}

          {results && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {results.length === 0 && <li className="p-3 text-sm text-slate-500">No matches.</li>}
              {results.map((result) => (
                <li key={result.id} className="p-3 text-sm">
                  <div className="mb-1 text-xs text-slate-500">similarity: {result.similarity.toFixed(3)}</div>
                  <div className="text-slate-700">{result.content}</div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
