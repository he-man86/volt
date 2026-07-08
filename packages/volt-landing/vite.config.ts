import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"

// ponytail: mirrors packages/console/app/vite.config.ts so volt-landing deploys the same
// way (cloudflare-module worker) and can import console-core server-side identically.
export default defineConfig({
  plugins: [
    solidStart() as PluginOption,
    nitro({
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
  ],
  server: {
    allowedHosts: true,
    port: 3002, // console/app is 3001
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
  },
})
