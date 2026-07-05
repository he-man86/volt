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
 * tests where the two IDEs disagreed; each entry here cites the
 * test whose divergence motivates the vendor tag.
 *
 * NOTE: several former entries were verified against the OLD recorder (a fixed
 * bug placed the test item out of scope → every build spuriously `Unknown type`
 * → a false "CODESYS didn't flag it"). Re-verified against the fresh recordings:
 *   - `duplicateDeclaration`, `doubleUnderscore`, `consecutiveUnderscores`,
 *     `messagePragmas` — CODESYS flags them, zero corpus FP → now enabled for BOTH.
 *   - `missingInterfaceImplementation` / `missingInterfaceSignature` — CODESYS
 *     flags them too, but the CHECK has 189 corpus FPs (can't resolve inherited /
 *     library interface members) → kept TwinCAT-only until the check is robust.
 * See `openspec/specs/language-server/diagnostics-conformance.md`.
 *
 * Adding a new rule? Default is "both vendors" (no entry needed).
 * Add an entry ONLY if there's recorded conformance evidence one
 * vendor accepts code the other rejects, or if the rule encodes
 * vendor-specific knowledge (e.g. `vendorOnlyOperator`).
 */
import type { DiagnosticConfig } from "./index.js";
import type { Vendor } from "../../reference/index.js";

export type VendorApplicability = readonly Vendor[];

export const RULE_VENDOR_APPLICABILITY: Partial<
	Record<keyof DiagnosticConfig, VendorApplicability>
> = {
	/**
	 * `vendorOnlyOperator` exists specifically to error on CODESYS-only
	 * operators when the workspace targets TwinCAT. By definition, the
	 * rule must not fire on a CODESYS workspace — those operators are
	 * legal there.
	 */
	vendorOnlyOperator: ["twincat"],
	// missingInterfaceImplementation / missingInterfaceSignature — now enabled for BOTH vendors. The
	// former 192 corpus FPs were FBs satisfying an interface via an EXTENDS base method; the check now
	// follows the base chain (collectProvidedMembers) and bails when a base is unresolvable (library
	// base), so it flags only genuinely-missing members. Verified zero corpus FP. CODESYS flags these
	// too ("There is no implementation for method …"), so no entry = both vendors.
	/**
	 * CODESYS-only. External `fb.internalVar := x` (write to a non-VAR_INPUT/VAR_OUTPUT member):
	 * verified by the conformance recordings — for the SAME source, CODESYS rejects ("'X' is no input
	 * of '<FB>'", build fails) but TwinCAT ACCEPTS (build clean, 0 errors). The 13 Bucket-A fixtures
	 * (hide_var, noinit, displaymode_*, …) all show TC build=true / CS build=false. Running the check on
	 * a TwinCAT workspace would false-positive on code TC compiles.
	 */
	externalNonInputWrite: ["codesys"],
	/**
	 * CODESYS-only (verified by recordings): CS errors on instantiating an ABSTRACT FB, TC accepts (no
	 * compile-time enforcement — see the oop_abstract_instantiated fixture).
	 */
	abstractInstantiation: ["codesys"],
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
