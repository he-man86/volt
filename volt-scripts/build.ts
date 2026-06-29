#!/usr/bin/env bun
/**
 * Volt binary build — mirrors opencode's `packages/opencode/script/build.ts` (the solid JSX plugin, the TUI
 * worker entrypoints, the tree-sitter/version/models defines) but with **volt.ts as the entry**, so the
 * output binary is `volt` = our opencode + the PLC dispatcher, in-process.
 *
 * Kept as close to opencode's build.ts as possible — re-port when that file changes upstream. Runs from
 * packages/opencode so opencode's relative paths (tsconfig, node_modules, worker) resolve unchanged.
 *
 *   bun volt-scripts/build.ts        # local-platform binary → dist/volt/bin/volt[.exe]
 */
import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ocDir = path.join(repo, "packages/opencode")
process.chdir(ocDir)

// Resolve opencode's build deps from opencode's own node_modules (not reachable from volt-scripts/) — use
// bun's resolver so the package "exports" subpath is honored, then import the resolved absolute path.
const generated = await import(path.join(ocDir, "script/generate.ts"))
const { createSolidTransformPlugin } = await import(Bun.resolveSync("@opentui/solid/bun-plugin", ocDir))
const plugin = createSolidTransformPlugin()

const os = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch
const version = process.env.VOLT_VERSION ?? "0.0.0-dev"
const channel = process.env.OPENCODE_CHANNEL ?? "dev"

const voltEntry = path.join(repo, "packages/volt-git/src/volt.ts")
const localWorker = path.join(ocDir, "node_modules/@opentui/core/parser.worker.js")
const rootWorker = path.join(repo, "node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localWorker) ? localWorker : rootWorker)
const workerPath = "./src/cli/tui/worker.ts"
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
const workerRelativePath = path.relative(ocDir, parserWorker).replaceAll("\\", "/")

const outfile = path.join(repo, "dist/volt/bin/volt")
await $`mkdir -p ${path.dirname(outfile)}`

await Bun.build({
  conditions: ["bun", "node"],
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  sourcemap: "none",
  splitting: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: `bun-${os}-${arch}` as any,
    outfile,
    execArgv: [`--user-agent=volt/${version}`, "--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: [voltEntry, parserWorker, workerPath],
  define: {
    FFF_LIBC: JSON.stringify("gnu"),
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: `'${channel}'`,
    OPENCODE_LIBC: "",
  },
})

console.log(`✓ ${outfile}`)
