// Turns a selection inside a rendered answer back into markdown, so an excerpt keeps its marks,
// lists, code blocks and tables, and never picks up interface text (the code block header).
// Plain functions over the DOM; no React.

// Ancestors that give selected text its meaning even when the selection lies wholly inside them.
const WRAPPING_ANCESTORS = new Set(["STRONG", "B", "EM", "I", "DEL", "S", "CODE", "A", "PRE"]);
// Containers whose children are cloned when the selection spans several of them.
const STRUCTURAL = new Set(["UL", "OL", "TABLE", "THEAD", "TBODY", "TR"]);
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "DIV", "HR"]);

// Attributes put on the answer's own elements for the length of one clone, so the clone still
// knows what a partial selection leaves out: an ordered item's real number, a table's header row.
const ITEM_NUMBER = "data-excerpt-number";
const TABLE_HEADER = "data-excerpt-header";
const CELL_COLUMN = "data-excerpt-column";
const MARKS = [ITEM_NUMBER, TABLE_HEADER, CELL_COLUMN];

export function selectionMarkdown(range: Range, answer: HTMLElement): string {
  const marked: Element[] = [];
  for (const ol of answer.querySelectorAll("ol")) {
    const start = Number(ol.getAttribute("start") ?? "1") || 1;
    [...ol.children].forEach((li, i) => {
      li.setAttribute(ITEM_NUMBER, String(start + i));
      marked.push(li);
    });
  }
  for (const table of answer.querySelectorAll("table")) {
    const header = table.querySelector("tr");
    if (!header?.querySelector("th")) continue;
    table.setAttribute(TABLE_HEADER, JSON.stringify([...header.children].map((cell) => cellText(cell))));
    marked.push(table);
  }
  for (const row of answer.querySelectorAll("tr")) {
    [...row.children].forEach((cell, i) => {
      cell.setAttribute(CELL_COLUMN, String(i));
      marked.push(cell);
    });
  }
  let content: Node;
  try {
    content = range.cloneContents();
  } finally {
    for (const el of marked) for (const name of MARKS) el.removeAttribute(name);
  }
  const common = range.commonAncestorContainer;
  let el: Element | null = common instanceof Element ? common : common.parentElement;
  if (el && el !== answer && STRUCTURAL.has(el.tagName)) {
    // Rows of one table: wrap them in their table, so they come out as a table with its header.
    if (el.tagName !== "UL" && el.tagName !== "OL") {
      for (; el && el.tagName !== "TABLE"; el = el.parentElement) content = wrapIn(el, content);
    }
    if (el) content = wrapIn(el, content);
  }
  for (; el && el !== answer && answer.contains(el); el = el.parentElement) {
    if (WRAPPING_ANCESTORS.has(el.tagName)) content = wrapIn(el, content);
  }
  const holder = document.createElement("div");
  holder.append(content);
  holder.querySelectorAll("[data-ui]").forEach((ui) => ui.remove());
  return blockList(holder).join("\n\n").trim();
}

// A shallow copy of `original` around `content`. A table gets its header back on the copy.
function wrapIn(original: Element, content: Node): Element {
  const wrapper = original.cloneNode(false) as Element;
  if (original.tagName === "TABLE") {
    const header = original.querySelector("tr");
    if (header?.querySelector("th")) wrapper.setAttribute(TABLE_HEADER, JSON.stringify([...header.children].map((cell) => cellText(cell))));
  }
  wrapper.append(content);
  return wrapper;
}

function cellText(cell: Element): string {
  return blockList(cell).join(" ").replace(/\|/g, "\\|").trim();
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

// An ordered item keeps its number from the answer, also when the selection starts in the middle.
function list(el: Element): string {
  const ordered = el.tagName === "OL";
  const start = Number(el.getAttribute("start") ?? "1") || 1;
  return [...el.children]
    .filter((li) => li.tagName === "LI")
    .map((li, i) => listItem(li, ordered ? `${li.getAttribute(ITEM_NUMBER) ?? start + i}. ` : "- "))
    .filter((item) => item.trim() !== "")
    .join("\n");
}

// A list item: its marker, then its content; nested lines are indented under the marker.
// An item whose own text was not selected (the selection starts inside its nested list) has
// nothing to show: its nested items stand in its place instead of hanging under an empty bullet.
function listItem(li: Element, marker: string): string {
  const body = blockList(li).join("\n");
  if (!body.trim()) return "";
  const first = [...li.childNodes].find((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
  if (first instanceof Element && (first.tagName === "UL" || first.tagName === "OL")) return body;
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

// A table, whole or in part, becomes a markdown table: the table's own header row, then the
// selected rows (a row cut by the selection keeps its place, with empty cells for what was left out).
// Rows of a table without a header row stay plain rows with the cells separated by " | ".
function table(el: Element): string {
  const rows = el.tagName === "TR" ? [el] : [...el.querySelectorAll("tr")];
  const placed = (row: Element) => {
    const out: string[] = [];
    [...row.children].forEach((cell, i) => (out[Number(cell.getAttribute(CELL_COLUMN) ?? i)] = cellText(cell)));
    return Array.from(out, (c) => c ?? "");
  };
  const cells = rows.map((row) => ({ header: row.querySelector("th") !== null, cells: placed(row) }));
  const stored = el.getAttribute(TABLE_HEADER);
  const header: string[] | null = cells[0]?.header ? cells[0].cells : stored ? (JSON.parse(stored) as string[]) : null;
  const body = cells.filter((row) => !row.header && row.cells.some((c) => c !== "")).map((row) => row.cells);
  if (header && body.length > 0) {
    const width = header.length;
    const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
  }
  if (header) return header.join(" | ");
  return body.map((row) => row.filter((c) => c !== "").join(" | ")).join("\n");
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
