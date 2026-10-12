/**
 * THE RUSTC CACHE'S STORE — looking an entry up, storing one (the executable placed by link or copy), and the ledger that
 * bounds the cache's size (pruning). One concern of `rustc-cache.ts` (openspec lsp-same-standard 4.4).
 */
import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, utimes, rm, link, copyFile, mkdir, writeFile, rename, appendFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { type RustBuild, type Entry, FORMAT, concretePaths, fault } from "./rustc-cache.js"

/** A present entry that cannot be read back whole is CORRUPT: reported, removed, and a miss. */
export async function lookup(root: string, key: string, file: string, exe: string): Promise<{ build: RustBuild; entry: Entry } | undefined> {
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

export async function store(root: string, key: string, entry: Entry, exe: string | undefined): Promise<void> {
  const tmp = join(root, `.tmp-${randomBytes(8).toString("hex")}`)
  await mkdir(tmp, { recursive: true })
  let bytesOut: number | undefined
  try {
    if (exe !== undefined) {
      const bytes = await readFile(exe)
      bytesOut = bytes.byteLength
      entry.exe = createHash("sha256").update(bytes).digest("hex")
      // EXECUTABLE ON POSIX: a hit hard-links (or copies, which keeps the mode) THIS file to the caller's `exe`, so
      // its mode is the hit's mode — written with the default 0666 & ~umask, every hit was spawned to EACCES on
      // Linux. Windows has no execute bit and ignores the mode, which is why it passed there.
      await writeFile(join(tmp, "out.bin"), bytes, { mode: 0o755 })
    }
    const json = JSON.stringify(entry)
    await writeFile(join(tmp, "entry.json"), json) // written last: its presence means complete
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
    await appendFile(join(root, LEDGER), `${key} ${Buffer.byteLength(json) + (bytesOut ?? 0)}` + EOL)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** One line per stored entry, `<key> <bytes>`, appended by `store` — what `prune` reads instead of every entry. */
const LEDGER = ".ledger"
const EOL = "\n"

/** The cache's size by its ledger (a key stored twice counts once), or undefined when there is no ledger to read.
 *  An evicted entry stays in it until the next walk: the ledger can only OVERstate the size, which prunes early. */
export async function ledgerSize(root: string): Promise<number | undefined> {
  let raw: string
  try {
    raw = await readFile(join(root, LEDGER), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const sizes = new Map<string, number>()
  for (const line of raw.split(EOL)) {
    const [key, size] = line.split(" ")
    if (key && size !== undefined) sizes.set(key, Number(size))
  }
  let total = 0
  for (const n of sizes.values()) total += n
  return total
}

const pruned = new Map<string, Promise<void>>()
/** Once per process and root: past the cap, the least recently used entries go until it is at 3/4 of it. */
export function prune(root: string): Promise<void> {
  let p = pruned.get(root)
  if (p === undefined) pruned.set(root, (p = pruneNow(root)))
  return p
}
async function pruneNow(root: string): Promise<void> {
  const cap = Number(process.env.VOLT_RUSTC_CACHE_MAX_MB ?? 4096) * 1024 * 1024
  await mkdir(root, { recursive: true })
  const names = await readdir(root)
  for (const name of names)
    if (name.startsWith(".tmp-")) {
      // a writer that died mid-store; a live one finishes in well under an hour
      const dir = join(root, name)
      if (Date.now() - (await stat(dir)).mtimeMs > 3_600_000) await rm(dir, { recursive: true, force: true })
    }
  const recorded = await ledgerSize(root)
  if (recorded !== undefined && recorded <= cap) return
  // no ledger (a cache older than it) or past the cap: the walk measures every entry and rewrites the ledger
  const entries: { key: string; dir: string; used: number; size: number }[] = []
  for (const name of names) {
    if (name.startsWith(".")) continue
    const dir = join(root, name)
    let size = 0
    let used = 0
    try {
      for (const f of await readdir(dir)) {
        const s = await stat(join(dir, f))
        size += s.size
        if (f === "entry.json") used = s.mtimeMs
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue // evicted by another process meanwhile
      throw error
    }
    entries.push({ key: name, dir, used, size })
  }
  let total = entries.reduce((n, e) => n + e.size, 0)
  const kept = new Set(entries)
  if (total > cap)
    for (const e of [...entries].sort((a, b) => a.used - b.used)) {
      if (total <= cap * 0.75) break
      await rm(e.dir, { recursive: true, force: true })
      kept.delete(e)
      total -= e.size
    }
  const tmp = join(root, `${LEDGER}.${randomBytes(4).toString("hex")}`)
  await writeFile(tmp, [...kept].map((e) => `${e.key} ${e.size}` + EOL).join(""))
  await rename(tmp, join(root, LEDGER))
}
