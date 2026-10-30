/**
 * Completion (`completion.ts`): member access, scope mode, inside a pragma, a cyclic EXTENDS, a GVL's qualified members
 * and an interface's members.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { hover } from "./hover.js"
import { completion } from "./completion.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

// `Compute` (not `Add` — ADD is a reserved IEC operator keyword).
const SRC = `FUNCTION_BLOCK Lib
END_FUNCTION_BLOCK
METHOD Compute : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
END_METHOD
FUNCTION_BLOCK F
VAR
	lib : Lib;
	rx : INT;
END_VAR
rx := lib.Compute(1, 2);
END_FUNCTION_BLOCK`

test("completion: inside {attribute '…'} offers the known attribute names, not scope symbols", () => {
  const src = `{attribute 'qual'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`
  const doc: Document = {
    uri: "file:///F.pou",
    source: src,
    parseResult: parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult: doc.parseResult, source: src }], [], "codesys")
  const items = completion(doc, project, src.indexOf("qual") + 4)
  const labels = items.map((i) => i.label)
  expect(labels).toContain("qualified_only")
  expect(labels).toContain("pack_mode")
  expect(labels).not.toContain("F") // NOT scope completion
})

test("completion: outside a pragma falls back to scope completion", () => {
  const { doc, project } = setup(SRC)
  const items = completion(doc, project, SRC.indexOf("rx := lib"))
  expect(items.some((i) => i.label === "lib")).toBe(true) // scope symbol, not an attribute
})

// A cyclic EXTENDS (conformance cc2_circular_inheritance: A EXTENDS B, B EXTENDS A) is an error the IDE reports, and the
// editor still completes in it: the visible names walk each base once (`visibleNames`). The two loops completion had
// before looped forever on this input — a hang, which only a test that runs it can keep from coming back.
test("completion in a cyclic EXTENDS answers — each base's names once, no endless walk", () => {
  const src = `FUNCTION_BLOCK FB_CircleA EXTENDS FB_CircleB
VAR
  aOwn : INT;
END_VAR
aOwn := 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_CircleB EXTENDS FB_CircleA
VAR
  bOwn : INT;
END_VAR
END_FUNCTION_BLOCK`
  const { doc, project } = setup(src)
  const labels = completion(doc, project, src.indexOf("aOwn := 1")).map((i) => i.label)
  expect(labels).toContain("aOwn")
  expect(labels).toContain("bOwn")
  expect(labels.filter((l) => l === "bOwn")).toHaveLength(1)
})

describe("through the services barrel", () => {
  function setup(src: string) {
    const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
    const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
    return { doc, project }
  }

  function at(src: string, needle: string, n = 1): number {
    let idx = -1
    for (let i = 0; i < n; i++) idx = src.indexOf(needle, idx + 1)
    return idx + 1
  }

  const SRC = `FUNCTION_BLOCK FB_A
VAR
	speed : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR
	inst : FB_A;
	count : INT;
END_VAR
count := 0;
END_FUNCTION_BLOCK`

  test("completion: member access offers the base type's members", () => {
    // cursor right after `inst.` — synthesize by inserting a dot position
    const withDot = SRC.replace("count := 0;", "inst.;\ncount := 0;")
    const { doc: d2, project: p2 } = setup(withDot)
    const items = completion(d2, p2, withDot.indexOf("inst.") + "inst.".length)
    expect(items.map((i) => i.label)).toContain("speed")
  })

  test("completion: scope mode offers visible symbols + keywords", () => {
    const { doc, project } = setup(SRC)
    const items = completion(doc, project, at(SRC, "count := 0", 1))
    const labels = items.map((i) => i.label)
    expect(labels).toContain("count")
    expect(labels).toContain("inst")
    expect(labels).toContain("IF") // keyword
  })
})

describe("GVL-qualified members (P1)", () => {
  /**
   * GVL-qualified member completion (P1). `GvlName.field` — a GVL block has no child scope; its vars live flat
   * on the project scope tagged by the block uri, so completion has to collect by uri, not `findChildScope`.
   */
  test("completion after `GVL.` offers the GVL's globals (incl. qualified_only)", () => {
    const gvl = `{attribute 'qualified_only'}\nVAR_GLOBAL\n speed : INT;\n mode : BOOL;\nEND_VAR`
    const prg = `PROGRAM PLC_PRG\nVAR\n x : INT;\nEND_VAR\nx := GVL.speed;\nEND_PROGRAM`
    const inputs = [
      { uri: "file:///GVL.gvl", source: gvl, parseResult: parseSource(gvl, { networkText: true, unicodeIdentifiers: false }, "codesys") },
      { uri: "file:///P.pou", source: prg, parseResult: parseSource(prg, { networkText: true, unicodeIdentifiers: false }, "codesys") },
    ]
    const project = build.buildSymbolTable(inputs, [], "codesys")
    const labels = (completion(inputs[1], project, prg.indexOf("GVL.") + 4) ?? []).map((c) => c.label)
    expect(labels.sort()).toEqual(["mode", "speed"])
  })
})

describe("an interface-typed member (P1)", () => {
  /**
   * Interface-typed member access (P1). `drv : IDrive; drv.Spin(…)` must complete/hover/sig-help through the
   * interface's members. Before the `interface` Type kind, `resolveTypeExpr(IDrive)` yielded UNKNOWN → completion
   * fell back to scope symbols and hover on the member wrongly matched a builtin operator.
   */
  const SRC = `INTERFACE IDrive
METHOD Spin : BOOL
VAR_INPUT
    dist : INT;
END_VAR
END_METHOD
PROPERTY Pos : INT
END_INTERFACE
PROGRAM PLC_PRG
VAR
    drv : IDrive;
    rv : BOOL;
    n : INT;
END_VAR
rv := drv.Spin(10);
n := drv.Pos;
END_PROGRAM`

  const setup = () => {
    const parseResult = parseSource(SRC, { networkText: true, unicodeIdentifiers: false }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: SRC, parseResult }
    return { doc, project: build.buildSymbolTable([{ uri: doc.uri, parseResult, source: SRC }], [], "codesys") }
  }

  test("completion after an interface instance's `.` offers its members", () => {
    const { doc, project } = setup()
    const labels = (completion(doc, project, SRC.indexOf("drv.") + 4) ?? []).map((c) => c.label)
    expect(labels).toContain("Spin")
    expect(labels).toContain("Pos")
  })
})
