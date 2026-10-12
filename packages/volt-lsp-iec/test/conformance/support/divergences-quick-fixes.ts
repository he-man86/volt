/**
 * THE QUICK-FIX FIXTURES' KNOWN DIVERGENCES (openspec lsp-quick-fixes 1.1, 2026-10-12) — one concern of
 * `divergences.ts`, which assembles `KNOWN_DIVERGENCES`. A BEFORE (`fixtures/quick-fixes/`) exists to report the ONE
 * finding its fix answers. Every AFTER agrees exactly, on both vendors. Each mark below is missing-only (the LSP says
 * nothing the vendor does not), and is one of two kinds — a FOLLOW-ON the vendor adds around a finding the LSP gives, or
 * a ROOT finding the LSP does not give at all. Which vendors the LSP reports a BEFORE's own finding on is held separately,
 * against the recordings, by `src/services/assist/code-actions.test.ts` (its `VENDOR_GAPS`).
 *
 * FOLLOW-ONS — the LSP reports the BEFORE's finding as the vendor does; the vendor says more around it, a gap another
 * fixture already pins:
 *
 *   `qf_c0046_before_declare_argument` — an undeclared name as a named argument: the vendors add the hole's conversion
 *        INTO the input's type ("Cannot convert type 'Unknown type: 'amount'' to type 'REAL'"), as for
 *        `enum_same_member_call_argument` (`divergences-names.ts` ENUM_DIVERGENCES): `hole.ts` decides what a hole is for
 *        every check — not trivial. Niche: accepted loss (0 occurrences in the corpora — an undeclared name never builds).
 *   `qf_c0046_before_declare_condition` — an undeclared IF condition: "Expression of type 'BOOL' expected in this place"
 *        for the condition the hole leaves untyped, as `enum_same_member_comparison` (ENUM_DIVERGENCES). Niche: accepted
 *        loss (0 occurrences in the corpora).
 *   `qf_c0077_before` (CODESYS) — the conversions into and out of the unknown type `count := count + 1` makes ("Cannot
 *        convert type 'USINT' to type 'DIMT'", "… 'DIMT' to type 'USINT'"); the LSP types nothing through a type it
 *        cannot resolve. Niche: accepted loss (0 occurrences in the corpora — an unknown type never builds).
 *   `qf_c0533_before` (CODESYS) — the warning TWICE, as `oopb_abstract_method_output_default` (`divergences-types.ts`
 *        CODESYS_ANALYSIS_NICHE): one more cell of that unmeasured count — an ABSTRACT FB nothing extends, held by a
 *        POINTER only. Niche: accepted loss (0 VAR_OUTPUT defaults in a method of an ABSTRACT FB in the corpora).
 *   `qf_border_before` (TwinCAT) — "Cannot convert type '10' to type 'INT (10..0)'" after the refused subrange, as
 *        `decl_subrange_reversed` (`divergences-declarations.ts` AFTER_A_REFUSED_TYPE). Niche: accepted loss (0 reversed
 *        subranges in the corpora — one never builds).
 *   `qf_access_before` — "Cannot access private method ???.FB_…" at PLC_PRG's call, as `unit_fb_private`
 *        (`divergences-units.ts` FB_ACCESS_AT_THE_CALL). Niche: accepted loss (0 occurrences in the corpora — no PRIVATE
 *        or PROTECTED function block; their 5 access-modified ones are INTERNAL).
 *
 * ROOT FINDINGS the LSP does not give:
 *
 *   `qf_c0077_before` (TwinCAT) — "Unknown type: 'DIMT'" ITSELF, and the two conversions after it. NOT niche: it is a
 *        deferral. `unknownTypeName` (`analysis/shared/resolution.ts`) judges a bare type name on CODESYS only, because
 *        TwinCAT materializes its libraries under `References/`, which the library rule does not know (task 0.1, filed
 *        for 2.4): until it does, a TwinCAT library type is project source here, and bare names would be judged against
 *        the wrong set. So C0077 — and its near-miss fix — is CODESYS's until 2.4 lands that rule.
 *   `qf_c0228_bound_subrange`, `qf_c0228_bound_inline_subrange` — a CONSTANT of a subrange, NAMED (`TYPE R : INT(3..9)`)
 *        or INLINE (`cap : INT(3..9);`), with no initial value, as an
 *        ARRAY bound: "Array border cap does not evaluate to a valid signed integer constant" (TwinCAT "Array Border …"),
 *        then a follow-on that differs by vendor (CODESYS "The variable 'arr' is too large…", TwinCAT "Cannot convert
 *        type 'ARRAY [1..cap] OF INT' to type 'ARRAY [1..cap] OF INT'"). The fold gives that constant no value — the
 *        compiler's own verdict (`frontend/types/const/values.ts` `isSubrange`) — so the bound is not compared, and
 *        no check names a bound that does not fold. Niche: accepted loss (0 occurrences in the corpora — their one
 *        constant with no initial value, bakon-nano's `defaultXYA`, is a STRUCT that bounds nothing).
 */
import type { Vendor } from "../../../src/index.js"

export const QUICK_FIX_BEFORE_CASCADES: Record<Vendor, readonly string[]> = {
  codesys: ["qf_c0046_before_declare_argument", "qf_c0046_before_declare_condition", "qf_c0077_before", "qf_c0533_before", "qf_access_before", "qf_c0228_bound_subrange", "qf_c0228_bound_inline_subrange"],
  twincat: ["qf_c0046_before_declare_argument", "qf_c0046_before_declare_condition", "qf_c0077_before", "qf_border_before", "qf_access_before", "qf_c0228_bound_subrange", "qf_c0228_bound_inline_subrange"],
}
