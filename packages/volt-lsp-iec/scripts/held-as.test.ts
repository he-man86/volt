/**
 * `deleteOpsFor` / `orphansIn` — the language recorder's cleanup lookup (openspec `push-without-header-check` 5.B).
 *
 * WHY: after 5.B a DUT whose text states no subtype is published as `X.dut`, not listed `unreadable`. A cleanup that
 * did not know `.dut` was a DUT name never deleted `pwh_empty_struct` (pushed as `.struct`): the broken DUT stayed in
 * the project, entered every later fixture's `before` and its build, and a re-record met `ITEM_EXISTS`.
 */
import { expect, test } from "bun:test"
import { deleteOpsFor, mayBeHeldAs, orphansIn } from "./held-as.js"

const nothing = { items: new Set<string>(), unreadable: new Set<string>() }

test("a DUT pushed as X.struct and published as X.dut is deleted under X.dut, unforced", () => {
  const r = { items: { "PLC_PRG.prg": "p", "pwh_empty_struct.dut": "v1" } }
  expect(deleteOpsFor(["pwh_empty_struct.struct"], r, nothing)).toEqual({
    ops: [{ op: "deleteItem", name: "pwh_empty_struct.dut", ifVersion: "v1" }],
    force: false,
  })
})

test("a DUT pushed as X.dut and published under a subtype is deleted under that subtype", () => {
  expect(mayBeHeldAs("E_Mode.dut", "E_Mode.enum")).toBe(true)
  expect(deleteOpsFor(["E_Mode.dut"], { items: { "E_Mode.enum": "v" } }, nothing).ops).toEqual([
    { op: "deleteItem", name: "E_Mode.enum", ifVersion: "v" },
  ])
})

test("an X.dut the project already held before the push is not the push's to delete", () => {
  const before = { items: new Set(["pwh_empty_struct.dut"]), unreadable: new Set<string>() }
  expect(deleteOpsFor(["pwh_empty_struct.struct"], { items: { "pwh_empty_struct.dut": "v" } }, before).ops).toEqual([])
})

test("a DUT name never reaches another family's item of the same bare name", () => {
  expect(mayBeHeldAs("X.dut", "X.fb")).toBe(false)
  expect(mayBeHeldAs("X.struct", "X.gvl")).toBe(false)
})

test("a killed run's X.dut leftover is swept as an orphan of the fixture pushed as X.struct", () => {
  expect(orphansIn(["pwh_empty_struct.struct", "other.fb"], { items: { "pwh_empty_struct.dut": "v" } })).toEqual([
    "pwh_empty_struct.struct",
  ])
})

test("an unreadable GVL is still deleted by a forced op under the pushed name", () => {
  expect(deleteOpsFor(["G.gvl"], { items: {}, unreadable: ["G"] }, nothing)).toEqual({
    ops: [{ op: "deleteItem", name: "G.gvl", ifVersion: null }],
    force: true,
  })
})
