/**
 * THE WIRES OF A PLAIN-ST NETWORK BODY (openspec network-text-st 2.3, network-output-member; `_plain-st.ts`, the one
 * network check, holds the rest): a name on its network's `%WIRES` line is defined once — `w := <box>`, or an Execute
 * box's `ENO => w` — and read by its name any number of times, before its definition too; an Execute box read once
 * through its wire stands directly before the statement that reads it and defines no other wire; a box's output reaches
 * no wire; an enabled box other than a comparison is read by its value only as a coil's value, however often its wire is
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

/** A wire an Execute box defines through its ENO: its statement's index, its call, its pin. */
type CallWire = { index: number; call: CallExpr; pin: string }

/** A read of a wire: its statement's index, where it stands, whether it is a coil's whole value (an assignment to no
 * wire), and whether it is a wire definition statement's whole value (`w2 := w1;`). */
type WireRead = { index: number; span: Span; assignValue: boolean; wireDefValue: boolean }

/** What the walk of a body's statements learns about its wires. */
interface WireTally {
  wireOf: Map<string, { network: PlainStNetwork; span: Span }>
  defined: Map<string, { at: number }>
  reads: Map<string, number>
  byCall: Map<string, CallWire>
  readAt: Map<string, WireRead[]>
  early: { key: string; span: Span; name: string }[]
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
  const tally: WireTally = { wireOf: new Map(), defined: new Map(), reads: new Map(), byCall: new Map(), readAt: new Map(), early: [], enOnlyWires: new Map() }
  for (const n of networks) for (const w of n.wires) if (!tally.wireOf.has(w.name.toLowerCase())) tally.wireOf.set(w.name.toLowerCase(), { network: n, span: w.span })
  let index = -1
  for (const stmt of statements) if (!inExecute(stmt.span)) statementWires(stmt, ++index, tally, of, scope, project, out)
  checkCallWires(tally, out)
  for (const [key, name] of tally.enOnlyWires) for (const r of tally.readAt.get(key) ?? []) if (!r.assignValue) emitEnabledValue(out, r.span, name)
  // A wire may be read before its definition (the value it held), except the one an Execute box read once defines: that
  // read is the box itself, which stands directly before it.
  for (const e of tally.early)
    if (tally.byCall.has(e.key) && tally.reads.get(e.key) === 1) emit(out, e.span, CODE, `the wire ${e.name} is read before it is defined`)
  for (const [key, wire] of tally.wireOf)
    if (!tally.defined.has(key)) emit(out, wire.span, CODE, `the wire ${key} is named and never defined`)
}

/** One statement's definitions and reads of wires. */
function statementWires(
  stmt: Statement,
  index: number,
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
    else t.defined.set(key, { at: target.span.start })
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
        const execute = stmt.kind === "call_stmt" && stmt.call === x && calleeName(x).toUpperCase() === "EXECUTE"
        for (const a of x.args) if (a.output && a.value !== undefined) {
          define(a.value)
          targets.add(a.value)
          if (execute && isWire(a.value)) t.byCall.set((a.value as { name: string }).name.toLowerCase(), { index, call: x, pin: a.param?.name ?? "" })
          else if (isWire(a.value)) {
            const wire = (a.value as { name: string }).name
            emit(out, a.value.span, CODE, `the call ${calleeName(x)} wires its output ${a.param?.name ?? ""} to the wire ${wire}: a wire is defined by \`${wire} := <box>\`, its box closed by the output it reads`)
          }
        }
      }
      if (x.kind !== "ident_expr" || targets.has(x)) return
      const key = x.name.toLowerCase()
      const wire = t.wireOf.get(key)
      if (wire === undefined) return
      t.reads.set(key, (t.reads.get(key) ?? 0) + 1)
      t.readAt.set(key, [...(t.readAt.get(key) ?? []), { index, span: x.span, assignValue: assignValues.has(x), wireDefValue: x === wireDefValue }])
      if (of(x.span) !== wire.network) emit(out, x.span, CODE, `the wire ${x.name} is read outside its network: a wire is its network's`)
      const d = t.defined.get(key)
      if (d === undefined || d.at > x.span.start) t.early.push({ key, span: x.span, name: x.name })
    })
}

/** The wires Execute boxes define: one read once stands directly before its reader and defines no other wire. */
function checkCallWires(t: WireTally, out: DiagnosticItem[]): void {
  // An Execute box read once through its wire is the box itself, standing where it is read: only other such boxes stand
  // between it and the statement that reads it, so the text runs it where the network does.
  const readOnce = (key: string) => (t.reads.get(key) ?? 0) === 1
  const runCalls = new Set([...t.byCall].filter(([key]) => readOnce(key)).map(([, c]) => c.index))
  for (const [key, c] of t.byCall) {
    const name = calleeName(c.call)
    if (!readOnce(key)) continue
    const r = t.readAt.get(key)![0]!
    if (r.index > c.index)
      for (let k = c.index + 1; k < r.index; k++)
        if (!runCalls.has(k)) {
          emit(out, c.call.span, CODE, `the call ${name} defines the wire ${key}, read once, and does not stand directly before the statement that reads it: a box read once stands where it is read`)
          break
        }
    // `w2 := w1;` over a box read once through w1 is the box defining w2: the box names w2 itself, so one model has one text.
    if (r.wireDefValue)
      emit(out, r.span, CODE, `the wire is defined by the box ${name}, read once through the wire ${key}: the box defines the wire itself (${c.pin} => the wire)`)
  }
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
