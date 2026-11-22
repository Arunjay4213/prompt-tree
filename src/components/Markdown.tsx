import { Copy } from "lucide-react";
import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { showToast } from "../store";
import { copyText } from "../text";
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
            void copyText((codeRef.current?.textContent ?? "").replace(/\n$/, "")).then((ok) => showToast(ok ? "Copied" : "Copy failed"));
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

// Stable plugin lists, so React never sees new props for an unchanged answer.
// rehype-highlight skips an unknown or half-written language name instead of throwing.
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

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
