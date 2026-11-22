// JSON file store for conversations: <folder>/<id>.json under the project root, where the folder is
// data/demo in demo mode and data/conversations in every other mode, so placeholder and test
// conversations never mix with real ones. The folder is chosen once at startup from the mode.
// The server stores each conversation exactly as the web app sent it and never edits it.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ConversationSummary } from "../shared/api";
import { MODE } from "./model";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONVERSATIONS_DIR = join(PROJECT_ROOT, "data", MODE === "demo" ? "demo" : "conversations");

// Callers must validate `id` with CONVERSATION_ID_PATTERN first.
function conversationPath(id: string): string {
  return join(CONVERSATIONS_DIR, `${id}.json`);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  await mkdir(CONVERSATIONS_DIR, { recursive: true });
  const names = (await readdir(CONVERSATIONS_DIR)).filter((name) => name.endsWith(".json"));
  const summaries: ConversationSummary[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(CONVERSATIONS_DIR, name), "utf8"));
      const { id, title, updatedAt } = parsed as Record<string, unknown>;
      if (typeof id !== "string" || typeof title !== "string" || typeof updatedAt !== "number") {
        throw new Error("missing id, title or updatedAt");
      }
      summaries.push({ id, title, updatedAt });
    } catch (err) {
      console.warn(`Skipping unreadable conversation file ${name}: ${(err as Error).message}`);
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Returns the raw JSON text, or null when there is no such conversation.
export async function readConversation(id: string): Promise<string | null> {
  try {
    return await readFile(conversationPath(id), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Atomic write: a temp file in the same folder, then rename over the target.
async function writeConversation(id: string, conversation: unknown): Promise<void> {
  await mkdir(CONVERSATIONS_DIR, { recursive: true });
  const target = conversationPath(id);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(conversation), "utf8");
  try {
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

// Saves and deletes for one id run one after another, so a version check and its write
// never interleave with another save or delete of the same conversation.
// Each entry is the tail of that id's chain. It never rejects, and it is removed when the chain is idle.
const locks = new Map<string, Promise<void>>();

async function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).then(work);
  const tail = run.then(() => undefined, () => undefined);
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

// The value of the X-Base-Version header: `new`, or the decimal updatedAt the save is based on.
export type BaseVersion = { kind: "new" } | { kind: "version"; updatedAt: string };

export type SaveOutcome = { kind: "written" } | { kind: "conflict"; currentUpdatedAt: number | null };

// The stored updatedAt, or null when there is no file.
// A file that cannot be read as a conversation counts as missing, so a `new` save can replace it.
async function storedUpdatedAt(id: string): Promise<number | null> {
  const text = await readConversation(id);
  if (text === null) return null;
  try {
    const { updatedAt } = JSON.parse(text) as Record<string, unknown>;
    if (typeof updatedAt === "number") return updatedAt;
  } catch {
    // fall through to the warning below
  }
  console.warn(`Conversation file ${id}.json is unreadable; treating it as missing.`);
  return null;
}

export function saveConversation(id: string, base: BaseVersion, conversation: unknown): Promise<SaveOutcome> {
  return withLock(id, async () => {
    const current = await storedUpdatedAt(id);
    const matches = current === null ? base.kind === "new" : base.kind === "version" && base.updatedAt === String(current);
    if (!matches) return { kind: "conflict", currentUpdatedAt: current };
    await writeConversation(id, conversation);
    return { kind: "written" };
  });
}

export function deleteConversation(id: string): Promise<void> {
  return withLock(id, () => rm(conversationPath(id), { force: true }));
}
