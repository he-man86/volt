#!/usr/bin/env node
// `volt-lsp-iec` CLI (next). `--stdio` runs the LSP server; `--version` prints the version.
// Internal: `--server-version <v>` lets a client (the VS Code extension) tell the server its identity for
// `serverInfo.version` — the meaningful identity when the server runs under an editor's node.
import { runServer } from "./server/index.js"
import type { Vendor } from "./analysis/index.js"

// Baked in at compile time by build-payload.ts (`--define __VOLT_VERSION__`), stamped from the same VOLT_VERSION
// that stamps FileVersion into the .NET binaries — so every Volt binary reports the SAME version and cannot drift
// from a sidecar file (there is no version.txt any more). "(dev)" when compiled without the define.
declare const __VOLT_VERSION__: string
function shippedVersion(): string {
  return typeof __VOLT_VERSION__ === "string" ? __VOLT_VERSION__ : "(dev)"
}

function main(argv: readonly string[]): number | undefined {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`volt-lsp-iec ${shippedVersion()}`)
    return 0
  }
  if (argv.includes("--stdio")) {
    const vendor: Vendor = argv.includes("--twincat") ? "twincat" : "codesys"
    // Version precedence: an explicit `--server-version <v>` from the client (the VS Code extension passes its
    // own version — the meaningful identity when the server runs under the editor's node), else the version baked
    // into this binary at compile time, else "(dev)".
    const vi = argv.indexOf("--server-version")
    const version = vi >= 0 && vi + 1 < argv.length ? argv[vi + 1] : shippedVersion()
    runServer(process.stdin, process.stdout, vendor, version)
    return undefined // server owns the event loop; do not exit
  }
  console.error("usage: volt-lsp-iec --stdio [--codesys|--twincat]")
  return 1
}

const code = main(process.argv.slice(2))
if (code !== undefined) process.exit(code)
