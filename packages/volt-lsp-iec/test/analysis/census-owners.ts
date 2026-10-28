/**
 * THE CENSUS'S ROWS AND BUILDERS — every registry check with the file that defines it, which checks can emit each message
 * builder (resolved through the helpers that call it), and the builders wrapped to remember which produced a text. One
 * concern of `census.ts` (openspec lsp-same-standard 4.4).
 */
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { CHECK_REGISTRY, messagesFor, type Messages, type Vendor } from "../../src/analysis/index.js"
import { PACKAGE, normMessage } from "../frontend/sources.js"

export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]
/** The network-text pass — outside the registry while design.md §3 is parked, and the one census row with no entry. */
export const NETWORK_ROW = "network-text"
/** A finding whose text no builder produced: the parser's own wording (in `parse-errors`) or a check's inline text. */
export const PARSER = "(parser)"
export const INLINE = "(inline)"

// ─── the registry, by file ───────────────────────────────────────────────────────────────────────────────────

export interface RegistryRow {
  /** The check function's name — the registry entry. */
  check: string
  /** Its folder under `src/analysis/checks/` (`network` for the network-text row). */
  group: string
  /** Package-relative, slash-separated. */
  file: string
}

const CHECKS_DIR = join(PACKAGE, "src", "analysis", "checks")
const NETWORK_FILE = join(PACKAGE, "src", "analysis", "checks", "network", "_plain-st.ts")
const portable = (path: string): string => relative(PACKAGE, path).split(sep).join("/")
const walkTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walkTs(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : []
  })

let rowsCache: RegistryRow[] | undefined
/** Every registry entry with the file that defines it, plus the network-text row. A check defined in no file, or in two, throws. */
export function registryRows(): RegistryRow[] {
  if (rowsCache !== undefined) return rowsCache
  const files = walkTs(CHECKS_DIR).map((path) => ({ path, text: readFileSync(path, "utf8") }))
  const rows = CHECK_REGISTRY.map((check): RegistryRow => {
    const where = files.filter((f) => new RegExp(`export function ${check.name}\\(`).test(f.text))
    if (where.length !== 1) throw new Error(`registry check ${check.name} is defined in ${where.length} files under src/analysis/checks`)
    const file = portable(where[0]!.path)
    return { check: check.name, group: file.split("/")[3]!, file }
  })
  rowsCache = [...rows, { check: NETWORK_ROW, group: "network", file: portable(NETWORK_FILE) }]
  return rowsCache
}

/**
 * One top-level declaration of a source file (a declaration starts at column 0) — the unit a call is resolved to. The
 * file's preamble (its imports) is no segment.
 */
interface Segment {
  file: string
  name: string
  text: string
}
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|class\s+|interface\s+|type\s+|enum\s+)([A-Za-z_$][\w$]*)/
function segmentsOf(file: string, text: string): Segment[] {
  const out: Segment[] = []
  let current: Segment | undefined
  for (const l of text.split("\n")) {
    const m = DECLARATION.exec(l)
    if (m !== null) {
      current = { file, name: m[1], text: "" }
      out.push(current)
    }
    if (current !== undefined) current.text += l + "\n"
  }
  return out
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * WHICH CHECKS CAN EMIT EACH BUILDER — the static half of "which check owns this message", resolved THROUGH the helpers
 * that call a builder on a check's behalf (`rules.ts` `conversionWarning` gives `narrowing` for three checks). Every
 * top-level declaration in `src/analysis/**` and the network-text file that calls `.<builder>(` is a source; a
 * declaration belongs to the rows its file defines (a check file's local helper to that file's checks, the network file
 * to the network-text row), and to the rows of every declaration that refers to it — in its own file, or in a file that
 * imports it by name. `messages/`, which defines the builders, calls none.
 */
let ownersCache: Map<string, Set<string>> | undefined
export function builderOwners(): Map<string, Set<string>> {
  if (ownersCache === undefined) {
    const builders = builderNames()
    const rowsOfFile = new Map<string, Set<string>>()
    for (const r of registryRows()) rowsOfFile.set(r.file, (rowsOfFile.get(r.file) ?? new Set<string>()).add(r.check))
    const files = walkTs(join(PACKAGE, "src", "analysis"))
      .filter((p) => !p.includes(`${sep}messages${sep}`))
      .map((p) => ({ file: portable(p), text: readFileSync(p, "utf8") }))
    const imports = new Map(files.map((f) => [f.file, (f.text.match(/^import[\s\S]*?from\s+["'][^"']+["']/gm) ?? []).join("\n")]))
    const segments = files.flatMap((f) => segmentsOf(f.file, f.text))
    const callersMemo = new Map<Segment, Segment[]>()
    const callers = (seg: Segment): Segment[] => {
      const hit = callersMemo.get(seg)
      if (hit !== undefined) return hit
      const ref = new RegExp(`(?<![\\w$.])${escapeRe(seg.name)}(?![\\w$])`)
      const named = new RegExp(`(?<![\\w$])${escapeRe(seg.name)}(?![\\w$])`)
      const found = segments.filter(
        (c) => c !== seg && (c.file === seg.file || named.test(imports.get(c.file)!)) && ref.test(c.text),
      )
      callersMemo.set(seg, found)
      return found
    }
    // every row one declaration reaches: its own file's, and those of every declaration that refers to it, transitively
    const reach = (from: Segment): Set<string> => {
      const rows = new Set<string>()
      const seen = new Set<Segment>([from])
      const queue = [from]
      for (let seg = queue.shift(); seg !== undefined; seg = queue.shift()) {
        for (const r of rowsOfFile.get(seg.file) ?? []) rows.add(r)
        for (const c of callers(seg))
          if (!seen.has(c)) {
            seen.add(c)
            queue.push(c)
          }
      }
      return rows
    }
    const owners = new Map(builders.map((b) => [b, new Set<string>()]))
    for (const seg of segments)
      for (const b of builders) if (new RegExp(`\\.${b}\\(`).test(seg.text)) for (const r of reach(seg)) owners.get(b)!.add(r)
    ownersCache = owners
  }
  return new Map([...ownersCache].map(([b, s]) => [b, new Set(s)]))
}

// ─── builder attribution ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `messagesFor(vendor)`, each builder wrapped to remember which builder produced each text — per WINDOW: `take()` hands
 * over what was produced since the last `take()` and forgets it. A window is one check's run on one document (or the
 * network pass on one), so a finding is attributed only to a builder its own emitter called, never to one some earlier
 * fixture happened to call with the same wording (the parser's own "Expression expected instead of …" among them).
 */
export function recordingMessages(vendor: Vendor): { messages: Messages; take: () => Map<string, string> } {
  const base = messagesFor(vendor) as unknown as Record<string, unknown>
  let builderOf = new Map<string, string>()
  const wrapped: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== "function") throw new Error(`messagesFor(${vendor}).${name} is no builder`)
    wrapped[name] = (...args: unknown[]) => {
      const text = (value as (...a: unknown[]) => unknown)(...args)
      if (typeof text === "string") builderOf.set(text, name)
      return text
    }
  }
  const take = (): Map<string, string> => {
    const window = builderOf
    builderOf = new Map<string, string>()
    return window
  }
  return { messages: wrapped as unknown as Messages, take }
}

export const builderNames = (): string[] => Object.keys(messagesFor("codesys"))

/** A message's shape: normalized as the corpus gate normalizes, every quoted part as `'…'`. */
export const shapeOf = (message: string): string => normMessage(message).replace(/'[^']*'/g, "'…'")

/** Each builder's text with every argument a wildcard — skipped when what is left is too little to name a message. */
export function placeholderPatterns(vendor: Vendor): [string, RegExp][] {
  const out: [string, RegExp][] = []
  const marker = (i: number) => `\u0001${i}\u0001`
  for (const [name, fn] of Object.entries(messagesFor(vendor) as unknown as Record<string, (...a: unknown[]) => unknown>)) {
    let text: unknown
    try {
      text = fn(...Array.from({ length: Math.max(fn.length, 1) }, (_, i) => marker(i)))
    } catch {
      continue
    }
    if (typeof text !== "string") continue
    const parts = normMessage(text).split(/\u0001\d+\u0001/)
    if (parts.join("").replace(/\s/g, "").length < 12) continue
    out.push([name, new RegExp(`^${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*?")}$`)])
  }
  return out
}
