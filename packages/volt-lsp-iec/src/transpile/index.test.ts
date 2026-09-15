import { describe, expect, test } from "bun:test"
import * as transpile from "./index.js"

// The transpiler's public surface, pinned while `lower/` and `interp/` are split into files: a move that drops or
// renames an export fails here, not in whichever consumer happens to import it.
describe("transpile — public surface", () => {
  test("the runtime exports are exactly these", () => {
    expect(Object.keys(transpile).sort()).toEqual([
      "defaultValueOf",
      "emitRust",
      "fieldNames",
      "holdsCall",
      "isBit",
      "load",
      "lowerSource",
      "lowerUnit",
      "peelArray",
      "run",
      "rustAccess",
      "rustName",
      "rustType",
      "sameName",
      "snake",
    ])
  })
})
