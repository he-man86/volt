/**
 * Per-rule vendor applicability. Rules listed here as `"twincat"`-only
 * are silently disabled when the workspace targets CODESYS (and vice
 * versa). Rules ABSENT from this map default to "both vendors".
 *
 * **Performance contract:** applied ONCE at config-resolve time
 * (`resolveConfig` in `./config.ts`). The dispatcher in
 * `../semantic/diagnostics.ts` sees a pre-filtered DiagnosticConfig
 * where vendor-incompatible flags are already `false` — zero
 * per-diagnostic / per-token vendor branching in hot paths.
 *
 * Triage source: conformance recordings against TwinCAT and CODESYS.
 * Diff between `expected-tc.json` and `expected-codesys.json` listed
 * 14 tests where the two IDEs disagreed; each entry here cites the
 * test whose divergence motivates the vendor tag.
 *
 * Adding a new rule? Default is "both vendors" (no entry needed).
 * Add an entry ONLY if there's recorded conformance evidence one
 * vendor accepts code the other rejects, or if the rule encodes
 * vendor-specific knowledge (e.g. `vendorOnlyOperator`).
 */
import type { DiagnosticConfig } from "./config.js";
import type { Vendor } from "../reference/index.js";

export type VendorApplicability = readonly Vendor[];

export const RULE_VENDOR_APPLICABILITY: Partial<
	Record<keyof DiagnosticConfig, VendorApplicability>
> = {
	/**
	 * TC errors on identifiers starting with `__` (system-name
	 * collision risk). CODESYS accepts the same code silently
	 * (verified: `identifier_double_underscore` test → TC 5 errors,
	 * CS 0).
	 */
	doubleUnderscore: ["twincat"],
	/**
	 * TC errors on multiple consecutive underscores anywhere in an
	 * identifier. CODESYS accepts (verified:
	 * `identifier_consecutive_underscores` → TC 5 errors, CS 0).
	 */
	consecutiveUnderscores: ["twincat"],
	/**
	 * TC catches `IMPLEMENTS X` declarations missing required interface
	 * members at parse time. CODESYS surfaces these only at build
	 * time and via different diagnostic channels we don't currently
	 * scrape (verified: `interface_missing_implementation` and
	 * `interface_with_property_impl` → TC 1 error each, CS 0).
	 */
	missingInterfaceImplementation: ["twincat"],
	/**
	 * `vendorOnlyOperator` exists specifically to error on CODESYS-only
	 * operators when the workspace targets TwinCAT. By definition, the
	 * rule must not fire on a CODESYS workspace — those operators are
	 * legal there.
	 */
	vendorOnlyOperator: ["twincat"],
	/**
	 * TC errors on two declarations sharing a name in the same scope
	 * (`A local variable named 'X' is already defined in '...'`).
	 * CODESYS apparently doesn't surface this through the messages we
	 * scrape from the build store — verified: `duplicate_declaration`
	 * → TC 1 error, CS 0.
	 */
	duplicateDeclaration: ["twincat"],
	/**
	 * `{error 'msg'}`, `{warning 'msg'}`, `{info 'msg'}`, `{text 'msg'}`
	 * are TC-specific pragmas that surface during the TC compile. CODESYS
	 * uses different pragma syntax for compile-time messages and the
	 * TC-style pragmas just get silently ignored — verified across
	 * `error_message`, `warning_message`, `info_message`, `text_message`
	 * (all TC-flagged, all CS-silent).
	 */
	messagePragmas: ["twincat"],
};

/**
 * Mask out rule flags whose rule isn't applicable to the active vendor.
 * Pure function — input unchanged. Called once at config-resolve time.
 */
export function filterConfigByVendor(
	cfg: DiagnosticConfig,
	vendor: Vendor,
): DiagnosticConfig {
	const out: DiagnosticConfig = { ...cfg };
	for (const key of Object.keys(RULE_VENDOR_APPLICABILITY) as Array<
		keyof DiagnosticConfig
	>) {
		const vendors = RULE_VENDOR_APPLICABILITY[key];
		if (vendors && !vendors.includes(vendor)) {
			out[key] = false;
		}
	}
	return out;
}
