/**
 * THE `{attribute '…'}` NAMES EACH DIALECT KNOWS — a vocabulary of the language (moved here from the dissolved
 * `reference/` catalog, openspec lsp-same-standard 2.2). The oracle for the opt-in `unknown-attribute` check: CODESYS
 * warns "The attribute <n> is unknown and will be ignored by the compiler" on an attribute it doesn't recognize (a typo
 * like `qualifid_only`, or a name from a library not referenced). Matching that is only as good as this list is
 * COMPLETE, so the check is opt-in (default OFF) — a missing entry would false-positive on a valid attribute.
 * Completion offers these names and hover describes them (`services/assist/builtin-hover.ts`), each in the project's
 * dialect only.
 *
 * Source: CODESYS `07-pragmas.md` (+ the TwinCAT `Tc*` attribute family). Lowercased, alias-folded. The attributes in
 * the AST (where an attribute attaches) are `attributes.ts`, beside this file.
 */
import type { Dialect } from "../lex/vocabulary.js"

// Attribute names accepted after `{attribute '…'}` (CODESYS + shared), plus alias spellings.
const CODESYS_ATTRIBUTES: readonly string[] = [
  // `abstract` was missing, so every use warned "The attribute … is unknown and will be ignored" — a false positive
  // the IDE never emits, which also hid its own "The ABSTRACT keyword is missing" (conformance `cc4_not_instantiable`).
  // `deprecated` is NOT CODESYS's: it warns it unknown (`cc4_obsolete_and_deprecated`, re-recorded 2026-10-02 with the
  // pragma pushed — the recorder had dropped it, frontend-conformance 2.7.2).
  "abstract",
  "analysis",
  "call_after_global_init_slot",
  "call_after_init",
  "call_after_online_change_slot",
  "call_before_global_exit_slot",
  "call_on_type_change",
  "conditionalshow",
  "conditionalshow_all_locals",
  "const_non_replaced",
  "const_replaced",
  "dataflow",
  "displaymode",
  "enable_dynamic_creation",
  "estimated-stack-usage",
  "expandfully",
  "global_init_slot",
  "hide",
  "hide_all_locals",
  "implicit-parameter",
  "init_namespace",
  "init_on_onlchange",
  "initialize_on_call",
  "instance-path",
  "io_function_block",
  "io_function_block_mapping",
  "is_connected",
  "linkalways",
  "monitoring",
  "monitoring_display",
  "monitoring_encoding",
  "no_assign",
  "no_assign_warning",
  "no_check",
  "no_copy",
  "no_explicit_call",
  "no_instance_in_retain",
  "no_virtual_actions",
  "no-exit",
  "noinit",
  "no_init", // alias of noinit
  "no-init", // alias of noinit
  "obsolete",
  "pack_mode",
  "persistent",
  "pin_presentation_order_inputs",
  "pin_presentation_order_outputs",
  "pingroup",
  "processvalue",
  "qualified_only",
  "reflection",
  "retain",
  "strict",
  "subsequent",
  "suppress_warning",
  "symbol",
  "to_string",
]

// TwinCAT `Tc*` attribute family (also written `{attribute 'Tc…'}`).
const TWINCAT_ATTRIBUTES: readonly string[] = [
  "tc2gvlvarnames",
  "tccallafteroutputupdate",
  "tccontextid",
  "tccontextname",
  "tcdisplayscale",
  "tcencoding",
  "tcglobaldatatype",
  "tchidesubitems",
  "tcignorepersistent",
  "tcinitonreset",
  "tcinitsymbol",
  "tclinkto",
  "tclinktooso", // alias of tclinkto
  "tcncaxis",
  "tcnosymbol",
  "tc_no_symbol", // alias of tcnosymbol
  "tcpersistent",
  "tcretain",
  "tcrpcenable",
  "tcswapdword",
  "tcswapword",
]

/**
 * WHOSE ATTRIBUTE IS IT? One flat set held both families, and that is the one thing this catalog must not do:
 * `{attribute 'TcRetain'}` is a real attribute to TwinCAT and an unknown one to CODESYS, which says so —
 * "The attribute TcRetain is unknown and will be ignored by the  compiler." Sixteen `tc_*` fixtures recorded
 * exactly that warning on CODESYS and silence on TwinCAT (2026-09-20), and the LSP answered silence to both
 * because the merged set made every `Tc*` name known everywhere.
 *
 * The reverse does not hold, and is deliberately not asserted: TwinCAT emits NOTHING for an attribute it does
 * not know (the `unknown-attribute` check is CODESYS-only for that reason), so a CODESYS name there is simply
 * not a question anyone can answer.
 */
const KNOWN_BY_DIALECT: Readonly<Record<Dialect, ReadonlySet<string>>> = {
  codesys: new Set(CODESYS_ATTRIBUTES),
  twincat: new Set([...CODESYS_ATTRIBUTES, ...TWINCAT_ATTRIBUTES]),
}

/** The `{attribute '…'}` names to OFFER — the dialect's own, so CODESYS is never offered a name it warns about. */
export function attributeNames(dialect: Dialect): readonly string[] {
  return dialect === "twincat" ? [...CODESYS_ATTRIBUTES, ...TWINCAT_ATTRIBUTES] : CODESYS_ATTRIBUTES
}

/** True when `name` is an attribute THIS DIALECT recognizes (case-insensitive). */
export function isKnownAttribute(name: string, dialect: Dialect): boolean {
  return KNOWN_BY_DIALECT[dialect].has(name.toLowerCase())
}
