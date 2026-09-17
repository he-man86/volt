import { describe, expect, test } from "bun:test"
import * as transpile from "./index.js"

// The transpiler's public surface, pinned while `lower/` and `interp/` are split into files: a move that drops or
// renames an export fails here, not in whichever consumer happens to import it.
describe("transpile — public surface", () => {
  test("the runtime exports are exactly these", () => {
    expect(Object.keys(transpile).sort()).toEqual([
      // the loop cap and its wording are IR-level semantics BOTH backends read, so they are surface: the
      // interpreter enforces the cap and the emitter prints it, and a rename must break here rather than let
      // the two drift apart again (which is how the emitted Rust came to have no cap at all). Capitals sort
      // first, so they head the list.
      "LOOP_CAP_MESSAGE",
      "LOOP_ITERATION_CAP",
      "defaultValueOf",
      "elementOf",
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
