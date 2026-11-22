import { Copy } from "lucide-react";
import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import remarkGfm from "remark-gfm";
import { copyWithToast } from "../store";
import { IconButton } from "./ui";

// Fenced code: a dark panel with a header strip that shows the language and a Copy button.
// Long lines scroll inside the block; the block is never wider than the column.
function CodeBlock({ children }: { children?: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null);
  const className = isValidElement<{ className?: string }>(children) ? (children.props.className ?? "") : "";
  const language = /language-([\w+#.-]+)/.exec(className)?.[1] ?? "code";
  return (
    <div className="code-block">
      {/* data-ui: interface only, left out of excerpts taken from a selection */}
      <div className="code-block-header" data-ui>
        <span className="label-sm">{language}</span>
        <IconButton
          icon={Copy}
          label="Copy code"
          onClick={() => {
            copyWithToast((codeRef.current?.textContent ?? "").replace(/\n$/, ""));
          }}
        />
      </div>
      <pre ref={codeRef}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
  // A cell grows to its text, up to a readable width, then wraps. The table scrolls sideways.
  td: ({ children, style }) => (
    <td style={style}>
      <div className="cell">{children}</div>
    </td>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />,
};

// Syntax colors for a fixed set of languages (and their aliases such as ts, sh, html, yml). Only
// these grammars are bundled. Any other language, or a half-written name while an answer streams,
// renders as plain code in the same block.
const lowlight = createLowlight({ bash, c, cpp, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml });

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function textOf(node: HastNode): string {
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");
}

// A rehype step: the code element of each fenced block gets highlighted children.
function highlightCode() {
  const visit = (node: HastNode, parent: HastNode | null) => {
    if (node.type === "element" && node.tagName === "code" && parent?.tagName === "pre") {
      const classes = Array.isArray(node.properties?.className) ? (node.properties.className as unknown[]).map(String) : [];
      const language = classes.find((name) => name.startsWith("language-"))?.slice("language-".length);
      if (language && lowlight.registered(language)) {
        node.children = lowlight.highlight(language, textOf(node)).children as HastNode[];
        node.properties = { ...node.properties, className: ["hljs", ...classes] };
      }
      return;
    }
    for (const child of node.children ?? []) visit(child, node);
  };
  return (tree: HastNode) => visit(tree, null);
}

// Stable plugin lists, so React never sees new props for an unchanged answer.
const remarkPlugins = [remarkGfm];
const rehypePlugins = [highlightCode];

// How often a streaming text is parsed and drawn again. Text arrives about 60 times a second;
// parsing the whole markdown that often slows the canvas down while answers stream.
const STREAM_RENDER_MS = 70;

// The text to render: while `live`, a copy that follows `text` at most every STREAM_RENDER_MS
// (always with the latest text when it catches up); once not live, `text` itself, so the final
// answer is drawn at once.
export function useStreamText(text: string, live: boolean): string {
  const [shown, setShown] = useState(text);
  const lastAt = useRef(0);
  useEffect(() => {
    if (!live) {
      setShown(text);
      return;
    }
    const wait = STREAM_RENDER_MS - (performance.now() - lastAt.current);
    if (wait <= 0) {
      lastAt.current = performance.now();
      setShown(text);
      return;
    }
    const timer = setTimeout(() => {
      lastAt.current = performance.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, live]);
  return live ? shown : text;
}

// Answers and the combined document rendered as markdown (reading body style).
// Memoized on the text, so a turn that is not changing never parses again.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
