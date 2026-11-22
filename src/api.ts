// Fetch helpers for the JSON routes and a streaming reader for POST /api/complete.

import type { CompleteRequest, Conversation, ConversationSummary, Health, SaveConflict, StreamEvent } from "../shared/api";

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // body was not JSON
  }
  return `Request failed (${res.status})`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return getJson<Health>("/api/health");
}

export function listConversations(): Promise<ConversationSummary[]> {
  return getJson<ConversationSummary[]>("/api/conversations");
}

export type LoadResult = { kind: "found"; conversation: Conversation } | { kind: "missing" };

export async function getConversation(id: string): Promise<LoadResult> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  if (res.status === 404) return { kind: "missing" };
  if (!res.ok) throw new Error(await readError(res));
  return { kind: "found", conversation: (await res.json()) as Conversation };
}

// The stored version a save is based on: the `updatedAt` this client last loaded or saved, or
// "new" when it never loaded or saved the conversation. Sent as the X-Base-Version header.
export type BaseVersion = number | "new";

export function baseVersionHeader(base: BaseVersion): string {
  return base === "new" ? "new" : String(base);
}

// saved:    the server stored this body.
// conflict: the stored version is not the base (changed in another tab), or it was deleted (null).
export type SaveResult = { kind: "saved" } | { kind: "conflict"; currentUpdatedAt: number | null };

// Rejects on network errors and on any other non-2xx answer.
export async function saveConversation(conv: Conversation, base: BaseVersion, keepalive = false): Promise<SaveResult> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conv.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Base-Version": baseVersionHeader(base) },
    body: JSON.stringify(conv),
    keepalive,
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({ currentUpdatedAt: null }))) as Partial<SaveConflict>;
    return { kind: "conflict", currentUpdatedAt: typeof body.currentUpdatedAt === "number" ? body.currentUpdatedAt : null };
  }
  if (!res.ok) throw new Error(await readError(res));
  return { kind: "saved" };
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

// Streams POST /api/complete. EventSource cannot POST, so this reads the body directly.
// Every SSE event is one `data: <json>` line; a network chunk may end in the middle of a line.
// Resolves when the stream ends. Rejects on HTTP errors, network errors, and abort.
export async function streamComplete(
  request: CompleteRequest,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await readError(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trimStart();
    if (!payload) return;
    onEvent(JSON.parse(payload) as StreamEvent);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
}
