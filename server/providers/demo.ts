// Demo provider: placeholder answers, no key, no cost. Only offered when DEMO_MODE=1.

import type { AnswerEnd, OnText, Provider, ProviderRequest } from "./common";

async function complete(modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  const prompt = request.messages.at(-1)?.content ?? "";
  const quoted = prompt.trim().split("\n").map((line) => `> ${line}`).join("\n");
  const intro = request.system === undefined
    ? "This is a placeholder answer from demo mode. No model was called and no money was spent."
    : "This is a placeholder for the combined document. In live mode the model would merge the clips into one final document.";
  const text = [
    `**Demo answer from ${modelName}** (turn ${Math.ceil(request.messages.length / 2)}) to:`,
    quoted,
    intro + " The text streams in small pieces so the interface behaves like it does with a real model.",
    "- Each branch only sees its own path back to the root.\n- Continue a card, or branch off to explore a side question.\n- Clip the parts you want for the final output.",
    "```ts\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n```",
    `End of the placeholder answer from ${modelName}.`,
  ].join("\n\n");

  // About 100 chunks at 20 ms each: roughly 2 seconds in total.
  const chunkSize = Math.max(4, Math.ceil(text.length / 100));
  for (let start = 0; start < text.length; start += chunkSize) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (signal.aborted) return { type: "disconnected" };
    await onText(text.slice(start, start + chunkSize));
  }
  return { type: "done", outcome: "complete" };
}

export const demo: Provider = {
  id: "demo",
  label: "Demo",
  modelNames: ["placeholder-a", "placeholder-b"],
  complete,
};
