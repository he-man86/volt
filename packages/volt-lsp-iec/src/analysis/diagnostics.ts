/**
 * Semantic diagnostics orchestrator (Layer D, D.1). Pure data in → pure data out: it knows nothing
 * about LSP transport. Runs the check registry over one document's parse result + project scope and
 * concatenates findings. Vendor-keyed: the active vendor selects the message wording (and, via each
 * check, which diagnostics fire) — because CODESYS and TwinCAT diverge at times.
 *
 * Adding a check: implement `(ctx, out) => void` in `checks/<group>/` and register it below.
 */
import type { ParseResult } from "../syntax/index.js"
import type { Scope } from "../symbols/index.js"
import {
  EMPTY_WORKSPACE_REFS,
  resolveConfig,
  type AnalysisInitOptions,
  type ResolvedConfig,
  type Vendor,
  type WorkspaceRefs,
} from "./config.js"
import { messagesFor, type Messages } from "./messages.js"
import type { DiagnosticItem } from "./checks/_shared.js"
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
import { checkNoOpStatement } from "./checks/flow/no-op-statement.js"
import { checkThisSuperContext } from "./checks/flow/this-super-context.js"
import { checkFbInstantiation } from "./checks/calls/fb-instantiation.js"
import { checkConstantContext } from "./checks/declarations/const-context.js"
import { checkConstantInitializer } from "./checks/declarations/constant-initializer.js"
import { checkExternalInitializer } from "./checks/declarations/external-initializer.js"
import { checkInputDefault } from "./checks/declarations/input-default.js"
import { checkDeprecatedKeyword } from "./checks/declarations/deprecated-keyword.js"
import { checkBitUsage } from "./checks/declarations/bit-usage.js"
import { checkOutputRules } from "./checks/declarations/output-rules.js"
import { checkNonInstantiable } from "./checks/declarations/non-instantiable.js"
import { checkInheritance } from "./checks/oop/inheritance.js"
import { checkPropertyAccess } from "./checks/oop/property-access.js"
import { checkMethodReference } from "./checks/oop/method-reference.js"
import { checkInheritedVariable } from "./checks/oop/inherited-variable.js"
import { checkIntrinsicOperands } from "./checks/calls/intrinsic-operands.js"
import { checkCallArguments } from "./checks/calls/call-arguments.js"
import { checkCallResultAccess } from "./checks/calls/call-result-access.js"
import { checkRecursiveCall } from "./checks/calls/recursive-call.js"
import { checkExternalNonInputWrite } from "./checks/oop/external-write.js"
import { checkLifecycleSignatures } from "./checks/oop/lifecycle.js"
import { checkAbstractInstantiation } from "./checks/oop/abstract-instantiation.js"
import { checkInterfaceImplementations } from "./checks/oop/interface-implementation.js"
import { checkMethodSignatures } from "./checks/oop/method-signature.js"
import { checkAbstractOutputDefault } from "./checks/oop/abstract-output-default.js"
import { checkDuplicateDeclarations } from "./checks/names/duplicate-declaration.js"
import { checkUnresolvedIdentifiers } from "./checks/names/unresolved-identifier.js"
import { checkUnknownTypes } from "./checks/names/unknown-type.js"
import { checkTypeAsValue } from "./checks/names/type-as-value.js"
import { checkVarSectionPlacement } from "./checks/declarations/var-section-placement.js"
import { checkHeaderRules } from "./checks/declarations/header-rules.js"
import { checkAttributePlacement } from "./checks/declarations/attribute-placement.js"
import { checkPragmas } from "./checks/pragmas/pragmas.js"
import { checkParseErrors } from "./checks/syntax/parse-errors.js"

export type { DiagnosticItem }

/** Everything any check might need; a check reads only what it uses. */
export interface CheckContext {
  parseResult: ParseResult
  source: string
  project: Scope
  config: ResolvedConfig
  messages: Messages
  activeVendor: Vendor
  /** Workspace reference-file names (library namespaces + device instances) the checks may skip. */
  references: WorkspaceRefs
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
  // flow/
  checkCaseLabels,
  checkStatementRules,
  checkNewInExpression,
  checkNoOpStatement,
  checkThisSuperContext,
  // declarations/
  checkConstantContext,
  checkConstantInitializer,
  checkExternalInitializer,
  checkInputDefault,
  checkDeprecatedKeyword,
  checkBitUsage,
  checkOutputRules,
  checkNonInstantiable,
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
  checkIntrinsicOperands,
  checkFbInstantiation,
  // names/
  checkDuplicateDeclarations,
  checkUnresolvedIdentifiers,
  checkUnknownTypes,
  checkTypeAsValue,
  // declarations/
  checkVarSectionPlacement,
  // oop/
  checkExternalNonInputWrite,
  checkLifecycleSignatures,
  checkAbstractInstantiation,
  checkInterfaceImplementations,
  checkMethodSignatures,
  checkAbstractOutputDefault,
  // pragmas/
  checkPragmas,
  // syntax/ — surfaces statement-level parse errors, held to the corpus + conformance zero-FP gate (a parse
  // error on clean code is a grammar gap to fix, never a shipped FP). See change `resilient-st-parse-errors`.
  checkParseErrors,
]

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
  const ctx: CheckContext = {
    parseResult: args.parseResult,
    source: args.source,
    project: args.project,
    config,
    messages: messagesFor(config.vendor),
    activeVendor: config.vendor,
    references: args.references ?? EMPTY_WORKSPACE_REFS,
  }
  const out: DiagnosticItem[] = []
  for (const check of CHECKS) check(ctx, out)
  return out
}

function isResolved(c: DiagnosticsArgs["config"]): c is ResolvedConfig {
  return c !== undefined && "lints" in c && typeof (c as ResolvedConfig).vendor === "string"
}
