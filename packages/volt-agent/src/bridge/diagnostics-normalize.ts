/**
 * Canonicalize build diagnostics so every consumer (the conformance
 * recorder, the LSP/`volt build` display, the AI debug loop) sees ONE
 * object-naming convention regardless of vendor.
 *
 * **The quirk this fixes (verified live 2026-06-08):** the CODESYS bridge
 * prefixes TOP-LEVEL POU objects with the application container —
 * `Application.FB_X` — while the Beckhoff bridge emits the bare `FB_X`.
 * Every consumer that attributes a diagnostic by POU name breaks on the
 * prefix. The conformance recorder buckets per test by
 * `object === pouName || object.startsWith(pouName + ".")`, so CODESYS's
 * `Application.FB_X` matched NOTHING and was silently dropped — recording
 * real CODESYS errors (double-underscore, duplicate declaration, …) as
 * "CODESYS silent" and seeding FALSE TC-only divergences in
 * `rule-vendor-applicability.ts`.
 *
 * This is a COMPENSATING normalization at the TS boundary. The proper home
 * is each bridge's own boundary (a `BridgeDiagnostic` is contractually
 * canonical) — once the CODESYS bridge strips the prefix itself this is a
 * no-op and the schema can enforce the contract directly. Not yet handled
 * here (needs the parent FB, which the diagnostic doesn't carry — a
 * bridge-side fix): CODESYS reports property accessors as `Value.Get`
 * (missing the FB) where Beckhoff reports `FB.Value.Get`.
 */
import type { BridgeDiagnostic } from "./types.js";

/** Leading application-container segment CODESYS prepends to top-level POUs. */
const CONTAINER_PREFIX = /^Application\./;

/** Strip the container prefix from each diagnostic's `object`. Beckhoff
 *  objects never carry it, so this is a no-op there. */
export function canonicalizeDiagnostics(
	diags: readonly BridgeDiagnostic[],
): BridgeDiagnostic[] {
	return diags.map((d) =>
		d.object !== null && CONTAINER_PREFIX.test(d.object)
			? { ...d, object: d.object.replace(CONTAINER_PREFIX, "") }
			: d,
	);
}
