/**
 * THE PLACE AND POINTER RUNTIME — the frame a body runs on, and where a place's read or write lands in it: its root
 * (the frame, the per-call locals, the globals, a bound VAR_IN_OUT, a lent instance), its path, its dereference guard.
 */
import type { Access, IrBinding, IrExpr, IrLayout, IrRoutine, Place } from "../ir/index.js"
import { bool, fit, IecFault, num, storeAs, type Val } from "../semantics/index.js"
import { indexOutOfBounds } from "../ir/faults.js"

/** Where a value lives: a container (a frame, a record, an array) and the key into it. */
export type Cell = { container: Record<string | number, Val>; key: string | number }

/** What {@link Frame.locate} answers: the container the steps before a place's last one lead to, the key into it, and the
 *  bit a last `bit` step names. */
export interface Located {
  container: Val[] | { [field: string]: Val }
  key: number | string
  bit: Extract<Access, { kind: "bit" }> | undefined
}

export abstract class Frame {
  /**
   * @param root   the frame a body runs on — the POU's slot array, or an FB instance's record
   * @param keys   the key of each slot index in `root`: the index itself, or the field's upper-cased name
   * @param inouts the caller's variables bound to the body's VAR_IN_OUT parameters, by parameter index
   */
  constructor(
    readonly root: Record<string | number, Val>,
    readonly keys: readonly (string | number)[],
    protected readonly inouts: readonly Cell[],
    readonly layouts: ReadonlyMap<string, IrLayout>,
    readonly routines: ReadonlyMap<string, IrRoutine>,
    /** The application's globals — ONE array every body shares. */
    readonly globals: Val[],
    /** The harness's loop guard (`RunOptions`) — undefined runs every pass. */
    readonly guard: number | undefined,
    /** The running METHOD's, ACTION's or FUNCTION's per-call locals. */
    readonly locals: Val[] = [],
    /** The FB instances this body's caller lends it (`lent` places), by slot. */
    protected readonly lent: readonly Cell[] = [],
  ) {}

  /** An expression's value on this frame — the machine's. */
  abstract expr(e: IrExpr): Val

  /** A copy lent for a call and marked `back` is written to its place once the call returns (`bindInOut`) — the case
   *  where a VAR_IN_OUT was given a CONSTANT, so the binding is a cell holding a copy rather than the caller's place. */
  writeBack(bindings: readonly IrBinding[], cells: readonly Cell[]): void {
    bindings.forEach((b, i) => {
      if ("kind" in b && b.back !== undefined) this.write(b.back, (cells[i]!.container as Record<string | number, Val>)[cells[i]!.key]!)
    })
  }

  /** The cell a VAR_IN_OUT or lent binding names: the caller's place, or a cell holding a copy of a value. */
  bind(b: IrBinding): Cell {
    if ("kind" in b) {
      const value = this.expr(b.value)
      return { container: { v: storeAs(value, b.type) }, key: "v" }
    }
    const cell = this.locate(b)
    return { container: cell.container as Record<string | number, Val>, key: cell.key }
  }

  /** The container a place's root names, before the first step of its path. */
  private base(place: Place): Record<string | number, Val> {
    switch (place.root) {
      case undefined:
        return this.root
      case "local":
        return this.locals as unknown as Record<number, Val>
      case "global":
        return this.globals as unknown as Record<number, Val>
      case "inout":
        return this.inouts[place.slot]!.container
      case "lent":
        return this.lent[place.slot]!.container
      case "this":
        return { THIS: this.root as Val }
    }
  }

  /** The key into {@link base} a place's root names. */
  private baseKey(place: Place): string | number {
    switch (place.root) {
      case undefined:
        return this.keys[place.slot]!
      case "local":
      case "global":
        return place.slot
      case "inout":
        return this.inouts[place.slot]!.key
      case "lent":
        return this.lent[place.slot]!.key
      case "this":
        return "THIS"
    }
  }

  /** The container and key the steps before a place's last one lead to — where a read or write lands. */
  locate(place: Place): Located {
    // a dereference: the pointer holds 0 when null, and CODESYS stops the application on that access — so does this
    if (place.guard !== undefined && this.read(place.guard) === 0n) throw new IecFault("null-dereference")
    const steps = place.path
    const last = steps.at(-1)
    const bit = last?.kind === "bit" ? last : undefined
    const walk = bit === undefined ? steps.length : steps.length - 1
    let container: Val[] | { [field: string]: Val } = this.base(place) as Val[] | { [field: string]: Val }
    let key: number | string = this.baseKey(place)
    for (let s = 0; s < walk; s++) {
      const step = steps[s]!
      const next = (container as Record<string | number, Val>)[key] as Val[] | { [field: string]: Val }
      if (step.kind === "field") key = step.name.toUpperCase()
      else if (step.kind === "index") {
        const i = Number(num(this.expr(step.index)) as bigint) - Number(step.lower)
        // ponytail: what an out-of-bounds index does in CODESYS is unmeasured (no CheckBounds: it writes past the array) — refused loudly
        if (i < 0 || i >= (step.length ?? (next as Val[]).length)) throw new RangeError(indexOutOfBounds(i + Number(step.lower)))
        key = i
      }
      container = next
    }
    return { container, key, bit }
  }

  /** A place with no step and no dereference — a variable itself, the commonest place there is — is its root's slot,
   *  reached without walking a path or building a result for one. */
  private static plain(place: Place): boolean {
    return place.path.length === 0 && place.guard === undefined
  }

  read(place: Place): Val {
    if (Frame.plain(place)) return this.base(place)[this.baseKey(place)]!
    const { container, key, bit } = this.locate(place)
    const value = (container as Record<string | number, Val>)[key]!
    // A bigint's `>>` and `&` work on infinite two's complement, so a negative INT's bits read as the PLC's do.
    return bit === undefined ? value : ((num(value) as bigint) >> BigInt(bit.index)) & 1n ? true : false
  }

  write(place: Place, value: Val): void {
    if (Frame.plain(place)) {
      this.base(place)[this.baseKey(place)] = storeAs(value, place.type)
      return
    }
    const { container, key, bit } = this.locate(place)
    const slot = container as Record<string | number, Val>
    if (bit === undefined) {
      slot[key] = storeAs(value, place.type)
      return
    }
    const current = num(slot[key]!) as bigint
    const mask = 1n << BigInt(bit.index)
    // set or clear, then store at the INTEGER's width — so INT's bit 15 set on 0 reads back as -32768
    slot[key] = fit(bool(value) ? current | mask : current & ~mask, bit.of)
  }
}

/** A read of a place. A variable itself — no step, no dereference, the commonest place there is — is one slot of the
 *  frame, the locals or the globals, read directly; anything else walks its path ({@link Frame.read}). */
export function compileRead(place: Place): (m: Frame) => Val {
  const slot = place.slot
  if (place.path.length === 0 && place.guard === undefined)
    switch (place.root) {
      case undefined:
        return (m) => m.root[m.keys[slot]!]!
      case "local":
        return (m) => m.locals[slot]!
      case "global":
        return (m) => m.globals[slot]!
    }
  return (m) => m.read(place)
}

/** A write to a place, stored as the place's type holds it — the counterpart of {@link compileRead}. */
export function compileWrite(place: Place): (m: Frame, value: Val) => void {
  const { slot, type } = place
  if (place.path.length === 0 && place.guard === undefined)
    switch (place.root) {
      case undefined:
        return (m, v) => void (m.root[m.keys[slot]!] = storeAs(v, type))
      case "local":
        return (m, v) => void (m.locals[slot] = storeAs(v, type))
      case "global":
        return (m, v) => void (m.globals[slot] = storeAs(v, type))
    }
  return (m, v) => m.write(place, v)
}
