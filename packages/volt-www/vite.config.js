import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import mdx from "@mdx-js/rollup"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"

// Static multi-page site (one HTML per page). `vite build` -> dist/ with each page pre-built. Runs on Windows.
// The .html filenames match the design's own nav links (pricing.html, faq.html, …), so no link rewriting.
// Cloudflare Web Analytics beacon. Injected here rather than pasted into all 14 pages — and it has to be the
// manual snippet: the pages are served by a Worker, and Cloudflare's automatic injection only rewrites origin
// responses, so "Enable"/auto-inject silently does nothing for this site. Token is public by design.
const webAnalytics = {
  name: "cf-web-analytics",
  transformIndexHtml: () => [
    {
      tag: "script",
      attrs: {
        defer: true,
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "1107c69783d94f4aa88ce03e88ebf752"}',
      },
      injectTo: "body",
    },
  ],
}

export default defineConfig({
  // MDX runs `pre` (before react) so docs prose compiles to JSX and can embed the product mockups inline.
  // rehype-slug gives every heading an id — the docs sidebar reads those ids off the DOM (no ToC plugin).
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }) },
    react({ include: /\.(jsx|js|mdx)$/ }),
    webAnalytics,
  ],
  build: {
    rollupOptions: {
      input: {
        home: "index.html",
        pricing: "pricing.html",
        faq: "faq.html",
        docs: "docs.html",
        "docs-desktop-vs-vscode": "docs-desktop-vs-vscode.html",
        contact: "contact.html",
        changelog: "changelog.html",
        "legal-terms": "legal/terms.html",
        "legal-privacy": "legal/privacy.html",
        "legal-cookies": "legal/cookies.html",
        "feature-project-understanding": "feature-project-understanding.html",
        "feature-ai-native-plc-languages": "feature-ai-native-plc-languages.html",
        "feature-volt-git": "feature-volt-git.html",
        "feature-compiler-intelligence": "feature-compiler-intelligence.html",
        "feature-privacy": "feature-privacy.html",
        "feature-desktop-and-cli": "feature-desktop-and-cli.html",
      },
    },
  },
})
