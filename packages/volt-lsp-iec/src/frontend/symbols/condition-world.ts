/**
 * THE NAMES A CONDITIONAL PRAGMA MAY ASK, answered from the scope tree (`syntax/pragmas/conditional` `ConditionWorld`):
 * `defined (variable:/type:/pou: …)`, `hasattribute`, `hastype`, `hasconstantvalue`, and the vendor for the operators
 * only CODESYS reads. The device and the project's compile settings are the project's `environment` — what its builder
 * MEASURED, and nothing in the LSP: there a condition on them is refused by name. The conformance harness builds its
 * project with the recording projects' measured environment; the transpiler adds the exec oracle's.
 *
 * One world object per (project, scope) until the project changes (`memoByProject`), so `bodyStatements`' cache sees a
 * new world exactly when an answer may have moved.
 */
import type { Attribute, BodySpan, ConditionNames, ConditionWorld, Expr, TopLevel } from "../syntax/index.js"
import { memoByProject } from "./cache.js"
import type { Scope, Symbol } from "./model.js"
import { dialectOf } from "./scope.js"
import { lookup, scopeForUnit } from "./scope-nav.js"

const VARIABLE_KINDS = new Set(["var", "method_param", "gvl_var"])
const POU_KINDS = new Set(["function", "function_block", "program", "interface", "method", "action"])

const worldsOf = memoByProject(() => new WeakMap<Scope, ConditionWorld>())

/** The world of a body analysed in `scope` of `project`. */
export function conditionWorld(project: Scope, scope: Scope): ConditionWorld {
  const worlds = worldsOf(project)
  let world = worlds.get(scope)
  if (world === undefined) worlds.set(scope, (world = { ...project.environment, dialect: dialectOf(project), names: namesOf(project, scope) }))
  return world
}

/** The world of `body` of `unit`: its own scope (an accessor's), its unit's, or — for a unit whose scope does not resolve —
 *  the project's. For a consumer that walks every body, parsed or not (`parse-errors`). */
export function bodyConditionWorld(project: Scope, unit: TopLevel, body: BodySpan): ConditionWorld {
  const unitScope = scopeForUnit(project, unit)
  return conditionWorld(project, unitScope?.children.find((c) => c.span === body.span) ?? unitScope ?? project)
}

function namesOf(project: Scope, scope: Scope): ConditionNames {
  const symbol = (from: Scope, name: string, kinds: ReadonlySet<string>): Symbol | undefined => {
    const hit = lookup(from, name)?.symbol
    return hit !== undefined && kinds.has(hit.kind) ? hit : undefined
  }
  const variable = (name: string) => symbol(scope, name, VARIABLE_KINDS)
  const pou = (name: string) => symbol(scope, name, POU_KINDS) ?? symbol(project, name, POU_KINDS)
  const attributesOf = (s: Symbol): readonly Attribute[] => ("attributes" in s.ast ? (s.ast.attributes ?? []) : [])
  return {
    variable: (name) => variable(name) !== undefined,
    type: (name) => symbol(project, name, new Set(["type"])) !== undefined,
    pou: (name) => pou(name) !== undefined,
    hasAttribute: (kind, name, attribute) => {
      const s = kind === "pou" ? pou(name) : variable(name)
      return s === undefined ? undefined : attributesOf(s).some((a) => a.name.toLowerCase() === attribute.toLowerCase())
    },
    typeOf: (name) => {
      const t = variable(name)?.typeExpr
      return t?.kind === "named_type" && t.qualifiers === undefined ? t.name.text.toUpperCase() : undefined
    },
    constantValue: (name) => {
      const s = variable(name)
      const init = s?.constant === true && s.ast.kind === "var_decl" ? s.ast.init : undefined
      return integerOf(init)
    },
  }
}

/** A literal integer initializer's value (`5`, `-5`, `INT#5`). */
function integerOf(init: Expr | { kind: string } | undefined): bigint | undefined {
  if (init?.kind === "literal") {
    const value = (init as Extract<Expr, { kind: "literal" }>).value
    return typeof value === "bigint" ? value : undefined
  }
  if (init?.kind === "unary") {
    const u = init as Extract<Expr, { kind: "unary" }>
    const v = u.op === "-" ? integerOf(u.operand) : undefined
    return v === undefined ? undefined : -v
  }
  return undefined
}
