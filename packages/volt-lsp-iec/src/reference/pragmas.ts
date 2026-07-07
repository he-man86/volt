/**
 * Pragma-attribute catalog (Layer F · reference). The known names that may follow `{attribute '…'}` — the
 * oracle for the opt-in `unknown-attribute` lint: CODESYS warns "The attribute <n> is unknown and will be
 * ignored by the compiler" on an attribute it doesn't recognize (a typo like `qualifid_only`, or a name from
 * a library not referenced). Matching that is only as good as this list is COMPLETE, so the lint is opt-in
 * (default OFF) — a missing entry would false-positive on a valid attribute.
 *
 * Source: CODESYS `07-pragmas.md` (+ the TwinCAT `Tc*` attribute family). Lowercased, alias-folded.
 * ponytail: names only — the lint needs a membership test, not the full hover metadata (syntax/gotchas/
 * companions). Add the rich `PragmaEntry` shape back when hover/completion or conflict checks need it.
 */

// Attribute names accepted after `{attribute '…'}` (CODESYS + shared), plus alias spellings.
const CODESYS_ATTRIBUTES: readonly string[] = [
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

const KNOWN_ATTRIBUTES: ReadonlySet<string> = new Set([...CODESYS_ATTRIBUTES, ...TWINCAT_ATTRIBUTES])

/** All recognized `{attribute '…'}` names (CODESYS + TwinCAT, alias spellings included) — for completion. */
export const KNOWN_ATTRIBUTE_NAMES: readonly string[] = [...CODESYS_ATTRIBUTES, ...TWINCAT_ATTRIBUTES]

/** True when `name` is a recognized `{attribute '…'}` attribute (case-insensitive). */
export function isKnownAttribute(name: string): boolean {
  return KNOWN_ATTRIBUTES.has(name.toLowerCase())
}

/**
 * Pragma DIRECTIVES — the first word of a `{…}` pragma (as opposed to the attribute NAME that follows
 * `{attribute '…'}`). One-liners power hover; the name set powers the opt-in `unknown-pragma` lint.
 * Source: CODESYS `07-pragmas.md` (conditional-compilation, message, region, attribute) + the corpus.
 * `end_region`/`endregion` are both accepted spellings. Directive-arg operators (`defined`, `hasvalue`,
 * `hastype`, `hasattribute`) live INSIDE `{IF …}`, so they are never a leading directive — not listed.
 */
const DIRECTIVES: Readonly<Record<string, string>> = {
  attribute: "Attaches a compiler attribute to the following declaration.",
  if: "Conditional-compilation start — the block compiles only when the expression is true.",
  elsif: "Conditional-compilation alternative branch (`{IF}` … `{ELSIF}` … `{END_IF}`).",
  else: "Conditional-compilation fallback branch.",
  end_if: "Closes a conditional-compilation `{IF}` block.",
  define: "Defines a conditional-compilation symbol (used by `{IF defined(…)}`).",
  undefine: "Removes a conditional-compilation symbol.",
  region: "Starts a named, foldable source region (editor-only).",
  end_region: "Closes a `{region}` block.",
  endregion: "Closes a `{region}` block (alias of `end_region`).",
  warning: "Emits an author-defined compiler warning where reached.",
  error: "Emits an author-defined compiler error where reached.",
  info: "Emits an author-defined compiler info message.",
  text: "Author-defined compile-time text (hint-level).",
}

/** A one-line description for a pragma directive or `{attribute '…'}` name — powers pragma hover. */
export function pragmaHelp(word: string): string | undefined {
  const w = word.toLowerCase()
  if (w in DIRECTIVES) return DIRECTIVES[w]
  if (KNOWN_ATTRIBUTES.has(w)) return `Recognized \`{attribute '${word}'}\` compiler attribute.`
  return undefined
}
