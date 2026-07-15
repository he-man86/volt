import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Static multi-page site (one HTML per page). `vite build` -> dist/ with each page pre-built. Runs on Windows.
// The .html filenames match the design's own nav links (pricing.html, faq.html, …), so no link rewriting.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: "index.html",
        pricing: "pricing.html",
        faq: "faq.html",
        contact: "contact.html",
        changelog: "changelog.html",
        "legal-terms": "legal/terms.html",
        "legal-privacy": "legal/privacy.html",
        "feature-project-understanding": "feature-project-understanding.html",
        "feature-ai-native-plc-languages": "feature-ai-native-plc-languages.html",
        "feature-modern-engineering-workflows": "feature-modern-engineering-workflows.html",
        "feature-volt-git": "feature-volt-git.html",
        "feature-compiler-intelligence": "feature-compiler-intelligence.html",
        "feature-engineering-with-confidence": "feature-engineering-with-confidence.html",
        "feature-privacy-and-enterprise": "feature-privacy-and-enterprise.html",
        "feature-desktop-and-cli": "feature-desktop-and-cli.html",
      },
    },
  },
})
