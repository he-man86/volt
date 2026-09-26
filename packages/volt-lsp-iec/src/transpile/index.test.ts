import { describe, expect, test } from "bun:test"
import * as transpile from "./index.js"

// The transpiler's public surface, pinned while `lower/` and `interp/` are split into files: a move that drops or
// renames an export fails here, not in whichever consumer happens to import it.
describe("transpile — public surface", () => {
  test("the runtime exports are exactly these", () => {
    expect(Object.keys(transpile).sort()).toEqual([
      // the global `TIME()` reads — a harness sets it before a scan, so the name is how every harness reaches it
      "CLOCK",
      // the loop cap and its wording are IR-level semantics BOTH backends read, so they are surface: the
      // interpreter enforces the cap and the emitter prints it, and a rename must break here rather than let
      // the two drift apart again (which is how the emitted Rust came to have no cap at all). Capitals sort
      // first, so they head the list.
      "LOOP_CAP_MESSAGE",
      "LOOP_ITERATION_CAP",
      // the refusal registry: the codes, the templated families, the resolver and the factory. Surface on
      // purpose — `kind` answers "is this my bug or yours?", and a consumer that renders a refusal needs it.
      "LOWER_CODES",
      "LOWER_CODE_PREFIXES",
      "defaultValueOf",
      "elementOf",
      "emitRust",
      "fieldNames",
      "holdsCall",
      "isBit",
      // a project's libraries bound once, which a sweep lowers every program on top of
      "libraryBase",
      "load",
      "lowerCodeKind",
      "lowerDiagnostic",
      "lowerSource",
      "lowerUnit",
      "peelArray",
      // binds a project for `lowerUnit` — the one place its library units are marked, so no caller can forget them
      "prepareProject",
      "run",
      "rustAccess",
      "rustName",
      "rustType",
      "sameName",
      "snake",
    ])
  })
})
