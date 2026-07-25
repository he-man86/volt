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
 * ONE version scheme for every build — there is no separate "stable" number. Every build is a 4-part
 * `<base>.<count>` published as a PRERELEASE; a RELEASE is that exact build PROMOTED to the stable channel (its
 * GitHub prerelease flag flipped to latest — see volt-scripts/release.ts + .github/workflows/promote.yml). So the
 * released version is the same detailed number the dev channel used — monotonic, and it names the exact build. This
 * replaced a 3-part stable tag, which sorted BELOW every 4-part dev build (System.Version 0.0.1 = 0.0.1.0), so a
 * dev→stable switch read as a downgrade and never updated.
 *
 * Output (key=value lines — append to $GITHUB_OUTPUT):
 *   version    — the installer + connector version the updater compares (System.Version): <base>.<count> 4-part,
 *                e.g. 0.0.1.842
 *   base       — the 3-part X.Y.Z; what stamps the electron app package.json (vsce REJECTS a 4-part version)
 *   vsix       — the extension's 3-part version <maj>.<min>.<count> (e.g. 0.0.842). Unlike `base` (a constant per
 *                release-shape), this MOVES with the build so `--install-extension` actually upgrades and the
 *                connector's drift check can tell a stale sideloaded extension apart.
 *   prerelease — always true: every BUILD ships as a prerelease; promotion (not the build) flips it to stable.
 *
 *   bun volt-scripts/version.ts                 # print the four lines
 *   bun volt-scripts/version.ts >> "$GITHUB_OUTPUT"
 *   bun volt-scripts/version.ts --vsix          # print ONLY the vsix version (for `vsce package <version>`)
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const git = (args: string): string => spawnSync("git", args.split(" "), { cwd: repo, encoding: "utf8" }).stdout?.trim() ?? ""

// The X.Y.Z base is the one number a human sets (git can't infer patch-vs-feature); the 4th part is the git commit
// count (monotonic). Every build is <base>.<count> — a release is a promoted build, never a differently-numbered one.
const base: string = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
const count = git("rev-list HEAD --count") || "0"
const version = `${base}.${count}`
// The extension can't carry a 4-part version (vsce rejects it), so encode the build number in the patch:
// <maj>.<min>.<count>. Stays 3-part, but MOVES every build — unlike `base` (constant per release-shape) — so a newer
// sideloaded build strictly out-versions the last one and installs/refreshes cleanly instead of no-op'ing.
const [maj, min] = base.split(".")
const vsix = `${maj}.${min}.${count}`

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
  for (const line of [`version=${version}`, `base=${base}`, `vsix=${vsix}`, `prerelease=true`])
    console.log(line)
}
