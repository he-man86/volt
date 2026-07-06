import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import type { Document } from "../shared/index.js"
import { implementation } from "./implementation.js"
import {
  prepareTypeHierarchy,
  typeSubtypes,
  typeSupertypes,
  prepareCallHierarchy,
  callIncoming,
  callOutgoing,
} from "./hierarchy.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}
const at = (src: string, needle: string) => src.indexOf(needle) + 1

const OOP = `INTERFACE IStep
METHOD Step : BOOL
END_METHOD
END_INTERFACE
FUNCTION_BLOCK Base
END_FUNCTION_BLOCK
FUNCTION_BLOCK Derived EXTENDS Base IMPLEMENTS IStep
END_FUNCTION_BLOCK
METHOD Step : BOOL
Step := TRUE;
END_METHOD`

test("implementation: interface → the FBs that implement it", () => {
  const { doc, project } = setup(OOP)
  const impls = implementation([doc], project, doc, at(OOP, "IStep\nMETHOD"))
  expect(impls?.map((l) => l.range.start.line)).toContain(6) // `FUNCTION_BLOCK Derived` line
})

test("type hierarchy: super = EXTENDS + IMPLEMENTS; sub = implementers", () => {
  const { doc, project } = setup(OOP)
  const prep = prepareTypeHierarchy(doc, project, at(OOP, "Derived EXTENDS"))
  expect(prep?.item.name).toBe("Derived")
  const supers = typeSupertypes(project, prep!.sym)
    .map((i) => i.name)
    .sort()
  expect(supers).toEqual(["Base", "IStep"])
  const base = prepareTypeHierarchy(doc, project, at(OOP, "Base\nEND_FUNCTION_BLOCK"))
  const subs = typeSubtypes([doc], base!.sym).map((i) => i.name)
  expect(subs).toContain("Derived")
})

const CALLS = `FUNCTION_BLOCK Lib
END_FUNCTION_BLOCK
METHOD Work : BOOL
Work := TRUE;
END_METHOD
FUNCTION_BLOCK Caller
VAR
	lib : Lib;
	other : Lib;
END_VAR
lib.Work();
other.Work();
END_FUNCTION_BLOCK`

test("call hierarchy: incoming is type-aware (member call resolves to the exact method)", () => {
  const { doc, project } = setup(CALLS)
  const prep = prepareCallHierarchy(doc, project, at(CALLS, "Work : BOOL"))
  expect(prep?.item.name).toBe("Work")
  const incoming = callIncoming([doc], project, prep!.sym)
  // Caller invokes Work twice (via two Lib instances) — both resolve to the SAME method
  expect(incoming).toHaveLength(1)
  expect(incoming[0]?.item.name).toBe("Caller")
  expect(incoming[0]?.ranges).toHaveLength(2)
})

test("call hierarchy: outgoing lists what a POU calls", () => {
  const { doc, project } = setup(CALLS)
  const prep = prepareCallHierarchy(doc, project, at(CALLS, "Caller"))
  const outgoing = callOutgoing(doc, project, prep!.sym)
  expect(outgoing.map((o) => o.item.name)).toContain("Work")
})

test("call hierarchy: a member call to a DIFFERENT FB's same-named method is NOT a caller (negative)", () => {
  // Two FBs each declare `Ping`; a call to one must not report the other's method as called.
  const src = `FUNCTION_BLOCK A
END_FUNCTION_BLOCK
METHOD Ping : BOOL
END_METHOD
FUNCTION_BLOCK B
END_FUNCTION_BLOCK
METHOD Ping : BOOL
END_METHOD
FUNCTION_BLOCK User
VAR
	a : A;
END_VAR
a.Ping();
END_FUNCTION_BLOCK`
  const { doc, project } = setup(src)
  // incoming for B.Ping must be empty (only A.Ping is called)
  const bPing = prepareCallHierarchy(doc, project, src.indexOf("Ping", src.indexOf("FUNCTION_BLOCK B")) + 1)
  expect(callIncoming([doc], project, bPing!.sym)).toHaveLength(0)
})
