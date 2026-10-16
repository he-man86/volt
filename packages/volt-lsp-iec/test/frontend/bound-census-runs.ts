/**
 * THE CENSUS'S CROSS-CHECKS — a build's type messages against the stores the front-end types (both ways), a run's
 * recorded values against the types inferred and the folds computed. One concern of `bound-census.ts` (openspec
 * lsp-same-standard 4.4).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Expr,
  parseExprFromTokens,
  lex,
  isTrivia,
  type Dialect,
  allUnits,
  unitBodies,
  isStBody,
} from "../../src/frontend/syntax/index.js"
import { type Scope, scopeForUnit, lookupLocal, lookupMember } from "../../src/frontend/symbols/index.js"
import { inferExprType, renderType } from "../../src/frontend/types/index.js"
import { tally } from "../baseline/baseline.js"
import { storesOf } from "./bound-census-store-units.js"
import { typeKey, type Store } from "./bound-census-stores.js"
import type { BoundCensus } from "./bound-census-untyped.js"
import type { Bound } from "./dumps.js"
import type { FixtureSources } from "./sources.js"

export const RUN = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "conformance", "recordings", "codesys.run.json"), "utf8"),
).tests as Record<string, { values?: Record<string, string> }>

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────────

export const TYPE_MESSAGES: readonly RegExp[] = [
  /^Cannot convert type '(.+)' to type '(.+)'$/,
  /^Implicit conversion from (?:un)?signed Type '(.+)' to (?:un)?signed Type '(.+)' : Possible change of sign$/,
  /^Implicit conversion from '(.+)' to '(.+)': Possible loss of information$/,
]

/** Every message a recorded build holds, lower case — what `dumps.ts` `unparsedIn` asks of an LSP parse error; undefined
 *  when there is no build recording (the push refused the fixture). */
export function vendorSays(build: { diagnostics: readonly { message: string }[] } | undefined): ReadonlySet<string> | undefined {
  return build === undefined ? undefined : new Set(build.diagnostics.map((d) => d.message.toLowerCase()))
}

/** The type a recorded run value is printed as, or undefined when its text does not say. */
function recordedType(value: string): string | undefined {
  const prefixed = /^([A-Za-z_]+)#/.exec(value)
  if (prefixed !== null) return prefixed[1]
  if (value.startsWith("'")) return "STRING"
  if (value.startsWith('"')) return "WSTRING"
  if (value === "TRUE" || value === "FALSE") return "BOOL"
  const enumValue = /^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*$/.exec(value)
  return enumValue === null ? undefined : enumValue[1]
}

/** Does an inferred type print as the recorded one? A string's capacity is not in a printed value; a BIT reads as a BOOL;
 *  an inline enum is `(implicit)` to the front-end and `Implicit_Enum__<POU>` to CODESYS. */
function sameType(recorded: string, inferred: string): boolean {
  const r = typeKey(recorded)
  // the capacity however written — `STRING(5)`, `STRING(n)` (a named length is rendered as written, frontend-conformance 4.6.2)
  const i = typeKey(inferred).replace(/^(W?STRING)\(.*\)$/, "$1")
  if (r === "BOOL") return i === "BOOL" || i === "BIT"
  if (r.startsWith("IMPLICIT_ENUM__")) return i === "(IMPLICIT)"
  return r === i
}

/** A run-recording path as an expression — the run recording is CODESYS's, so lexed as CODESYS. */
export const pathExpr = (path: string): Expr | undefined =>
  parseExprFromTokens(lex(path, "codesys").filter((t) => !isTrivia(t.kind) && t.kind !== "eof"))

export function plcScope(plc: Bound): Scope | undefined {
  const unit = plc.parsed.parseResult.units[0]
  return unit === undefined ? undefined : scopeForUnit(plc.project, unit)
}

export function crossCheckBuildTypes(f: FixtureSources, vendor: Dialect, files: readonly Bound[], c: BoundCensus): void {
  const build = vendor === "codesys" ? f.codesys : f.twincat
  if (build === undefined) return
  const name = f.test.name
  const key = (what: string): string => `build ${vendor}: ${what}`
  const says = vendorSays(build)
  const stores = files.flatMap((b) => storesOf(b, says))
  // each store explains ONE copy of a message: it is used up by the message it explains — but a WARNING the IDE says twice
  // (`Store.warnedTwice`) is used up by its second copy
  const unused = new Set(stores)
  const warnedOnce = new Set<Store>()
  const refused = new Set<Store>()
  // an override whose parameter differs from its base method's: the vendor says the parameter's conversion beside it,
  // "Cannot convert type 'DINT' to type 'INT'" — a signature, not a store (rule H10, `analysis/checks/oop/method-signature`
  // says it; `inh_override_signature_mismatch`, `_section_mismatch`, `_pointer_only`, both vendors)
  const overrides = build.diagnostics.some((d) => /^Interface of overridden method '.+' of base '.+' doesn't match declaration$/.test(d.message))
  const unreadBody = files.some((b) => allUnits(b.parsed.parseResult.units).some((u) => unitBodies(u).some((body) => !isStBody(body))))
  for (const d of build.diagnostics) {
    const m = TYPE_MESSAGES.map((r) => r.exec(d.message)).find((x) => x !== null)
    if (m === undefined || m === null) continue
    tally(c.types, key("type messages recorded"))
    const [x, y] = [typeKey(m[1]), typeKey(m[2])]
    const warning = !m[0].startsWith("Cannot convert")
    const again = warning ? [...warnedOnce].find((s) => s.target === y && s.value.has(x)) : undefined
    if (again !== undefined) {
      warnedOnce.delete(again)
      tally(c.types, key("explained by the inferred types, said twice for an initializer"))
      continue
    }
    const by =
      [...unused].find((s) => s.target === y && s.value.has(x)) ??
      (vendor === "twincat" ? [...unused].find((s) => s.reversedOnTwincat === true && s.target === x && s.value.has(y)) : undefined)
    if (by !== undefined) {
      unused.delete(by)
      if (warning && by.warnedTwice === true) warnedOnce.add(by)
      if (m[0].startsWith("Cannot convert")) refused.add(by)
      tally(c.types, key("explained by the inferred types"))
    } else if (overrides && m[0].startsWith("Cannot convert"))
      tally(c.types, key("explained by an override's parameter (H10)"))
    // a NETWORK body (FBD/LD network text) is no ST the census walks (`storesOf` reads ST bodies): its sinks and boxes are
    // the network checks' (`cc_vg_*`, `ng_sink_type_mismatch`, `network_unnamed_*`). Each such message is NAMED, fixture and
    // text, never one blanket count: the fixture's ST files are read, and a mismatch in one of them must show here as a new
    // entry rather than vanish into the tally (step 4.7.4 review)
    else if (unreadBody)
      tally(c.types, key(`in a fixture with a network body (not ST, which this census reads): ${name}: ${d.message}`))
    else
      c.typeDisagreements.push(
        `${vendor} ${name}: build says ${JSON.stringify(d.message)} — ${
          stores.some((s) => s.target === y && s.value.has(x)) ? "once more than" : "no"
        } store the front-end types ${m[1]} → ${m[2]}`,
      )
  }
  checkRefusedStores(c, vendor, name, build, stores, refused)
}

/** The other way: every store the front-end types not implicitly convertible must be one `build` refused (`refused`, the
 *  stores a recorded "Cannot convert" used up). */
function checkRefusedStores(
  c: BoundCensus,
  vendor: Dialect,
  name: string,
  build: { diagnostics: readonly { message: string }[] },
  stores: readonly Store[],
  refused: ReadonlySet<Store>,
): void {
  const key = (what: string): string => `build ${vendor}: ${what}`
  // a COMPARISON whose operands meet in no type the vendor refuses as one: "Cannot compare type 'BOOL' with type 'INT'"
  // refuses the store of the one operand into their meet (`expr_comparison_chain_same_level`, both vendors,
  // frontend-conformance 2.5)
  const compared = new Set(
    build.diagnostics.flatMap((d) => {
      const m = /^Cannot compare type '(.+)' with type '(.+)'$/.exec(d.message)
      return m === null ? [] : [`${typeKey(m[1]!)}|${typeKey(m[2]!)}`, `${typeKey(m[2]!)}|${typeKey(m[1]!)}`]
    }),
  )
  // the other way: a store the front-end calls not implicitly convertible must be one the vendor refused
  const refusedPairs = new Set(
    build.diagnostics.flatMap((d) => {
      const m = /^Cannot convert type '(.+)' to type '(.+)'$/.exec(d.message)
      return m === null ? [] : [`${typeKey(m[1]!)}|${typeKey(m[2]!)}`]
    }),
  )
  for (const s of stores) {
    if (s.conversion !== "incompatible") continue
    tally(c.types, key("stores typed not implicitly convertible"))
    if (refused.has(s)) tally(c.types, key("stores typed not implicitly convertible, refused"))
    // TwinCAT prints ONE copy of a message per line (`analysis/diagnostics` `dedupePerLine`): a second store of the pair
    // on a line it already refused is refused too (`cb_and_then_bool_and_int`: `ba AND_THEN a` into a BOOL)
    else if (vendor === "twincat" && [...s.value].some((v) => refusedPairs.has(`${v}|${s.target}`)))
      tally(c.types, key("stores typed not implicitly convertible, refused once per line"))
    else if (s.compared !== undefined && compared.has(s.compared))
      tally(c.types, key("stores typed not implicitly convertible, refused as a comparison"))
    else
      c.typeDisagreements.push(
        `${vendor} ${name}: the front-end types a store ${s.printed}, not implicitly convertible — no recorded refusal is left for it`,
      )
  }
}

export function crossCheckRunTypes(f: FixtureSources, plc: Bound, c: BoundCensus): void {
  const name = f.test.name
  const values = RUN[name]?.values
  if (values === undefined) return
  const scope = plcScope(plc)
  for (const [path, value] of Object.entries(values)) {
    tally(c.types, "run: recorded values")
    const recorded = recordedType(value)
    if (recorded === undefined) {
      tally(c.types, "run: value names no type")
      continue
    }
    const expr = pathExpr(path)
    if (expr === undefined || scope === undefined) {
      c.typeDisagreements.push(`${name}: run path ${path} cannot be read in PLC_PRG`)
      continue
    }
    const type = inferExprType(expr, scope, plc.project)
    const inferred = renderType(type)
    // AN ENUM HOLDING A VALUE NO MEMBER NAMES is printed as a literal of its BASE type: `e := 5` leaves `INT#5` where a
    // member prints `E.On` (`prag_enum_not_strict_literal_not_a_member_assign`, `prag_to_string_not_a_member`, CODESYS
    // 2026-10-02) — the printed prefix is the value's representation there, not the variable's type. An enum with no base
    // is INT, so only `INT#…` is its base there; any other prefix is a disagreement.
    if (type.kind === "enum" && recorded === (type.base === undefined ? "INT" : renderType(type.base))) {
      tally(c.types, "run: an enum holding a value no member names, printed as its base type")
      continue
    }
    if (inferred === "?") {
      // a member the instance's FB INHERITS, read through the instance (`inst.baseField`) — counted apart, its owner named,
      // so a measure it would raise says why; rule H2 closed it (task 3.2.3, `infer/member` `lookupMember`: 41 → 0)
      tally(c.types, inheritedThroughInstance(expr, scope, plc.project) ? INHERITED_THROUGH_INSTANCE : "run: path inferred UNKNOWN")
      c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred UNKNOWN`)
    } else if (sameType(recorded, inferred)) tally(c.types, "run: path inferred as recorded")
    else c.typeDisagreements.push(`${name}: run path ${path} is ${recorded}, inferred ${inferred}`)
  }
}

export const INHERITED_THROUGH_INSTANCE = "run: path inferred UNKNOWN, an inherited member through an instance (H2, task 3.2.3)"

/** `inst.m` where `m` is no member of the instance's FB itself but of a base it extends. */
function inheritedThroughInstance(expr: Expr, scope: Scope, project: Scope): boolean {
  if (expr.kind !== "member") return false
  const base = inferExprType(expr.base, scope, project)
  if (base.kind !== "function_block" || base.scope === undefined) return false
  return lookupLocal(base.scope, expr.member.name).length === 0 && lookupMember(base.scope, expr.member.name) !== undefined
}

