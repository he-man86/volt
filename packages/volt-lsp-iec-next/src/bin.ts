#!/usr/bin/env node
// `volt-lsp-iec` CLI (next). `--stdio` runs the LSP server; `--version` prints the version.
import { runServer } from "./server/index.js"
import type { Vendor } from "./analysis/index.js"

const VERSION = "0.1.0"

function main(argv: readonly string[]): number | undefined {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`volt-lsp-iec ${VERSION}`)
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
