// prompt-tree server: a stateless streaming proxy to the model providers plus a JSON file store.
// The HTTP contract is in shared/api.ts.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { CONVERSATION_ID_PATTERN } from "../shared/api";
import type { CompleteRequest, Health, SaveConflict, StreamEvent } from "../shared/api";
import { ACTIVE_PROVIDERS, completeAnswer, DEFAULT_MODEL, MODE, MODELS, routeModel } from "./model";
import { deleteConversation, listConversations, PROJECT_ROOT, readConversation, saveConversation } from "./store";
import type { BaseVersion } from "./store";

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();

function badRequest(c: Context, error: string) {
  return c.json({ error }, 400);
}

app.get("/api/health", (c) => c.json<Health>({ mode: MODE, models: MODELS, defaultModel: DEFAULT_MODEL }));

app.get("/api/conversations", async (c) => c.json(await listConversations()));

app.get("/api/conversations/:id", async (c) => {
  const id = c.req.param("id");
  if (!CONVERSATION_ID_PATTERN.test(id)) return badRequest(c, "Invalid conversation id.");
  const text = await readConversation(id);
  if (text === null) return c.json({ error: "Conversation not found." }, 404);
  return c.body(text, 200, { "Content-Type": "application/json; charset=utf-8" });
});

app.put(
  "/api/conversations/:id",
  bodyLimit({ maxSize: 20 * 1024 * 1024, onError: (c) => c.json({ error: "Conversation is larger than 20 MB." }, 413) }),
  async (c) => {
    const id = c.req.param("id");
    if (!CONVERSATION_ID_PATTERN.test(id)) return badRequest(c, "Invalid conversation id.");
    const header = c.req.header("X-Base-Version");
    if (header === undefined || (header !== "new" && !/^\d+$/.test(header))) {
      return badRequest(c, 'X-Base-Version must be "new" or the decimal updatedAt the save is based on.');
    }
    const base: BaseVersion = header === "new" ? { kind: "new" } : { kind: "version", updatedAt: header };
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return badRequest(c, "Body must be a JSON object.");
    }
    const { id: bodyId, title, updatedAt } = body as Record<string, unknown>;
    if (bodyId !== id) return badRequest(c, "Body id does not match the URL id.");
    if (typeof title !== "string") return badRequest(c, "title must be a string.");
    if (typeof updatedAt !== "number") return badRequest(c, "updatedAt must be a number.");
    const outcome = await saveConversation(id, base, body);
    switch (outcome.kind) {
      case "written":
        return c.body(null, 204);
      case "conflict": {
        const error = outcome.currentUpdatedAt === null
          ? "This conversation was deleted in another tab or window."
          : "This conversation was changed in another tab or window.";
        return c.json<SaveConflict>({ error, currentUpdatedAt: outcome.currentUpdatedAt }, 409);
      }
    }
  },
);

app.delete("/api/conversations/:id", async (c) => {
  const id = c.req.param("id");
  if (!CONVERSATION_ID_PATTERN.test(id)) return badRequest(c, "Invalid conversation id.");
  await deleteConversation(id);
  return c.body(null, 204);
});

// Returns a readable problem with the request, or null when it is a valid CompleteRequest.
function completeRequestProblem(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object.";
  const { model, system, messages } = body as Record<string, unknown>;
  if (typeof model !== "string") return "model must be a model id string (see GET /api/health).";
  if (system !== undefined && typeof system !== "string") return "system must be a string.";
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array.";
  for (const message of messages as unknown[]) {
    const { role, content } = (message ?? {}) as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return 'Each message role must be "user" or "assistant".';
    if (typeof content !== "string") return "Each message content must be a string.";
  }
  if ((messages.at(-1) as { role: string }).role !== "user") return "The last message must be from the user.";
  return null;
}

app.post("/api/complete", async (c) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const problem = completeRequestProblem(body);
  if (problem !== null) return badRequest(c, problem);
  const request = body as CompleteRequest;
  const route = routeModel(request.model);
  if (route.kind === "unknown_model") return badRequest(c, `Unknown model "${request.model}". Available models are listed in GET /api/health.`);
  // Aborted by the node server when the browser closes the connection.
  const signal = c.req.raw.signal;

  return streamSSE(c, async (stream) => {
    const send = (event: StreamEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    const end = await completeAnswer(route, { system: request.system, messages: request.messages }, (text) => send({ type: "text", text }), signal);
    if (end.type !== "disconnected") await send(end);
  });
});

// Serve the built web app when it exists, so `pnpm build && pnpm start` runs everything from here.
const DIST_DIR = join(PROJECT_ROOT, "dist");
if (existsSync(join(DIST_DIR, "index.html"))) {
  app.use("*", serveStatic({ root: DIST_DIR }));
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api")) return next();
    return serveStatic({ root: DIST_DIR, path: "index.html" })(c, next);
  });
}

app.notFound((c) => c.json({ error: "Not found." }, 404));

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: PORT }, (info) => {
  const counts = ACTIVE_PROVIDERS.map((provider) => `${provider.label} ${provider.modelNames.length}`).join(", ") || "none";
  console.log(`prompt-tree server: mode ${MODE}, models: ${counts}, http://127.0.0.1:${info.port}`);
});
