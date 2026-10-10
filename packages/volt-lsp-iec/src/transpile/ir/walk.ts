/**
 * WALKS OVER THE IR — the one place that knows which nodes a node holds (transpile-restructure design.md §2.2, P1).
 *
 * `childrenOf` is an EXHAUSTIVE switch over the node kinds: a node kind added to the IR fails to compile here until it
 * says what it holds, so no walk can silently skip it. The reflective walks this replaces (`Object.entries` over every
 * key but `type`/`span`/`of`) followed whatever a node happened to carry — a `Type`'s scope included, had the skip list
 * missed one key. Every other walk over the IR is built on `childrenOf`.
 */
import type { IrBinding, IrCopy, IrExpr, IrFreeze, IrInvoke, Place } from "./expr.js"
import type { IrCall, IrLoop, IrStmt } from "./stmt.js"

/** Every node a walk visits: an expression, a statement, a place, and the two binding forms a call carries. */
export type IrNode = IrExpr | IrStmt | Place | IrCopy | IrFreeze

/** A place is the one node without a `kind`: a slot and a path. */
export const isPlace = (n: IrNode): n is Place => !("kind" in n)

/** The nodes `node` holds directly, in evaluation order where it has one. */
export function childrenOf(node: IrNode): IrNode[] {
  if (isPlace(node)) {
    // an image place's address first, then its indices — the order a backend computes the byte address in
    const out: IrNode[] = [...(node.at === undefined ? [] : [node.at]), ...node.path.flatMap((step) => (step.kind === "index" ? [step.index] : []))]
    if (node.guard !== undefined) out.push(node.guard)
    return out
  }
  switch (node.kind) {
    case "const":
    case "fresh":
      return []
    case "load":
    case "address":
      return [node.place]
    case "binary":
      return [node.left, node.right]
    case "unary":
      return [node.operand]
    case "convert":
      return [node.value]
    case "builtin":
      return [...node.args]
    case "invoke":
      return [
        ...(node.instance === undefined ? [] : [node.instance]),
        ...node.inputs,
        ...(node.order ?? []).filter((o): o is IrFreeze => typeof o !== "number"),
        ...node.inouts,
        ...(node.lent ?? []),
      ]
    case "dispatch":
      return [node.tag, ...node.arms.map((a) => a.call)]
    case "select":
      return [node.tag, ...node.arms.map((a) => a.place)]
    case "freeze":
      return [node.temp, node.value]
    case "copy":
      return node.back === undefined ? [node.value] : [node.value, node.back]
    case "assign":
      return [node.target, node.value]
    case "if":
      return [node.cond, ...node.then, ...node.else]
    case "switch":
      return [node.selector, ...node.arms.flatMap((a) => a.body), ...node.else]
    case "loop":
      return [...node.init, ...(node.test === undefined ? [] : [node.test.cond]), ...node.body, ...node.step]
    case "break":
    case "continue":
    case "return":
      return []
    case "call":
      return [node.instance, ...node.inouts, ...(node.lent ?? []), ...(node.bind === undefined ? [] : [node.bind.place])]
    case "eval":
      return [node.value]
    default: {
      const unknown: never = node
      throw new Error(`ir/walk: no children for node ${JSON.stringify((unknown as { kind?: string }).kind)}`)
    }
  }
}

const EXPR_KINDS: ReadonlySet<string> = new Set(["const", "fresh", "load", "binary", "unary", "convert", "builtin", "invoke", "dispatch", "select", "address"])
const STMT_KINDS: ReadonlySet<string> = new Set(["assign", "if", "switch", "loop", "break", "continue", "return", "call", "eval"])
const isExpr = (n: IrNode): n is IrExpr => !isPlace(n) && EXPR_KINDS.has(n.kind)
const isStmt = (n: IrNode): n is IrStmt => !isPlace(n) && STMT_KINDS.has(n.kind)

/** Does `visit` answer true for `root` or any node under it (pre-order, stopping at the first)? A walk that also enters
 *  what a node NAMES — a called routine's body, from the lowering's tables — calls `someNode` again from `visit`. */
export function someNode(root: IrNode | readonly IrNode[], visit: (n: IrNode) => boolean): boolean {
  const stack: IrNode[] = Array.isArray(root) ? [...(root as readonly IrNode[])].reverse() : [root as IrNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (visit(n)) return true
    const children = childrenOf(n)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
  }
  return false
}

/** Every expression under `root`, `root` included, pre-order. */
export function forEachExpr(root: IrNode | readonly IrNode[], f: (e: IrExpr) => void): void {
  someNode(root, (n) => (isExpr(n) && f(n), false))
}

/** Every statement under `root`, `root` included, pre-order. */
export function forEachStmt(root: IrNode | readonly IrNode[], f: (s: IrStmt) => void): void {
  someNode(root, (n) => (isStmt(n) && f(n), false))
}

/** Does any place under `root` (a path's index and a guard included) satisfy `test`? */
export function somePlace(root: IrNode | readonly IrNode[], test: (p: Place) => boolean): boolean {
  return someNode(root, (n) => isPlace(n) && test(n))
}

/**
 * Whether an IR node holds a call — an invoke, an interface dispatch, or an FB instance's body (`call`) — whose place in
 * the evaluation order then shows. `call` BELONGS HERE: running an FB instance's body is a call, as much as an `invoke`
 * of a FUNCTION or METHOD and a `dispatch` through an interface. Leaving it out made `fb-init-program` blind to the
 * plainest case it exists to refuse — a PROGRAM whose FB_Init runs another FB's body lowered with no diagnostic at all,
 * while the same FB_Init calling a METHOD was refused. The expression callers (a FOR limit or step, an invoke's inputs)
 * are unaffected: a `call` is a statement and never appears inside one.
 */
export function holdsCall(root: IrNode | readonly IrNode[]): boolean {
  return someNode(root, (n) => !isPlace(n) && (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call"))
}

/** `node` with every place in it rewritten by `f`, innermost first: a path's indices and a guard are mapped before the
 *  place that holds them. Nothing else changes; a node without a place in it comes back as a copy. `bind`, when given,
 *  then rewrites each call's VAR_IN_OUT binding — a place `f` mapped may become a copy lent for the call. */
export function mapPlaces<T extends IrNode>(node: T, f: (p: Place) => Place, bind?: (b: IrBinding) => IrBinding): T {
  return mapNode(node, f, bind, undefined) as T
}

/** `node` with every expression rewritten by `f`, innermost first: an expression's operands — and a place's indices and
 *  guard — are rewritten before it. Places, statements and everything else are kept (`lower/values/fold.ts` `foldPou`). */
export function mapExprs<T extends IrNode>(node: T, f: (e: IrExpr) => IrExpr, place: (p: Place) => Place = (p) => p): T {
  return mapNode(node, place, undefined, f) as T
}

function mapNode(n: IrNode, f: (p: Place) => Place, bind: ((b: IrBinding) => IrBinding) | undefined, expr: ((e: IrExpr) => IrExpr) | undefined): IrNode {
  const out = mapShallow(n, f, bind, expr)
  return expr !== undefined && isExpr(out) ? expr(out) : out
}

function mapShallow(n: IrNode, f: (p: Place) => Place, bind: ((b: IrBinding) => IrBinding) | undefined, expr: ((e: IrExpr) => IrExpr) | undefined): IrNode {
  const m = <U extends IrNode>(x: U): U => mapNode(x, f, bind, expr) as U
  const bindings = (xs: readonly IrBinding[]): IrBinding[] => xs.map((x) => (bind === undefined ? m(x) : bind(m(x))))
  const ms = <U extends IrNode>(xs: readonly U[]): U[] => xs.map(m)
  if (isPlace(n)) {
    const path = n.path.map((step) => (step.kind === "index" ? { ...step, index: m(step.index) } : step))
    return f({ ...n, ...(n.at === undefined ? {} : { at: m(n.at) }), path, ...(n.guard === undefined ? {} : { guard: m(n.guard) }) })
  }
  switch (n.kind) {
    case "const":
    case "fresh":
    case "break":
    case "continue":
    case "return":
      return { ...n }
    case "load":
    case "address":
      return { ...n, place: m(n.place) }
    case "binary":
      return { ...n, left: m(n.left), right: m(n.right) }
    case "unary":
      return { ...n, operand: m(n.operand) }
    case "convert":
      return { ...n, value: m(n.value) }
    case "builtin":
      return { ...n, args: ms(n.args) }
    case "invoke":
      return {
        ...n,
        ...(n.instance === undefined ? {} : { instance: m(n.instance) }),
        inputs: ms(n.inputs),
        ...(n.order === undefined ? {} : { order: n.order.map((o) => (typeof o === "number" ? o : m(o))) }),
        inouts: bindings(n.inouts),
        ...(n.lent === undefined ? {} : { lent: ms(n.lent) }),
      }
    case "dispatch":
      return { ...n, tag: m(n.tag), arms: n.arms.map((a) => ({ ...a, call: m(a.call) })) }
    case "select":
      return { ...n, tag: m(n.tag), arms: n.arms.map((a) => ({ ...a, place: m(a.place) })) }
    case "freeze":
      return { ...n, temp: m(n.temp), value: m(n.value) }
    case "copy":
      return { ...n, value: m(n.value), ...(n.back === undefined ? {} : { back: m(n.back) }) }
    case "assign":
      return { ...n, target: m(n.target), value: m(n.value) }
    case "if":
      return { ...n, cond: m(n.cond), then: ms(n.then), else: ms(n.else) }
    case "switch":
      return { ...n, selector: m(n.selector), arms: n.arms.map((a) => ({ ...a, body: ms(a.body) })), else: ms(n.else) }
    case "loop":
      return {
        ...n,
        init: ms(n.init),
        ...(n.test === undefined ? {} : { test: { ...n.test, cond: m(n.test.cond) } }),
        body: ms(n.body),
        step: ms(n.step),
      }
    case "call":
      return {
        ...n,
        instance: m(n.instance),
        inouts: bindings(n.inouts),
        ...(n.lent === undefined ? {} : { lent: ms(n.lent) }),
        ...(n.bind === undefined ? {} : { bind: { ...n.bind, place: m(n.bind.place) } }),
      }
    case "eval":
      return { ...n, value: m(n.value) }
    default: {
      const unknown: never = n
      throw new Error(`ir/walk: cannot map node ${JSON.stringify((unknown as { kind?: string }).kind)}`)
    }
  }
}

/** Every statement list a statement holds directly: an IF's two branches, a CASE's arms and ELSE, a loop's init, body
 *  and step. */
export function blocksOf(s: IrStmt): readonly (readonly IrStmt[])[] {
  switch (s.kind) {
    case "if":
      return [s.then, s.else]
    case "switch":
      return [...s.arms.map((a) => a.body), s.else]
    case "loop":
      return [s.init, s.body, s.step]
    default:
      return []
  }
}

/**
 * Does control never come out of the bottom of this statement — a RETURN, an EXIT or a CONTINUE, an IF whose both
 * branches end so, a CASE whose every arm and ELSE do, or a loop nothing leaves (no test, or the constant TRUE, and no
 * EXIT of its own: `cc4_loop_exit_constant`'s WHILE TRUE)? Whatever follows it in its block cannot run, and the printer
 * prints none of it (lean 7.5.11): Rust's `unreachable_code` was right about every such line, and the ST line is dead
 * either way (`stmt_return_midway`, `stmt_exit_inner` ask what it does — nothing).
 */
export function diverges(s: IrStmt): boolean {
  switch (s.kind) {
    case "return":
    case "break":
    case "continue":
      return true
    case "if":
      return s.else.length > 0 && divergesAll(s.then) && divergesAll(s.else)
    case "switch":
      return s.else.length > 0 && s.arms.every((a) => divergesAll(a.body)) && divergesAll(s.else)
    case "loop":
      return (s.test === undefined || (s.test.cond.kind === "const" && s.test.cond.value === true)) && !loopUses(s).exits
    default:
      return false
  }
}

/** Does a statement list never come out of its bottom — does one of its statements diverge (`diverges`)? */
export function divergesAll(list: readonly IrStmt[]): boolean {
  return list.some(diverges)
}

/** Which of a loop's two labels its body uses: an EXIT (`exits`) or a CONTINUE (`continues`) of THIS loop — one inside
 *  a nested loop is that loop's. A label no statement names is a rustc warning. */
export function loopUses(loop: IrLoop): { exits: boolean; continues: boolean } {
  const uses = { exits: false, continues: false }
  const visit = (stmts: readonly IrStmt[]): void => {
    for (const s of stmts) {
      if (s.kind === "break") uses.exits = true
      else if (s.kind === "continue") uses.continues = true
      else if (s.kind !== "loop") for (const nested of blocksOf(s)) visit(nested)
    }
  }
  visit(loop.body)
  return uses
}

/** Every call in a body — FB calls, and invokes wherever they sit, dispatch arms included — pre-order, on `childrenOf`
 *  like every other walk here (it was the last reflective one, a skip list over every key but `type`/`of`/`span`/`lent`). */
export function callsIn(root: IrNode | readonly IrNode[]): (IrInvoke | IrCall)[] {
  const out: (IrInvoke | IrCall)[] = []
  someNode(root, (n) => (!isPlace(n) && (n.kind === "call" || n.kind === "invoke") && out.push(n), false))
  return out
}

/** A callee that touches nothing but its own locals, inputs and in-outs, and calls nothing — no METHOD, FB body, FUNCTION
 *  or interface call, no dereference. The only way from it to a variable of its caller is then an in-out it was bound. */
export function touchesOnlyItsOwn(root: IrNode | readonly IrNode[]): boolean {
  return !someNode(root, (n) =>
    isPlace(n) ? n.guard !== undefined || (n.root !== "local" && n.root !== "inout") : n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call",
  )
}

/**
 * The places a body WRITES (or lends to be written), in no particular order: an assignment's target, a freeze's temp, a
 * copy's `back`, the instance a METHOD or FB body runs on, an instance lent to a callee, a call's hidden binding — and
 * each in-out bound to a place, unless `readOnly(call, i)` says the callee takes that one read-only (a VAR_IN_OUT
 * CONSTANT). A written place's own index expressions and guard are reads, and are not in the list.
 */
export function writtenPlaces(root: IrNode | readonly IrNode[], readOnly: (call: IrInvoke | IrCall, inout: number) => boolean): Place[] {
  const out: Place[] = []
  const bound = (call: IrInvoke | IrCall): void =>
    call.inouts.forEach((b, i) => {
      if (!("kind" in b) && !readOnly(call, i)) out.push(b)
    })
  someNode(root, (n) => {
    if (isPlace(n)) return false
    if (n.kind === "assign") out.push(n.target)
    else if (n.kind === "freeze") out.push(n.temp)
    else if (n.kind === "copy" && n.back !== undefined) out.push(n.back)
    else if (n.kind === "invoke" || n.kind === "call") {
      if (n.instance !== undefined) out.push(n.instance)
      out.push(...(n.lent ?? []))
      if (n.kind === "call" && n.bind !== undefined) out.push(n.bind.place)
      bound(n)
    }
    return false
  })
  return out
}

/** A body that writes nothing but its own locals and calls nothing. */
export function writesOnlyLocals(root: IrNode | readonly IrNode[]): boolean {
  return !someNode(root, (n) => !isPlace(n) && (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call" || (n.kind === "assign" && n.target.root !== "local")))
}

/**
 * THE INIT SEQUENCE'S READ WALK — what an initializer reads (`lower/init/sequence.ts`): `childrenOf`, every node entered
 * (task 5.9: a `select`, a call's freezes and lent places were skipped, so a read there reached no guard). What differs is
 * semantics, not a skip: `ADR(x)` takes an address, the same whenever it is taken — it reads only its place's index
 * expressions; a freeze READS its value and writes its temp; a call reads its inputs, its freezes, its in-out bindings (a
 * copy only its value — its `back` is written after the call), its lent places, then the instance it runs on.
 */
export function initReadChildren(n: IrNode): IrNode[] {
  if (isPlace(n)) return childrenOf(n)
  switch (n.kind) {
    case "invoke":
      return [
        ...n.inputs,
        ...(n.order ?? []).filter((o): o is IrFreeze => typeof o !== "number"),
        ...n.inouts.map((b) => ("kind" in b && b.kind === "copy" ? b.value : b)),
        ...(n.lent ?? []),
        ...(n.instance === undefined ? [] : [n.instance]),
      ]
    case "freeze":
      return [n.value]
    case "address":
      return childrenOf(n.place)
    default:
      return childrenOf(n)
  }
}

/** The first answer `onPlace` gives for a place under `root` — each place tested AFTER the places and expressions inside
 *  it (its path's indices, its guard), in the order `children` names them. */
export function findPlace<T>(root: IrNode, onPlace: (p: Place) => T | undefined, children: (n: IrNode) => readonly IrNode[] = childrenOf): T | undefined {
  for (const child of children(root)) {
    const found = findPlace(child, onPlace, children)
    if (found !== undefined) return found
  }
  return isPlace(root) ? onPlace(root) : undefined
}

/**
 * Two IR nodes alike — every field compared but the spans, a type by its kind and name only (a Type may reach its scope,
 * which is cyclic). What a printer asks before it prints one node in place of two (`emit/rust` `op=`, a range's `contains`).
 */
export function sameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = (o: object): string[] => Object.keys(o).filter((k) => k !== "span")
  const [ka, kb] = [keys(a), keys(b)]
  if (ka.length !== kb.length) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  return ka.every((k) => (k === "type" || k === "of" ? typeName(x[k]) === typeName(y[k]) : sameNode(x[k], y[k])))
}

const typeName = (t: unknown): string => {
  const o = t as { kind?: string; name?: string; elem?: { name?: string } } | undefined
  return `${o?.kind}:${o?.name ?? o?.elem?.name ?? ""}`
}
