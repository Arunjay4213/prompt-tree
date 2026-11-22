// The model registry: which models are available, the server mode, the default model, and
// routing a model id (`<provider>:<model name>`) to its provider. Built once at startup from the
// environment. Adding a provider is adding its file in providers/ and one entry in PROVIDERS.

import type { ModelInfo, ServerMode } from "../shared/api";
import { anthropic } from "./providers/anthropic";
import type { AnswerEnd, OnText, Provider, ProviderRequest } from "./providers/common";
import { compatible } from "./providers/compatible";
import { demo } from "./providers/demo";
import { openai } from "./providers/openai";
import { loadOpencode } from "./providers/opencode";

export type { AnswerEnd } from "./providers/common";

// Order matters: it is the order of the model list and decides the default model.
// opencode's models come from its local server, so they are loaded (once) before the server starts.
const PROVIDERS: Provider[] = process.env.DEMO_MODE === "1" ? [demo] : [openai, anthropic, compatible, await loadOpencode()];

export const ACTIVE_PROVIDERS = PROVIDERS.filter((provider) => provider.modelNames.length > 0);

export const MODELS: ModelInfo[] = ACTIVE_PROVIDERS.flatMap((provider) =>
  provider.modelNames.map((name) => ({
    id: `${provider.id}:${name}`,
    name,
    provider: provider.id,
    providerName: provider.label,
  })),
);

export const MODE: ServerMode =
  process.env.DEMO_MODE === "1" ? "demo" : MODELS.length > 0 ? "live" : "no_key";

export const DEFAULT_MODEL: string | null =
  MODELS.find((model) => model.id === process.env.DEFAULT_MODEL)?.id ?? MODELS[0]?.id ?? null;

// Where a completion request goes.
// no_provider:   nothing is configured; the answer is a single error event that says how to fix it
// model:         a known model and the provider that serves it
// unknown_model: the id is not in MODELS; the route answers 400 before any stream starts
export type Route =
  | { kind: "no_provider" }
  | { kind: "model"; provider: Provider; modelName: string }
  | { kind: "unknown_model" };

export function routeModel(id: string): Route {
  if (MODE === "no_key") return { kind: "no_provider" };
  const separator = id.indexOf(":");
  const provider = ACTIVE_PROVIDERS.find((candidate) => candidate.id === id.slice(0, separator));
  const modelName = id.slice(separator + 1);
  if (separator < 0 || provider === undefined || !provider.modelNames.includes(modelName)) {
    return { kind: "unknown_model" };
  }
  return { kind: "model", provider, modelName };
}

// Streams text through `onText` and returns how the answer ended (AnswerEnd), so the route can send
// exactly one "done" or "error" event at the end.
export function completeAnswer(
  route: Exclude<Route, { kind: "unknown_model" }>,
  request: ProviderRequest,
  onText: OnText,
  signal: AbortSignal,
): Promise<AnswerEnd> {
  switch (route.kind) {
    case "no_provider":
      return Promise.resolve({
        type: "error",
        message:
          "No model provider is configured. In the .env file set OPENAI_API_KEY, or ANTHROPIC_API_KEY, or COMPATIBLE_BASE_URL with COMPATIBLE_MODELS, then restart the server. Or run `pnpm dev:demo` for placeholder answers.",
      });
    case "model":
      return route.provider.complete(route.modelName, request, onText, signal);
  }
}
