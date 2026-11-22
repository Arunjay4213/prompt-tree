// opencode provider: answers come from a local opencode 2 server (`opencode serve`), so a person can use
// whatever model access their opencode holds. prompt-tree never sees those logins; it only talks to the
// opencode server. Tested against opencode 2.3.2 (@opencode/cli). The V2 API is new; only endpoints that
// are not marked experimental are used.
//
// Active when OPENCODE_URL is set and the server answers as opencode 2 at startup. OPENCODE_PASSWORD is
// the opencode server's own password (HTTP Basic auth, user "opencode"). Models: OPENCODE_MODELS
// (comma separated, opencode naming `provider/model`), otherwise opencode's default model only.
//
// Each completion is stateless: a fresh session with every tool denied, in prompt-tree's own directory
// outside any project, gets ONE prompt that carries the whole conversation as a transcript. The session is
// removed afterwards; sessions left behind by a crash are removed at the next startup.
//
// The opencode API cannot set a system prompt per session, and has no non-experimental way to add an
// agent. opencode does discover agents from `.opencode/agents/<name>.md` in a session's directory, so at
// startup prompt-tree writes its own plain-assistant agent there. Its system prompt replaces opencode's
// coding-agent base prompt. opencode's date and environment context and the person's global AGENTS.md
// still apply.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nameList, type AnswerEnd, type OnText, type Provider, type ProviderRequest, type TerminalEvent } from "./common";

const BASE_URL = (process.env.OPENCODE_URL ?? "").replace(/\/+$/, "");
const AUTH = process.env.OPENCODE_PASSWORD
  ? { authorization: `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_PASSWORD}`).toString("base64")}` }
  : undefined;

// Sessions start here: empty, outside the home directory and any repository, so no project
// instructions (AGENTS.md, CLAUDE.md) are picked up. With every tool denied, nothing writes into it.
const WORK_DIR = join(tmpdir(), "prompt-tree-opencode");

// Every session prompt-tree creates has this title, so leftovers can be recognised and removed.
const SESSION_TITLE = "prompt-tree request";

// prompt-tree's own agent, written into WORK_DIR at startup (opencode's documented Markdown agent format).
const AGENT_FILE = `---
description: Plain chat assistant used by prompt-tree
mode: primary
permissions:
  - action: "*"
    resource: "*"
    effect: deny
---
You are a helpful, knowledgeable assistant in a chat app. Answer the user's message directly and clearly.
You have no tools and no access to files, a shell or the web, so do not offer to use them.
`;

// The agent sessions run as: prompt-tree's own agent when opencode loaded it, otherwise opencode's
// default coding agent (with every tool still denied on the session).
type Agent = "prompt-tree" | "build";

// The parts of opencode events this provider reads.
type OpencodeEvent = {
  type: string;
  data?: { sessionID?: string; delta?: string; finish?: string; reason?: string; error?: { message?: string } };
};

// Calls the opencode API. Every failure becomes an Error with a message that is safe to show.
async function call(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: { ...AUTH, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new Error(`Could not reach opencode at ${BASE_URL}. Check that \`opencode serve\` is running.`);
  }
  if (response.status === 401) {
    throw new Error("opencode rejected the password. Set OPENCODE_PASSWORD in the .env file to your opencode server's password.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(`opencode returned HTTP ${response.status}${body.message ? `: ${body.message}` : ""}.`);
  }
  return response;
}

// Reads a server-sent event stream and yields each event's JSON data. A stream that breaks (opencode
// stopped, network gone, or the browser aborted) simply ends; the caller decides what that means.
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<OpencodeEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const data = buffer.slice(0, end).split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        buffer = buffer.slice(end + 2);
        if (data !== "") yield JSON.parse(data) as OpencodeEvent;
        end = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
  }
}

// The one prompt text for a stateless session: optional instructions, the earlier turns as a labelled
// transcript, then the final user message.
export function transcriptPrompt(request: ProviderRequest): string {
  const earlier = request.messages.slice(0, -1);
  const last = request.messages.at(-1)?.content ?? "";
  if (request.system === undefined && earlier.length === 0) return last;
  const parts: string[] = [];
  if (request.system !== undefined) parts.push(`<instructions>\n${request.system}\n</instructions>`);
  if (earlier.length > 0) {
    const lines = earlier.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`);
    parts.push(`<transcript>\n${lines.join("\n\n")}\n</transcript>`);
  }
  parts.push("Answer the final user message below as the next Assistant turn of this conversation. Do not mention the transcript or its format.");
  parts.push(`User: ${last}`);
  return parts.join("\n\n");
}

// Follows one session's events until its execution ends.
async function readAnswer(events: AsyncGenerator<OpencodeEvent>, sessionID: string, onText: OnText): Promise<TerminalEvent> {
  for await (const event of events) {
    if (event.data?.sessionID !== sessionID) continue;
    switch (event.type) {
      case "session.text.delta":
        await onText(event.data.delta ?? "");
        break;
      case "session.step.ended":
        if (event.data.finish === "length") return { type: "done", outcome: "cut_off" };
        if (event.data.finish === "content-filter") return { type: "error", message: "The answer was stopped by the model's content filter." };
        break;
      case "session.execution.succeeded":
        return { type: "done", outcome: "complete" };
      case "session.execution.failed":
        return { type: "error", message: `opencode could not answer: ${event.data.error?.message ?? "no reason given"}` };
      case "session.execution.interrupted":
        return { type: "error", message: `opencode stopped the answer (${event.data.reason ?? "no reason given"}).` };
    }
  }
  return { type: "error", message: "The connection to opencode was lost before the answer finished." };
}

// Stops the session if it is still running and deletes it, so prompt-tree's requests do not fill the
// person's opencode session list. Runs after the browser may have gone, so it uses its own timeout.
async function removeSession(sessionID: string, interrupt: boolean): Promise<void> {
  try {
    if (interrupt) await call(`/api/session/${sessionID}/interrupt`, { method: "POST", signal: AbortSignal.timeout(5000) });
    await call(`/api/session/${sessionID}`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.warn(`Could not remove opencode session ${sessionID}: ${(err as Error).message}`);
  }
}

async function complete(agent: Agent, modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  const slash = modelName.indexOf("/");
  try {
    // Subscribe first, and wait for the server's connected marker, so no event of this answer is missed.
    const stream = await call(
      "/api/event?types=session.text.delta&types=session.step.ended&types=session.execution.succeeded&types=session.execution.failed&types=session.execution.interrupted",
      { signal },
    );
    const events = readEvents(stream.body as ReadableStream<Uint8Array>);
    if ((await events.next()).value?.type !== "server.connected") throw new Error("The opencode event stream did not start.");
    const created = (await (await call("/api/session", {
      method: "POST",
      signal,
      body: {
        title: SESSION_TITLE,
        agent,
        model: { providerID: modelName.slice(0, slash), id: modelName.slice(slash + 1) },
        location: { directory: WORK_DIR },
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      },
    })).json()) as { data: { id: string } };
    const sessionID = created.data.id;
    try {
      await call(`/api/session/${sessionID}/prompt`, { method: "POST", signal, body: { text: transcriptPrompt(request) } });
      const end = await readAnswer(events, sessionID, onText);
      return signal.aborted ? { type: "disconnected" } : end;
    } finally {
      void events.return(undefined);
      void removeSession(sessionID, signal.aborted);
    }
  } catch (err) {
    if (signal.aborted) return { type: "disconnected" };
    if (err instanceof SyntaxError) return { type: "error", message: "opencode sent an event that could not be read." };
    return { type: "error", message: err instanceof Error ? err.message : "Unexpected error while talking to opencode." };
  }
}

// Checked once at startup. Returns the model names, or none (with one log line) when opencode is not usable.
async function loadModelNames(): Promise<string[]> {
  if (BASE_URL === "") return [];
  try {
    const signal = AbortSignal.timeout(5000);
    const info = (await (await call("/api/info", { signal })).json()) as { version?: string };
    if (!info.version?.startsWith("2.")) {
      console.warn(`opencode at ${BASE_URL} is version ${info.version ?? "unknown"}; prompt-tree needs opencode 2. The opencode provider is off.`);
      return [];
    }
    const listed = (await (await call("/api/model", { signal })).json()) as { data: { id: string; providerID: string }[] };
    const available = new Set(listed.data.map((model) => `${model.providerID}/${model.id}`));
    if (process.env.OPENCODE_MODELS) {
      const names = nameList(process.env.OPENCODE_MODELS);
      const unknown = names.filter((name) => !available.has(name));
      if (unknown.length > 0) console.warn(`opencode does not offer ${unknown.join(", ")}; those models are left out.`);
      return names.filter((name) => available.has(name));
    }
    const found = (await (await call("/api/model/default", { signal })).json()) as { data: { id: string; providerID: string } | null };
    if (found.data === null) {
      console.warn(`opencode at ${BASE_URL} has no default model; set OPENCODE_MODELS. The opencode provider is off.`);
      return [];
    }
    return [`${found.data.providerID}/${found.data.id}`];
  } catch (err) {
    console.warn(`opencode at ${BASE_URL} is not usable (${(err as Error).message}). The opencode provider is off.`);
    return [];
  }
}

// Writes prompt-tree's agent file (only when it changed) and waits until opencode has loaded it for
// WORK_DIR; opencode notices a new agent file after a few seconds.
async function installAgent(): Promise<Agent> {
  const file = join(WORK_DIR, ".opencode", "agents", "prompt-tree.md");
  try {
    mkdirSync(join(WORK_DIR, ".opencode", "agents"), { recursive: true });
    if (!existsSync(file) || readFileSync(file, "utf8") !== AGENT_FILE) writeFileSync(file, AGENT_FILE);
    const query = `location%5Bdirectory%5D=${encodeURIComponent(WORK_DIR)}`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`${BASE_URL}/api/agent/prompt-tree?${query}`, { headers: AUTH, signal: AbortSignal.timeout(5000) });
      const found = (await response.json().catch(() => ({}))) as { data?: { system?: string } };
      if (response.ok && found.data?.system) return "prompt-tree";
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    console.warn("opencode did not load prompt-tree's agent; answers use opencode's coding agent `build` (tools stay denied).");
  } catch (err) {
    console.warn(`Could not install prompt-tree's opencode agent (${(err as Error).message}); answers use opencode's coding agent \`build\`.`);
  }
  return "build";
}

// Deletes sessions a crashed run left behind: those in WORK_DIR with exactly prompt-tree's title.
async function removeStaleSessions(): Promise<void> {
  try {
    const listed = (await (await call(`/api/session?directory=${encodeURIComponent(WORK_DIR)}&limit=200`, { signal: AbortSignal.timeout(5000) })).json()) as { data: { id: string; title?: string }[] };
    const stale = listed.data.filter((session) => session.title === SESSION_TITLE);
    for (const session of stale) await removeSession(session.id, false);
    if (stale.length > 0) console.log(`Removed ${stale.length} leftover opencode session(s) from an earlier run.`);
  } catch (err) {
    console.warn(`Could not look for leftover opencode sessions: ${(err as Error).message}`);
  }
}

export async function loadOpencode(): Promise<Provider> {
  const modelNames = await loadModelNames();
  const agent: Agent = modelNames.length > 0 ? await installAgent() : "build";
  if (modelNames.length > 0) await removeStaleSessions();
  return {
    id: "opencode",
    label: "opencode",
    modelNames,
    complete: (modelName, request, onText, signal) => complete(agent, modelName, request, onText, signal),
  };
}
