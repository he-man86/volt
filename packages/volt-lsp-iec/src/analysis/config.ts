/**
 * Analysis config (Layer D, D.1). The clean rebuild collapses the legacy's ~30 per-check enable flags
 * to just `vendor` + a small opt-in LINT set. Rationale: every COMPILER-PARITY check (type mismatches,
 * unresolved identifiers, pragmas, interface impl) runs ALWAYS — it mirrors what the IDE would report,
 * so there is nothing to toggle. Only genuinely optional STYLE lints (which the compiler does not emit)
 * are opt-in and default OFF.
 */

export type Vendor = "codesys" | "twincat"
export type VendorSetting = Vendor | "auto"

/**
 * Project reference-file names that resolve OUTSIDE the symbol table, so the unresolved-identifier
 * check must skip them (never flag them): referenced-library namespaces (`.library` NAMESPACE lines)
 * and device-tree instance names (`.device` file stems). Both lowercased. Computed once per workspace
 * by the FS loaders in `workspace-refs`; empty when unknown ⇒ every reference is checked as before.
 */
export interface WorkspaceRefs {
  libraryNamespaces: ReadonlySet<string>
  deviceInstances: ReadonlySet<string>
}

/** No workspace reference files known — the safe default (nothing skipped on this account). */
export const EMPTY_WORKSPACE_REFS: WorkspaceRefs = {
  libraryNamespaces: new Set(),
  deviceInstances: new Set(),
}

/** Opt-in style lints — NOT emitted by the compiler, so off by default (a user enables what they want). */
export interface LintConfig {
  /** A local declaration shadowing an outer one. */
  shadowing: boolean
}

export interface AnalysisInitOptions {
  vendor?: VendorSetting
  lints?: Partial<LintConfig>
  /** Diagnose dead (unreachable) code. Default OFF — matches the compiler, which never checks code it
   *  doesn't compile. When off, diagnostics on structurally-dead units are suppressed. */
  diagnoseDeadCode?: boolean
}

export interface ResolvedConfig {
  vendor: Vendor
  lints: LintConfig
  diagnoseDeadCode: boolean
}

const DEFAULT_LINTS: LintConfig = {
  shadowing: false,
}

/** Resolve user init options to a concrete config. `auto`/unset vendor defaults to CODESYS. */
export function resolveConfig(opts: AnalysisInitOptions = {}): ResolvedConfig {
  const vendor: Vendor = opts.vendor === "twincat" ? "twincat" : "codesys"
  return { vendor, lints: { ...DEFAULT_LINTS, ...opts.lints }, diagnoseDeadCode: opts.diagnoseDeadCode ?? false }
}
