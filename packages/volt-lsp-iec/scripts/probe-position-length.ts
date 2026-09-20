/**
 * WHAT DOES `__POSITION` EXPAND TO? — asked through the one number the compiler will tell us.
 *
 * CODESYS types `__POSITION` as a sized string LITERAL: `here := __POSITION();` into a DINT is "Cannot convert
 * type 'STRING(INT#23)' to type 'DINT'", and the same operator in a declaration initializer is 'STRING(INT#13)'.
 * The LSP says plain `STRING`, so both cells are LSP-only messages — false positives by `lsp-parity-not-better`
 * — and they cannot be closed by guessing: the size is the LENGTH OF THE TEXT the operator expands to, and
 * nothing documents that text. TwinCAT has no `__POSITION` at all ("Identifier '__POSITION' not defined").
 *
 * The length is measurable without ever seeing the string. Vary ONE thing per probe, build, read the size back
 * out of the error. Measured 2026-09-20 against CODESYS SP21 — twelve probes, and the interesting half:
 *
 *   BODY  `here := __POSITION();`  line 1, column 1          23
 *         POU name ten characters longer                     23
 *         indented ten spaces (column 11)                    24
 *         indented ninety-nine spaces (column 100)           25
 *         statement on line 16 / line 106                    24 / 25
 *         in a METHOD rather than the FB body                23
 *   DECL  `here : DINT := __POSITION;`  line 3, column 2     13
 *         POU name ten characters longer                     13
 *         initializer pushed out to column 101               13
 *         declaration on line 16 / line 106                  14 / 15
 *
 * ONE MODEL FITS ALL TWELVE: length = CONSTANT + digits(line) + digits(column), counted inside the POU's own
 * text, with CONSTANT = 21 in an implementation and 11 in a declaration. The POU's NAME is not in it, and
 * neither is whether the code sits in a method or an FB body. (The declaration form's column never moved: it
 * follows the declared NAME, not the initializer — `here` is at column 2 in every one of those probes.)
 *
 * AND THE TEXT ITSELF, read out of the SIMULATOR a few hours later (`sysop_position_value`, `record:exec`):
 *
 *     implementation   'Line 1, Column 1 (Impl)'      23 = 21 + digits(line) + digits(column)
 *                      'Line 2, Column 11 (Impl)'     24  — the same statement indented ten spaces
 *     declaration      'Line 5 (Decl)'                13 = 12 + digits(line), and NO column at all
 *
 * So both constants are explained, and so is every probe below. `Line `+`, Column `+` (Impl)` is 21 characters;
 * `Line `+` (Decl)` is 12. The LINE is counted inside the POU's own part (the header is declaration line 1, the
 * first statement is implementation line 1) and the COLUMN is the STATEMENT'S, not the operator's — probe J,
 * which pushed only the initializer out to column 101 and measured nothing, was asking about a number the
 * declaration form does not carry.
 *
 * WHAT THE LSP STILL DOES NOT KNOW is where a POU's implementation starts and which statement encloses an
 * expression. Both are derivable from the source it already has, and neither is tracked today, so the two
 * CODESYS cells (`sysop_position_call_form`, `sysop_position_initializer`) stay on the backlog with the whole
 * rule written down rather than with a fitted constant implemented.
 *
 * It did answer one thing nobody asked: BLANK LINES AT THE START OF AN IMPLEMENTATION ARE DROPPED on the way
 * in. The first attempt at the line probes padded with empty lines and measured no change at all; the same
 * probes padded with real statements moved the number every time.
 *
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/probe-position-length.ts
 *
 * ALWAYS POINT THIS AT A COPY (see probe-is-it-compiled.ts): it writes PLC_PRG and restores after each probe.
 */
import { call } from "./bridge.js"
import { markImplementations } from "../test/conformance/support/mark-implementations.js"

const refs = async (): Promise<any> => await call("refs")
const version = async (name: string): Promise<string | null> => (await refs()).items[name] ?? null
const push = async (ops: unknown[]): Promise<void> => {
  const r = await call("push", { expectedProjectVersion: (await refs()).projectVersion, ops })
  if (!r.accepted) throw new Error(`push rejected: ${JSON.stringify(r.conflicts ?? r)}`)
}
const build = async (): Promise<string[]> =>
  ((await call("build", { buildType: "full" })).diagnostics ?? []).map((d: any) => String(d.message))

const health = await call("health")
const selected = (health.projects ?? []).map((p: any) => p.project).find((n: any) => typeof n === "string")
if (selected !== undefined) await call("connect", { project: selected })

const PLC = "PLC_PRG.prg"

/** Sources are joined from LINES — no escapes, so nothing in this file can be mangled into a real newline. */
const NL = String.fromCharCode(10)
const TAB = String.fromCharCode(9)
const src = (...lines: string[]): string => lines.join(NL) + NL
const filler = (n: number): string[] => Array.from({ length: n }, () => "here := 1;")
const decls = (n: number): string[] => Array.from({ length: n }, (_, i) => `${TAB}fill${i} : DINT;`)
const pristine = src("PROGRAM PLC_PRG", "VAR", "", "END_VAR", "", "END_PROGRAM")

const PROBES: { tag: string; name?: string; varies: string; fb: (name: string) => string }[] = [
  {
    tag: "A",
    varies: "baseline - body line 1, column 1",
    fb: (n) => src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", "here := __POSITION();", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "B",
    name: "FB_PP_BBBBBBBBBBB",
    varies: "POU NAME ten characters longer",
    fb: (n) => src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", "here := __POSITION();", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "C",
    varies: "COLUMN 11 - indented ten spaces",
    fb: (n) =>
      src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", `${" ".repeat(10)}here := __POSITION();`, "END_FUNCTION_BLOCK"),
  },
  {
    tag: "D",
    varies: "COLUMN 100 - three digits",
    fb: (n) =>
      src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", `${" ".repeat(99)}here := __POSITION();`, "END_FUNCTION_BLOCK"),
  },
  {
    tag: "E",
    varies: "LINE 16 - reached by real statements, because blank ones are dropped on the way in",
    fb: (n) =>
      src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", ...filler(15), "here := __POSITION();", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "F",
    varies: "LINE 106 - three digits",
    fb: (n) =>
      src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT;`, "END_VAR", ...filler(105), "here := __POSITION();", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "G",
    varies: "in a METHOD rather than the FB body",
    fb: (n) =>
      src(
        `FUNCTION_BLOCK ${n}`,
        "VAR",
        "END_VAR",
        "END_FUNCTION_BLOCK",
        "",
        "METHOD Run : DINT",
        "VAR",
        `${TAB}here : DINT;`,
        "END_VAR",
        "here := __POSITION();",
        "END_METHOD",
      ),
  },
  {
    tag: "H",
    varies: "a DECLARATION initializer, line 3",
    fb: (n) => src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT := __POSITION;`, "END_VAR", "here := here;", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "I",
    name: "FB_PP_IIIIIIIIIII",
    varies: "a DECLARATION initializer, POU name ten characters longer",
    fb: (n) => src(`FUNCTION_BLOCK ${n}`, "VAR", `${TAB}here : DINT := __POSITION;`, "END_VAR", "here := here;", "END_FUNCTION_BLOCK"),
  },
  {
    tag: "J",
    varies: "a DECLARATION initializer at column 101",
    fb: (n) =>
      src(
        `FUNCTION_BLOCK ${n}`,
        "VAR",
        `${TAB}here : DINT :=${" ".repeat(85)}__POSITION;`,
        "END_VAR",
        "here := here;",
        "END_FUNCTION_BLOCK",
      ),
  },
  {
    tag: "K",
    varies: "a DECLARATION initializer on declaration line 16",
    fb: (n) =>
      src(
        `FUNCTION_BLOCK ${n}`,
        "VAR",
        ...decls(13),
        `${TAB}here : DINT := __POSITION;`,
        "END_VAR",
        "here := here;",
        "END_FUNCTION_BLOCK",
      ),
  },
  {
    tag: "L",
    varies: "a DECLARATION initializer on declaration line 106",
    fb: (n) =>
      src(
        `FUNCTION_BLOCK ${n}`,
        "VAR",
        ...decls(103),
        `${TAB}here : DINT := __POSITION;`,
        "END_VAR",
        "here := here;",
        "END_FUNCTION_BLOCK",
      ),
  },
]

for (const p of PROBES) {
  const name = p.name ?? `FB_PP_${p.tag}`
  const wire = `${name}.fb`
  try {
    await push([{ op: "set", name: wire, toFolder: null, sourceText: markImplementations(p.fb(name)), ifVersion: await version(wire) }])
    const plc = src("PROGRAM PLC_PRG", "VAR", `${TAB}inst : ${name};`, "END_VAR", "inst();", "END_PROGRAM")
    await push([{ op: "set", name: PLC, toFolder: null, sourceText: markImplementations(plc), ifVersion: await version(PLC) }])
    const sized = (await build()).map((m) => /STRING\(INT#(\d+)\)/.exec(m)?.[1]).find((s) => s !== undefined)
    console.log(`${p.tag}  ${(sized === undefined ? "no sized STRING" : `STRING(INT#${sized})`).padEnd(16)} ${p.varies}`)
  } finally {
    await push([{ op: "set", name: PLC, toFolder: null, sourceText: markImplementations(pristine), ifVersion: await version(PLC) }])
    const v = await version(wire)
    if (v !== null) await push([{ op: "deleteItem", name: wire, ifVersion: v }])
  }
}
