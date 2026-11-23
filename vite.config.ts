import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = process.env.PORT ?? "8787";

// A package directory under node_modules (pnpm keeps them under node_modules/.pnpm/.../node_modules).
const pkg = (names: string) => new RegExp(`[\\\\/]node_modules[\\\\/](${names})[\\\\/]`);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vendor code in a few stable chunks, all loaded up front from index.html (nothing is lazy):
  // React, the canvas library, the markdown and highlighting stack, and the rest.
  build: {
    rolldownOptions: {
      // react-compiler-runtime starts with "use no memo", which the bundler warns it may drop.
      // That is harmless for a dependency, so only that warning, and only from node_modules, is hidden.
      onLog(level, log, handler) {
        const file = log.id ?? log.loc?.file ?? "";
        if (log.code === "MODULE_LEVEL_DIRECTIVE" && /[\\/]node_modules[\\/]/.test(file)) return;
        handler(level, log);
      },
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: pkg("react|react-dom|scheduler"), priority: 40 },
            { name: "canvas", test: pkg("@xyflow|d3-[^\\\\/]+|classcat"), priority: 30 },
            {
              name: "markdown",
              test: pkg(
                "react-markdown|remark-[^\\\\/]+|rehype-[^\\\\/]+|micromark[^\\\\/]*|mdast-[^\\\\/]+|hast-[^\\\\/]+|hastscript|unist-[^\\\\/]+|unified|vfile[^\\\\/]*|lowlight|highlight\\.js|" +
                  "bail|trough|devlop|zwitch|ccount|longest-streak|markdown-table|trim-lines|is-plain-obj|extend|" +
                  "decode-named-character-reference|character-entities[^\\\\/]*|character-reference-invalid|is-[a-z-]+|" +
                  "property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|" +
                  "estree-util-[^\\\\/]+|style-to-[^\\\\/]+|inline-style-parser|web-namespaces|escape-string-regexp",
              ),
              priority: 20,
            },
            { name: "vendor", test: /[\\/]node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${serverPort}` },
  },
});
