#!/usr/bin/env bun
/**
 * SNAPSHOT F — THE FRONT-END'S WHOLE OUTPUT, BEFORE AND AFTER A MOVE (openspec frontend-conformance design.md P9, §5,
 * task 1.3). A phase-1 task is output-neutral when this compares identical.
 *
 *   bun scripts/frontend-snapshot.ts write [--out <dir>] [--graphical 0|1]
 *   bun scripts/frontend-snapshot.ts check [--base <rev>] [--graphical 0|1]
 *   bun scripts/frontend-snapshot.ts show <id> <aspect> [--base <rev>] [--graphical 0|1]
 *
 * WHAT IT HOLDS, per source (`test/frontend/sources.ts`: every corpus file, fixture source and library body):
 *
 *   F-front  `ast` (units, spans included), `errors`, `failed` (failedDeclarations), `tokens` (the lexed stream), each ST
 *            body's statement tree (`stmts` and `active`, one tree since frontend-conformance 2.7.1 — `bodyStatements`), and the `resolution`,
 *            `types` and `folds` dumps of `test/frontend/dumps.ts` (fixtures bound once per vendor); plus `diagnostics`,
 *            the LSP's own over the six corpora (the server's `documentDiagnostics`);
 *   F-back   each conformance fixture's lowering diagnostics, emitted Rust (`rust`) and interpreter values (`interp`, every
 *            run path after the fixture's cycles).
 *
 * Each aspect is stored as a hash (the whole corpus as text is gigabytes); `show` prints one aspect of one source in full,
 * from the working tree or from `--base`, to read a difference `check` names.
 *
 * WHY AGAINST A COMMIT, NOT A STORED FILE. Other runs commit to `src/transpile/` while this change runs. `check` builds
 * the snapshot of `--base` (default: the parent commit, HEAD~1) in a temporary git worktree — this script is copied into
 * it, so a base that predates the script is measured by the same code — caches it under
 * `test/frontend/.snapshot/<commit>-g<0|1>/` (gitignored), writes the working tree's, and compares the two. A transpile
 * commit between two tasks is then on both sides of the comparison.
 *
 * The script reaches the front-end only through paths every tree of this change has: `test/frontend/{dumps,bound,
 * sources}.ts`, the transpiler's and the conformance support's, and the syntax index at whichever of `src/syntax/` and
 * `src/frontend/syntax/` exists. `--graphical` sets `VOLT_GRAPHICAL` as the test preload does (default 1) — it is read
 * when the modules load, so every import below is dynamic.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const PKG = join(import.meta.dir, "..")
const REPO = join(PKG, "..", "..")
const SNAPSHOTS = join(PKG, "test", "frontend", ".snapshot")

const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const graphical = option("--graphical") ?? "1"
if (graphical !== "0" && graphical !== "1") throw new Error(`--graphical takes 0 or 1, not ${graphical}`)
if (graphical === "1") process.env.VOLT_GRAPHICAL = "1"
else delete process.env.VOLT_GRAPHICAL

const load = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(PKG, path)).href)) as T
const syntaxIndex = existsSync(join(PKG, "src", "frontend", "syntax", "index.ts"))
  ? "src/frontend/syntax/index.ts"
  : "src/syntax/index.ts"

/** Plain JSON of any front-end value: keys sorted (a move may build a node's fields in another order), bigint tagged. */
function json(value: unknown): string {
  const norm = (x: unknown): unknown => {
    if (typeof x === "bigint") return `#${x}n`
    if (Array.isArray(x)) return x.map(norm)
    if (x instanceof Map) return { "#map": [...x].map(([k, v]) => [norm(k), norm(v)]) }
    if (x instanceof Set) return { "#set": [...x].map(norm) }
    if (x !== null && typeof x === "object") {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x).sort()) {
        const v = (x as Record<string, unknown>)[k]
        // a body's `dialect` is its file's (`ParseResult.dialect`), carried for its statement parse (frontend-conformance
        // 2.8.3) — no fact of the tree a snapshot compares
        if (k === "dialect" && (x as { kind?: unknown }).kind === "body") continue
        if (v !== undefined && typeof v !== "function") out[k] = norm(v)
      }
      return out
    }
    return typeof x === "number" && Number.isNaN(x) ? "#NaN" : x
  }
  return JSON.stringify(norm(value))
}

const hash = (text: string): string => new Bun.CryptoHasher("sha1").update(text).digest("hex")

/** One source's aspects, as text. `only` limits the work to one id (for `show`). */
type Sink = (id: string, aspect: string, text: string) => void

async function snapshot(sink: Sink, only?: string): Promise<void> {
  const want = (id: string): boolean => only === undefined || id === only
  const syntax = await load<Record<string, any>>(syntaxIndex)
  const sources = await load<typeof import("../test/frontend/sources.ts")>("test/frontend/sources.ts")
  const dumps = await load<typeof import("../test/frontend/dumps.ts")>("test/frontend/dumps.ts")
  const bound = await load<typeof import("../test/frontend/bound.ts")>("test/frontend/bound.ts")

  const front = (p: { id: string; source: string; dialect: string; parseResult: any }, key = p.id): void => {
    if (!want(key)) return
    const r = p.parseResult
    sink(key, "ast", json(r.units))
    sink(key, "errors", json(r.errors))
    sink(key, "failed", json(r.failedDeclarations))
    sink(key, "tokens", json(syntax.lex(p.source, p.dialect)))
    const stmts: string[] = []
    const active: string[] = []
    const visit = (units: readonly any[]): void => {
      for (const unit of units) {
        if (unit.kind === "namespace") {
          visit(unit.units)
          continue
        }
        for (const body of syntax.unitBodies(unit)) {
          if (!syntax.isStBody(body)) continue
          // ONE tree since 2.7.1 (`bodyStatements`, the conditional pragmas applied, no world); both aspects kept so a
          // body's tree is compared with both of the base's (`parseStatements` every branch, `parseActive` the taken
          // ones — this script runs in the base's worktree too), its `messages` written only where it has some
          const api = syntax as unknown as Record<string, ((b: unknown) => { messages?: readonly unknown[] }) | undefined>
          const tree = (parse: ((b: unknown) => { messages?: readonly unknown[] }) | undefined): string => {
            const { messages, ...rest } = parse!(body)
            return json(messages !== undefined && messages.length > 0 ? { ...rest, messages } : rest)
          }
          stmts.push(tree(api.bodyStatements ?? api.parseStatements))
          active.push(tree(api.bodyStatements ?? api.parseActive))
        }
      }
    }
    visit(r.units)
    sink(key, "stmts", stmts.join("\n"))
    sink(key, "active", active.join("\n"))
  }
  const boundAspects = (b: any, key: string): void => {
    if (!want(key)) return
    sink(key, "resolution", dumps.resolutionDump(b).join("\n"))
    sink(key, "types", dumps.typeDump(b).join("\n"))
    sink(key, "folds", dumps.foldDump(b).join("\n"))
  }

  // ── corpus ──
  const { projectDocuments } = await load<typeof import("../test/corpus/support/diagnostics.ts")>(
    "test/corpus/support/diagnostics.ts",
  )
  for (const project of sources.corpusProjects()) {
    if (only !== undefined && !project.files.some((f) => f.id === only)) continue
    for (const b of bound.boundCorpus(project)) {
      front(b.parsed)
      boundAspects(b, b.parsed.id)
    }
    const ids = new Map(project.files.map((f) => [f.uri, f.id]))
    for (const d of projectDocuments(project.dir, project.vendor as never)) {
      const id = ids.get(d.uri) ?? `corpus/${project.name}/${relative(project.dir, d.uri).split("\\").join("/")}`
      if (want(id)) sink(id, "diagnostics", json(d.diagnostics))
    }
  }

  // ── fixtures: parsed as each vendor, bound as each vendor ──
  for (const f of sources.fixtureSources()) {
    if (only !== undefined && only !== f.own.id && only !== f.plc.id && !only.startsWith(`fixture/${f.test.name}/`))
      continue
    for (const vendor of ["codesys", "twincat"] as const)
      bound.withBoundFixture(f, vendor, (own, plc) => {
        for (const b of [own, plc]) {
          front(b.parsed, `${b.parsed.id}@${vendor}`)
          boundAspects(b, `${b.parsed.id}@${vendor}`)
        }
      })
  }

  // ── the library repo ──
  for (const b of bound.boundLibrary()) {
    front(b.parsed)
    boundAspects(b, b.parsed.id)
  }

  // ── F-back: every fixture lowered, emitted and run ──
  const transpile = await load<Record<string, any>>("src/transpile/index.ts")
  const { ALL_TESTS } = await load<typeof import("../test/conformance/fixtures/index.ts")>(
    "test/conformance/fixtures/index.ts",
  )
  const { assembleFixture } = await load<typeof import("../test/conformance/support/fixture-units.ts")>(
    "test/conformance/support/fixture-units.ts",
  )
  const { PROJECT_BASE } = await load<typeof import("../test/conformance/support/project-libraries.ts")>(
    "test/conformance/support/project-libraries.ts",
  )
  const { runPaths } = await load<typeof import("../test/conformance/support/run-paths.ts")>(
    "test/conformance/support/run-paths.ts",
  )
  const { HARNESS_LOOP_GUARD } = await load<typeof import("../test/conformance/support/transpile-confidence.ts")>(
    "test/conformance/support/transpile-confidence.ts",
  )
  const failure = (e: unknown): string => `throws ${e instanceof Error ? e.message : String(e)}`
  for (const t of ALL_TESTS) {
    const key = `back/${t.name}`
    if (!want(key)) continue
    let lowered: any
    try {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      lowered = transpile.lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE)
    } catch (e) {
      sink(key, "lowering", failure(e))
      continue
    }
    sink(key, "lowering", json(lowered.diagnostics))
    if (lowered.pou === undefined) continue
    let rust: string
    try {
      rust = transpile.emitRust(lowered.pou, { loopGuard: HARNESS_LOOP_GUARD }).code
    } catch (e) {
      rust = failure(e)
    }
    sink(key, "rust", rust)
    const values: string[] = []
    try {
      const runner = transpile.run(lowered.pou, { loopGuard: HARNESS_LOOP_GUARD })
      for (let i = 0; i < (t.cycles ?? 1); i++) runner.scan()
      for (const path of runPaths(t, ALL_TESTS)) {
        try {
          values.push(`${path} = ${json(runner.get(path))}`)
        } catch (e) {
          values.push(`${path} ${failure(e)}`)
        }
      }
    } catch (e) {
      values.push(failure(e))
    }
    sink(key, "interp", values.join("\n"))
  }
}

/** Write the working tree's snapshot to `dir/snapshot.tsv`: `id <TAB> aspect <TAB> sha1`, in walk order. */
async function write(dir: string): Promise<void> {
  const started = performance.now()
  const lines: string[] = []
  await snapshot((id, aspect, text) => lines.push(`${id}\t${aspect}\t${hash(text)}`))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "snapshot.tsv"), `${lines.join("\n")}\n`)
  writeFileSync(join(dir, "done"), `${lines.length} lines in ${Math.round((performance.now() - started) / 1000)} s\n`)
  console.log(`wrote ${lines.length} aspect hashes to ${relative(PKG, dir)} in ${Math.round((performance.now() - started) / 1000)} s`)
}

function git(...argv: string[]): string {
  const r = Bun.spawnSync(["git", ...argv], { cwd: REPO, stdout: "pipe", stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

/**
 * Run this script, with `argv`, inside a temporary worktree of `sha` — the script copied in, the package's
 * `node_modules` reached through a junction — and remove the worktree afterwards.
 */
function inWorktree(sha: string, argv: string[], stdout: "inherit" | "pipe"): string {
  const tree = join(REPO, ".worktrees", `frontend-snapshot-${sha.slice(0, 12)}`)
  if (existsSync(tree)) git("worktree", "remove", "--force", tree)
  // Checked out byte for byte as the index holds it: with `core.autocrlf` a fresh checkout turns every source CRLF and
  // every span moves, which would read as a front-end change.
  git("-c", "core.autocrlf=false", "worktree", "add", "--detach", tree, sha)
  // …and then as THIS tree holds it: a file checked out here with CRLF (`git ls-files --eol`: `w/crlf`) is CRLF there
  // too, so both sides read the same bytes.
  for (const line of git("ls-files", "--eol", "--", "packages/volt-lsp-iec").split("\n")) {
    const m = /^\S+\s+w\/crlf\s+\S+\s+(.+)$/.exec(line)
    if (m === null) continue
    const there = join(tree, m[1]!)
    if (!existsSync(there)) continue
    const text = readFileSync(there, "utf8")
    if (!text.includes("\r\n")) writeFileSync(there, text.replace(/\n/g, "\r\n"))
  }
  const pkg = join(tree, "packages", "volt-lsp-iec")
  const links = [
    [join(pkg, "node_modules"), join(PKG, "node_modules")],
    [join(tree, "node_modules"), join(REPO, "node_modules")],
  ] as const
  try {
    for (const [link, target] of links) if (existsSync(target) && !existsSync(link)) symlinkSync(target, link, "junction")
    copyFileSync(join(PKG, "scripts", "frontend-snapshot.ts"), join(pkg, "scripts", "frontend-snapshot.ts"))
    const r = Bun.spawnSync(["bun", join(pkg, "scripts", "frontend-snapshot.ts"), ...argv], {
      cwd: pkg,
      stdout,
      stderr: "inherit",
    })
    if (r.exitCode !== 0) throw new Error(`the snapshot of ${sha} failed (exit ${r.exitCode})`)
    return stdout === "pipe" ? (r.stdout?.toString() ?? "") : ""
  } finally {
    // the junctions first: a worktree removal must never walk into the real node_modules
    for (const [link] of links) if (existsSync(link)) unlinkSync(link)
    git("worktree", "remove", "--force", tree)
  }
}

async function main(): Promise<void> {
  const [verb] = args
  if (verb === "write") {
    await write(option("--out") ?? join(SNAPSHOTS, `worktree-g${graphical}`))
    return
  }
  if (verb === "show") {
    const [, id, aspect] = args
    if (id === undefined || aspect === undefined) throw new Error("usage: show <id> <aspect> [--base <rev>]")
    const base = option("--base")
    if (base !== undefined) {
      process.stdout.write(inWorktree(git("rev-parse", base), ["show", id, aspect, "--graphical", graphical], "pipe"))
      return
    }
    let found = false
    await snapshot((i, a, text) => {
      if (i === id && a === aspect) {
        found = true
        process.stdout.write(`${text}\n`)
      }
    }, id)
    if (!found) throw new Error(`no aspect ${aspect} of ${id}`)
    return
  }
  if (verb === "check") {
    const sha = git("rev-parse", option("--base") ?? "HEAD~1")
    const baseDir = join(SNAPSHOTS, `${sha}-g${graphical}`)
    const started = performance.now()
    if (!existsSync(join(baseDir, "done"))) {
      rmSync(baseDir, { recursive: true, force: true })
      inWorktree(sha, ["write", "--out", baseDir, "--graphical", graphical], "inherit")
    } else console.log(`base ${sha.slice(0, 12)}: cached`)
    const hereDir = join(SNAPSHOTS, `worktree-g${graphical}`)
    await write(hereDir)
    const read = (dir: string): Map<string, string> =>
      new Map(
        readFileSync(join(dir, "snapshot.tsv"), "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => {
            const [id, aspect, h] = l.split("\t")
            return [`${id}\t${aspect}`, h!] as const
          }),
      )
    const before = read(baseDir)
    const after = read(hereDir)
    const differ: string[] = []
    for (const [k, h] of before) if (after.get(k) !== h) differ.push(after.has(k) ? `~ ${k}` : `- ${k}`)
    for (const k of after.keys()) if (!before.has(k)) differ.push(`+ ${k}`)
    const files = new Set(differ.map((d) => d.slice(2).split("\t")[0]))
    const seconds = Math.round((performance.now() - started) / 1000)
    console.log(`base ${sha.slice(0, 12)} vs working tree (VOLT_GRAPHICAL=${graphical}): ${before.size} aspects, ${seconds} s`)
    if (differ.length === 0) {
      console.log("✓ identical")
      return
    }
    console.log(`✗ ${differ.length} aspect(s) differ over ${files.size} source(s):`)
    for (const d of differ.slice(0, 200)) console.log(`  ${d}`)
    if (differ.length > 200) console.log(`  … and ${differ.length - 200} more`)
    process.exit(1)
  }
  console.error("usage: bun scripts/frontend-snapshot.ts write|check|show … (see the header)")
  process.exit(2)
}

await main()
