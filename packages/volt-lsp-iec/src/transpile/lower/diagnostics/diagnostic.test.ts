/**
 * EVERY LOWERING DIAGNOSTIC NAMES ITS FILE (openspec `lowering-diagnostic-uri`): `uri` is the file its span is in, and the
 * span points at the CAUSE in that file — the main source, a second POU, a GVL, a library (Standard). A body that does not
 * lower is refused once per POU, at that POU in its own file, however many calls reach it.
 *
 * The class sweep over every code any program produces is the coherence check (`misplaced`): `lowerSource` asks it of every
 * answer — so every lowering of the suite, every fixture and every test snippet, is checked — and the corpus gate of every
 * corpus POU: each diagnostic's uri is one of the lowering's own files and its span is a span OF THAT FILE. These pin the
 * cross-file cases per code, where coherence alone cannot tell the cause's file from another's.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"
import { libraryBase } from "../project/library-base.js"
import type { LowerDiagnostic } from "./diagnostic.js"

type File = { uri: string; source: string }
const MAIN = "Main.pou"

/** Each diagnostic as code, file, the line its span starts on, and the text it covers. */
function where(diagnostics: readonly LowerDiagnostic[], files: readonly File[], main: string): [string, string, number, string][] {
  const text = (uri: string): string => (uri === MAIN ? main : files.find((f) => f.uri === uri)!.source)
  return diagnostics.map((d) => [d.code, d.uri, d.span.startLine, text(d.uri).slice(d.span.start, d.span.end).split("\n")[0]!])
}
const lowered = (main: string, files: File[]) => where(lowerSource(main, "Main", files, MAIN).diagnostics, files, main)

const FB_L: File = {
  uri: "FB_L.pou",
  source: "FUNCTION_BLOCK FB_L\nVAR_INPUT\n\ti : BOOL;\nEND_VAR\nVAR_OUTPUT\n\to : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\no := i;\nEND_FUNCTION_BLOCK\n",
}

describe("the draft's repro: a reached LD/FBD POU", () => {
  test("one diagnostic, in FB_L.pou, at FB_L", () => {
    expect(lowered("PROGRAM Main\nVAR\n\tf : FB_L;\nEND_VAR\nf(i := TRUE);\nEND_PROGRAM\n", [FB_L])).toEqual([
      ["graphical-body", "FB_L.pou", 1, "FB_L"],
    ])
  })

  test("two instances, both called: still the one diagnostic — no `call-body` for the same cause", () => {
    const { diagnostics } = lowerSource("PROGRAM Main\nVAR\n\tf, g : FB_L;\nEND_VAR\nf(i := TRUE);\ng(i := FALSE);\nEND_PROGRAM\n", "Main", [FB_L], MAIN)
    expect(diagnostics.map((d) => [d.code, d.uri, d.message])).toEqual([["graphical-body", "FB_L.pou", "FB_L is plain-ST network text, which is not lowered yet"]])
  })
})

describe("per code, the file that holds the cause", () => {
  test("in the main source: a refusal of the POU's own body", () => {
    expect(lowered("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := 'é';\nEND_PROGRAM\n", [])).toEqual([["string-non-ascii", MAIN, 5, "'é'"]])
  })

  test("in a second POU: a positional call past the parameters, inside FB_X's body", () => {
    const fbx: File = { uri: "FB_X.pou", source: "FUNCTION_BLOCK FB_X\nVAR\n\tn : INT;\nEND_VAR\nn := F_One(1, 2);\nEND_FUNCTION_BLOCK\n" }
    const f: File = { uri: "F_One.pou", source: "FUNCTION F_One : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nF_One := a;\nEND_FUNCTION\n" }
    const got = lowered("PROGRAM Main\nVAR\n\tx : FB_X;\nEND_VAR\nx();\nEND_PROGRAM\n", [fbx, f])
    expect(got.map(([code, uri, line]) => [code, uri, line])).toEqual([["call-positional", "FB_X.pou", 5]])
  })

  test("in a second POU's METHOD and in a FUNCTION: each in its own file", () => {
    const fbm: File = { uri: "FB_M.pou", source: "FUNCTION_BLOCK FB_M\nEND_FUNCTION_BLOCK\nMETHOD Go : INT\nGo := 'é';\nEND_METHOD\n" }
    expect(lowered("PROGRAM Main\nVAR\n\tm : FB_M;\n\tn : INT;\nEND_VAR\nn := m.Go();\nEND_PROGRAM\n", [fbm])).toEqual([["string-non-ascii", "FB_M.pou", 4, "'é'"]])
    const fn: File = { uri: "F_S.pou", source: "FUNCTION F_S : INT\nF_S := 'é';\nEND_FUNCTION\n" }
    expect(lowered("PROGRAM Main\nVAR\n\tn : INT;\nEND_VAR\nn := F_S();\nEND_PROGRAM\n", [fn])).toEqual([["string-non-ascii", "F_S.pou", 2, "'é'"]])
  })

  test("in a GVL: a declaration the body reaches, at that declaration", () => {
    const list: File = { uri: "GVL_X.gvl", source: "VAR_GLOBAL\n\tok : INT;\n\tbad : STRING := 'é';\nEND_VAR\n" }
    expect(lowered("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nbad := 'a';\nEND_PROGRAM\n", [list])).toEqual([["string-non-ascii", "GVL_X.gvl", 3, "'é'"]])
  })

  test("in a DUT: a field no backend holds, at the field — not at the POU that holds the struct", () => {
    const dut: File = { uri: "ST_U.dut", source: "TYPE ST_U :\nSTRUCT\n\tok : INT;\n\tmissing : T_Missing;\nEND_STRUCT\nEND_TYPE\n" }
    expect(lowered("PROGRAM Main\nVAR\n\trec : ST_U;\nEND_VAR\nrec.ok := 1;\nEND_PROGRAM\n", [dut])).toEqual([["slot-unknown", "ST_U.dut", 4, "missing"]])
  })

  test("in a DUT: an alias type's own initializer a variable takes, at that initializer — as a variable and as an element", () => {
    const dut: File = { uri: "T_Text.dut", source: "TYPE T_Text : STRING := 'é';\nEND_TYPE\n" }
    expect(lowered("PROGRAM Main\nVAR\n\tx : T_Text;\nEND_VAR\nEND_PROGRAM\n", [dut])).toEqual([["string-non-ascii", "T_Text.dut", 1, "'é'"]])
    expect(lowered("PROGRAM Main\nVAR\n\tx : ARRAY[1..2] OF T_Text;\nEND_VAR\nEND_PROGRAM\n", [dut])).toEqual([["string-non-ascii", "T_Text.dut", 1, "'é'"]])
  })

  test("in a GVL: an FB instance whose init the init step does not walk, at the instance", () => {
    const fb: File = {
      uri: "FB_I.pou",
      source: "FUNCTION_BLOCK FB_I\nVAR\n\tk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nk := 5;\nEND_METHOD\n",
    }
    const list: File = { uri: "GVL_I.gvl", source: "VAR_GLOBAL\n\tinst : FB_I;\nEND_VAR\n" }
    expect(lowered("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_PROGRAM\n", [fb, list])).toEqual([["attr-init-unreached", "GVL_I.gvl", 2, "inst"]])
  })

  test("in Standard: a library element with no body written, at that element in the library's file", () => {
    const standard = "file:///p/Library Manager/Standard"
    const ton = `${standard}/TON.pou`
    const tonSource = "FUNCTION_BLOCK TON\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
    const base = libraryBase([
      { uri: `${standard}/Standard.library`, source: "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.18.0 (System)\nPLACEHOLDER true\nSYSTEM false\nMATERIALIZATION 4\n" },
      { uri: ton, source: tonSource },
    ])
    const main = "PROGRAM Main\nVAR\n\tt : TON;\nEND_VAR\nt(IN := TRUE, PT := T#1S);\nEND_PROGRAM\n"
    const { diagnostics } = lowerSource(main, "Main", [], MAIN, base)
    expect(diagnostics.map((d) => [d.code, d.uri, d.span.startLine, tonSource.slice(d.span.start, d.span.end)])).toEqual([["call-library", ton, 1, "TON"]])
  })

  test("a parse error of another file names that file", () => {
    const broken: File = { uri: "GVL_P.gvl", source: "VAR_GLOBAL\n\tx : ;\nEND_VAR\n" }
    const { diagnostics } = lowerSource("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_PROGRAM\n", "Main", [broken], MAIN)
    expect(diagnostics.map((d) => [d.code, d.uri, d.span.startLine])).toEqual([["parse", "GVL_P.gvl", 2]])
  })
})
