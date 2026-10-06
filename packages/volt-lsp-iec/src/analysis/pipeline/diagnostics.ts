/**
 * THE ONE PIPELINE (openspec analysis-conformance design.md P1, task 1.6). Pure data in → pure data out: it knows nothing
 * about LSP transport. `computeDiagnostics` asserts one vendor across project, parse and config, runs the registry's
 * checks for that vendor (optionally only some groups), and applies the policy once. Vendor-keyed: the active vendor
 * selects the message wording (and, via the registry and each check, which diagnostics fire) — because CODESYS and
 * TwinCAT diverge at times.
 */
import type { ParseResult } from "../../frontend/syntax/index.js"
import type { Scope } from "../../frontend/symbols/index.js"
import { resolveConfig, type AnalysisInitOptions, type ResolvedConfig } from "../config.js"
import { messagesFor } from "../messages.js"
import type { DiagnosticItem } from "../shared/diagnostic-item.js"
import type { Check, CheckContext } from "./context.js"
import { applyPolicy } from "./policy.js"
import { REGISTRY, type CheckGroup } from "./registry.js"

export interface DiagnosticsArgs {
  parseResult: ParseResult
  source: string
  project: Scope
  /** Resolved config, or raw init options (resolved here). */
  config?: ResolvedConfig | AnalysisInitOptions
  /** The document's URI, so a type name resolves the way it does for the file that wrote it. */
  uri: string
  /** Run only the checks of these groups (unset: every check). */
  groups?: readonly CheckGroup[]
}

export function computeDiagnostics(args: DiagnosticsArgs): DiagnosticItem[] {
  const config = isResolved(args.config) ? args.config : resolveConfig(args.config)
  // ONE VENDOR PER ANALYSIS, and it has to reach the SYMBOL TABLE too. `buildSymbolTable`'s dialect defaults to
  // codesys, which is the kind of quiet default this repo does not keep: the SERVER never passed it, so
  // `project.dialect` was codesys on a TwinCAT workspace and every branch reading it — `resolveNamedType`'s
  // CODESYS-only elementary types, `resolution.ts`'s cascade gate — was dead in production while the conformance
  // replay (which does pass it) stayed green. Twenty-nine colocated tests asserted TwinCAT behaviour against a
  // CODESYS-bound project for the same reason and could not have failed if the dialect mattered.
  //
  // Throwing is the point. There is no sensible answer to "which vendor is this?" when the two disagree, and a
  // silent winner is what hid this for as long as it did.
  if (args.project.dialect !== config.vendor)
    throw new Error(
      `dialect mismatch: the project was bound as '${args.project.dialect}' and the analysis asked for ` +
        `'${config.vendor}'. Pass the vendor to buildSymbolTable(files, manifests, vendor) as well.`,
    )
  // …and to the PARSE: the token-reading checks read `ctx.tokens`, which the parse lexed with ITS dialect.
  if (args.parseResult.dialect !== config.vendor)
    throw new Error(
      `dialect mismatch: the source was parsed as '${args.parseResult.dialect}' and the analysis asked for ` +
        `'${config.vendor}'. Pass the vendor to parseSource/parseDocument as well.`,
    )
  const ctx: CheckContext = {
    parseResult: args.parseResult,
    source: args.source,
    project: args.project,
    uri: args.uri,
    config,
    messages: messagesFor(config.vendor),
    tokens: () => args.parseResult.tokens,
  }
  return runRegistry(ctx, undefined, args.groups)
}

/** The pipeline's former name — kept as an alias until task 4.4 moves its callers. */
export const computeSemanticDiagnostics = computeDiagnostics

/** The check registry in run order, READ-ONLY — exported for the diagnostic census (`test/analysis/census.ts`), which
 *  counts per entry. Nothing else reads it. */
export const CHECK_REGISTRY: readonly Check[] = REGISTRY.map((e) => e.check)

/**
 * Run the registry's checks for `ctx`'s vendor (only `groups`' when given) and apply the policy (configurable severity /
 * off, TwinCAT's per-line dedupe) — the whole of `computeDiagnostics` after its dialect assertions. `onCheck` sees each
 * check that ran, with the findings it appended (its slice of `out`, before the policy): the census attributes every
 * finding to its check through it.
 */
export function runRegistry(
  ctx: CheckContext,
  onCheck?: (check: Check, emitted: readonly DiagnosticItem[]) => void,
  groups?: readonly CheckGroup[],
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  // ONE PLACE DECIDES WHICH CHECKS RUN FOR WHICH VENDOR, in both directions: the registry's `vendors`. A check that opens
  // with its own whole-body `if (vendor !== …) return` is the shape C6 removed, and it grew back the moment a rule ran
  // the other way — so the registry stays the only answer to "does this check apply here?".
  // THE ORDER CONTRACT HOLDS FOR A SUBSET TOO. A check with `reads` reports only where earlier findings — of any group —
  // explained the hole; run without their producers it says nothing where the vendor reports. Which checks produce a
  // code is the registry test's static measure, not runtime data, so a subset that holds a reader is refused unless it
  // keeps every group.
  if (groups !== undefined) {
    const missing = [...new Set(REGISTRY.map((e) => e.group))].filter((g) => !groups.includes(g))
    const reader = missing.length > 0 ? REGISTRY.find((e) => e.reads !== undefined && groups.includes(e.group)) : undefined
    if (reader !== undefined)
      throw new Error(
        `groups [${groups.join(", ")}] hold ${reader.check.name}, which reads earlier findings of every group, but leave ` +
          `out [${missing.join(", ")}]: run it with every group, or leave its group out.`,
      )
  }
  const active = REGISTRY.filter(
    (e) => (e.vendors === "both" || e.vendors === ctx.config.vendor) && (groups === undefined || groups.includes(e.group)),
  ).map((e) => e.check)
  if (CHECK_TIMING !== undefined) {
    for (const check of active) {
      const t = Number(process.hrtime.bigint())
      const from = out.length
      check(ctx, out)
      onCheck?.(check, out.slice(from))
      CHECK_TIMING[check.name] = (CHECK_TIMING[check.name] ?? 0) + (Number(process.hrtime.bigint()) - t) / 1e6
    }
  } else {
    for (const check of active) {
      const from = out.length
      check(ctx, out)
      onCheck?.(check, out.slice(from))
    }
  }
  return applyPolicy(out, ctx.config, ctx.source)
}

/** Per-check wall time (ms) under `PROFILE_CHECKS=1`, printed slowest first when the process exits. The corpus and
 *  bench tests point at this switch for a timeout; it used to collect the numbers and print nothing. */
const CHECK_TIMING: Record<string, number> | undefined = process.env.PROFILE_CHECKS ? {} : undefined
if (CHECK_TIMING !== undefined) {
  process.on("exit", () =>
    console.table(
      Object.entries(CHECK_TIMING)
        .sort(([, a], [, b]) => b - a)
        .map(([check, ms]) => ({ check, ms: Math.round(ms) })),
    ),
  )
}

function isResolved(c: DiagnosticsArgs["config"]): c is ResolvedConfig {
  return c !== undefined && "warnings" in c && typeof (c as ResolvedConfig).vendor === "string"
}
