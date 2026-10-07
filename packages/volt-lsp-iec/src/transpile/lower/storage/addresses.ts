/**
 * Direct addresses — `AT %IX0.0` and the `%` operands: the one spelling of an address, its bits, its claim, and the
 * refusals of an overlap or an address shared by several instances.
 */

import { baseOf, type Lowering } from "../lowering.js"
import type { Span, VarDecl } from "../../../frontend/syntax/index.js"
import type { Place } from "../../ir/index.js"
import { elementaryRef, peelArray, type Type, typeZero } from "../../../frontend/types/index.js"

/**
 * THE ONE SPELLING OF A DIRECT ADDRESS — `%` area, width, index, and a bit only on an `X`. Undefined for anything else,
 * which each caller reports in its own words.
 *
 * The regex and that shape rule were written out twice, and the overlap bookkeeping below a third time in its own
 * shape, so the rule for what an address IS lived in three places that could drift apart while every test still passed.
 */
function parseAddress(text: string): RegExpExecArray | undefined {
  const m = /^%([IQM])([XBWDL])(\d+)(?:\.(\d+))?$/i.exec(text)
  return m === null || (m[2]!.toUpperCase() === "X") !== (m[4] !== undefined) ? undefined : m
}

/**
 * The name an address would alias, or undefined when it is free — the one overlap rule, under both interpretations.
 *
 * TWO ADDRESSES THAT OVERLAP ARE ONE STORAGE, and the vendor aliases them. This refuses the overlap instead, which
 * is a REACH gap and not a wrong answer — the whole model is measured now (`declarations/addresses.ts`, 2026-09-19)
 * and waiting for a byte-addressable marker area to hold it:
 *
 *   %MW4 := 16#1234   ->   %MB8 is 16#34 and %MB9 is 16#12      LITTLE-ENDIAN
 *   %MD16 := 16#12345678 -> %MW32 is 16#5678                    and the numbering is in UNITS, not bytes:
 *                                                               word 4 IS bytes 8-9, dword 16 IS words 32-33
 *   %MB12 := 1        ->   %MX12.0 is TRUE                      bit 0 is the least significant
 *   %MB12 := 128      ->   %MX12.7 is TRUE
 *   two WORDs at %MW2 ->   writing one shows in the other
 *
 * Implementing it means each area becoming a byte array with every addressed variable a VIEW into it (offset,
 * width, little-endian) rather than a slot of its own — a new storage kind in the IR and in both backends. Six
 * fixtures sit at `not-lowered` until then, which is the honest rating: the vendor runs them and we refuse.
 */
function addressClash(lw: Lowering, m: RegExpExecArray): string | undefined {
  const { area, bits } = addressBits(m)
  return lw.shared.addressed.find((x) => x.area === area && x.bits[0] < bits[1] && bits[0] < x.bits[1])?.name
}

/** That address, recorded as taken by `name`. */
function claimAddress(lw: Lowering, m: RegExpExecArray, name: string, owner: string): void {
  const { area, bits } = addressBits(m)
  lw.shared.addressed.push({ area, bits, name, owner })
}

/**
 * A DIRECT ADDRESS written as an EXPRESSION — `x := %IB8`, `%MW30 := %MW30 + 1` — which the corpus does 8 times and no
 * variable names. It is the same plain storage an `AT` variable is (conformance `ca_direct_address_expression`: `%MW30`
 * written 258 reads back 258, then 259; an input image reads 0, since nothing drives one in the simulator), so it gets
 * one APPLICATION-WIDE slot per address: the process image is not a frame's. Two mentions of one address are one slot;
 * two addresses that would overlap are refused, as two `AT` variables on overlapping addresses already are.
 */
export function addressPlace(lw: Lowering, text: string, span: Span): Place | undefined {
  const m = parseAddress(text)
  if (m === undefined) return lw.bail("var-at", `${text}: an address that is incomplete, or of a shape not modelled`, span)
  const key = text.toUpperCase()
  const known = lw.shared.globals.byName.get(key)
  const width = m[2]!.toUpperCase() as "X" | "B" | "W" | "D" | "L"
  const type = elementaryRef({ X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD", L: "LWORD" }[width])
  if (known !== undefined) return { slot: known, path: [], type, span, root: "global" }
  if (!reserveAddress(lw, text, m, key, span)) return undefined
  lw.shared.globals.byName.set(key, lw.shared.globals.slots.length)
  lw.shared.globals.slots.push({ name: key, type, section: "VAR", init: typeZero(type) })
  return { slot: lw.shared.globals.slots.length - 1, path: [], type, span, root: "global" }
}

/**
 * The bits an address covers, MEASURED: the simulator addresses a word by its WORD index, not its byte — `%QW5` and
 * `%QW6` written 16#1111 and 16#2222 read back as themselves, and `%QW2` beside `%QB2` leaves the byte at 0
 * (conformance `ca_adjacent_word_addresses`). Both were refused as overlaps while this tried the byte interpretation
 * too, which is the pattern every real project writes — the corpus has `%IW5` next to `%IW6` and `%QW2` next to `%QB2`.
 * ponytail: a project that turns BYTE addressing on is not modelled, and nothing Volt reads says which one it is.
 */
export function addressBits(m: RegExpExecArray): { area: string; bits: [number, number] } {
  const n = Number(m[3])
  const width = { X: 0, B: 1, W: 2, D: 4, L: 8 }[m[2]!.toUpperCase() as "X" | "B" | "W" | "D" | "L"]
  const bit = n * 8 + Number(m[4] ?? 0)
  return { area: m[1]!.toUpperCase(), bits: width === 0 ? [bit, bit + 1] : [n * width * 8, (n + 1) * width * 8] }
}

/**
 * The overlap bookkeeping `bindAddress` keeps, for an address with no variable on it.
 *
 * WHAT THE REFUSAL BELOW IS WAITING FOR, measured 2026-09-24 against the six `addr_*` fixtures that record an
 * overlap. The ADDRESSING is already right — `addressBits` above puts `%MW4` and `%MB8` on the same byte, `%MD16`
 * and `%MW32` on the same byte, and the recordings agree, little-endian both times (`w := 16#1234` reads `lo` as
 * 16#34, `d := 16#12345678` reads the low `w` as 16#5678). Only the ALIASING is missing.
 *
 * And the machinery for it exists: `lower/storage/unions.ts` already models one storage seen through several members, by
 * byte arithmetic rather than a real memory area — `unionCopies` is the write-propagation. Reaching it means giving
 * each overlapping GROUP one backing slot and making each `AT` variable a member place into it, which is a change
 * to how addressed storage is allocated rather than a new model. That is the shape of the work; nothing here is
 * unmeasured.
 */
function reserveAddress(lw: Lowering, text: string, m: RegExpExecArray, name: string, span: Span): boolean {
  const clash = addressClash(lw, m)
  if (clash !== undefined) {
    lw.bail("var-at", `${text} overlaps ${clash} — the vendor aliases them and this has no byte-addressable area to do it in`, span)
    return false
  }
  claimAddress(lw, m, name, "GLOBAL")
  return true
}

/**
 * `AT %I…/%Q…/%M…` (conformance `operand_hw_address_marker`): in the simulator an address is plain storage — nothing drives
 * an input, a marker reads back what was written — so the variable stays an ordinary slot, the process image a transpiled
 * test writes and reads. What plain storage cannot hold is the ALIASING an address brings (review 2026-09-15), so that is
 * refused: two variables whose addresses overlap — under byte addressing and under word addressing alike, as which one
 * the project uses is not read — several names on one address, an incomplete `%I*` (mapped elsewhere), an address in a
 * METHOD or FUNCTION. An FB field's address shared by the FB's several instances is refused once the POU has lowered.
 */
export function bindAddress(lw: Lowering, decl: VarDecl): boolean {
  const text = decl.at!.tokens.map((t) => t.text).join("")
  const refuse = (why: string): boolean => {
    lw.bail("var-at", `${decl.names.map((n) => n.text).join(", ")} AT ${text}: ${why}`, decl.span)
    return false
  }
  const m = parseAddress(text)
  if (m === undefined) return refuse("an address that is incomplete, or of a shape not modelled")
  if (lw.routineMode) return refuse("an address inside a METHOD or FUNCTION")
  if (decl.names.length > 1) return refuse("several variables on one address")
  const clash = addressClash(lw, m)
  if (clash !== undefined) return refuse(`it overlaps ${clash} — the vendor aliases them and this has no byte-addressable area to do it in`)
  claimAddress(lw, m, decl.names[0]!.text, lw.globalMode ? "GLOBAL" : lw.frameContext)
  return true
}

/**
 * An FB whose own or inherited field is bound AT an address, and of which the POU holds more than one instance — each one
 * would be storage of its own, where the address is one place (review 2026-09-15). Instances are counted through fields,
 * arrays (by length), globals and routine locals; an instance of a derived FB counts for each of its bases.
 */
export function addressSharedByInstances(lw: Lowering, slots: readonly { type: Type }[]): string | undefined {
  const addressed = new Set(lw.shared.addressed.filter((a) => a.owner.startsWith("FB:")).map((a) => a.owner.slice(3)))
  if (addressed.size === 0) return undefined
  const count = new Map<string, number>()
  const walk = (t: Type, times: number): void => {
    const array = peelArray(t)
    if (array !== undefined) return walk(array.element, times * array.length)
    if (t.kind !== "struct" && t.kind !== "function_block") return
    const key = t.name.toUpperCase()
    for (let unit = lw.bodies.get(key)?.unit; unit !== undefined; ) {
      const name = unit.name.text.toUpperCase()
      count.set(name, (count.get(name) ?? 0) + times)
      const base = baseOf(unit)
      unit = base === undefined ? undefined : lw.bodies.get(base.text.toUpperCase())?.unit
    }
    for (const field of lw.layouts.get(key)?.fields ?? []) walk(field.type, times)
  }
  for (const slot of slots) walk(slot.type, 1)
  return [...addressed].find((fb) => (count.get(fb) ?? 0) > 1)
}
