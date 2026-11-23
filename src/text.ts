// Text helpers shared by components: previews, relative times, clipboard, download, the options of
// an answer, and the pure parts of "Ask each".

import remarkParse from "remark-parse";
import { unified } from "unified";

// Markdown to a plain one-paragraph preview, for the canvas cards and the clip list.
// Code blocks are left out, table rows become "cell · cell", and every other markup mark is
// removed (headings, list bullets and numbers, quotes, emphasis, inline code ticks, link targets).
export function plainPreview(markdown: string): string {
  const lines: string[] = [];
  // Headings that got a colon, so "Monthly cost" and the text under it do not read as one sentence.
  const colons = new Set<number>();
  let inFence = false;
  for (const raw of markdown.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let line = raw.replace(/^(\s*>)+\s?/, ""); // blockquote marks
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) continue; // table separator row
    if (/^\s*(\*{3,}|_{3,}|-{3,})\s*$/.test(line)) continue; // horizontal rule
    if (/^\s*\|.*\|\s*$/.test(line) || (line.match(/\|/g)?.length ?? 0) >= 2) {
      line = line
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell !== "")
        .join(" · ");
    }
    const heading = /^\s*#{1,6}\s+/.test(line);
    line = line
      .replace(/^\s*#{1,6}\s+/, "") // heading marks
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""); // list bullets, numbers, task boxes
    if (heading && /[^\s.,:;!?]$/.test(line.trimEnd())) {
      line = `${line.trimEnd()}:`;
      colons.add(lines.length);
    }
    lines.push(line);
  }
  // A heading with no text after it keeps no colon.
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === "") last--;
  if (colons.has(last)) lines[last] = lines[last]!.slice(0, -1);
  return lines
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: their alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: their text
    .replace(/`+([^`]*)`+/g, "$1") // inline code ticks
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1") // bold with **
    // Underscores mark emphasis only at word edges, as in markdown, so window.__x keeps them.
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1$2") // bold with __
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1") // strikethrough
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2") // italic with *
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2") // italic with _
    .replace(/\s+/g, " ")
    .trim();
}

// "just now", "5m ago", "2h ago", "3d ago", then a short date.
export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Resolves to whether the text reached the clipboard.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// "1 turn", "3 turns"
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The name shown for a model id: the part after "<provider>:" ("openai:model-x" -> "model-x").
// Answers saved before models were recorded (null) show "Assistant".
export function modelName(id: string | null): string {
  if (id === null) return "Assistant";
  const colon = id.indexOf(":");
  return colon >= 0 ? id.slice(colon + 1) : id;
}

// ---------- options in an answer ----------

// The few mdast node fields used here.
type MdNode = { type: string; depth?: number; ordered?: boolean | null; value?: string; children?: MdNode[] };

const parser = unified().use(remarkParse);
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 8;

// Plain text of a node: its text and inline code, without markdown marks.
function plainOf(node: MdNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(plainOf).join("");
}

function firstWords(text: string, count: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  return words.length > count ? `${words.slice(0, count).join(" ")}...` : words.join(" ");
}

function startsWithBold(item: MdNode): boolean {
  const first = item.children?.[0];
  return first?.type === "paragraph" && first.children?.[0]?.type === "strong";
}

// The title of a list item: its leading bold text when it starts with bold, else its first eight words.
function itemTitle(item: MdNode): string {
  const first = item.children?.[0];
  const lead = first?.type === "paragraph" ? first.children?.[0] : undefined;
  if (lead?.type === "strong") return plainOf(lead).replace(/[\s:.-]+$/, "").trim();
  return firstWords(first ? plainOf(first) : plainOf(item), 8);
}

// The options an answer offers, as titles: two to eight headings of one level (the shallowest level
// that has at least two), else the items of the first top-level list with two to eight items when
// it is numbered or every item starts with bold text, else none. Code blocks and tables never count: the markdown parser sees them for what they are.
function findOptions(markdown: string): string[] {
  const root = parser.parse(markdown) as MdNode;
  const top = root.children ?? [];
  const headings = top.filter((n) => n.type === "heading");
  for (let depth = 1; depth <= 6; depth++) {
    const level = headings.filter((h) => h.depth === depth);
    if (level.length < OPTIONS_MIN) continue;
    if (level.length <= OPTIONS_MAX) return level.map((h) => plainOf(h).trim()).filter(Boolean);
    break; // too many to be options: try the list rule
  }
  // A list counts only when it names options: a numbered list, or one whose every item starts with
  // bold text (the option's name). A plain bulleted list of facts is not a set of options.
  const list = top.find((n) => n.type === "list");
  const items = list?.children ?? [];
  if (items.length < OPTIONS_MIN || items.length > OPTIONS_MAX) return [];
  if (list?.ordered || items.every(startsWithBold)) return items.map(itemTitle).filter(Boolean);
  return [];
}

// Memoized per answer text: an answer is parsed once, not on every render.
const optionCache = new Map<string, string[]>();
const OPTION_CACHE_MAX = 300;

export function answerOptions(markdown: string): string[] {
  const cached = optionCache.get(markdown);
  if (cached) return cached;
  const options = findOptions(markdown);
  if (optionCache.size >= OPTION_CACHE_MAX) optionCache.delete(optionCache.keys().next().value!);
  optionCache.set(markdown, options);
  return options;
}

// ---------- "Ask each" ----------

// Whether a question refers to every option ("each", "every", "both", "all of them", "all the
// options", "all three"...), as whole words, any case. Only a hint for which button looks primary.
export function refersToEach(text: string): boolean {
  return /\b(each|every|both|all\s+of\s+them|all\s+(the\s+)?options|all\s+(two|three|four|five|six|seven|eight))\b/i.test(text);
}

export const REWRITE_SYSTEM =
  "You rewrite one follow-up question so it can be asked separately about each option in an assistant answer. Reply with only a JSON array of strings, one per option, in the same order as the options given. Each string is the follow-up rewritten to ask about only that option, naming the option, and complete enough to be understood on its own. No other text.";
const REWRITE_ANSWER_CHARS = 6000;

// The one user message of the rewrite request.
export function rewriteMessage(answer: string, options: string[], question: string): string {
  return [
    `The assistant answer:\n\n${answer.slice(0, REWRITE_ANSWER_CHARS)}`,
    `The options, in order:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
    `The follow-up question:\n${question}`,
  ].join("\n\n---\n\n");
}

// The rewritten prompts, or null unless the reply is exactly `count` non-empty strings as a JSON
// array (a surrounding code fence is allowed).
export function parseRewrite(reply: string, count: number): string[] | null {
  const body = reply.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== count) return null;
  if (!parsed.every((p) => typeof p === "string" && p.trim() !== "")) return null;
  return (parsed as string[]).map((p) => p.trim());
}

// Without a usable rewrite, each option's prompt is the option quoted, an empty line, the question.
export function fallbackPrompts(options: string[], question: string): string[] {
  return options.map((o) => `> ${o}\n\n${question}`);
}

// ---------- quoted prompts ----------

// A prompt that starts with quoted lines ("> ..."), as "Branch with selection" and "Branch per option"
// make it: the quoted text (without the "> " marks) and the person's own text after it. Only leading
// quote lines count; everything else is the person's text, exactly as typed.
export function splitQuote(prompt: string): { quote: string; own: string } {
  const lines = prompt.split("\n");
  let end = 0;
  while (end < lines.length && /^\s*>/.test(lines[end]!)) end++;
  if (end === 0) return { quote: "", own: prompt };
  const quote = lines
    .slice(0, end)
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
  return { quote, own: lines.slice(end).join("\n").trim() };
}

// A card's prompt line: the person's own text, or the quoted text when there is nothing else.
export function promptPreview(prompt: string): string {
  const { quote, own } = splitQuote(prompt);
  return own || quote;
}

// The options an answer offers: its headings or list items count only when the prompt that
// produced it asked for alternatives. Otherwise they are sections of one answer, not options.
export function offeredOptions(prompt: string, answer: string): string[] {
  return askedForAlternatives(prompt) ? answerOptions(answer) : NO_OFFERED_OPTIONS;
}
const NO_OFFERED_OPTIONS: string[] = [];

// Whether a prompt asked for alternatives. Whole words, any case, from a fixed list.
export function askedForAlternatives(prompt: string): boolean {
  return /\b(options?|versions?|alternatives?|choices?|ideas?|approach(es)?|ways?|variants?|plans?|possibilities|candidates)\b/i.test(prompt);
}
