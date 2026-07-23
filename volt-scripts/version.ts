#!/usr/bin/env bun
/**
 * Compute the ONE Volt version — the single source of truth CI injects into every artifact, so no version is ever
 * hand-maintained across files (opencode's lesson: compute once, inject; never let an artifact read its own stored
 * version — that's the exact bug behind sst/opencode#36232).
 *
 * The split, and why:
 *   - The BUILD NUMBER is git — `git rev-list HEAD --count` (monotonic, always grows, e.g. 842).
 *   - The X.Y.Z BASE is human intent — git can't know if a change is a patch or a feature, so the base lives in ONE
 *     place (`packages/volt-desktop/package.json`), bumped only when you decide the next release's shape.
 *
 * Output (key=value lines — append to $GITHUB_OUTPUT):
 *   version    — the installer + connector version the updater compares (System.Version): tag → the tag (stable);
 *                dev push → <base>.<count> 4-part (prerelease). e.g. 0.0.1 or 0.0.1.842
 *   base       — the 3-part X.Y.Z; what stamps the electron app package.json (vsce REJECTS a 4-part version)
 *   vsix       — the extension's 3-part version: tag → base; dev push → <maj>.<min>.<count> (e.g. 0.0.842). Unlike
 *                `base` (a constant 0.0.1 on every dev build), this MOVES with the build so `--install-extension`
 *                actually upgrades and the connector's drift check can tell a stale sideloaded extension apart.
 *   prerelease — true on a dev push, false on a tag
 *
 *   bun volt-scripts/version.ts                 # print the three lines
 *   bun volt-scripts/version.ts >> "$GITHUB_OUTPUT"
 *   bun volt-scripts/version.ts --vsix          # print ONLY the vsix version (for `vsce package <version>`)
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const git = (args: string): string => spawnSync("git", args.split(" "), { cwd: repo, encoding: "utf8" }).stdout?.trim() ?? ""

const isTag = process.env.GITHUB_REF_TYPE === "tag"
const base: string = isTag
  ? (process.env.GITHUB_REF_NAME ?? "").trim()
  : (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version

const count = git("rev-list HEAD --count") || "0"
const version = isTag ? base : `${base}.${count}`
// The extension can't carry a 4-part version (vsce rejects it), so encode the build number in the patch:
// <maj>.<min>.<count>. Stays 3-part, but MOVES every build — unlike `base` (constant per release) — so a newer
// sideloaded build strictly out-versions the last one and installs/refreshes cleanly instead of no-op'ing.
const [maj, min] = base.split(".")
const vsix = isTag ? base : `${maj}.${min}.${count}`

if (!/^\d+\.\d+\.\d+$/.test(base) || !/^\d+\.\d+\.\d+(\.\d+)?$/.test(version) || !/^\d+\.\d+\.\d+$/.test(vsix)) {
  console.error(`✗ computed a bad version (base='${base}', version='${version}', vsix='${vsix}') — is volt-desktop's version a bare X.Y.Z?`)
  process.exit(1)
}

// `--vsix` prints the bare extension version so a LOCAL `bun run package` stamps the same git-derived version CI
// does. Without it the local build carried the base 0.0.1 forever — lower than every installed dev build, so
// `--install-extension` no-op'd (or left a stray 0.0.1 folder) and the editor kept loading the old extension while
// the source said otherwise. The one number, computed once, whoever builds.
if (process.argv.includes("--vsix")) {
  console.log(vsix)
} else {
  for (const line of [`version=${version}`, `base=${base}`, `vsix=${vsix}`, `prerelease=${isTag ? "false" : "true"}`])
    console.log(line)
}
