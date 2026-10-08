/**
 * The one program-reentrancy test (task 1.7.12) and each site's rule.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { IrStmt } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { programReentrant, programTarget } from "./reentrancy.js"

const span = undefined as never
const lw = new Lowering({} as Scope, {} as Scope)
const dispatching: IrStmt[] = [{ kind: "eval", value: { kind: "dispatch", tag: { kind: "const", value: 0n, type: undefined as never, span }, arms: [], type: undefined as never, span }, span }]
const touching = { touched: new Set([4]), body: [] as IrStmt[] }
const quiet = { touched: new Set<number>(), body: dispatching }

test("off the globals nothing is reentrant; on a program's slot the touched set and an interface call are", () => {
  expect(programTarget({ slot: 4, path: [], type: undefined as never, span, root: "global" })).toEqual({ slot: 4, inside: false })
  expect(programTarget({ slot: 4, path: [], type: undefined as never, span })).toBeUndefined()
  expect(programReentrant(lw, touching, undefined)).toBeUndefined()
  expect(programReentrant(lw, touching, { slot: 4, inside: false })).toBe("touches")
  expect(programReentrant(lw, touching, { slot: 5, inside: false })).toBeUndefined()
  expect(programReentrant(lw, quiet, { slot: 4, inside: false })).toBe("dispatch")
})

test("a rule checks a reason only inside a program, or never", () => {
  expect(programReentrant(lw, touching, { slot: 4, inside: false }, { touched: "inside", dispatch: "inside" })).toBeUndefined()
  expect(programReentrant(lw, touching, { slot: 4, inside: true }, { touched: "inside", dispatch: "inside" })).toBe("touches")
  expect(programReentrant(lw, quiet, { slot: 4, inside: false }, { touched: "always", dispatch: "inside" })).toBeUndefined()
  expect(programReentrant(lw, quiet, { slot: 4, inside: true }, { touched: "always", dispatch: "never" })).toBeUndefined()
})
