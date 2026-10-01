/**
 * A CONTENT-ADDRESSED CACHE FOR THE EMITTED-RUST BUILDS — `fixtures.test.ts` and `scripts/rate-fixtures.ts` both
 * build every lowered fixture's Rust with `clippy-driver`, ~2,300 processes and ~6 minutes, every run, while a step
 * changes a handful of fixtures. Through here an unchanged build is never repeated. A STALE HIT IS THE ONE WAY THIS
 * CAN BREAK THE SUITE, so the key is everything a build reads, a sample of hits is re-proved every run, and CI runs
 * without it (`VOLT_RUSTC_CACHE=0` in `.github/workflows/ci.yml`).
 *
 * WHAT A BUILD READS, AND WHERE EACH IS IN THE KEY — a difference in any of it is a miss:
 *   1. the emitted `.rs` — the exact source text (`KeyInput.source`). It must be SELF-CONTAINED: a source that could
 *      read another file or the environment at compile time (`include!`, `include_str!`, `include_bytes!`, `mod x;`,
 *      `#[path]`, `extern crate`, `env!`, `option_env!`) is NOT CACHED at all (`uncacheable`) — its inputs are not in
 *      the key. The emitter's output has none: no prelude or runtime file is compiled or linked beside it; the
 *      string prelude is text inside the emitted source, so it is keyed as part of it.
 *   2. the crate name — rustc derives it from the file's basename (`KeyInput.file`'s basename).
 *   3. every flag — the whole argv (`--edition`, every `-W`/`-F` lint level, `--error-format`, `-o`/`--emit`, any
 *      `--target`/`--extern`/`-L` a caller ever adds), in order, with only the scratch `.rs` and output paths
 *      abstracted (`KeyInput.argv`).
 *   4. the compiler — `-vV` (release, commit hash, LLVM version, HOST = the target triple, since the argv names no
 *      `--target`), the sysroot path, and a sha256 of the REAL binary in that sysroot (`clippy-driver -vV` prints
 *      rustc's version, so the version alone cannot tell two clippys apart) — `toolchainIdentity`.
 *   5. the standard library the crate links — the name and size of every file in `<sysroot>/lib/rustlib/<host>/lib`
 *      (std's rlib names carry their own build hash) — also `toolchainIdentity`.
 *   6. the linker — the path rustc would resolve it from (`link.exe` on Windows, `cc` elsewhere, via PATH) with
 *      its size and mtime. PATH itself is NOT keyed: `bun run` prepends `node_modules/.bin`, which changes nothing
 *      a build reads and would make the suite and `rate:fixtures` never share an entry.
 *   7. the environment the compiler, clippy and the linker read — `KEYED_ENV` below — and the content of every
 *      `clippy.toml` / `.clippy.toml` in the directories clippy searches (from `CLIPPY_CONF_DIR`, else
 *      `CARGO_MANIFEST_DIR`, else the working directory, up to the root) — `environmentIdentity`.
 *   8. the entry format (`FORMAT`), so a change to what is stored retires every old entry.
 *
 * THE VALUE is what a caller consumes: the exit code, stdout, stderr (the JSON diagnostics and lints) and, when it
 * built, the executable — copied to the caller's `exe` so the recorded scan and the edge runs use it as if it had
 * just been linked. Paths in stderr are stored abstracted and a hit restores the CURRENT scratch paths, so a hit
 * reads byte-for-byte like a compile there. RUNS ARE NOT CACHED: they are a small share of the cost, and a run is
 * only as deterministic as the emitted program, which is the thing under test.
 *
 * SAMPLED VERIFICATION. A fraction of hits (`VOLT_RUSTC_CACHE_VERIFY`, default 0.02; 1 = every hit, a full
 * cold-equivalent check) is ALSO compiled for real, and both executables are run on the caller's probes (the
 * recorded scan and the edge run). Which hits are sampled is a pure function of the key and a seed
 * (`VOLT_RUSTC_CACHE_SEED`, random per run and printed, so a run is reproducible). Any difference — exit, stdout,
 * stderr, or a probe's exit/stdout/stderr — EVICTS the entry and THROWS `rustc cache stale: <fixture>, <part>`, which
 * fails the case (and `rate:fixtures`) loudly. A verified hit hands the caller the FRESH build.
 *
 * NO FALLBACK HIDES A MISS: a corrupt or partial entry is reported once, removed, and a miss; a cache I/O error is
 * reported once and the build is a real compile. Entries are written to a temp directory and renamed into place, so
 * no reader sees half of one. `VOLT_RUSTC_CACHE=0` turns the cache off; `VOLT_RUSTC_CACHE_MAX_MB` (default 4096)
 * caps it, pruned least-recently-used. `VOLT_RUSTC_TRACE=<file>` appends one JSON line per build — what the
 * equivalence proof diffs.
 */
import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { appendFile, copyFile, link, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"

/** Where entries live: outside git (`.cache/` is ignored), inside the package so `git clean -X` clears it. */
export const CACHE_ROOT = join(import.meta.dir, "..", "..", "..", ".cache", "rustc")

/** The environment variables the compiler, clippy or the linker read — the ones that can change a build's output. */
export const KEYED_ENV = [
  // rustc
  "RUSTFLAGS", // read by cargo, not rustc — keyed anyway: cheap, and a wrapper may forward it
  "RUSTC_BOOTSTRAP",
  "RUSTC_LOG",
  "RUST_TARGET_PATH",
  "SOURCE_DATE_EPOCH",
  "RUSTC_FORCE_RUSTC_VERSION",
  // toolchain selection (the rustup shim)
  "RUSTUP_TOOLCHAIN",
  "RUSTUP_HOME",
  "CARGO_HOME",
  // clippy
  "CLIPPY_CONF_DIR",
  "CLIPPY_ARGS",
  "CARGO_MANIFEST_DIR",
  "CLIPPY_DISABLE_DOCS_LINKS",
  // the linker (MSVC reads these; the Unix `cc` reads the C toolchain's)
  "LINK",
  "_LINK_",
  "LIB",
  "LIBPATH",
  "VCINSTALLDIR",
  "VSINSTALLDIR",
  "VCToolsInstallDir",
  "VisualStudioVersion",
  "CC",
  "LIBRARY_PATH",
  "MACOSX_DEPLOYMENT_TARGET",
] as const

const FILE = "\u0000FILE\u0000"
const EXE = "\u0000EXE\u0000"
const FORMAT = 2

/** Everything a build's output depends on. `buildKey` hashes all of it; the unit test changes each field. */
export interface KeyInput {
  source: string
  argv: readonly string[]
  /** the scratch .rs path in `argv` — abstracted, but its BASENAME is keyed (the crate name) */
  file: string
  /** the output path in `argv` — abstracted */
  exe: string
  /** `toolchainIdentity(...)` of `argv[0]` */
  compiler: string
  /** `environmentIdentity()` */
  environment: string
}

export function buildKey(k: KeyInput): string {
  const argv = k.argv.map((a) => (a === k.file ? FILE : a === k.exe ? EXE : a))
  return createHash("sha256")
    .update(JSON.stringify([FORMAT, k.source, basename(k.file), argv, k.compiler, k.environment]))
    .digest("hex")
}

/** What identifies a compiler — each part is keyed; the unit test changes each one. */
export interface Toolchain {
  /** `<compiler> -vV`: release, commit hash, LLVM, host (the target triple) */
  versionVerbose: string
  sysroot: string
  /** sha256 of the binary that actually runs — the one in the sysroot, not the rustup shim */
  binary: string
  /** `name:size` of every file in `<sysroot>/lib/rustlib/<host>/lib` — the std the crate links */
  stdlib: readonly string[]
  /** where the linker resolves from, with its size and mtime */
  linker: string
}
export const toolchainIdentity = (t: Toolchain): string =>
  JSON.stringify([t.versionVerbose, t.sysroot, t.binary, t.stdlib, t.linker])

const toolchains = new Map<string, string>()
function compilerIdentity(compiler: string): string {
  const known = toolchains.get(compiler)
  if (known !== undefined) return known
  const vv = spawnSync(compiler, ["-vV"], { encoding: "utf8" })
  const root = spawnSync(compiler, ["--print", "sysroot"], { encoding: "utf8" })
  if (vv.status !== 0 || root.status !== 0) throw new Error(`${compiler} -vV / --print sysroot failed: ${vv.stderr}${root.stderr}`)
  const sysroot = root.stdout.trim()
  const host = /^host: (.+)$/m.exec(vv.stdout)?.[1]?.trim()
  if (host === undefined) throw new Error(`${compiler} -vV names no host`)
  const real = [join(sysroot, "bin", basename(compiler)), compiler].find((p) => existsSync(p))!
  const lib = join(sysroot, "lib", "rustlib", host, "lib")
  const linkerPath = Bun.which(process.platform === "win32" ? "link.exe" : "cc")
  const linkerStat = linkerPath === null ? undefined : statSync(linkerPath)
  const identity = toolchainIdentity({
    versionVerbose: vv.stdout,
    sysroot,
    binary: createHash("sha256").update(readFileSync(real)).digest("hex"),
    stdlib: readdirSync(lib)
      .sort()
      .map((f) => `${f}:${statSync(join(lib, f)).size}`),
    linker: JSON.stringify([linkerPath, linkerStat?.size, linkerStat?.mtimeMs]),
  })
  toolchains.set(compiler, identity)
  return identity
}

/** The keyed environment, and every `clippy.toml` / `.clippy.toml` clippy could pick up from where it starts looking. */
export function environmentIdentity(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  const values = KEYED_ENV.map((name) => [name, env[name] ?? null])
  const configs: [string, string][] = []
  for (let dir = env.CLIPPY_CONF_DIR ?? env.CARGO_MANIFEST_DIR ?? cwd; ; dir = dirname(dir)) {
    for (const name of ["clippy.toml", ".clippy.toml"]) {
      const p = join(dir, name)
      if (existsSync(p)) configs.push([p, readFileSync(p, "utf8")])
    }
    if (dirname(dir) === dir) break
  }
  return JSON.stringify([values, configs])
}

/** Why a source cannot be cached — it can read an input the key does not hold — or undefined when it can. */
export function uncacheable(source: string): string | undefined {
  const m = /(\b(?:include(?:_str|_bytes)?!|option_env!|env!|extern\s+crate\b|mod\s+\w+\s*;)|#\s*\[\s*path\b)/.exec(source)
  return m === null ? undefined : `the source reads an input outside the key (\`${m[1]}\`)`
}

/** Whether this hit is re-proved: a pure function of the key and the run's seed, so a run can be repeated exactly. */
export function sampled(key: string, seed: string, fraction: number): boolean {
  if (fraction <= 0) return false
  if (fraction >= 1) return true
  return parseInt(createHash("sha256").update(`${seed}\u0000${key}`).digest("hex").slice(0, 8), 16) / 0x1_0000_0000 < fraction
}

/** A stale hit — the cache answered something a real compile does not. Never caught by the cache itself. */
export class StaleCacheError extends Error {}

/** What a build gives its caller. */
export interface RustBuild {
  exit: number
  stdout: string
  stderr: string
  /** true when it came out of the cache unverified; a verified hit is a real compile and says false */
  cached: boolean
}

interface Entry {
  format: number
  exit: number
  stdout: string
  stderr: string
  /** the scratch directory it was built in — a panic message in a probe names it */
  origin: string
  /** sha256 of `out.bin`, present exactly when the build produced an executable */
  exe?: string
}

export const cacheEnabled = (): boolean => process.env.VOLT_RUSTC_CACHE !== "0"

const reported = new Set<string>()
/** Each kind of cache fault is reported ONCE per process — the build it affects is a real compile either way. */
function once(kind: string, message: string): void {
  if (reported.has(kind)) return
  reported.add(kind)
  // eslint-disable-next-line no-console
  console.warn(`  [rustc-cache] ${message}`)
}
const fault = (what: string, error: unknown) =>
  once(what, `${what}: ${(error as Error)?.message ?? error} — compiling instead (reported once)`)

let seedMemo: string | undefined
function verification(): { fraction: number; seed: string } {
  const fraction = Number(process.env.VOLT_RUSTC_CACHE_VERIFY ?? 0.02)
  if (!(fraction >= 0)) throw new Error(`VOLT_RUSTC_CACHE_VERIFY=${process.env.VOLT_RUSTC_CACHE_VERIFY} is not a fraction`)
  const seed = (seedMemo ??= process.env.VOLT_RUSTC_CACHE_SEED ?? randomBytes(4).toString("hex"))
  once("seed", `re-proving ${fraction * 100}% of hits by a real compile; VOLT_RUSTC_CACHE_SEED=${seed} repeats this sample`)
  return { fraction, seed }
}

/** A path as rustc prints it in its JSON (escaped) and in plain text (raw) — each gets its own token, so a hit
 *  restores each spelling exactly where it was. On a platform where the two are equal there is just the one. */
const escaped = (path: string) => JSON.stringify(path).slice(1, -1)
function abstractPaths(text: string, file: string, exe: string): string {
  for (const [path, token] of [[file, FILE], [exe, EXE]] as const)
    text = text.split(escaped(path)).join(`${token}J`).split(path).join(`${token}R`)
  return text
}
function concretePaths(text: string, file: string, exe: string): string {
  for (const [path, token] of [[file, FILE], [exe, EXE]] as const)
    text = text.split(`${token}J`).join(escaped(path)).split(`${token}R`).join(path)
  return text
}

/**
 * Build `source` with `argv` (which names `file` and `exe`), through the cache. On a miss `source` is written to
 * `file` and the compiler runs; on a hit nothing is compiled and, if it built, the stored executable lands at `exe`.
 * `probes` are the argument lists the caller will run the executable with — a verified hit runs both builds on each.
 */
export async function buildRust(
  argv: readonly string[],
  file: string,
  exe: string,
  source: string,
  probes: readonly (readonly string[])[] = [[]],
  root = CACHE_ROOT,
): Promise<RustBuild> {
  let key: string | undefined
  if (cacheEnabled()) {
    const refused = uncacheable(source)
    if (refused !== undefined) once("uncacheable", `${basename(file)}: not cached — ${refused}`)
    else
      try {
        key = buildKey({ source, argv, file, exe, compiler: compilerIdentity(argv[0]!), environment: environment() })
        await prune(root)
      } catch (error) {
        fault("the cache could not be keyed", error)
        key = undefined
      }
  }
  if (key !== undefined) {
    let hit: { build: RustBuild; entry: Entry } | undefined
    try {
      hit = await lookup(root, key, file, exe)
    } catch (error) {
      fault("lookup failed", error)
    }
    if (hit !== undefined) {
      const { fraction, seed } = verification()
      if (!sampled(key, seed, fraction)) return trace(file, hit.build)
      return trace(file, await verify(root, key, argv, file, exe, source, probes, hit))
    }
  }
  const fresh = await compile(argv, file, source)
  // only an ordinary verdict is stored: 0 (built) or 1 (refused). A crash, a signal or an ICE is not an answer.
  if (key !== undefined && (fresh.exit === 0 || fresh.exit === 1)) {
    try {
      const entry = { format: FORMAT, exit: fresh.exit, stdout: fresh.stdout, stderr: abstractPaths(fresh.stderr, file, exe), origin: dirname(file) }
      await store(root, key, entry, fresh.exit === 0 ? exe : undefined)
    } catch (error) {
      fault("store failed", error)
    }
  }
  return trace(file, fresh)
}

async function compile(argv: readonly string[], file: string, source: string): Promise<RustBuild> {
  await writeFile(file, source)
  const p = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { exit, stdout, stderr, cached: false }
}

/** Re-prove a hit: compile for real, run both executables on every probe, and refuse the entry on any difference. */
async function verify(
  root: string,
  key: string,
  argv: readonly string[],
  file: string,
  exe: string,
  source: string,
  probes: readonly (readonly string[])[],
  hit: { build: RustBuild; entry: Entry },
): Promise<RustBuild> {
  const side = join(dirname(exe), `${basename(exe, extname(exe))}.cached${extname(exe)}`)
  // the stored executable, moved out of the way before the real compile writes that path: `exe` is a hard link to the
  // entry (`placeExecutable`), so compiling over it in place would write the fresh build INTO the cache
  if (hit.build.exit === 0) await rename(exe, side)
  try {
    const fresh = await compile(argv, file, source)
    const parts: [string, unknown, unknown][] = [
      ["build exit", hit.build.exit, fresh.exit],
      ["build stdout", hit.build.stdout, fresh.stdout],
      ["build stderr (diagnostics/lints)", hit.build.stderr, fresh.stderr],
    ]
    if (fresh.exit === 0 && hit.build.exit === 0)
      for (const args of probes) {
        const [was, is] = await Promise.all([probe([side, ...args]), probe([exe, ...args])])
        // a panic names the source path compiled into the binary: the stored one was built in `origin`
        was.stderr = was.stderr.split(join(hit.entry.origin, basename(file))).join(file)
        parts.push([`run [${args.join(" ")}]`, was, is])
      }
    const differ = parts.find(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
    if (differ !== undefined) {
      await rm(join(root, key), { recursive: true, force: true })
      const message = `rustc cache stale: ${basename(file, ".rs")}, ${differ[0]} differed (entry ${key} evicted)`
      // eslint-disable-next-line no-console
      console.error(`  [rustc-cache] ${message}\n    cached: ${JSON.stringify(differ[1]).slice(0, 400)}\n    real:   ${JSON.stringify(differ[2]).slice(0, 400)}`)
      throw new StaleCacheError(message)
    }
    return fresh
  } finally {
    await rm(side, { force: true })
    await rm(side.replace(/\.exe$/, ".pdb"), { force: true })
  }
}

async function probe(argv: string[]): Promise<{ exit: number; stdout: string; stderr: string; killed: boolean }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    p.kill()
  }, 120_000)
  const [stdout, stderr, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearTimeout(timer)
  return { exit: killed ? -1 : exit, stdout, stderr, killed }
}

let environmentMemo: string | undefined
const environment = () => (environmentMemo ??= environmentIdentity())

async function trace(file: string, b: RustBuild): Promise<RustBuild> {
  const out = process.env.VOLT_RUSTC_TRACE
  if (out !== undefined) {
    const dir = dirname(file)
    const stderr = b.stderr.split(escaped(dir)).join("<dir>").split(dir).join("<dir>")
    await appendFile(out, JSON.stringify({ file: basename(file), exit: b.exit, stdout: b.stdout, stderr, cached: b.cached }) + "\n")
  }
  return b
}

/** A present entry that cannot be read back whole is CORRUPT: reported, removed, and a miss. */
async function lookup(root: string, key: string, file: string, exe: string): Promise<{ build: RustBuild; entry: Entry } | undefined> {
  const dir = join(root, key)
  let raw: string
  try {
    raw = await readFile(join(dir, "entry.json"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined // absent: an ordinary miss
    throw error
  }
  try {
    const entry = JSON.parse(raw) as Entry
    if (entry.format !== FORMAT || typeof entry.exit !== "number" || typeof entry.stdout !== "string" || typeof entry.stderr !== "string" || typeof entry.origin !== "string")
      throw new Error("malformed entry.json")
    if (entry.exit === 0) {
      const stored = join(dir, "out.bin")
      const bytes = await readFile(stored)
      if (createHash("sha256").update(bytes).digest("hex") !== entry.exe) throw new Error("executable does not match its hash")
      await placeExecutable(stored, exe)
    }
    const now = new Date()
    await utimes(join(dir, "entry.json"), now, now) // the LRU clock
    return { build: { exit: entry.exit, stdout: entry.stdout, stderr: concretePaths(entry.stderr, file, exe), cached: true }, entry }
  } catch (error) {
    fault("corrupt entry", new Error(`${key}: ${(error as Error).message}`))
    await rm(dir, { recursive: true, force: true })
    return undefined
  }
}

/**
 * The stored executable at the caller's `exe` — as a HARD LINK, not a copy. Windows' virus scanner inspects every new
 * executable FILE before its first run, one at a time: a fresh copy per hit cost ~270 ms a run with 15 lanes, and with
 * ~4,600 runs a suite that was the whole Rust phase. A link is the same file the scanner already passed (measured
 * 2026-10-01: 60 runs in 0.45-0.55 s linked against 2.5 s copied).
 *
 * THE CALLER'S `exe` IS THEREFORE THE ENTRY'S OWN FILE, and nothing may write through it: `verify` renames it aside
 * before compiling over that path, and the hash check above catches anything else on the next lookup. A cache on another
 * volume than the caller's scratch directory cannot be linked (EXDEV) and is copied — same bytes, the old speed.
 */
async function placeExecutable(stored: string, exe: string): Promise<void> {
  await rm(exe, { force: true })
  try {
    await link(stored, exe)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
    await copyFile(stored, exe)
  }
}

async function store(root: string, key: string, entry: Entry, exe: string | undefined): Promise<void> {
  const tmp = join(root, `.tmp-${randomBytes(8).toString("hex")}`)
  await mkdir(tmp, { recursive: true })
  try {
    if (exe !== undefined) {
      const bytes = await readFile(exe)
      entry.exe = createHash("sha256").update(bytes).digest("hex")
      await writeFile(join(tmp, "out.bin"), bytes)
    }
    await writeFile(join(tmp, "entry.json"), JSON.stringify(entry)) // written last: its presence means complete
    // WINDOWS REFUSES A RENAME while something holds a file inside the directory — the virus scanner opens every new
    // executable — so EPERM/EBUSY are retried briefly (measured: one store in ~2,300 hit it) before it is a fault.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, join(root, key))
        break
      } catch (error) {
        if (existsSync(join(root, key, "entry.json"))) break // a lost race with an identical writer
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= 6 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error
        await Bun.sleep(25 * 2 ** attempt)
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

const pruned = new Map<string, Promise<void>>()
/** Once per process and root: past the cap, the least recently used entries go until it is at 3/4 of it. */
function prune(root: string): Promise<void> {
  let p = pruned.get(root)
  if (p === undefined) pruned.set(root, (p = pruneNow(root)))
  return p
}
async function pruneNow(root: string): Promise<void> {
  const cap = Number(process.env.VOLT_RUSTC_CACHE_MAX_MB ?? 4096) * 1024 * 1024
  await mkdir(root, { recursive: true })
  const entries: { dir: string; used: number; size: number }[] = []
  for (const name of await readdir(root)) {
    const dir = join(root, name)
    if (name.startsWith(".tmp-")) {
      // a writer that died mid-store; a live one finishes in well under an hour
      if (Date.now() - (await stat(dir)).mtimeMs > 3_600_000) await rm(dir, { recursive: true, force: true })
      continue
    }
    let size = 0
    let used = 0
    for (const f of await readdir(dir)) {
      const s = await stat(join(dir, f))
      size += s.size
      if (f === "entry.json") used = s.mtimeMs
    }
    entries.push({ dir, used, size })
  }
  let total = entries.reduce((n, e) => n + e.size, 0)
  if (total <= cap) return
  for (const e of entries.sort((a, b) => a.used - b.used)) {
    if (total <= cap * 0.75) break
    await rm(e.dir, { recursive: true, force: true })
    total -= e.size
  }
}
