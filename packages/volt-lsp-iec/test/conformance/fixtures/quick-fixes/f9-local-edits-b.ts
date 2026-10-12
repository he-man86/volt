/**
 * F9, continued — the LOCAL EDITS to a keyword, a modifier or a header (design.md §4 F9): RETAIN where it is not allowed
 * (C0175), PRIVATE on a function block (`access-only-on-methods`), a PROGRAM's return type (C0182), a FUNCTION's
 * `pack_mode` (C0550, CODESYS only), an interface that IMPLEMENTS another (C0421), a BIT outside a structure or function
 * block (C0203), a signature naming something other than its object (`signature-name-mismatch`).
 */
import type { LanguageTest } from "../../types.js"
import { after, DOC, fb } from "./shared.js"

/** A fixture whose FUNCTION `F_LANG_<name>` PLC_PRG calls. */
function fn(name: string, feature: string, source: (n: string) => string): LanguageTest {
  return {
    name,
    pouName: `F_LANG_${name}`,
    kind: "function",
    feature,
    fromDoc: DOC,
    source: source(name),
    plcPrgVar: `r_${name} : INT;`,
    plcPrgBody: `r_${name} := F_LANG_${name}(i := 1);`,
  }
}
/** A fixture whose PROGRAM `PRG_LANG_<name>` PLC_PRG calls. */
function prg(name: string, feature: string, source: (n: string) => string): LanguageTest {
  return { name, pouName: `PRG_LANG_${name}`, kind: "program", feature, fromDoc: DOC, source: source(name), plcPrgVar: `seen_${name} : BOOL;`, plcPrgBody: `PRG_LANG_${name}();\nseen_${name} := TRUE;` }
}
const retain = (n: string, section: string): string => `FUNCTION F_LANG_${n} : INT\n${section}\n\ti : INT;\nEND_VAR\nF_LANG_${n} := i;\nEND_FUNCTION\n`
const packed = (n: string, pragma: string): string =>
  `${pragma}FUNCTION F_LANG_${n} : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\nF_LANG_${n} := i + 1;\nEND_FUNCTION\n`
const derived = (n: string, keyword: string): string =>
  `INTERFACE ITF_LANG_${n}_a\nMETHOD GetA : INT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE ITF_LANG_${n}_b ${keyword} ITF_LANG_${n}_a\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} IMPLEMENTS ITF_LANG_${n}_b\nVAR\n\tout : INT;\nEND_VAR\nout := GetA();\nEND_FUNCTION_BLOCK\n\nMETHOD GetA : INT\nGetA := 2;\nEND_METHOD\n`
const bits = (n: string, type: string): string => `PROGRAM PRG_LANG_${n}\nVAR\n\tb : ${type};\n\tout : BOOL;\nEND_VAR\nb := TRUE;\nout := b;\nEND_PROGRAM\n`
const signature = (n: string, declared: string): string =>
  `FUNCTION_BLOCK ${declared}\nVAR\n\tout : INT;\nEND_VAR\nout := out + 1;\nEND_FUNCTION_BLOCK\n`

export const QF_LOCAL_EDIT_B_TESTS: readonly LanguageTest[] = [
  fn("qf_c0175_before", "BEFORE — a FUNCTION's VAR_INPUT RETAIN", (n) => retain(n, "VAR_INPUT RETAIN")),
  after(fn("qf_c0175_remove", "AFTER — RETAIN removed", (n) => retain(n, "VAR_INPUT")),
    { before: "qf_c0175_before", code: "C0175", title: "Remove RETAIN", preferred: true }),

  fb("qf_access_before", "BEFORE — a PRIVATE function block",
    (n) => `FUNCTION_BLOCK PRIVATE FB_LANG_${n}\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  after(fb("qf_access_remove", "AFTER — PRIVATE removed", (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_access_before", code: "access-only-on-methods", title: "Remove PRIVATE", preferred: true }),

  prg("qf_c0182_before", "BEFORE — a PROGRAM with a return type",
    (n) => `PROGRAM PRG_LANG_${n} : INT\nVAR\n\tout : INT;\nEND_VAR\nout := 3;\nEND_PROGRAM\n`),
  after(prg("qf_c0182_remove", "AFTER — the return type removed", (n) => `PROGRAM PRG_LANG_${n}\nVAR\n\tout : INT;\nEND_VAR\nout := 3;\nEND_PROGRAM\n`),
    { before: "qf_c0182_before", code: "C0182", title: "Remove the return type", preferred: true }),

  fn("qf_c0550_before", "BEFORE — pack_mode on a FUNCTION", (n) => packed(n, "{attribute 'pack_mode' := '1'}\n")),
  after(fn("qf_c0550_remove", "AFTER — the attribute removed", (n) => packed(n, "")),
    { before: "qf_c0550_before", code: "C0550", title: "Remove the attribute", preferred: true }),

  fb("qf_c0421_before", "BEFORE — an interface IMPLEMENTS another", (n) => derived(n, "IMPLEMENTS")),
  after(fb("qf_c0421_extends", "AFTER — EXTENDS", (n) => derived(n, "EXTENDS")),
    { before: "qf_c0421_before", code: "C0421", title: "Change to EXTENDS", preferred: true }),

  prg("qf_c0203_before", "BEFORE — a BIT in a PROGRAM", (n) => bits(n, "BIT")),
  after(prg("qf_c0203_bool", "AFTER — a BOOL", (n) => bits(n, "BOOL")),
    { before: "qf_c0203_before", code: "C0203", title: "Change BIT to BOOL", preferred: true }),

  fb("qf_sn_before", "BEFORE — a signature naming something other than its object", (n) => signature(n, `FB_LANG_${n}_signature`),
    { plcPrgVar: "inst_qf_sn_before : FB_LANG_qf_sn_before_signature;" }),
  after(fb("qf_sn_rename", "AFTER — the signature renamed to the object", (n) => signature(n, `FB_LANG_${n}`)),
    { before: "qf_sn_before", code: "signature-name-mismatch", title: "Rename to 'FB_LANG_qf_sn_before'", preferred: true }),
]
