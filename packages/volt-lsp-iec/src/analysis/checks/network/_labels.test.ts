/**
 * The network-text label check (`_labels.ts`): a JMP's label across the whole body, at the recorded builds' words.
 */
import { test, expect } from "bun:test"
import { computeNetworkTextDiagnostics, messagesFor } from "../../index.js"
import { doc, project, vgDiags } from "../../../../test/support/network-docs.js"

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// A JUMP GOES TO ANOTHER NETWORK. That is what a jump IS in FBD/LD: each network may carry one label, and
// `JMP name` transfers control to the network carrying it. `NetworkTextWriter` emits that label on the
// DESTINATION network's header (`LABEL:`, from `Network.Label`, which both drivers read and write), so a
// legitimate forward jump names a label the jumping network does not carry.
//
// Checking labels per network therefore rejects the normal case and accepts only a jump to a label in its own
// network — which is either an infinite loop or a no-op. This is the shape real ladder uses.
test("network text: a JMP may target a label on ANOTHER network", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
IF a THEN JMP Done := ; END_IF;
END_NETWORK
NETWORK LABEL: Done
out := TRUE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-undefined-label")).toBe(0)
})

test("network text: a JMP to an undefined label is flagged; a defined one is not", () => {
  const bad = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
JMP Nowhere := ;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(bad).filter((d) => d.code === "jump-label-undefined").map((d) => d.message)).toEqual([
    "No such label 'NOWHERE' within the scope of the JMP statement",
  ])
  const good = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK LABEL: Loop
out := TRUE;
JMP Loop := ;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(good)).toEqual([])
})

test("network text: both vendors report a JMP to a missing label, TwinCAT with a full stop", () => {
  // Census 1.15 (DIALECT N19), measured on network text v2: TwinCAT DOES report it — `No such label 'NOWHERE' within
  // the scope of the JMP statement.` (tc-labels-edge-names.log (deleted; git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log)). The 2026-07-07 measurement that it said nothing was of
  // v1 text, and the exception it bought went with it.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
JMP Nowhere := ;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const of = (vendor: "codesys" | "twincat") =>
    computeNetworkTextDiagnostics(d, project(d), messagesFor(vendor)).filter((x) => x.code === "jump-label-undefined").map((x) => x.message)
  expect(of("codesys")).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement"])
  expect(of("twincat")).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement."])
})

// ─── labels at parity with the recorded builds (census 1.15, DIALECT N19; openspec network-text-literal-nwl 5.6) ───
// Both IDEs HOLD every shape below, so none is a gate refusal: the build reports them, and the LSP says what the build
// says — `nwl-labels.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log`) (CODESYS) and `tc-labels-edge-names.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log`) (TwinCAT) — and nothing more.

const labelsBody = (networks: string) => `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
${networks}
END_FUNCTION_BLOCK`
const labelMessages = (networks: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const d = doc(labelsBody(networks))
  return computeNetworkTextDiagnostics(d, project(d), messagesFor(vendor)).map((x) => `[${x.severity}] ${x.message}`)
}

test("network labels: one label on two networks, in any case, is the build's duplicate — and nothing else", () => {
  const networks = "NETWORK\n  JMP Done := ;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := FALSE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[error] The label 'DONE' is a duplicate"])
  expect(labelMessages(networks, "twincat")).toEqual(["[error] The label 'DONE' is a duplicate"])
  // No jump at all: the duplicate, and ONE unreferenced warning for the name (nwl-labels.log (deleted; git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log), "duplicate label, no jump").
  expect(labelMessages("NETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := FALSE;\nEND_NETWORK")).toEqual([
    "[error] The label 'DONE' is a duplicate",
    "[warning] The label 'DONE' has not been referenced",
  ])
})

test("network labels: a DISABLED network's label is no jump target", () => {
  const networks = "NETWORK\n  JMP Done := ;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := TRUE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[error] No such label 'DONE' within the scope of the JMP statement"])
  expect(labelMessages(networks, "twincat")).toEqual(["[error] No such label 'DONE' within the scope of the JMP statement."])
})

test("network labels: a JMP inside a DISABLED network references nothing", () => {
  const networks = "NETWORK DISABLED\n  JMP Done := ;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[warning] The label 'DONE' has not been referenced"])
  expect(labelMessages(networks, "twincat")).toEqual(["[warning] The label 'DONE' has not been referenced"])
})

test("network labels: a label nothing jumps to is the build's warning; a jump in another case references it", () => {
  expect(labelMessages("NETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK")).toEqual(["[warning] The label 'DONE' has not been referenced"])
  expect(labelMessages("NETWORK\n  JMP DONE := ;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK")).toEqual([])
})

// 2R.5 (awkward-sweep #9, #11): a jump is a coil — beside another coil, or two on one rung, or nested. Each one names a
// label the check resolves exactly as a lone JMP's: undefined is flagged, a referenced label is not "unreferenced".
test("network text: a jump coil beside other coils resolves its label like a lone JMP", () => {
  const src = `FUNCTION_BLOCK F
VAR c : BOOL; x1 : BOOL; y : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
  x1 := JMP Done := c;
END_NETWORK
NETWORK
  JMP Done := JMP Nowhere := c;
END_NETWORK
NETWORK
  y := (JMP Elsewhere := c);
END_NETWORK
NETWORK LABEL: Done
  out := TRUE;
END_NETWORK
END_FUNCTION_BLOCK`
  const diags = vgDiags(src)
  expect(diags.filter((d) => d.code === "jump-label-undefined").map((d) => d.message)).toEqual([
    "No such label 'NOWHERE' within the scope of the JMP statement",
    "No such label 'ELSEWHERE' within the scope of the JMP statement",
  ])
  expect(diags.filter((d) => d.code === "jump-label-unreferenced")).toEqual([])
})
