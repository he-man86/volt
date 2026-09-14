/**
 * Project-level dead-code detection (Layer D). A top-level POU (FUNCTION_BLOCK / FUNCTION / PROGRAM)
 * that is structurally unreachable from any PROGRAM entry point — and not kept live by a global
 * instance or interface dispatch — is "dead". When `diagnoseDeadCode` is off (the default), the
 * server suppresses diagnostics on dead units, matching the compiler, which never checks code it
 * doesn't compile.
 *
 * SAFETY INVARIANT: any uncertainty resolves to LIVE. A possibly-reachable unit is never reported
 * dead, so a real error is never hidden. Concretely: an FB implementing a referenced interface is
 * live (dynamic dispatch), a type/pointer reference keeps its target live, and a project with no
 * PROGRAM at all (a library) marks nothing dead.
 *
 * ponytail: reachability edges are a plain identifier scan — a token naming a unit IS an edge —
 * not a resolved call/instantiation graph. That over-connects (comments/strings aside, the lexer
 * drops those), which is exactly the safe direction here. Upgrade to a resolved graph only if the
 * corpus shows a dead unit staying live because of a coincidental name collision.
 */
import {
  lex,
  type Function,
  type FunctionBlock,
  type ParseResult,
  type Program,
  type Span,
  type TopLevel,
} from "../syntax/index.js"

export interface ReachabilityInput {
  uri: string
  source: string
  parseResult: ParseResult
}

/** Per top-level unit: the lex-derived facts the member-reachability pass needs. */
interface UnitInfo {
  name: string // lc
  kind: TopLevel["kind"]
  span: Span
  isPou: boolean
  refs: Set<string> // identifiers (lc) appearing inside this unit's span
}

/**
 * ALL lex-derived facts about ONE file — the ONLY expensive (source-scanning) part of dead-code analysis.
 * Extracted so the server can MEMOIZE it per parsed document: on a keystroke, only the edited file is
 * re-scanned; the other N-1 files' infos are reused, instead of re-lexing the whole project every edit.
 * A pure function of `(source, parseResult)`, so caching by document identity is sound.
 */
export interface FileReachInfo {
  uri: string
  owner?: string // primary POU (lc), if any
  root: boolean // GVL/type file — always active
  refs: Set<string> // every identifier (lc) in the file (deadPous edges)
  pous: string[] // POU names (lc) this file declares (namespaces flattened)
  programs: string[] // PROGRAM names (lc)
  implementers: [string, string[]][] // interface(lc) → implementing FBs(lc)
  ifaceMethods: string[] // interface method names (lc) declared at top level
  units: UnitInfo[] // top-level units, for member reachability
}

type Pou = Program | FunctionBlock | Function

const isPou = (u: TopLevel): u is Pou =>
  u.kind === "program" || u.kind === "function_block" || u.kind === "function"

/** The lowercased name of a file's primary POU (FB/FUNCTION/PROGRAM), or undefined for a non-POU file
 *  (interface / GVL / type / library signature). One-item-per-file: this is the unit that owns every
 *  diagnostic in the document, so the server suppresses the whole file when this name is dead. */
export function ownerPou(parseResult: ParseResult): string | undefined {
  return firstPou(parseResult.units)?.name.text.toLowerCase()
}

function firstPou(units: readonly TopLevel[]): Pou | undefined {
  for (const u of units) {
    if (isPou(u)) return u
    if (u.kind === "namespace") {
      const inner = firstPou(u.units)
      if (inner !== undefined) return inner
    }
  }
  return undefined
}

/**
 * Lowercased names of every dead top-level POU across the workspace. Conservative: uncertain ⇒ live.
 *
 * `taskRoots` (lowercased PROGRAM names from the `.task` `Calls:` lines) are the entry points CODESYS
 * actually runs. When supplied and at least one matches a real PROGRAM, ONLY those seed reachability — so a
 * PROGRAM not assigned to any task (its call commented out / "moved elsewhere") is correctly dead. Absent or
 * non-matching (a library, or a project whose task config wasn't loaded) ⇒ fall back to ALL PROGRAMs as
 * roots, preserving the uncertain-⇒-live safety.
 */
/**
 * Extract every lex-derived fact about one file (the expensive, memoizable step). One lexer pass feeds both
 * `deadPous` (whole-file identifier set) and `deadMemberSpans` (per-unit identifier buckets).
 */
export function fileReachInfo(file: ReachabilityInput): FileReachInfo {
  const { source, parseResult, uri } = file
  const refs = new Set<string>()
  const ordered = [...parseResult.units].filter((u) => "span" in u).sort((a, b) => a.span.start - b.span.start)
  const buckets = new Map<TopLevel, Set<string>>()
  for (const u of ordered) buckets.set(u, new Set())
  let ui = 0
  for (const tok of lex(source)) {
    if (tok.kind !== "identifier") continue
    const lc = tok.text.toLowerCase()
    refs.add(lc)
    while (ui < ordered.length && ordered[ui]!.span.end <= tok.span.start) ui++
    if (ui < ordered.length && ordered[ui]!.span.start <= tok.span.start) buckets.get(ordered[ui]!)!.add(lc)
  }

  const pous = new Set<string>()
  const programs: string[] = []
  const implementers = new Map<string, string[]>()
  catalog(parseResult.units, pous, programs, implementers)

  const ifaceMethods: string[] = []
  for (const u of parseResult.units)
    if (u.kind === "interface") for (const m of u.methods) ifaceMethods.push(m.name.text.toLowerCase())

  const units: UnitInfo[] = parseResult.units.map((u) => ({
    name: "name" in u && u.name !== undefined ? u.name.text.toLowerCase() : "",
    kind: u.kind,
    span: u.span,
    isPou: isPou(u),
    refs: buckets.get(u) ?? new Set<string>(),
  }))

  const owner = ownerPou(parseResult)
  return {
    uri,
    owner,
    root: owner === undefined && hasRootDecl(parseResult.units),
    refs,
    pous: [...pous],
    programs,
    implementers: [...implementers],
    ifaceMethods,
    units,
  }
}

/** Dead POUs from pre-extracted per-file infos (the graph fixpoint only — no lexing). */
export function deadPousFromInfos(infos: readonly FileReachInfo[], taskRoots?: ReadonlySet<string>): Set<string> {
  const pous = new Set<string>() // lc names of all top-level POUs
  const programs: string[] = [] // lc names of PROGRAM roots
  const implementers = new Map<string, string[]>() // lc interface -> lc FBs implementing it
  const byOwner = new Map<string, FileReachInfo[]>() // owner POU (lc) -> the file(s) it owns

  for (const info of infos) {
    for (const p of info.pous) pous.add(p)
    for (const pr of info.programs) programs.push(pr)
    for (const [iface, fbs] of info.implementers) {
      const list = implementers.get(iface)
      if (list !== undefined) list.push(...fbs)
      else implementers.set(iface, [...fbs])
    }
    if (info.owner !== undefined) {
      const owned = byOwner.get(info.owner)
      if (owned !== undefined) owned.push(info)
      else byOwner.set(info.owner, [info])
    }
  }

  // No entry points ⇒ can't determine reachability (e.g. a library) ⇒ mark nothing dead.
  if (programs.length === 0) return new Set()

  // Roots: the task-assigned PROGRAMs when the task config named at least one real PROGRAM; otherwise every
  // PROGRAM (safe fallback — no task info means we can't rule any out).
  const taskProgramRoots = taskRoots !== undefined ? programs.filter((p) => taskRoots.has(p)) : []
  const roots = taskProgramRoots.length > 0 ? taskProgramRoots : programs

  // Worklist transitive closure (O(edges), not O(iterations × edges)): a file's refs are scanned ONCE — either
  // upfront if it's a root file (GVL/type — always active), or the moment its owner POU becomes reachable. Each
  // ref that names a POU (or an interface, whose implementers go live via dynamic dispatch) is pulled in and its
  // owning file queued. An interface's own `.itf` file is passive — never a root, no owner match — so it's
  // scanned only when a genuinely reachable unit references it. Equivalent to the old fixpoint, without re-scans.
  const reachable = new Set<string>(roots)
  const worklist: string[] = [...roots]
  const scan = (info: FileReachInfo): void => {
    for (const ref of info.refs) {
      if (pous.has(ref) && !reachable.has(ref)) {
        reachable.add(ref)
        worklist.push(ref)
      }
      const impls = implementers.get(ref)
      if (impls !== undefined)
        for (const fb of impls)
          if (!reachable.has(fb)) {
            reachable.add(fb)
            worklist.push(fb)
          }
    }
  }
  for (const info of infos) if (info.root) scan(info) // root files are active from the start
  while (worklist.length > 0) {
    const owned = byOwner.get(worklist.pop()!)
    if (owned !== undefined) for (const info of owned) scan(info)
  }

  const dead = new Set<string>()
  for (const name of pous) if (!reachable.has(name)) dead.add(name)
  return dead
}

/** Dead POUs across the workspace (lexes each file). Convenience wrapper over `fileReachInfo` +
 *  `deadPousFromInfos` for callers that don't cache per-file infos (tests, one-shot analysis). */
export function deadPous(files: readonly ReachabilityInput[], taskRoots?: ReadonlySet<string>): Set<string> {
  return deadPousFromInfos(files.map(fileReachInfo), taskRoots)
}

/**
 * Dead MEMBERS — methods/actions of a LIVE POU that are unreachable from live code (the finer granularity
 * beyond `deadPous`). CODESYS excludes individual methods from build; an excluded method (its calls
 * commented out, "moved elsewhere") forms a closed island referenced only from other excluded members — the
 * compiler skips it, so the LSP must too. Returns each dead member's full declaration span, per URI, for
 * per-diagnostic suppression (a live FB can still contain dead methods).
 *
 * Same fixpoint as `deadPous`, one level down: seed the live refs from each live POU's OWN body (methods
 * are separate top-level units after it), then pull in every member whose name a live node references, and
 * propagate that member's own refs. SAFETY (uncertain ⇒ live): properties (implicit accessors), lifecycle
 * methods (`FB_Init`/`FB_Exit`/`FB_ReInit`, runtime-called), and any method whose name matches an interface
 * method (dynamic dispatch) are ALWAYS live — never reported dead, so a real error in them is never hidden.
 * The identifier scan over-connects (a bare name is an edge), the safe direction here.
 */
export function deadMemberSpans(
  files: readonly ReachabilityInput[],
  deadPouNames: ReadonlySet<string>,
): Map<string, Span[]> {
  return deadMemberSpansFromInfos(files.map(fileReachInfo), deadPouNames)
}

/** Dead member spans from pre-extracted per-file infos (the graph fixpoint only — no lexing). */
export function deadMemberSpansFromInfos(
  infos: readonly FileReachInfo[],
  deadPouNames: ReadonlySet<string>,
): Map<string, Span[]> {
  const LIFECYCLE = new Set(["fb_init", "fb_exit", "fb_reinit"])
  const ifaceMethods = new Set<string>()
  for (const info of infos) for (const m of info.ifaceMethods) ifaceMethods.add(m)

  interface MemberNode {
    uri: string
    name: string
    span: Span
    refs: ReadonlySet<string>
    live: boolean
  }
  const members: MemberNode[] = []
  const liveRefs = new Set<string>() // identifier names (lc) referenced by live code

  for (const info of infos) {
    if (info.owner !== undefined && deadPouNames.has(info.owner)) continue // whole file already suppressed
    for (const u of info.units) {
      const refs = u.refs
      if (u.isPou) {
        for (const r of refs) liveRefs.add(r) // the owner POU's own body seeds the live set
        continue
      }
      if (u.kind !== "method" && u.kind !== "action" && u.kind !== "property") continue
      const name = u.name
      const whitelisted = u.kind === "property" || LIFECYCLE.has(name) || ifaceMethods.has(name)
      if (whitelisted) for (const r of refs) liveRefs.add(r)
      members.push({ uri: info.uri, name, span: u.span, refs, live: whitelisted })
    }
  }

  // Worklist closure (O(members + refs), not O(iterations × members)): a member goes live when its name enters
  // liveRefs; activating it adds its own refs, which may activate more. Index members by name so each new live
  // ref activates only the members it names, instead of re-scanning every member each round.
  const byName = new Map<string, MemberNode[]>()
  for (const m of members) {
    const list = byName.get(m.name)
    if (list !== undefined) list.push(m)
    else byName.set(m.name, [m])
  }
  const worklist: string[] = [...liveRefs]
  while (worklist.length > 0) {
    const nodes = byName.get(worklist.pop()!)
    if (nodes === undefined) continue
    for (const m of nodes) {
      if (m.live) continue
      m.live = true
      for (const r of m.refs)
        if (!liveRefs.has(r)) {
          liveRefs.add(r)
          worklist.push(r)
        }
    }
  }

  const out = new Map<string, Span[]>()
  for (const m of members)
    if (!m.live) {
      const arr = out.get(m.uri)
      if (arr !== undefined) arr.push(m.span)
      else out.set(m.uri, [m.span])
    }
  return out
}

/** True when `span` falls inside any of a file's dead-member spans — the per-diagnostic suppression test. */
export function inDeadMember(span: Span, deadSpans: readonly Span[] | undefined): boolean {
  if (deadSpans === undefined) return false
  for (const d of deadSpans) if (span.start >= d.start && span.start < d.end) return true
  return false
}

/** A file with no POU is an always-active root iff it declares a global (GVL) or a type — either can
 *  hold/name an FB instance and so keeps its target live. A pure interface file is NOT a root. */
function hasRootDecl(units: readonly TopLevel[]): boolean {
  for (const u of units) {
    if (u.kind === "global_var_list" || u.kind === "type_decl") return true
    if (u.kind === "namespace" && hasRootDecl(u.units)) return true
  }
  return false
}

/** Flatten namespaces and record every top-level POU, PROGRAM root, and interface-implementer edge. */
function catalog(
  units: readonly TopLevel[],
  pous: Set<string>,
  programs: string[],
  implementers: Map<string, string[]>,
): void {
  for (const u of units) {
    if (u.kind === "namespace") {
      catalog(u.units, pous, programs, implementers)
      continue
    }
    if (!isPou(u)) continue
    const name = u.name.text.toLowerCase()
    pous.add(name)
    if (u.kind === "program") programs.push(name)
    if (u.kind === "function_block" && u.implements !== undefined) {
      for (const iface of u.implements) {
        const key = iface.text.toLowerCase()
        const list = implementers.get(key)
        if (list !== undefined) list.push(name)
        else implementers.set(key, [name])
      }
    }
  }
}
