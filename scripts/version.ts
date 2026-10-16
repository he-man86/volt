#!/usr/bin/env bun
/**
 * Compute the ONE Volt version — the single source of truth CI injects into every artifact, so no version is ever
 * hand-maintained across files. The rule: compute once, inject; never let an artifact read its own stored
 * version — that is where the drift bugs come from.
 *
 * The split, and why:
 *   - The BUILD NUMBER is git — `git rev-list HEAD --count` (monotonic, always grows, e.g. 15940 → the LAST part).
 *   - The maj.min BASE is human intent — git can't know if a change is a patch or a feature, so it lives in ONE
 *     place (`packages/volt-desktop/package.json`), bumped only when you decide the next release's shape.
 *
 * ONE 3-part scheme `<maj>.<min>.<count>` for every artifact — installer, connector, desktop AND the extension (vsce
 * only accepts 3-part, so the whole toolchain uses that one format; maj.min is the human knob, count is the build).
 * Every build is published as a PRERELEASE; a RELEASE is that exact build PROMOTED to the stable channel (its GitHub
 * prerelease flag flipped to latest — see scripts/release.ts + .github/workflows/promote.yml). So the released
 * version is the same number the dev channel used — monotonic, and it names the exact build.
 *
 *   bun scripts/version.ts                     # `version=<maj>.<min>.<count>` — append to $GITHUB_OUTPUT
 *   bun scripts/version.ts --version           # the bare version (e.g. for `vsce package <version>`)
 *
 * (It printed `base=`, `vsix=` and `prerelease=true` too — three names for the one value plus a constant, kept "so
 * the release workflow's stamp steps read unchanged" after the scheme became one number. Gone with their readers.)
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const git = (args: string): string => {
  const r = spawnSync("git", args.split(" "), { cwd: repo, encoding: "utf8" })
  if (r.status !== 0) {
    console.error(`✗ git ${args} failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? "").trim()}`)
    process.exit(1)
  }
  return r.stdout.trim()
}

const pkgVersion: string = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
const [maj, min] = pkgVersion.split(".")
// NO fallback: an empty count would yield the bare base version — the exact never-out-versions-an-install bug
// test:ext exists to catch. A count git could not give is a failed build.
const count = git("rev-list HEAD --count")
const version = `${maj}.${min}.${count}` // e.g. 0.1.15940 — VOLT_VERSION, the desktop, the extension, the release tag

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ computed a bad version ('${version}') from '${pkgVersion}' — is volt-desktop's version a bare X.Y.Z? (only maj.min are read)`)
  process.exit(1)
}

const unknown = process.argv.slice(2).filter((a) => a !== "--version")
if (unknown.length > 0) {
  console.error(`✗ unknown argument(s): ${unknown.join(" ")} — version.ts takes only --version`)
  process.exit(1)
}

// `--version` prints the bare value so a LOCAL `bun run package` stamps the same git-derived version CI does.
console.log(process.argv.includes("--version") ? version : `version=${version}`)
