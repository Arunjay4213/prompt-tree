// The server's mode as the interface shows it, in one table: the top bar's mode tag reads it, so the
// wording is the same everywhere.

import type { ModelInfo } from "../../shared/api";
import type { HealthState } from "../store";

export type ServerModeKind = "loading" | "live" | "demo" | "no_key" | "unreachable";

export type ServerMode = {
  kind: ServerModeKind;
  dot: "bg-line" | "bg-pass" | "bg-accent" | "bg-fail";
  tag: string; // the top bar's tag (empty: no tag, the model is live or the mode is not known yet)
  short: string; // the top bar's tag when the bar is narrow
  tip: string;
};

const MODES: Record<ServerModeKind, Omit<ServerMode, "kind">> = {
  loading: { dot: "bg-line", tag: "", short: "", tip: "Asking the server which mode it runs in" },
  live: { dot: "bg-pass", tag: "", short: "", tip: "Live: answers come from real models and cost money" },
  demo: {
    dot: "bg-accent",
    tag: "Demo - placeholder answers",
    short: "Demo",
    tip: "Demo mode: placeholder answers from two demo models, no real model is called and nothing is spent (started with pnpm dev:demo)",
  },
  no_key: {
    dot: "bg-fail",
    tag: "No API key",
    short: "No key",
    tip: "No API key: set a provider key in the .env file (see .env.example) and restart the server",
  },
  unreachable: {
    dot: "bg-fail",
    tag: "Server offline",
    short: "Offline",
    tip: "The server is not reachable: start it with pnpm dev and reload",
  },
};

// With more than one model, the tooltip also lists them by provider.
export function serverMode(health: HealthState, models: ModelInfo[]): ServerMode {
  const kind: ServerModeKind = health.kind === "ready" ? health.health.mode : health.kind;
  const mode = MODES[kind];
  return { kind, ...mode, tip: models.length > 1 ? `${mode.tip}. ${modelList(models)}` : mode.tip };
}

// "OpenAI: model-x, model-y · Anthropic: model-z"
function modelList(models: ModelInfo[]): string {
  const groups = new Map<string, string[]>();
  for (const m of models) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m.name]);
  return [...groups].map(([provider, names]) => `${provider}: ${names.join(", ")}`).join(" · ");
}
