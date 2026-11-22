// Turns a selection inside a rendered answer back into markdown, so an excerpt keeps its marks,
// lists, code blocks and tables, and never picks up interface text (the code block header).
// Plain functions over the DOM; no React.

// Ancestors that give selected text its meaning even when the selection lies wholly inside them.
const WRAPPING_ANCESTORS = new Set(["STRONG", "B", "EM", "I", "DEL", "S", "CODE", "A", "PRE"]);
// Containers whose children are cloned when the selection spans several of them.
const STRUCTURAL = new Set(["UL", "OL", "TABLE", "THEAD", "TBODY", "TR"]);
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "DIV", "HR"]);

export function selectionMarkdown(range: Range, answer: HTMLElement): string {
  let content: Node = range.cloneContents();
  const common = range.commonAncestorContainer;
  let el: Element | null = common instanceof Element ? common : common.parentElement;
  if (el && el !== answer && STRUCTURAL.has(el.tagName)) content = wrapIn(el, content);
  for (; el && el !== answer && answer.contains(el); el = el.parentElement) {
    if (WRAPPING_ANCESTORS.has(el.tagName)) content = wrapIn(el, content);
  }
  const holder = document.createElement("div");
  holder.append(content);
  holder.querySelectorAll("[data-ui]").forEach((ui) => ui.remove());
  return blockList(holder).join("\n\n").trim();
}

function wrapIn(original: Element, content: Node): Element {
  const wrapper = original.cloneNode(false) as Element;
  wrapper.append(content);
  return wrapper;
}

function isBlock(node: Node): node is Element {
  return node instanceof Element && BLOCKS.has(node.tagName);
}

// The block children of a node as markdown blocks; runs of inline content become paragraphs.
function blockList(parent: Node): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = run.trim();
    if (text) out.push(text);
    run = "";
  };
  for (const child of parent.childNodes) {
    if (isBlock(child)) {
      flush();
      const text = block(child);
      if (text.trim()) out.push(text);
    } else {
      run += inline(child);
    }
  }
  flush();
  return out;
}

function block(el: Element): string {
  const tag = el.tagName;
  if (tag === "P") return inlineAll(el).trim();
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inlineAll(el).trim()}`;
  if (tag === "BLOCKQUOTE") {
    return blockList(el)
      .join("\n\n")
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }
  if (tag === "UL" || tag === "OL") return list(el);
  if (tag === "LI") return listItem(el, "- ");
  if (tag === "PRE") return fence(el);
  if (tag === "TABLE" || tag === "THEAD" || tag === "TBODY" || tag === "TR") return table(el);
  if (tag === "HR") return "---";
  return blockList(el).join("\n\n");
}

function list(el: Element): string {
  const ordered = el.tagName === "OL";
  const start = Number(el.getAttribute("start") ?? "1") || 1;
  return [...el.children]
    .filter((li) => li.tagName === "LI")
    .map((li, i) => listItem(li, ordered ? `${start + i}. ` : "- "))
    .filter((item) => item.trim() !== "")
    .join("\n");
}

// A list item: its marker, then its content; nested lines are indented under the marker.
function listItem(li: Element, marker: string): string {
  const body = blockList(li).join("\n");
  if (!body.trim()) return "";
  const indent = " ".repeat(marker.length);
  return body
    .split("\n")
    .map((line, i) => (i === 0 ? marker + line : line ? indent + line : line))
    .join("\n");
}

function fence(pre: Element): string {
  const code = pre.querySelector("code") ?? pre;
  const language = /language-([\w+#.-]+)/.exec(code.className)?.[1] ?? "";
  const text = (pre.textContent ?? "").replace(/\n$/, "");
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

// A whole table with a header row becomes a markdown table; a part of a table becomes plain
// rows with the cells separated by " | ".
function table(el: Element): string {
  const rows = el.tagName === "TR" ? [el] : [...el.querySelectorAll("tr")];
  const cells = rows.map((row) => [...row.children].map((cell) => blockList(cell).join(" ").replace(/\|/g, "\\|").trim()));
  const hasHeader = rows[0]?.querySelector("th") !== null && rows.length > 1;
  const width = cells[0]?.length ?? 0;
  if (el.tagName === "TABLE" && hasHeader && cells.every((row) => row.length === width)) {
    const line = (row: string[]) => `| ${row.join(" | ")} |`;
    return [line(cells[0]!), line(cells[0]!.map(() => "---")), ...cells.slice(1).map(line)].join("\n");
  }
  return cells
    .map((row) => row.filter((c) => c !== "").join(" | "))
    .filter((row) => row !== "")
    .join("\n");
}

function inlineAll(el: Node): string {
  let out = "";
  for (const child of el.childNodes) out += inline(child);
  return out;
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (!(node instanceof Element)) return "";
  switch (node.tagName) {
    case "STRONG":
    case "B":
      return mark(node, "**");
    case "EM":
    case "I":
      return mark(node, "*");
    case "DEL":
    case "S":
      return mark(node, "~~");
    case "CODE":
      return node.textContent ? `\`${node.textContent}\`` : "";
    case "A": {
      const text = inlineAll(node).trim();
      const href = node.getAttribute("href");
      return text && href ? `[${text}](${href})` : text;
    }
    case "BR":
      return "\n";
    case "IMG": {
      const src = node.getAttribute("src");
      return src ? `![${node.getAttribute("alt") ?? ""}](${src})` : "";
    }
    default:
      return isBlock(node) ? ` ${block(node)} ` : inlineAll(node);
  }
}

// **text** with the spaces at its edges kept outside the marks.
function mark(el: Element, marker: string): string {
  const inner = inlineAll(el);
  const core = inner.trim();
  if (!core) return inner;
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const trail = inner.slice(inner.trimEnd().length);
  return `${lead}${marker}${core}${marker}${trail}`;
}
