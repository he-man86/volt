#!/usr/bin/env bun
/**
 * Build the Volt CLI installer (the "advanced user" channel) — a standalone NSIS `.exe` that puts `volt` on
 * PATH + installs the bridge/connector + LSP. Mirrors opencode's curl-installs-the-CLI, as a Windows installer.
 * Needs `dist/volt` (run `bun volt-scripts/dist.ts` first) + makensis (electron-builder's cached NSIS or a
 * system NSIS).
 *
 *   bun volt-scripts/build-cli-installer.ts   ->  dist/Volt-CLI-Setup-<ver>-x64.exe
 */
import { Glob } from "bun"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const dist = resolve(repo, "dist/volt")
const out = resolve(repo, "dist")
const nsi = resolve(import.meta.dirname, "cli-installer/volt-cli.nsi")

if (!existsSync(resolve(dist, "bin/volt.exe")) || !existsSync(resolve(dist, "connector/VoltConnector.exe"))) {
  console.error("✗ dist/volt not built (need bin/volt.exe + connector/VoltConnector.exe) — run: bun volt-scripts/dist.ts")
  process.exit(1)
}

const makensis = findMakensis()
if (!makensis) {
  console.error("✗ makensis not found (electron-builder NSIS cache or a system NSIS install)")
  process.exit(1)
}

// Version: env override (CI) → the volt-git package version (source of truth) → dev default — same precedence as build.ts.
const version = process.env.VOLT_VERSION ?? JSON.parse(readFileSync(resolve(repo, "packages/volt-git/package.json"), "utf8")).version ?? "0.0.0-dev"

console.log(`• makensis: ${makensis}`)
console.log(`• building Volt-CLI-Setup-${version}-x64.exe`)
const r = spawnSync(makensis, [`/DVERSION=${version}`, `/DDIST=${dist}`, `/DOUTDIR=${out}`, nsi], { stdio: "inherit" })
if (r.status !== 0) {
  console.error("✗ makensis failed")
  process.exit(1)
}
console.log(`\n✓ dist/Volt-CLI-Setup-${version}-x64.exe`)

function findMakensis(): string | undefined {
  const cache = resolve(homedir(), "AppData/Local/electron-builder/Cache")
  if (existsSync(cache)) {
    for (const rel of new Glob("nsis-*/**/makensis.exe").scanSync({ cwd: cache, onlyFiles: true })) {
      return resolve(cache, rel)
    }
  }
  for (const p of ["C:/Program Files (x86)/NSIS/makensis.exe", "C:/Program Files/NSIS/makensis.exe"]) {
    if (existsSync(p)) return p
  }
  return undefined
}
