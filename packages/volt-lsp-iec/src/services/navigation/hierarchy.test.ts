import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { implementation } from "./implementation.js"
import {
  prepareTypeHierarchy,
  typeSubtypes,
  typeSupertypes,
  prepareCallHierarchy,
  callIncoming,
  callOutgoing,
} from "./hierarchy.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
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
  const subs = typeSubtypes(project, base!.sym).map((i) => i.name)
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

// ─── navigation breadth (openspec lsp-quick-fixes design.md §6, tasks.md 2.4): the gaps the since-deleted nav-breadth probe
// (`git show 0db2d45fcd:packages/volt-lsp-iec/scripts/nav-breadth.ts`) measured — calls through an FB INSTANCE (B1), a
// PROGRAM called (B2), a PROPERTY's accessors as its outgoing calls
// (B3), `SUPER^()` (B4) ───

function setupFiles(files: Record<string, string>) {
  const docs: Document[] = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
  const project = build.buildSymbolTable(docs.map((d) => ({ uri: d.uri, parseResult: d.parseResult, source: d.source })), [], "codesys")
  return { docs, project }
}
const offsetOf = (src: string, needle: string) => src.indexOf(needle) + 1

const BREADTH_CALLS = `FUNCTION_BLOCK FB_Worker
VAR
\tn : INT;
END_VAR
%LANGUAGE ST
n := n + 1;
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Derived EXTENDS FB_Worker
%LANGUAGE ST
SUPER^();
END_FUNCTION_BLOCK
PROGRAM PRG_Tick
%LANGUAGE ST
;
END_PROGRAM
PROGRAM PRG_Main
VAR
\tone : FB_Worker;
\tmany : ARRAY[1..2] OF FB_Worker;
END_VAR
%LANGUAGE ST
one();
many[1]();
PRG_Tick();
END_PROGRAM
`

test("B1/B2/B4: a call of an FB instance, of an array element instance, of SUPER^ is a call of the FB's body; a PROGRAM is callable", () => {
  const { docs, project } = setupFiles({ "file:///calls.pou": BREADTH_CALLS })
  const doc = docs[0]!
  const worker = prepareCallHierarchy(doc, project, offsetOf(BREADTH_CALLS, "FB_Worker\nVAR"))!
  expect(callIncoming(docs, project, worker.sym).map((c) => [c.item.name, c.ranges.length]).sort()).toEqual([["FB_Derived", 1], ["PRG_Main", 2]])
  const tick = prepareCallHierarchy(doc, project, offsetOf(BREADTH_CALLS, "PRG_Tick\n%LANGUAGE"))
  expect(tick?.item.name).toBe("PRG_Tick")
  expect(callIncoming(docs, project, tick!.sym).map((c) => c.item.name)).toEqual(["PRG_Main"])
  const main = prepareCallHierarchy(doc, project, offsetOf(BREADTH_CALLS, "PRG_Main"))!
  expect(callOutgoing(doc, project, main.sym).map((c) => c.item.name).sort()).toEqual(["FB_Worker", "PRG_Tick"])
})

const PROPERTY = `FUNCTION F_Seven : INT
%LANGUAGE ST
F_Seven := 7;
END_FUNCTION
FUNCTION_BLOCK FB_P
END_FUNCTION_BLOCK
PROPERTY Level : INT
GET
%LANGUAGE ST
Level := F_Seven();
END_GET
END_PROPERTY
`

test("B3: a call hierarchy prepares on a PROPERTY, its accessors' calls are its outgoing calls", () => {
  const { docs, project } = setupFiles({ "file:///p.pou": PROPERTY })
  const prep = prepareCallHierarchy(docs[0]!, project, offsetOf(PROPERTY, "Level : INT"))
  expect(prep?.item.name).toBe("Level")
  expect(callOutgoing(docs[0]!, project, prep!.sym).map((c) => c.item.name)).toEqual(["F_Seven"])
})
