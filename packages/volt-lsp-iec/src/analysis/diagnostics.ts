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
import { checkExternalNonInputWrite } from "./checks/oop/external-write.js"
import { checkLifecycleSignatures } from "./checks/oop/lifecycle.js"
import { checkAbstractInstantiation } from "./checks/oop/abstract-instantiation.js"
import { checkInterfaceImplementations } from "./checks/oop/interface-implementation.js"
import { checkDuplicateDeclarations } from "./checks/names/duplicate-declaration.js"
import { checkUnresolvedIdentifiers } from "./checks/names/unresolved-identifier.js"
import { checkVarSectionPlacement } from "./checks/declarations/var-section-placement.js"
import { checkPragmas } from "./checks/pragmas/pragmas.js"

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
  // names/
  checkDuplicateDeclarations,
  checkUnresolvedIdentifiers,
  // declarations/
  checkVarSectionPlacement,
  // oop/
  checkExternalNonInputWrite,
  checkLifecycleSignatures,
  checkAbstractInstantiation,
  checkInterfaceImplementations,
  // pragmas/
  checkPragmas,
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
