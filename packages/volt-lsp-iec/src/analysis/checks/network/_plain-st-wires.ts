/**
 * THE WIRES OF A PLAIN-ST NETWORK BODY (openspec network-text-st 2.3, network-output-member; `_plain-st.ts`, the one
 * network check, holds the rest): a name on its network's `%WIRES` line is defined once — `w := <box>` — and read by its
 * name any number of times, before its definition too; a box's output reaches no wire; an enabled box other than a comparison is read by its value only as a coil's value, however often its wire is
 * read (CODESYS: "A box with EN can be used for comparison operators only."). Refused by name, as the bridge's reader
 * refuses it (`StNetworkReader`).
 */
import { type CallExpr, type Expr, type PlainStNetwork, type Span, type Statement, stmtExprs, walkExpr } from "../../../frontend/syntax/index.js"
import { type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, declaresEn, networkBox } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export const CODE = "network-plain-st"

/** The comparison boxes: the only enabled boxes CODESYS reads by their value inside another box (1.4). */
const COMPARISONS: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

/** A read of a wire: where it stands, and whether it is a coil's whole value (an assignment to no wire). */
type WireRead = { span: Span; assignValue: boolean }

/** What the walk of a body's statements learns about its wires. */
interface WireTally {
  wireOf: Map<string, { network: PlainStNetwork; span: Span }>
  defined: Set<string>
  readAt: Map<string, WireRead[]>
  /** The wires whose definition's whole value is an enabled box other than a comparison read by its value. */
  enOnlyWires: Map<string, string>
}

/** Each wire defined once, before it is read, in its own network; an expression's wire read twice or more. */
export function checkWires(
  statements: readonly Statement[],
  networks: readonly PlainStNetwork[],
  of: (span: Span) => PlainStNetwork | undefined,
  inExecute: (span: Span) => boolean,
  scope: Scope | undefined,
  project: Scope,
  out: DiagnosticItem[],
): void {
  const tally: WireTally = { wireOf: new Map(), defined: new Set(), readAt: new Map(), enOnlyWires: new Map() }
  for (const n of networks) for (const w of n.wires) if (!tally.wireOf.has(w.name.toLowerCase())) tally.wireOf.set(w.name.toLowerCase(), { network: n, span: w.span })
  for (const stmt of statements) if (!inExecute(stmt.span)) statementWires(stmt, tally, of, scope, project, out)
  for (const [key, name] of tally.enOnlyWires) for (const r of tally.readAt.get(key) ?? []) if (!r.assignValue) emitEnabledValue(out, r.span, name)
  for (const [key, wire] of tally.wireOf)
    if (!tally.defined.has(key)) emit(out, wire.span, CODE, `the wire ${key} is named and never defined`)
}

/** One statement's definitions and reads of wires. */
function statementWires(
  stmt: Statement,
  t: WireTally,
  of: (span: Span) => PlainStNetwork | undefined,
  scope: Scope | undefined,
  project: Scope,
  out: DiagnosticItem[],
): void {
  const isWire = (e: Expr) => e.kind === "ident_expr" && t.wireOf.has(e.name.toLowerCase())
  const define = (target: Expr) => {
    if (target.kind !== "ident_expr" || !t.wireOf.has(target.name.toLowerCase())) return
    const key = target.name.toLowerCase()
    if (t.defined.has(key)) emit(out, target.span, CODE, `the wire ${target.name} is defined twice`)
    else t.defined.add(key)
  }
  const targets = new Set<Expr>()
  const assignValues = new Set<Expr>()
  let wireDefValue: Expr | undefined
  if (stmt.kind === "assign" && stmt.op === undefined && (stmt.chained ?? []).length === 0 && isWire(stmt.target)) wireDefValue = stmt.value
  else if (stmt.kind === "assign") assignValues.add(stmt.value)
  if (stmt.kind === "assign") {
    if (stmt.op === undefined && (stmt.chained ?? []).length === 0) define(stmt.target)
    else for (const x of [stmt.target, ...(stmt.chained ?? [])])
      if (isWire(x)) emit(out, x.span, CODE, `the wire ${(x as { name: string }).name} is assigned beside other targets or by S=/R=: a wire is defined alone`)
    targets.add(stmt.target)
    for (const c of stmt.chained ?? []) targets.add(c)
  }
  // the calls closed by `.ENO`, the shown ENO: such a box hands on its ENO, not its value. A call closed by any other
  // member (`.OUT`, `.Q`) is still read by a data output, and stands where its member does.
  const closed = new Set<CallExpr>()
  const memberOf = new Map<CallExpr, Expr>()
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind !== "member" || x.base.kind !== "call") return
      memberOf.set(x.base, x)
      if (scope !== undefined && boxMember(x, scope, project)?.eno === true) closed.add(x.base)
    })
  const at = (x: CallExpr): Expr => memberOf.get(x) ?? x
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind === "assign_expr") {
        define(x.target)
        targets.add(x.target)
        if (!isWire(x.target)) assignValues.add(x.value)
      }
      if (x.kind === "call" && !closed.has(x) && enOnlyValue(x, scope, project)) {
        if (at(x) === wireDefValue && stmt.kind === "assign" && stmt.target.kind === "ident_expr") t.enOnlyWires.set(stmt.target.name.toLowerCase(), calleeName(x))
        else if (!assignValues.has(at(x)) && !(stmt.kind === "call_stmt" && stmt.call === x)) emitEnabledValue(out, x.span, calleeName(x))
      }
      if (x.kind === "call") {
        for (const a of x.args) if (a.output && a.value !== undefined) {
          define(a.value)
          targets.add(a.value)
          if (isWire(a.value)) {
            const wire = (a.value as { name: string }).name
            emit(out, a.value.span, CODE, `the call ${calleeName(x)} wires its output ${a.param?.name ?? ""} to the wire ${wire}: a wire is defined by \`${wire} := <box>\`, its box closed by the output it reads`)
          }
        }
      }
      if (x.kind !== "ident_expr" || targets.has(x)) return
      const key = x.name.toLowerCase()
      const wire = t.wireOf.get(key)
      if (wire === undefined) return
      t.readAt.set(key, [...(t.readAt.get(key) ?? []), { span: x.span, assignValue: assignValues.has(x) }])
      if (of(x.span) !== wire.network) emit(out, x.span, CODE, `the wire ${x.name} is read outside its network: a wire is its network's`)
    })
}

function emitEnabledValue(out: DiagnosticItem[], span: Span, name: string): void {
  emit(out, span, CODE, `the enabled box ${name} is read by its value where it is no coil's value: a box with EN can be used for comparison operators only (CODESYS), and any other is read by its value only as a coil's value`)
}

/** Is `call` an enabled function box other than a comparison — `EN :=` its shown EN, no FB? Not closed by `.ENO`
 *  (`checkWires`), it is read by its value or a data output, which CODESYS reads only as a coil's value. */
function enOnlyValue(call: CallExpr, scope: Scope | undefined, project: Scope): boolean {
  if (scope === undefined || COMPARISONS.has(calleeName(call).toUpperCase())) return false
  const box = networkBox(call, scope, project)
  return box !== undefined && box.instance === undefined && box.enable !== undefined && !declaresEn(box.signature)
}

function calleeName(call: CallExpr): string {
  return call.callee.kind === "ident_expr" ? call.callee.name : ""
}
