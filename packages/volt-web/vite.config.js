import { reactRouter } from "@react-router/dev/vite"
import mdx from "@mdx-js/rollup"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    // MDX runs `pre` (before the router) so docs prose compiles to JSX and can embed the product mockups inline.
    // rehype-slug gives every heading an id — the docs sidebar reads those ids off the DOM (no ToC plugin).
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }) },
    reactRouter(),
  ],
})
