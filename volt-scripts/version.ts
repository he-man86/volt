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
 * Output (three key=value lines — append to $GITHUB_OUTPUT):
 *   version    — the installer + connector version the updater compares (System.Version): tag → the tag (stable);
 *                dev push → <base>.<count> 4-part (prerelease). e.g. 0.0.1 or 0.0.1.842
 *   base       — the 3-part X.Y.Z; what stamps every package.json + the .vsix (vsce REJECTS a 4-part version)
 *   prerelease — true on a dev push, false on a tag
 *
 *   bun volt-scripts/version.ts                 # print the three lines
 *   bun volt-scripts/version.ts >> "$GITHUB_OUTPUT"
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

if (!/^\d+\.\d+\.\d+$/.test(base) || !/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error(`✗ computed a bad version (base='${base}', version='${version}') — is volt-desktop's version a bare X.Y.Z?`)
  process.exit(1)
}

for (const line of [`version=${version}`, `base=${base}`, `prerelease=${isTag ? "false" : "true"}`]) console.log(line)
