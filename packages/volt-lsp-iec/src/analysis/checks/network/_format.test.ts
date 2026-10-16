/**
 * The format's own findings (`_format.ts`, readability.md P9, P12, P13): a split reused across networks of one body, an
 * enable shown with nothing wired, a coil on the rail. None is an error.
 */
import { test, expect } from "bun:test"
import { vgDiags } from "../../../../test/support/network-docs.js"

const fb = (networks: string) =>
  `FUNCTION_BLOCK F\nVAR a : BOOL; b : BOOL; x : BOOL; y : BOOL; i : INT; END_VAR\nIMPLEMENTATION LD\n${networks}END_FUNCTION_BLOCK`
const of = (src: string, code: string) => vgDiags(src).filter((d) => d.code === code)

test("network text: a split defined in two networks of one body is a warning on the second (P9)", () => {
  const src = fb("NETWORK\n  split1 := a;\n  x := split1;\nEND_NETWORK\nNETWORK\n  split1 := b;\n  y := split1;\nEND_NETWORK\n")
  const got = of(src, "network-split-reused")
  expect(got.map((d) => d.severity)).toEqual(["warning"])
  expect(got[0]!.message).toContain("network 1")
  expect(of(src.replace("split1 := b;\n  y := split1;", "split2 := b;\n  y := split2;"), "network-split-reused")).toEqual([])
})

test("network text: EN with nothing after it is a hint, and so is a coil on the rail (P12, P13)", () => {
  expect(of(fb("NETWORK\n  MOVE 1 => i EN;\nEND_NETWORK\n"), "network-en-unwired").map((d) => d.severity)).toEqual(["hint"])
  expect(of(fb("NETWORK\n  MOVE 1 => i EN a;\nEND_NETWORK\n"), "network-en-unwired")).toEqual([])
  expect(of(fb("NETWORK\n  x R= ;\nEND_NETWORK\n"), "network-coil-on-rail").map((d) => d.severity)).toEqual(["hint"])
  expect(of(fb("NETWORK\n  x R= a;\nEND_NETWORK\n"), "network-coil-on-rail")).toEqual([])
})
