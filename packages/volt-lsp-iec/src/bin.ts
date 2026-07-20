#!/usr/bin/env node
// `volt-lsp-iec` CLI (next). `--stdio` runs the LSP server; `--version` prints the version.
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { runServer } from "./server/index.js"
import type { Vendor } from "./analysis/index.js"

// The one shipped Volt version (version.txt at the install root; the LSP runs from <root>\bin), so every Volt
// binary reports the SAME version and the connector's Status window can verify they're in sync. "(dev)" from the
// build tree.
function shippedVersion(): string {
  try {
    const dir = dirname(process.execPath)
    for (const c of [resolve(dir, "version.txt"), resolve(dir, "..", "version.txt")]) {
      if (existsSync(c)) return readFileSync(c, "utf8").trim()
    }
  } catch {}
  return "(dev)"
}

function main(argv: readonly string[]): number | undefined {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`volt-lsp-iec ${shippedVersion()}`)
    return 0
  }
  if (argv.includes("--stdio")) {
    const vendor: Vendor = argv.includes("--twincat") ? "twincat" : "codesys"
    runServer(process.stdin, process.stdout, vendor)
    return undefined // server owns the event loop; do not exit
  }
  console.error("usage: volt-lsp-iec --stdio [--codesys|--twincat]")
  return 1
}

const code = main(process.argv.slice(2))
if (code !== undefined) process.exit(code)
