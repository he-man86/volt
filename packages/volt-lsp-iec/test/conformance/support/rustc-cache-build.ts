/**
 * THE CACHED RUSTC BUILD — `buildRust`: the compile behind the cache, a sampled share of its hits verified by a real
 * compile, and the trace a run can write. One concern of `rustc-cache.ts` (openspec lsp-same-standard 4.4).
 */
import { randomBytes } from "node:crypto"
import {
  abstractPaths,
  buildKey,
  CACHE_ROOT,
  cacheEnabled,
  compilerIdentity,
  environmentIdentity,
  escaped,
  fault,
  FORMAT,
  once,
  sampled,
  StaleCacheError,
  uncacheable,
  type Entry,
  type RustBuild,
} from "./rustc-cache.js"
import { writeFile, rename, rm, appendFile } from "node:fs/promises"
import { basename, dirname, join, extname } from "node:path"
import { prune, lookup, store } from "./rustc-cache-store.js"

let seedMemo: string | undefined
export function verification(): { fraction: number; seed: string } {
  const fraction = Number(process.env.VOLT_RUSTC_CACHE_VERIFY ?? 0.02)
  if (!(fraction >= 0)) throw new Error(`VOLT_RUSTC_CACHE_VERIFY=${process.env.VOLT_RUSTC_CACHE_VERIFY} is not a fraction`)
  const seed = (seedMemo ??= process.env.VOLT_RUSTC_CACHE_SEED ?? randomBytes(4).toString("hex"))
  once("seed", `re-proving ${fraction * 100}% of hits by a real compile; VOLT_RUSTC_CACHE_SEED=${seed} repeats this sample`)
  return { fraction, seed }
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
        // …and the OS thread id of the run (`thread 'main' (39996) panicked`), which no two runs share
        const run = (r: typeof was) => ({ ...r, stderr: r.stderr.replace(/^(thread '[^']*') \(\d+\)/gm, "$1 (<tid>)") })
        parts.push([`run [${args.join(" ")}]`, run(was), run(is)])
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
