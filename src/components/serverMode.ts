// The server's mode as the interface shows it, in one table: the sidebar's model tag and the top
// bar's mode tag both read it, so the wording is the same everywhere.

import type { ModelInfo } from "../../shared/api";
import type { HealthState } from "../store";
import { modelName } from "../text";

export type ServerModeKind = "loading" | "live" | "demo" | "no_key" | "unreachable";

export type ServerMode = {
  kind: ServerModeKind;
  dot: "bg-line" | "bg-pass" | "bg-accent" | "bg-fail";
  label: string; // the sidebar's model tag (live mode shows the model name or the model count instead)
  tag: string; // the top bar's tag (empty: no tag, the model is live or the mode is not known yet)
  short: string; // the top bar's tag when the bar is narrow
  tip: string;
};

const MODES: Record<ServerModeKind, Omit<ServerMode, "kind">> = {
  loading: { dot: "bg-line", label: "Connecting", tag: "", short: "", tip: "Asking the server which mode it runs in" },
  live: { dot: "bg-pass", label: "", tag: "", short: "", tip: "Live: answers come from real models and cost money" },
  demo: {
    dot: "bg-accent",
    label: "Demo mode",
    tag: "Demo - placeholder answers",
    short: "Demo",
    tip: "Demo mode: placeholder answers from two demo models, no real model is called and nothing is spent (started with pnpm dev:demo)",
  },
  no_key: {
    dot: "bg-fail",
    label: "No API key",
    tag: "No API key",
    short: "No key",
    tip: "No API key: set a provider key in the .env file (see .env.example) and restart the server",
  },
  unreachable: {
    dot: "bg-fail",
    label: "Server offline",
    tag: "Server offline",
    short: "Offline",
    tip: "The server is not reachable: start it with pnpm dev and reload",
  },
};

// Live mode names the one model, or counts them (`3 models`); the tooltip then lists them by provider.
export function serverMode(health: HealthState, models: ModelInfo[]): ServerMode {
  const kind: ServerModeKind = health.kind === "ready" ? health.health.mode : health.kind;
  const mode = MODES[kind];
  if (kind !== "live" || models.length === 0) return { kind, ...mode, tip: models.length > 1 ? `${mode.tip}. ${modelList(models)}` : mode.tip };
  if (models.length === 1) return { kind, ...mode, label: modelName(models[0]!.id) };
  return { kind, ...mode, label: `${models.length} models`, tip: modelList(models) };
}

// "OpenAI: model-x, model-y · Anthropic: model-z"
function modelList(models: ModelInfo[]): string {
  const groups = new Map<string, string[]>();
  for (const m of models) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m.name]);
  return [...groups].map(([provider, names]) => `${provider}: ${names.join(", ")}`).join(" · ");
}
