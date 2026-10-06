/**
 * The policy the pipeline applies ONCE, after every check ran (openspec analysis-conformance design.md P1, task 1.6):
 * configurable severity and "off", then TwinCAT's per-line dedupe. Vendor gating is the registry's (`registry.ts`).
 */
import { CONFIGURABLE_CODES, type ConfigurableCode, type ResolvedConfig } from "../config.js"
import type { DiagnosticItem } from "../shared/diagnostic-item.js"

export function applyPolicy(out: readonly DiagnosticItem[], config: ResolvedConfig, source: string): DiagnosticItem[] {
  // CODESYS "Compiler warnings" dialog: each configurable code is off / warning / error. Drop it when off,
  // else FORCE the configured severity (so a code the check emits as error but CODESYS defaults to warning is
  // corrected). Non-configurable codes pass through untouched — errors always error, like CODESYS.
  const result: DiagnosticItem[] = []
  for (const it of out) {
    if (!CONFIGURABLE_CODES.has(it.code)) {
      result.push(it)
      continue
    }
    const state = config.diagnostics[it.code as ConfigurableCode]
    if (state === "off") continue
    result.push(it.severity === state ? it : { ...it, severity: state })
  }
  return config.vendor === "twincat" ? dedupePerLine(result, source) : result
}

/**
 * TWINCAT NEVER SAYS THE SAME THING TWICE ON ONE LINE, and CODESYS does it all the time.
 *
 * Measured over both recordings (2026-09-20): 111 of 2541 CODESYS fixtures carry a message repeated on the SAME
 * line — `out := a AND b` with signed operands warns once per operand, at two spans on one statement — and the
 * number of TwinCAT fixtures that do is ZERO. It is not a rule about bitwise operators or about any one check:
 * it is what TwinCAT's error list does with what its compiler produces, so it belongs here, once, rather than as
 * a count branch inside every check that can fire twice.
 */
function dedupePerLine(items: readonly DiagnosticItem[], source: string): DiagnosticItem[] {
  const seen = new Set<string>()
  const out: DiagnosticItem[] = []
  for (const it of items) {
    const key = `${lineOf(source, it.span.start)}\u0000${it.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/** The 0-based line an offset falls on — counted, because a span carries offsets and nothing else. */
function lineOf(source: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++
  return line
}
