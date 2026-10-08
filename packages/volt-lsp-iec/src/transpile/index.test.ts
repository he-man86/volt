import { describe, expect, test } from "bun:test"
import * as transpile from "./index.js"

// The transpiler's public surface, pinned while `lower/` and `interp/` are split into files: a move that drops or
// renames an export fails here, not in whichever consumer happens to import it.
describe("transpile — public surface", () => {
  test("the runtime exports are exactly these", () => {
    expect(Object.keys(transpile).sort()).toEqual([
      // the global `TIME()` reads — a harness sets it before a scan, so the name is how every harness reaches it
      "CLOCK",
      // the refusal registry: the codes, the templated families, the resolver and the factory. Surface on
      // purpose — `kind` answers "is this my bug or yours?", and a consumer that renders a refusal needs it.
      "LOWER_CODES",
      "LOWER_CODE_PREFIXES",
      // a harness's loop guard giving up — thrown only when `run(pou, { loopGuard })` asked for one (task 27)
      "LoopGuardError",
      "emitRust",
      // a project's libraries bound once, which a sweep lowers every program on top of
      "libraryBase",
      "load",
      // lowering then printing in one call, beside `load` (pipeline/, task 1.4.2)
      "lowerAndEmit",
      "lowerCodeKind",
      // the source path over an already-bound project (design.md §2.1.1's lower row, task 1.7.20); `lowerDiagnostic`,
      // the factory, left the surface then — nothing outside lowering builds a refusal
      "lowerPrepared",
      "lowerSource",
      "lowerUnit",
      // binds a project for `lowerUnit` — the one place its library units are marked, so no caller can forget them
      "prepareProject",
      "run",
      "rustType",
    ])
  })
})
