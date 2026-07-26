#!/usr/bin/env bun
/**
 * Compute the ONE Volt version — the single source of truth CI injects into every artifact, so no version is ever
 * hand-maintained across files (opencode's lesson: compute once, inject; never let an artifact read its own stored
 * version — that's the exact bug behind sst/opencode#36232).
 *
 * The split, and why:
 *   - The BUILD NUMBER is git — `git rev-list HEAD --count` (monotonic, always grows, e.g. 15940 → the LAST part).
 *   - The maj.min BASE is human intent — git can't know if a change is a patch or a feature, so it lives in ONE
 *     place (`packages/volt-desktop/package.json`), bumped only when you decide the next release's shape.
 *
 * ONE 3-part scheme `<maj>.<min>.<count>` for every artifact — installer, connector AND the extension — there is no
 * separate "stable" number and no 4-part variant. (vsce only accepts 3-part, so the whole toolchain uses that ONE
 * format; the patch component is dropped — maj.min is the human knob, count is the build.) Every build is published
 * as a PRERELEASE; a RELEASE is that exact build PROMOTED to the stable channel (its GitHub prerelease flag flipped
 * to latest — see volt-scripts/release.ts + .github/workflows/promote.yml). So the released version is the same
 * number the dev channel used — monotonic (count always grows), and it names the exact build.
 *
 * Output (key=value lines — append to $GITHUB_OUTPUT) — version/base/vsix are now the SAME 3-part value; the three
 * keys are kept so the release workflow's stamp steps read unchanged:
 *   version    — the one version, <maj>.<min>.<count> (e.g. 0.1.15940): VOLT_VERSION (installer + connector), tag
 *   base       — same value; stamps the electron app package.json
 *   vsix       — same value; stamps the extension (vsce accepts it — it's 3-part)
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

// ONE 3-part scheme for EVERY artifact — <maj>.<min>.<count>. The human knob is maj.min (the release SHAPE); git's
// commit count is the build (the LAST part). Patch (Z) is dropped: vsce only accepts 3-part, so the whole toolchain
// uses the SAME 3-part format instead of the installer carrying a 4-part `X.Y.Z.count` the extension can't. Still
// monotonic (count always grows) and still a valid System.Version / SemVer for the updater. package.json keeps a
// valid 3-part semver, but only maj.min are read here.
const pkgVersion: string = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
const [maj, min] = pkgVersion.split(".")
const count = git("rev-list HEAD --count") || "0"
const version = `${maj}.${min}.${count}` // e.g. 0.1.15940 — VOLT_VERSION, electron app, vsix, and the release tag
const base = version // no separate constant base anymore — the one number IS the 3-part version
const vsix = version

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ computed a bad version ('${version}') from '${pkgVersion}' — is volt-desktop's version a bare X.Y.Z? (only maj.min are read)`)
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
