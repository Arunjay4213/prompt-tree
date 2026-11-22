// Text helpers shared by components: previews, relative times, clipboard, download.

// Markdown to a plain one-paragraph preview, for the canvas cards and the clip list.
// Code blocks are left out, table rows become "cell · cell", and every other markup mark is
// removed (headings, list bullets and numbers, quotes, emphasis, inline code ticks, link targets).
export function plainPreview(markdown: string): string {
  const lines: string[] = [];
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
    line = line
      .replace(/^\s*#{1,6}\s+/, "") // heading marks
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""); // list bullets, numbers, task boxes
    lines.push(line);
  }
  return lines
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: their alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: their text
    .replace(/`+([^`]*)`+/g, "$1") // inline code ticks
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2") // bold
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
