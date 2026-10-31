/**
 * A UNIT'S BODY AS STATEMENTS LOWERING RUNS — or why it cannot be: not ST, not parsed, or a library's declaration with no
 * body written (`bodyOf`). Split from `routines.ts`, every body site's one pipeline.
 */
import type { Lowering } from "../core/lowering.js"
import { type BodySpan, isPlainStNetworkBody, isStBody, type StatementList, type TopLevel } from "../../../frontend/syntax/index.js"
import { networkScope, scopeForUnit } from "../../../frontend/symbols/index.js"
import { execBodyStatements } from "../conditions.js"
import { type HiddenVar, type LoweredNetworks, lowerNetworks } from "../network/network.js"
import { NetworkRefusal } from "../network/ast.js"

/**
 * A LIBRARY CALLABLE DECLARED WITHOUT A BODY — refused, not lowered to a routine that does nothing.
 *
 * A project's libraries are materialized as DECLARATION files: signatures and VAR sections, no statements. The library
 * repo (`libraries/<library>/<version>/`) replaces them with ST bodies for the versions it has written; any other
 * library element is still only its declaration here. `execBodyStatements` answers an empty statement list for that, and an
 * empty routine lowers cleanly — so `t1(IN := TRUE)` would run nothing and `t1.Q` would read FALSE forever. That is an
 * INVENTED meaning rather than a missing one, and it is the same hazard `lowerUnit` already refuses for a graphical
 * body, for the same stated reason.
 *
 * An empty body is legal IEC, so emptiness alone is not the discriminator — PROVENANCE is (`LoweringProject.libraryUnits`).
 * A POU written in the project with no statements genuinely does nothing and must still lower; a library element with
 * no statements is one whose body nobody has written. A library with real source — the repo's — lowers like any POU.
 */
function isBodylessLibrary(lw: Lowering, ast: object, statements: readonly unknown[]): boolean {
  return statements.length === 0 && lw.shared.libraryUnits.has(ast)
}

/** Why a body cannot be lowered: not ST, not parsed, or a library's declaration with no body written. */
export interface BodyRefusal {
  code: "graphical-body" | "parse" | "pragma-undecided" | "call-library" | "network-box" | "network-invalid"
  message: string
}

/** A body as lowering runs it: its statements, and — a network body's — the variables they keep (`network/state.ts`). */
interface LoweredBody {
  statements: StatementList
  hidden?: readonly HiddenVar[]
}

/**
 * THE ONE BODY PIPELINE (transpile-restructure 1.7.7): a unit's ST body as the statements lowering lowers — or why it
 * cannot be. Every body comes through here: a METHOD's, ACTION's and FUNCTION's (`calledRoutine`), a PROPERTY
 * accessor's (`calls/property.ts`), a base body run by `SUPER^()` (`baseBody`), an FB's body at its first call
 * (`calledLayout`), and the POU's own (`entry/lower-unit.ts`). The site reports the refusal its way — a diagnostic, the
 * pending body marked failed, a POU with no IR. `name` names the body in the message; the POU's own body is unnamed
 * (its messages say "body"), and is the one a library's empty declaration is not asked of (`library: false` — a POU is
 * lowered from the project).
 */
export function bodyOf(
  lw: Lowering,
  unit: Parameters<typeof execBodyStatements>[1],
  body: Parameters<typeof isStBody>[0],
  name: string | undefined,
  { library = true, frame }: { library?: boolean; frame?: string } = {},
): LoweredBody | BodyRefusal {
  // A member with no body slot (no %LANGUAGE line, openspec language-line) runs nothing a lowering could run — lowered as
  // an empty ST body, an abstract base calling its own abstract member counted as reach. Named for what it is; the
  // category is the one a hidden body has.
  if (body.noSlot !== undefined)
    return { code: "graphical-body", message: `${name ?? "the body"} has no body slot: it holds no code (no %LANGUAGE line)` }
  if (!isStBody(body)) return { code: "graphical-body", message: name === undefined ? "a body that is not ST is not lowered here" : `${name} has no ST body` }
  const parsed = execBodyStatements(lw.project, unit, body)
  // A body that parses but for a conditional pragma asking what Volt is not given — a project option, a device fact, a
  // compile define — is valid ST CODESYS decides (`prag_if_hasconstanttype`: c 5, out 1) and no recording settles here:
  // `pragma-undecided`. A body that does not parse is `parse` (transpile-refusal-classification 2.1).
  if (!parsed.ok && parsed.errors.length === 0 && parsed.refused !== undefined) return { code: "pragma-undecided", message: parsed.refused }
  if (!parsed.ok) return { code: "parse", message: parsed.firstError ?? (name === undefined ? "body did not parse" : `${name}'s body did not parse`) }
  if (library && isBodylessLibrary(lw, unit, parsed.statements))
    return { code: "call-library", message: `${name ?? "the body"} is a library declaration without a body` }
  if (!isPlainStNetworkBody(body)) return { statements: parsed.statements }
  // plain-ST network text: its boxes (`GT(…)`, `t1(…).Q`, `EXECUTE`) and wires as the ST they run as (`network/`), its
  // hidden state named for the frame it runs in — an ACTION's, a base body's run by `SUPER^()`, after that body
  const owner = frame ?? (unit.kind === "action" ? unit.name.text : undefined)
  const lowered = networksOf(lw, unit, body, parsed.statements, owner === undefined ? "__nw" : `__nw_${owner}_`)
  return lowered instanceof NetworkRefusal ? { code: lowered.code, message: lowered.message } : lowered
}

/** One lowering of a network body per statement list and prefix: lowering keys maps on the nodes it lowers. */
const lowerings = new WeakMap<StatementList, Map<string, LoweredNetworks | NetworkRefusal>>()

function networksOf(lw: Lowering, unit: TopLevel, body: BodySpan, statements: StatementList, prefix: string): LoweredNetworks | NetworkRefusal {
  let byPrefix = lowerings.get(statements)
  if (byPrefix === undefined) lowerings.set(statements, (byPrefix = new Map()))
  let lowered = byPrefix.get(prefix)
  if (lowered === undefined) {
    // the scope the body resolves in: its unit's (an accessor's own), the body's wires over it (`symbols` `network-scope.ts`)
    const unitScope = scopeForUnit(lw.project, unit)
    if (unitScope === undefined) return new NetworkRefusal("the network body's unit has no scope")
    const scope = networkScope(unitScope.children.find((c) => c.span === body.span) ?? unitScope, body)
    try {
      lowered = lowerNetworks(body, statements, scope, lw.project, prefix)
    } catch (e) {
      if (!(e instanceof NetworkRefusal)) throw e
      lowered = e
    }
    byPrefix.set(prefix, lowered)
  }
  return lowered
}
