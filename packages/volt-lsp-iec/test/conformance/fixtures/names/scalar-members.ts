/**
 * A MEMBER READ OFF A VALUE WITH NO MEMBERS — `x.foo` (a name nothing declares) and `x.0` (a bit number) where `x` is a
 * REFERENCE TO INT, a REAL, a STRING, a TIME, a BOOL, a DATE or a REFERENCE TO REAL; and `x.foo` WRITTEN into an INT and a
 * REAL. An integer read with a name is "'x' is no structured variable", typed BIT (`sio_program_global_name`); these put
 * the same shapes to every other kind of value.
 *
 * Each FB copies the read into `out : BOOL` — a BIT result converts to it, so the only message is about the read.
 */
import type { LanguageTest } from "../../types.js"

const doc = "docs/codesys-reference/09-shadowing.md"

/** An FB `FB_LANG_<name>` declaring `decl` and `out : BOOL` (then the sections `after`), running `body`, instanced in PLC_PRG and called. */
function fb(name: string, feature: string, decl: string, body: string, after = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${decl}\n\tout : BOOL;\nEND_VAR\n${after}${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The declaration (and the statements before the read) of each base. */
const BASES: readonly { tag: string; label: string; decl: string; setup: string }[] = [
  { tag: "reference_int", label: "a REFERENCE TO INT", decl: "\tv : INT := 5;\n\tx : REFERENCE TO INT;", setup: "x REF= v;\n" },
  { tag: "real", label: "a REAL", decl: "\tx : REAL := 1.5;", setup: "" },
  { tag: "string", label: "a STRING", decl: "\tx : STRING := 'ab';", setup: "" },
  { tag: "time", label: "a TIME", decl: "\tx : TIME := T#5MS;", setup: "" },
  { tag: "bool", label: "a BOOL", decl: "\tx : BOOL := TRUE;", setup: "" },
  { tag: "date", label: "a DATE", decl: "\tx : DATE := D#2020-01-01;", setup: "" },
  { tag: "reference_real", label: "a REFERENCE TO REAL", decl: "\tv : REAL := 1.5;\n\tx : REFERENCE TO REAL;", setup: "x REF= v;\n" },
]

/** `x.foo := TRUE` into each base: the member as an assignment target. */
const WRITTEN: readonly { tag: string; label: string; decl: string }[] = [
  { tag: "int", label: "an INT", decl: "\tx : INT;" },
  { tag: "real", label: "a REAL", decl: "\tx : REAL;" },
]

export const SCALAR_MEMBER_TESTS: readonly LanguageTest[] = [
  ...BASES.flatMap(({ tag, label, decl, setup }) => [
    fb(`smem_${tag}_name`, `\`x.foo\` read off ${label}: a member name nothing declares`, decl, `${setup}out := x.foo;`),
    fb(`smem_${tag}_bit`, `\`x.0\` read off ${label}: a bit number`, decl, `${setup}out := x.0;`),
  ]),
  ...WRITTEN.map(({ tag, label, decl }) =>
    fb(`smem_${tag}_name_write`, `\`x.foo := TRUE\` written into ${label}: a member name nothing declares, as a target`, decl, "x.foo := TRUE;"),
  ),
  // the other two shapes of a bit number: a CONSTANT naming one, off a REAL; one past the width, through a REFERENCE
  fb("smem_real_constant_bit", "`x.c` read off a REAL, `c` a VAR CONSTANT INT naming bit 0", "\tx : REAL := 1.5;", "out := x.c;", "VAR CONSTANT\n\tc : INT := 0;\nEND_VAR\n"),
  fb("smem_reference_word_bit_past", "`x.17` read off a REFERENCE TO WORD: a bit number past the width", "\tv : WORD := 3;\n\tx : REFERENCE TO WORD;", "x REF= v;\nout := x.17;"),
]

