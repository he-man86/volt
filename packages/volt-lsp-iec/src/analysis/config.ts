/**
 * Analysis config (Layer D, D.1). Mirrors CODESYS's project settings exactly:
 *   - COMPILER ERRORS run ALWAYS and are untoggleable (CODESYS gives no control for a hard error).
 *   - The codes in CODESYS's "Compiler warnings" dialog are each a 3-STATE control — off / warning / error —
 *     just like the dialog's checkbox (unchecked = off, ✓ = warning, red ✓ = error). The central filter in
 *     computeSemanticDiagnostics applies the chosen state: drops the diagnostic when off, else forces its
 *     severity. So a project can match its CODESYS configuration byte for byte.
 *   - Plus one non-CODESYS switch: `diagnoseDeadCode`.
 */

export type Vendor = "codesys" | "twincat"
export type VendorSetting = Vendor | "auto"

/** The three states a configurable diagnostic can take — CODESYS's off / warning / error. */
export type DiagnosticState = "off" | "warning" | "error"

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

/**
 * The codes from CODESYS's "Compiler warnings" dialog that Volt implements — each a 3-state control. Keyed by
 * the LSP diagnostic `code` (the filter key); `c` is the CODESYS `Cnnnn` (the setting label, so a user can match
 * their project). ALL default to "warning" — CODESYS enables these as warnings by default. (Some Volt checks
 * historically emitted several of these as ERROR; the filter now forces the configured severity, so the check's
 * own severity no longer matters for a configurable code.) Codes NOT here are non-configurable — errors always
 * error, exactly as CODESYS gives them no dialog control.
 */
export const CONFIGURABLE_CHECKS = [
  { code: "pointer-not-convertible", c: "C0033", label: "Type possibly not convertible to the target type" },
  { code: "jump-label-unreferenced", c: "C0118", label: "A label has not been referenced" },
  { code: "no-op-statement", c: "C0139", label: "The code has no effect — is this the intent?" },
  { code: "sign-change-conversion", c: "C0195/C0196", label: "Implicit conversion changes the sign" },
  { code: "narrowing-conversion", c: "C0197", label: "Implicit conversion, possible loss of information" },
  { code: "string-constant-too-long", c: "C0198", label: "String constant too long for the destination type" },
  { code: "constant-no-initial-value", c: "C0228", label: "No initial value for a constant variable" },
  { code: "loop-exit-constant", c: "C0266", label: "Loop exit condition is constant FALSE" },
  { code: "unknown-attribute", c: "C0351", label: "Unknown attribute or invalid value" },
  { code: "enum-comparison", c: "C0354", label: "Comparison of one enumeration type with another" },
  { code: "adr-on-bit", c: "C0355", label: "A single bit cannot be referenced (ADR)" },
  { code: "inout-own-access", c: "C0371", label: "Access to a VAR_IN_OUT from an external context" },
  { code: "message-pragma-warning", c: "C0373", label: "User-defined warning ({warning} pragma)" },
  { code: "interface-implements", c: "C0421", label: "Use keyword EXTENDS for inheritance of interfaces" },
  { code: "inout-in-initializer", c: "C0441", label: "Access to an uninitialized VAR_IN_OUT variable" },
  { code: "input-default-composite", c: "C0525", label: "The input is only optional when called as a function" },
  { code: "default-not-constant", c: "C0526", label: "Default value is not constant" },
  { code: "abstract-output-default", c: "C0533", label: "The default value for a VAR_OUTPUT is not used" },
  { code: "union-inheritance", c: "C0542", label: "Inheritance is not intended for a UNION" },
] as const

export type ConfigurableCode = (typeof CONFIGURABLE_CHECKS)[number]["code"]

/** The diagnostic codes governed by a 3-state control — used by the central filter. */
export const CONFIGURABLE_CODES: ReadonlySet<string> = new Set(CONFIGURABLE_CHECKS.map((w) => w.code))

export interface AnalysisInitOptions {
  vendor?: VendorSetting
  /** Per-code state (keyed by {@link ConfigurableCode}). Any omitted code defaults to "warning", matching CODESYS. */
  diagnostics?: Partial<Record<ConfigurableCode, DiagnosticState>>
  /** Diagnose dead (unreachable) code. Default OFF — matches the compiler, which never checks code it
   *  doesn't compile. When off, diagnostics on structurally-dead units are suppressed. */
  diagnoseDeadCode?: boolean
}

export interface ResolvedConfig {
  vendor: Vendor
  /** Every configurable code's state, fully populated (all default "warning"). The filter drops an "off" code
   *  and forces the chosen severity on the rest; non-configurable codes are never consulted here. */
  diagnostics: Record<ConfigurableCode, DiagnosticState>
  diagnoseDeadCode: boolean
}

/** All configurable codes → "warning" — CODESYS's default. */
function defaultDiagnostics(): Record<ConfigurableCode, DiagnosticState> {
  const d = {} as Record<ConfigurableCode, DiagnosticState>
  for (const { code } of CONFIGURABLE_CHECKS) d[code] = "warning"
  return d
}

/** Resolve user init options to a concrete config. `auto`/unset vendor defaults to CODESYS. */
export function resolveConfig(opts: AnalysisInitOptions = {}): ResolvedConfig {
  const vendor: Vendor = opts.vendor === "twincat" ? "twincat" : "codesys"
  return {
    vendor,
    diagnostics: { ...defaultDiagnostics(), ...opts.diagnostics },
    diagnoseDeadCode: opts.diagnoseDeadCode ?? false,
  }
}
