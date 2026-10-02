/**
 * `deleteOpsFor` / `orphansIn` — the language recorder's cleanup lookup (openspec `push-without-header-check` 5.B).
 *
 * WHY: a cleanup that looked an item up only under the name it was pushed as never deleted one the IDE published
 * under another name: the leftover stayed in the project, entered every later fixture's `before` and its build, and a
 * re-record met `ITEM_EXISTS`. Premise changed by the owner (5.P): every DUT is `X.dut`, so the DUT rows that paired a
 * pushed `X.struct` with a held `X.dut` (or `X.dut` with `X.enum`) are gone; a DUT is looked up under `X.dut` alone,
 * in any case.
 */
import { expect, test } from "bun:test"
import { deleteOpsFor, mayBeHeldAs, orphansIn } from "./held-as.js"

const nothing = { items: new Set<string>(), unreadable: new Set<string>() }

test("a DUT pushed as X.dut is deleted under X.dut, unforced", () => {
  const r = { items: { "PLC_PRG.prg": "p", "pwh_empty_struct.dut": "v1" } }
  expect(deleteOpsFor(["pwh_empty_struct.dut"], r, nothing)).toEqual({
    ops: [{ op: "deleteItem", name: "pwh_empty_struct.dut", ifVersion: "v1" }],
    force: false,
  })
})

test("a split DUT name is no DUT name: it reaches nothing", () => {
  expect(mayBeHeldAs("E_Mode.dut", "E_Mode.enum")).toBe(false)
  expect(mayBeHeldAs("E_Mode.struct", "E_Mode.dut")).toBe(false)
})

test("a program pushed as X.fb and published as X.prg is deleted under X.prg", () => {
  expect(deleteOpsFor(["P.fb"], { items: { "P.prg": "v" } }, nothing).ops).toEqual([
    { op: "deleteItem", name: "P.prg", ifVersion: "v" },
  ])
})

test("an X.prg the project already held before the push is not the push's to delete", () => {
  const before = { items: new Set(["P.prg"]), unreadable: new Set<string>() }
  expect(deleteOpsFor(["P.fb"], { items: { "P.prg": "v" } }, before).ops).toEqual([])
})

test("a DUT name never reaches another family's item of the same bare name", () => {
  expect(mayBeHeldAs("X.dut", "X.fb")).toBe(false)
  expect(mayBeHeldAs("X.dut", "X.gvl")).toBe(false)
})

test("a killed run's leftover is swept as an orphan of the fixture, under its own name or its family's", () => {
  expect(orphansIn(["pwh_empty_struct.dut", "P.fb", "other.fb"], { items: { "pwh_empty_struct.dut": "v", "P.prg": "w" } })).toEqual([
    "pwh_empty_struct.dut",
    "P.fb",
  ])
})

test("an unreadable GVL is still deleted by a forced op under the pushed name", () => {
  expect(deleteOpsFor(["G.gvl"], { items: {}, unreadable: ["G"] }, nothing)).toEqual({
    ops: [{ op: "deleteItem", name: "G.gvl", ifVersion: null }],
    force: true,
  })
})
