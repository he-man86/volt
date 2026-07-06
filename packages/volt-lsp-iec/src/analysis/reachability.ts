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
import { lex, type Function, type FunctionBlock, type ParseResult, type Program, type TopLevel } from "../syntax/index.js"

export interface ReachabilityInput {
  uri: string
  source: string
  parseResult: ParseResult
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
export function deadPous(files: readonly ReachabilityInput[], taskRoots?: ReadonlySet<string>): Set<string> {
  const pous = new Set<string>() // lc names of all top-level POUs
  const programs: string[] = [] // lc names of PROGRAM roots
  const implementers = new Map<string, string[]>() // lc interface -> lc FBs implementing it

  interface FileInfo {
    owner?: string // primary POU (lc) of this file, if any
    root: boolean // a GVL/type file — always active (a global instance / typed field keeps its target live)
    refs: Set<string> // every identifier (lc) appearing in the file
  }
  const infos: FileInfo[] = []

  for (const f of files) {
    const refs = new Set<string>()
    for (const t of lex(f.source)) if (t.kind === "identifier") refs.add(t.text.toLowerCase())
    catalog(f.parseResult.units, pous, programs, implementers)
    const owner = ownerPou(f.parseResult)
    infos.push({ owner, root: owner === undefined && hasRootDecl(f.parseResult.units), refs })
  }

  // No entry points ⇒ can't determine reachability (e.g. a library) ⇒ mark nothing dead.
  if (programs.length === 0) return new Set()

  // Roots: the task-assigned PROGRAMs when the task config named at least one real PROGRAM; otherwise every
  // PROGRAM (safe fallback — no task info means we can't rule any out).
  const taskProgramRoots = taskRoots !== undefined ? programs.filter((p) => taskRoots.has(p)) : []
  const roots = taskProgramRoots.length > 0 ? taskProgramRoots : programs

  // Fixpoint: seed the PROGRAM roots, then repeatedly pull in POUs referenced by any ACTIVE file, plus
  // the implementers of any interface referenced by an active file (dynamic dispatch ⇒ live). A file is
  // active if it's a root (GVL/type — a global instance or typed field) or a POU whose owner is reachable.
  // An interface's own `.itf` file is NEITHER — passive — so an interface is "used" only when a genuinely
  // reachable unit references it as a type, not merely by its own declaration.
  const reachable = new Set<string>(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const info of infos) {
      const active = info.root || (info.owner !== undefined && reachable.has(info.owner))
      if (!active) continue
      for (const ref of info.refs) {
        if (pous.has(ref) && !reachable.has(ref)) {
          reachable.add(ref)
          changed = true
        }
        const impls = implementers.get(ref)
        if (impls !== undefined) {
          for (const fb of impls)
            if (!reachable.has(fb)) {
              reachable.add(fb)
              changed = true
            }
        }
      }
    }
  }

  const dead = new Set<string>()
  for (const name of pous) if (!reachable.has(name)) dead.add(name)
  return dead
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
