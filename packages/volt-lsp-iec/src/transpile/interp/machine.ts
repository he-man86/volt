/**
 * The IR interpreter's MACHINE — a backend, and the reference the other backends are checked against.
 *
 * It runs the SAME IR the Rust emitter prints, which is the point: a lowering bug shows up in both, and an
 * emitter bug shows up as a disagreement between them rather than as a silently wrong number. It walks a
 * frame of slots — no name lookup, no scope chain, no types at run time; lowering already answered all three.
 * The value semantics it computes with are `semantics/`'s, the places it reads and writes `frame.ts`'s, the calls
 * `calls.ts`'s.
 *
 * ponytail: a tree compiled once into closures (`compileExpr`, `compileStmt`). It is the oracle and the fast path to a green test, not the shipping runtime — if
 * scan throughput ever matters, that is what the Rust backend is for.
 */
import type { IrExpr, IrStmt } from "../ir/index.js"
import {
  binaryValue, bool, builtinValue, constValue, convertValue, eq, fit, IecFault, instantiate, LoweringBug, num, ord, reinterpret, selectedArg, shortCircuit,
  unaryValue, type Val,
} from "../semantics/index.js"
import { type Cell, compileRead, compileWrite, Frame } from "./frame.js"
import { call, type Caller, invoke } from "./calls.js"

/** How a statement list ended: normally, or by EXIT, CONTINUE or RETURN. */
type Signal = "none" | "break" | "continue" | "return"

/**
 * A HARNESS gave up on a loop — not a program outcome. CODESYS caps no loop (`tr_27_loop_cap_*` run 1,000,001 and
 * 5,000,000 passes), so neither backend does; a harness that runs code it cannot trust to terminate passes
 * `run(pou, { loopGuard })`, and this is thrown on the body entry past the guard: one pass = one body entry.
 */
export class LoopGuardError extends RangeError {
  constructor(readonly guard: number) {
    super(`loop entered its body more than ${guard} times (harness loop guard)`)
  }
}

export class Machine extends Frame implements Caller {
  /** An expression's value on this frame — through the closure it was compiled into, once ({@link compiledExpr}). */
  expr(e: IrExpr): Val {
    return compiledExpr(e)(this)
  }

  /** A statement list run on this frame — through the closure it was compiled into, once ({@link compiledBlock}). */
  block(list: readonly IrStmt[]): Signal {
    return compiledBlock(list)(this)
  }

  enterFrame(root: Record<string | number, Val>, keys: readonly (string | number)[], inouts: readonly Cell[], locals: Val[], lent: readonly Cell[], body: readonly IrStmt[]): void {
    new Machine(root, keys, inouts, this.layouts, this.routines, this.globals, this.memory, this.guard, locals, lent).block(body)
  }
}

/**
 * THE TREE IS WALKED ONCE, NOT ONCE PER PASS. Each IR node is compiled, the first time it runs, into a closure over its
 * already-compiled children; a pass is then a chain of direct calls. Walking the tree on every pass — a `switch` on
 * the node's kind, then on its operator, then on the place's root, a result object per place and a spread to build it,
 * at every node of every pass — cost ~400 ns for `cnt := cnt + 1` and its loop test, which put the recorded loops
 * (`tr_27_loop_cap_*`: 1,000,001 and 5,000,000 passes) at seconds. A closure holds nothing but the node it was made
 * from; the frame it runs on is its argument, so one compiled body serves every instance, call and scan.
 */
type Run<T> = (m: Machine) => T

const exprs = new WeakMap<IrExpr, Run<Val>>()
const blocks = new WeakMap<readonly IrStmt[], Run<Signal>>()

function compiledExpr(e: IrExpr): Run<Val> {
  let run = exprs.get(e)
  if (run === undefined) exprs.set(e, (run = compileExpr(e)))
  return run
}

function compiledBlock(list: readonly IrStmt[]): Run<Signal> {
  let run = blocks.get(list)
  if (run === undefined) blocks.set(list, (run = compileBlock(list)))
  return run
}

/** An `ARRAY[*]` in-out's dimension's element count, off the array the call bound (lean 7.7.8). */
function compileCount(e: Extract<IrExpr, { kind: "count" }>): Run<Val> {
  return (m) => {
    let array = m.read(e.array)
    for (let d = 1; d < e.dim; d++) array = (array as Val[])[0]!
    return fit(BigInt((array as Val[]).length), e.type)
  }
}

/** A UNION member's bytes read as another member (lean 7.8.4): over the member's own where it is the longer. */
function compileReinterpret(e: Extract<IrExpr, { kind: "reinterpret" }>): Run<Val> {
  const value = compiledExpr(e.value)
  const over = e.over === undefined ? undefined : compiledExpr(e.over)
  return (m) => reinterpret(value(m), e.value.type, e.type, over?.(m), m.layouts)
}

function compileExpr(e: IrExpr): Run<Val> {
  switch (e.kind) {
    case "const": {
      // a constant is stored the same way every time it is read: fitted on its first read, and kept
      let value: Val | undefined
      return () => (value ??= constValue(e.value, e.type))
    }
    // A fresh composite — what a VAR_TEMP struct or array is reset to at the top of each call.
    case "fresh":
      return (m) => instantiate(e.type, e.init, m.layouts)
    case "load":
      return compileRead(e.place)
    // `ADR(x)` of a variable in the image: the address its place reaches, read without the access
    case "address":
      return (m) => m.address(e.place)
    // an `ARRAY[*]` in-out's dimension's element count, off the array the call bound (lean 7.7.8)
    case "count":
      return compileCount(e)
    case "invoke":
      return (m) => invoke(m, e)
    case "dispatch": {
      // a call through an interface runs on the instance its value names; none — a null interface — stops the application
      const tag = compiledExpr(e.tag)
      return (m) => {
        const t = tag(m)
        const arm = e.arms.find((a) => a.tag === t)
        if (arm === undefined) throw new IecFault(e.fault)
        return invoke(m, arm.call)
      }
    }
    case "select": {
      // a read through a pointer that may name several variables: the tag picks which. None is a null dereference,
      // which stops the application exactly as `iec_deref` does for the single-target form.
      const tag = compiledExpr(e.tag)
      return (m) => {
        const t = tag(m)
        const arm = e.arms.find((a) => a.tag === t)
        if (arm === undefined) throw new IecFault("null-dereference")
        return m.read(arm.place)
      }
    }
    case "convert": {
      const value = compiledExpr(e.value)
      return (m) => convertValue(value(m), e.type, e.value.type)
    }
    case "reinterpret":
      return compileReinterpret(e)
    // The three node kinds whose meaning needs no storage live in `semantics/`, because lowering evaluates
    // them too when it folds a declaration's initial value — one table, so a folded value and a computed one
    // cannot disagree.
    case "builtin": {
      const args = e.args.map(compiledExpr)
      // two addresses ordered: inside one region of the image only (`Memory.order`)
      if (e.name === "address_order") return (m) => m.memory.order(num(args[0]!(m)) as bigint, num(args[1]!(m)) as bigint)
      // SEL and MUX evaluate only the input their selector picks (`IrBuiltinName`)
      if (e.name === "sel" || e.name === "mux") {
        const name = e.name
        return (m) => fit(args[selectedArg(name, args[0]!(m), args.length)]!(m), e.type)
      }
      const types = e.args.map((a) => a.type)
      return (m) => builtinValue(e.name, args.map((a) => a(m)), e.type, types, e.bits)
    }
    case "unary": {
      const operand = compiledExpr(e.operand)
      return (m) => unaryValue(e.op, operand(m), e.type)
    }
    case "binary": {
      const left = compiledExpr(e.left)
      const right = compiledExpr(e.right)
      // The short-circuit forms must not evaluate the right side — the only reason they are distinct nodes,
      // and the one part of a binary that belongs to whoever does the evaluating.
      if (e.op === "and_then" || e.op === "or_else") return shortCircuit(e.op, left, right)
      const { op, type } = e
      return (m) => binaryValue(op, left(m), right(m), type)
    }
  }
}

/** A read of a place. A variable itself — no step, no dereference, the commonest place there is — is one slot of the
 *  frame, the locals or the globals, read directly; anything else walks its path ({@link Machine.read}). */
function compileBlock(list: readonly IrStmt[]): Run<Signal> {
  const stmts = list.map(compileStmt)
  if (stmts.length === 0) return () => "none"
  if (stmts.length === 1) return stmts[0]!
  return (m) => {
    for (const s of stmts) {
      const sig = s(m)
      if (sig !== "none") return sig
    }
    return "none"
  }
}

/** An assignment of a STRING into a STRING (a WSTRING into a WSTRING): the source's capacity, which makes the write a
 *  string store (`compileWrite`); undefined for every other assignment. */
function stringSource(s: Extract<IrStmt, { kind: "assign" }>): number | undefined {
  const [v, t] = [s.value.type, s.target.type]
  if (v.kind !== "elementary" || t.kind !== "elementary" || v.name !== t.name || (v.name !== "STRING" && v.name !== "WSTRING")) return undefined
  if (v.length === undefined) throw new LoweringBug(`a string store from a value with no capacity (${v.name})`)
  return v.length
}

function compileStmt(s: IrStmt): Run<Signal> {
  switch (s.kind) {
    case "assign": {
      const value = compiledExpr(s.value)
      const store = compileWrite(s.target, stringSource(s))
      return (m) => {
        store(m, value(m))
        return "none"
      }
    }
    case "if": {
      const cond = compiledExpr(s.cond)
      const then = compiledBlock(s.then)
      const otherwise = compiledBlock(s.else)
      return (m) => (bool(cond(m)) ? then : otherwise)(m)
    }
    case "switch": {
      const selector = compiledExpr(s.selector)
      const arms = s.arms.map((arm) => ({ labels: arm.labels, body: compiledBlock(arm.body) }))
      const otherwise = compiledBlock(s.else)
      return (m) => {
        const sel = selector(m)
        for (const arm of arms)
          for (const label of arm.labels)
            if (label.lo === label.hi ? eq(sel, label.lo) : ord("ge", sel, label.lo) && ord("le", sel, label.hi))
              return arm.body(m)
        return otherwise(m)
      }
    }
    case "loop": {
      const init = compiledBlock(s.init)
      const body = compiledBlock(s.body)
      const step = compiledBlock(s.step)
      // the test, at the top of a pass (FOR, WHILE) or at its end (REPEAT) — or none
      const before = s.test !== undefined && !s.test.atEnd ? compiledExpr(s.test.cond) : undefined
      const after = s.test !== undefined && s.test.atEnd ? compiledExpr(s.test.cond) : undefined
      return (m) => {
        init(m)
        for (let n = 1; ; n++) {
          if (before !== undefined && !bool(before(m))) break
          if (m.guard !== undefined && n > m.guard) throw new LoopGuardError(m.guard)
          const sig = body(m)
          if (sig === "break") break
          if (sig === "return") return sig
          step(m)
          if (after !== undefined && !bool(after(m))) break
        }
        return "none"
      }
    }
    case "call":
      return (m) => {
        call(m, s)
        return "none"
      }
    case "eval": {
      // a call as a statement — direct, or dispatched through an interface
      const value = compiledExpr(s.value)
      return (m) => {
        value(m)
        return "none"
      }
    }
    case "break":
      return () => "break"
    case "continue":
      return () => "continue"
    case "return":
      return () => "return"
  }
}
