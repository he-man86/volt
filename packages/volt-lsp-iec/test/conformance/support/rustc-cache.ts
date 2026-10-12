/**
 * A CONTENT-ADDRESSED CACHE FOR THE EMITTED-RUST BUILDS — `transpile-replay.test.ts` and `scripts/rate-fixtures.ts` both
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
 * caps it, pruned least-recently-used. The size is read from a LEDGER (`<key> <bytes>` per stored entry), not by
 * stat-ing every entry: that walk, once per process, cost 5.7 s with 17,199 entries and timed out the first Rust
 * test of a file whose build was a hit. Only a ledger past the cap (or a missing one) pays the walk, which rewrites it. `VOLT_RUSTC_TRACE=<file>` appends one JSON line per build — what the
 * equivalence proof diffs.
 */
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

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
export const FORMAT = 2

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
export function compilerIdentity(compiler: string): string {
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

export interface Entry {
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
export function once(kind: string, message: string): void {
  if (reported.has(kind)) return
  reported.add(kind)
  // eslint-disable-next-line no-console
  console.warn(`  [rustc-cache] ${message}`)
}
export const fault = (what: string, error: unknown) =>
  once(what, `${what}: ${(error as Error)?.message ?? error} — compiling instead (reported once)`)

/** A path as rustc prints it in its JSON (escaped) and in plain text (raw) — each gets its own token, so a hit
 *  restores each spelling exactly where it was. On a platform where the two are equal there is just the one. */
export const escaped = (path: string) => JSON.stringify(path).slice(1, -1)
export function abstractPaths(text: string, file: string, exe: string): string {
  for (const [path, token] of [[file, FILE], [exe, EXE]] as const)
    text = text.split(escaped(path)).join(`${token}J`).split(path).join(`${token}R`)
  return text
}
export function concretePaths(text: string, file: string, exe: string): string {
  for (const [path, token] of [[file, FILE], [exe, EXE]] as const)
    text = text.split(`${token}J`).join(escaped(path)).split(`${token}R`).join(path)
  return text
}

