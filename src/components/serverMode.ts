// The server's mode as the interface shows it, in one table: the sidebar's model tag and the top
// bar's mode tag both read it, so the wording is the same everywhere.

import type { HealthState } from "../store";

export type ServerModeKind = "loading" | "live" | "demo" | "no_key" | "unreachable";

export type ServerMode = {
  kind: ServerModeKind;
  dot: "bg-line" | "bg-pass" | "bg-accent" | "bg-fail";
  label: string; // the sidebar's model tag (live mode shows the model name instead)
  tag: string; // the top bar's tag (empty: no tag, the model is live or the mode is not known yet)
  short: string; // the top bar's tag when the bar is narrow
  tip: string;
};

const MODES: Record<ServerModeKind, Omit<ServerMode, "kind">> = {
  loading: { dot: "bg-line", label: "Connecting", tag: "", short: "", tip: "Asking the server which mode it runs in" },
  live: { dot: "bg-pass", label: "", tag: "", short: "", tip: "Live: answers come from the model and cost money" },
  demo: {
    dot: "bg-accent",
    label: "Demo mode",
    tag: "Demo - placeholder answers",
    short: "Demo",
    tip: "Demo mode: placeholder answers, no model is called and nothing is spent (started with pnpm dev:demo)",
  },
  no_key: {
    dot: "bg-fail",
    label: "No API key",
    tag: "No API key",
    short: "No key",
    tip: "No API key: put OPENAI_API_KEY in the .env file and restart the server",
  },
  unreachable: {
    dot: "bg-fail",
    label: "Server offline",
    tag: "Server offline",
    short: "Offline",
    tip: "The server is not reachable: start it with pnpm dev and reload",
  },
};

export function serverMode(health: HealthState): ServerMode {
  const kind: ServerModeKind = health.kind === "ready" ? health.health.mode : health.kind;
  const mode = MODES[kind];
  return { kind, ...mode, label: kind === "live" && health.kind === "ready" ? health.health.model : mode.label };
}
