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
  /** POUs marked `{attribute 'obsolete' := 'msg'}`, keyed by lowercased name → its declared name + message.
   *  Feeds the C0357 obsolete-usage check (the attribute is parser trivia, so it's collected from raw file text
   *  in the workspace scan — not on the AST). Empty when unknown ⇒ nothing flagged. */
  obsoletePous: ReadonlyMap<string, { name: string; message: string }>
}

/** No workspace reference files known — the safe default (nothing skipped on this account). */
export const EMPTY_WORKSPACE_REFS: WorkspaceRefs = {
  libraryNamespaces: new Set(),
  deviceInstances: new Set(),
  obsoletePous: new Map(),
}

/**
 * The codes from CODESYS's "Compiler warnings" dialog that Volt implements — each a 3-state control. Keyed by
 * the LSP diagnostic `code` (the filter key); `c` is the CODESYS `Cnnnn` (the setting label, so a user can match
 * their project). ALL default to "warning" — CODESYS enables these as warnings by default. (Some Volt checks
 * historically emitted several of these as ERROR; the filter now forces the configured severity, so the check's
 * own severity no longer matters for a configurable code.) Codes NOT here are non-configurable — errors always
 * error, exactly as CODESYS gives them no dialog control.
 *
 * This is 22 of the ~66 codes in the CODESYS dialog. The full dialog list — which codes Volt implements, which
 * are still gaps, and why the un-closeable ones can't be — is `docs/codesys-reference/compiler-warnings-coverage.md`.
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
  { code: "obsolete-usage", c: "C0357", label: "Use of a POU marked {attribute 'obsolete'}" },
  { code: "input-default-composite", c: "C0525", label: "The input is only optional when called as a function" },
  { code: "default-not-constant", c: "C0526", label: "Default value is not constant" },
  { code: "abstract-output-default", c: "C0533", label: "The default value for a VAR_OUTPUT is not used" },
  { code: "union-inheritance", c: "C0542", label: "Inheritance is not intended for a UNION" },
  { code: "reserved-keyword", c: "C0543", label: "The name is a reserved keyword in the IEC 61131-3 standard" },
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

// ─── project settings (the `.projectsettings` descriptor) ─────────────────────

/**
 * Which diagnostics a PROJECT configures, parsed from the read-only `.projectsettings` file the bridge
 * materializes from CODESYS's Project Settings dialog.
 *
 * This is the point of that file: a compiler warning's state belongs to the project, not to whoever opened
 * it. Without it the LSP reports warnings the project switched off — pro2193 disables C0371, and its
 * VAR_IN_OUT conformance failures were exactly that, not a defect in the check.
 *
 * Only DEVIATIONS are listed (the bridge omits the rest, so the file doesn't churn when a CODESYS version
 * adds a warning id), so anything absent keeps the "warning" default. `Cnnnn` codes map back through
 * {@link CONFIGURABLE_CHECKS} — the same table the filter keys on, so there is one mapping, not two.
 */
const CODE_BY_CNNNN: ReadonlyMap<string, ConfigurableCode> = new Map(
  // `c` is occasionally a pair (`C0195/C0196` — one control, two compiler codes); both must resolve.
  CONFIGURABLE_CHECKS.flatMap((w) => w.c.split("/").map((c) => [c.trim().toUpperCase(), w.code] as const)),
)

/** `Cnnnn` → the LSP diagnostic code it configures, or undefined for one Volt does not implement. */
export function configurableCodeFor(cnnnn: string): ConfigurableCode | undefined {
  return CODE_BY_CNNNN.get(cnnnn.trim().toUpperCase())
}

/**
 * Read the per-code states out of a `.projectsettings` body. Two lines matter:
 *
 *     Disabled warnings:     C0371, C0139
 *     Warnings as errors:    C0033
 *
 * Anything else in the file is compile options, which the analysis does not consume (yet). A code Volt
 * does not implement is skipped rather than rejected: the file lists the PROJECT's configuration, and a
 * project may legitimately configure a warning this LSP has no check for.
 */
export function projectDiagnosticsFrom(body: string): Partial<Record<ConfigurableCode, DiagnosticState>> {
  const out: Partial<Record<ConfigurableCode, DiagnosticState>> = {}
  for (const [label, state] of [
    ["disabled warnings", "off"],
    ["warnings as errors", "error"],
  ] as const) {
    const line = body.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${label}:`))
    if (line === undefined) continue
    for (const raw of line.slice(line.indexOf(":") + 1).split(",")) {
      const code = configurableCodeFor(raw)
      if (code !== undefined) out[code] = state
    }
  }
  return out
}
