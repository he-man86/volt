/**
 * Semantic diagnostics orchestrator (Layer D, D.1). Pure data in → pure data out: it knows nothing
 * about LSP transport. Runs the check registry over one document's parse result + project scope and
 * concatenates findings. Vendor-keyed: the active vendor selects the message wording (and, via each
 * check, which diagnostics fire) — because CODESYS and TwinCAT diverge at times.
 *
 * Adding a check: implement `(ctx, out) => void` in `checks/<group>/` and register it below.
 */
import { lex, type ParseResult, type Token } from "../syntax/index.js"
import type { Scope } from "../symbols/index.js"
import {
  EMPTY_WORKSPACE_REFS,
  resolveConfig,
  CONFIGURABLE_CODES,
  type AnalysisInitOptions,
  type ConfigurableCode,
  type ResolvedConfig,
  type WorkspaceRefs,
} from "./config.js"
import { messagesFor, type Messages } from "./messages.js"
import type { DiagnosticItem } from "./diagnostic-item.js"
import { checkAssignmentTypes } from "./checks/types/assignment.js"
import { checkNarrowingConversion } from "./checks/types/narrowing.js"
import { checkBinaryOperators } from "./checks/types/binary-operators.js"
import { checkConversionCalls } from "./checks/types/conversion.js"
import { checkDeref } from "./checks/types/deref.js"
import { checkSubrange } from "./checks/types/subrange.js"
import { checkArrayBounds } from "./checks/types/array-bounds.js"
import { checkConstantOverflow } from "./checks/types/constant-overflow.js"
import { checkBitNumber } from "./checks/types/bit-number.js"
import { checkIndexing } from "./checks/types/indexing.js"
import { checkComparison } from "./checks/types/comparison.js"
import { checkArrayInit } from "./checks/types/array-init.js"
import { checkStructInit } from "./checks/types/struct-init.js"
import { checkPointerConversion } from "./checks/types/pointer-conversion.js"
import { checkStringConstant } from "./checks/types/string-constant.js"
import { checkReferenceAssign } from "./checks/types/reference-assign.js"
import { checkDataRecursion } from "./checks/types/data-recursion.js"
import { checkEnumInit } from "./checks/types/enum-init.js"
import { checkCaseLabels } from "./checks/flow/case-labels.js"
import { checkStatementRules } from "./checks/flow/statement-rules.js"
import { checkNewInExpression } from "./checks/flow/new-in-expression.js"
import { checkJumpLabels } from "./checks/flow/jump-labels.js"
import { checkNoOpStatement } from "./checks/flow/no-op-statement.js"
import { checkEmptyBlock } from "./checks/flow/empty-block.js"
import { checkLoopExit } from "./checks/flow/loop-exit.js"
import { checkThisSuperContext } from "./checks/flow/this-super-context.js"
import { checkFbInstantiation } from "./checks/calls/fb-instantiation.js"
import { checkConstantContext } from "./checks/declarations/const-context.js"
import { checkConstantInitializer } from "./checks/declarations/constant-initializer.js"
import { checkExternalInitializer } from "./checks/declarations/external-initializer.js"
import { checkExternalGlobal } from "./checks/declarations/external-global.js"
import { checkInputDefault } from "./checks/declarations/input-default.js"
import { checkBitUsage } from "./checks/declarations/bit-usage.js"
import { checkOutputRules } from "./checks/declarations/output-rules.js"
import { checkNonInstantiable } from "./checks/declarations/non-instantiable.js"
import { checkObsoleteUsage } from "./checks/declarations/obsolete-usage.js"
import { checkAtAddress } from "./checks/declarations/at-address.js"
import { checkInheritance } from "./checks/oop/inheritance.js"
import { checkPropertyAccess } from "./checks/oop/property-access.js"
import { checkMethodReference } from "./checks/oop/method-reference.js"
import { checkInheritedVariable } from "./checks/oop/inherited-variable.js"
import { checkIntrinsicOperands } from "./checks/calls/intrinsic-operands.js"
import { checkCallArguments } from "./checks/calls/call-arguments.js"
import { checkCallResultAccess } from "./checks/calls/call-result-access.js"
import { checkRecursiveCall } from "./checks/calls/recursive-call.js"
import { checkNonCallableCall } from "./checks/calls/non-callable-call.js"
import { checkExternalNonInputWrite } from "./checks/oop/external-write.js"
import { checkInoutExternalAccess } from "./checks/oop/inout-external-access.js"
import { checkInoutOwnAccess } from "./checks/oop/inout-own-access.js"
import { checkConditionalCall } from "./checks/names/conditional-call.js"
import { checkDialectType } from "./checks/declarations/dialect-type.js"
import { checkDynamicCreation } from "./checks/declarations/dynamic-creation.js"
import { checkFbInitInout } from "./checks/oop/fb-init-inout.js"
import { checkFbInitInstantiation } from "./checks/oop/fb-init-instantiation.js"
import { checkAbstractAssign } from "./checks/oop/abstract-assign.js"
import { checkLifecycleSignatures } from "./checks/oop/lifecycle.js"
import { checkAbstractInstantiation } from "./checks/oop/abstract-instantiation.js"
import { checkInterfaceImplementations } from "./checks/oop/interface-implementation.js"
import { checkMethodSignatures } from "./checks/oop/method-signature.js"
import { checkAbstractOutputDefault } from "./checks/oop/abstract-output-default.js"
import { checkDuplicateDeclarations } from "./checks/names/duplicate-declaration.js"
import { checkUnresolvedIdentifiers } from "./checks/names/unresolved-identifier.js"
import { checkAmbiguousGlobal } from "./checks/names/ambiguous-global.js"
import { checkTypeAsValue } from "./checks/names/type-as-value.js"
import { checkReservedKeyword } from "./checks/names/reserved-keyword.js"
import { checkRefusedName } from "./checks/names/refused-name.js"
import { checkUnknownSource } from "./checks/types/unknown-source.js"
import { checkSignatureName } from "./checks/declarations/signature-name.js"
import { checkUnaryOperand } from "./checks/types/unary-operand.js"
import { checkUnsupportedOperator } from "./checks/types/unsupported-operator.js"
import { checkTimeLiteralUnit } from "./checks/types/time-literal-unit.js"
import { checkWstringEscape } from "./checks/types/wstring-escape.js"
import { checkPartialAccess } from "./checks/types/partial-access.js"
import { checkVarSectionPlacement } from "./checks/declarations/var-section-placement.js"
import { checkHeaderRules } from "./checks/declarations/header-rules.js"
import { checkAttributePlacement } from "./checks/declarations/attribute-placement.js"
import { checkPragmas } from "./checks/pragmas/pragmas.js"
import { checkParseErrors } from "./checks/syntax/parse-errors.js"
import { checkInoutInitializer } from "./checks/declarations/inout-initializer.js"

export type { DiagnosticItem }

/** Everything any check might need; a check reads only what it uses. */
export interface CheckContext {
  parseResult: ParseResult
  source: string
  project: Scope
  config: ResolvedConfig
  messages: Messages
  /** Workspace reference-file names (library namespaces + device instances) the checks may skip. */
  references: WorkspaceRefs
  /** The source lexed ONCE, shared by every pragma/attribute-token check. The parser strips pragmas, so these
   *  checks re-lex — three of them independently did (~5ms each on a large file); this memoizes to one lex. */
  tokens: () => readonly Token[]
}

type Check = (ctx: CheckContext, out: DiagnosticItem[]) => void

/** The check registry — grouped by concern (types/ · declarations/ · names/ · oop/ · pragmas/). */
const CHECKS: readonly Check[] = [
  // types/
  checkAssignmentTypes,
  checkNarrowingConversion,
  checkBinaryOperators,
  checkConversionCalls,
  checkDeref,
  checkSubrange,
  checkArrayBounds,
  checkConstantOverflow,
  checkBitNumber,
  checkIndexing,
  checkComparison,
  checkArrayInit,
  checkStructInit,
  checkPointerConversion,
  checkStringConstant,
  checkReferenceAssign,
  checkDataRecursion,
  checkEnumInit,
  checkUnaryOperand,
  checkUnsupportedOperator,
  checkTimeLiteralUnit,
  checkWstringEscape,
  checkPartialAccess,
  // flow/
  checkCaseLabels,
  checkStatementRules,
  checkNewInExpression,
  checkJumpLabels,
  checkNoOpStatement,
  checkEmptyBlock,
  checkLoopExit,
  checkThisSuperContext,
  // declarations/
  checkConstantContext,
  checkConstantInitializer,
  checkExternalInitializer,
  checkExternalGlobal,
  checkInputDefault,
  checkBitUsage,
  checkOutputRules,
  checkNonInstantiable,
  checkObsoleteUsage,
  checkAtAddress,
  checkHeaderRules,
  checkAttributePlacement,
  // oop/
  checkInheritance,
  checkPropertyAccess,
  checkMethodReference,
  checkInheritedVariable,
  // calls/
  checkCallArguments,
  checkCallResultAccess,
  checkRecursiveCall,
  checkNonCallableCall,
  checkIntrinsicOperands,
  checkFbInstantiation,
  // names/
  checkDuplicateDeclarations,
  checkUnresolvedIdentifiers,
  checkAmbiguousGlobal,
  checkTypeAsValue,
  checkReservedKeyword,
  checkRefusedName,
  // declarations/
  checkVarSectionPlacement,
  checkInoutInitializer,
  // oop/
  checkExternalNonInputWrite,
  checkInoutExternalAccess,
  checkInoutOwnAccess,
  checkConditionalCall,
  checkDialectType,
  checkDynamicCreation,
  checkFbInitInout,
  checkFbInitInstantiation,
  checkAbstractAssign,
  checkLifecycleSignatures,
  checkAbstractInstantiation,
  checkInterfaceImplementations,
  checkMethodSignatures,
  checkAbstractOutputDefault,
  // pragmas/
  checkPragmas,
  // syntax/ — surfaces every parser-recorded syntax error (declaration structure + statement bodies), held to
  // the corpus + conformance zero-FP gate (a parse error on clean code is a grammar gap to fix, never a shipped
  // FP). See change `resilient-st-parse-errors`.
  checkSignatureName,
  checkParseErrors,
  // LAST: it reports only where an earlier check already explained the hole (see its header).
  checkUnknownSource,
]

/**
 * The checks that run for CODESYS only — one list, where each used to open with its own `if (vendor !== "codesys") return`
 * (consolidate-lsp-structure C6). A rule gate INSIDE a check (one message of several) stays in that check.
 *
 * SIX OF THESE WERE NOT VENDOR DIFFERENCES AT ALL. `checkRefusedName`, `checkTimeLiteralUnit`,
 * `checkUnaryOperand`, `checkUnsupportedOperator`, `checkUnknownSource` and `checkSignatureName` each sat here
 * with the note "TwinCAT unmeasured" — a placeholder from when TwinCAT's recording covered 280 fixtures. It
 * covers 2524 now, and every one of them AGREES: an IL operator used as a name cascades identically on both,
 * down to the ten messages and their order. Un-gating the six is worth 73 fixtures (2351 -> 2424) and one
 * false positive, which turned out to be the same reachability case CODESYS already has documented.
 *
 * The note on each entry below is what keeps that from happening again: it says what was MEASURED, not what
 * was assumed. A check with nothing measured behind it does not belong here — it belongs in a recording.
 */
const CODESYS_ONLY: ReadonlySet<Check> = new Set<Check>([
  // live /build (2026-09-20): TwinCAT compiles `IF (p := __NEW(T)) = 0` CLEAN (`cc5_new_in_expression`). On
  // CODESYS the rule is still UNMEASURED — that project's device configures no dynamic memory, so every __NEW
  // reports THAT instead and the nesting rule is never reached (it is in `KNOWN_DIVERGENCES.codesys` for it).
  checkNewInExpression,
  checkAttributePlacement, // live /build: TwinCAT silently accepts pack_mode on a FUNCTION/METHOD
  checkInputDefault, // live /build: TwinCAT silently accepts an array default on a FUNCTION input
  checkAbstractAssign, // live /build (2026-07-11): TwinCAT accepts this — no such rule
  checkAbstractOutputDefault, // live /build: TwinCAT silently accepts a VAR_OUTPUT default here
  checkReservedKeyword, // a CODESYS forward-compat warning; TwinCAT accepts CHAR/WCHAR as names (verified live)
])

export interface DiagnosticsArgs {
  parseResult: ParseResult
  source: string
  project: Scope
  /** Resolved config, or raw init options (resolved here). */
  config?: ResolvedConfig | AnalysisInitOptions
  /** Workspace reference-file names (computed once per workspace). Defaults to empty. */
  references?: WorkspaceRefs
}

export function computeSemanticDiagnostics(args: DiagnosticsArgs): DiagnosticItem[] {
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
  let tokenCache: readonly Token[] | undefined
  const ctx: CheckContext = {
    parseResult: args.parseResult,
    source: args.source,
    project: args.project,
    config,
    messages: messagesFor(config.vendor),
    references: args.references ?? EMPTY_WORKSPACE_REFS,
    tokens: () => (tokenCache ??= lex(args.source, config.vendor)),
  }
  const out: DiagnosticItem[] = []
  const active = config.vendor === "codesys" ? CHECKS : CHECKS.filter((check) => !CODESYS_ONLY.has(check))
  if (CHECK_TIMING !== undefined) {
    for (const check of active) {
      const t = Number(process.hrtime.bigint())
      check(ctx, out)
      CHECK_TIMING[check.name] = (CHECK_TIMING[check.name] ?? 0) + (Number(process.hrtime.bigint()) - t) / 1e6
    }
  } else {
    for (const check of active) check(ctx, out)
  }
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
  return config.vendor === "twincat" ? dedupePerLine(result, args.source) : result
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
