/** Signature help (`signature-help.ts`): the callee's signature and the active parameter, through an interface too. */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { hover } from "./hover.js"
import { completion } from "./completion.js"
import { signatureHelp } from "./signature-help.js"
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

test("signature-help: shows the callee signature + active parameter", () => {
  const { doc, project } = setup(SRC)
  const atFirst = SRC.indexOf("Compute(1") + "Compute(".length // on the `1`
  const help = signatureHelp(doc, project, atFirst)
  expect(help?.signatures[0]?.label).toBe("Compute(a : INT, b : INT)")
  expect(help?.signatures[0]?.parameters).toHaveLength(2)
  expect(help?.activeParameter).toBe(0)
  const atSecond = SRC.indexOf(", 2") + 2 // on the `2`
  expect(signatureHelp(doc, project, atSecond)?.activeParameter).toBe(1)
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

  test("signature help resolves the interface method's parameters", () => {
    const { doc, project } = setup()
    const sig = signatureHelp(doc, project, SRC.indexOf("Spin(10") + 5) as { signatures?: { label: string }[] }
    expect(sig?.signatures?.[0]?.label).toBe("Spin(dist : INT)")
  })
})
