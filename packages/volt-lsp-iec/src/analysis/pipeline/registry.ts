/**
 * THE CHECK REGISTRY, AS DATA (openspec analysis-conformance design.md P3, §2; tasks 1.6, 1.7). One entry per check, in
 * RUN ORDER, and the one place that says:
 *
 *   group    the folder under `checks/` the check lives in (`registry.test.ts` holds every entry to its file — A6);
 *   vendors  which vendors it runs for. This used to be two sets beside the list (CODESYS_ONLY, TWINCAT_ONLY), each
 *            entry with the note of what was MEASURED — the notes moved onto the entries. A rule gate INSIDE a check
 *            (one message of several, or a check that cannot fire on a vendor by what that vendor's front-end gives it)
 *            stays in the check; its entry's note names it;
 *   reads    the codes of EARLIER findings the check reads from `out` — the order contract. `registry.test.ts` asserts
 *            every registry producer of a code a check reads runs before it.
 *
 * Adding a check: implement `(ctx, out) => void` in `checks/<group>/`, with its colocated test, and add its entry here.
 *
 * SIX OF THE OLD CODESYS-ONLY ENTRIES WERE NOT VENDOR DIFFERENCES AT ALL. `checkRefusedName` (since moved into the
 * parser), `checkTimeLiteralUnit` (into the lexer), `checkUnaryOperand`, `checkUnsupportedOperator`, `checkUnknownSource`
 * and `checkSignatureName` each sat in the CODESYS-only set with the note "TwinCAT unmeasured" — a placeholder from when
 * TwinCAT's recording covered 280 fixtures. It covers 2524 now, and every one of them AGREES: an IL operator used as a
 * name cascades identically on both, down to the ten messages and their order. Un-gating the six was worth 73 fixtures
 * (2351 -> 2424) and one false positive, which turned out to be the same reachability case CODESYS already has
 * documented. The note on each vendor-scoped entry is what keeps that from happening again: it says what was MEASURED,
 * not what was assumed. A check with nothing measured behind it is not vendor-scoped — it belongs in a recording.
 *
 * Both directions exist in the recordings — CODESYS has rules TwinCAT lacks and TwinCAT has rules CODESYS lacks — so
 * `vendors` takes either. (`checkPartialAccess` was the TwinCAT-only entry until frontend-conformance 2.5.4: TwinCAT's
 * reading of `dwSource.%W1` is the lexer's and the parser's now — the vendor's vocabulary, not a check. NOT
 * `checkUnknownType`, which looks like a sibling and is not: its TwinCAT rule lives in `dialectMissingType`, a helper
 * `unknown-source` also calls, so the vendor question has to be answered there anyway.)
 */
import type { Vendor } from "../config.js"
import { HOLE_EVIDENCE_CODES } from "../shared/hole.js"
import type { Check } from "./context.js"
import { checkAssignmentTypes } from "../checks/types/assignment.js"
import { checkNarrowingConversion } from "../checks/types/narrowing.js"
import { checkBinaryOperators } from "../checks/types/binary-operators.js"
import { checkConversionCalls } from "../checks/types/conversion.js"
import { checkDeref } from "../checks/types/deref.js"
import { checkSubrange } from "../checks/types/subrange.js"
import { checkConstantCycle } from "../checks/declarations/constant-cycle.js"
import { checkArrayBounds } from "../checks/types/array-bounds.js"
import { checkConstantOverflow } from "../checks/types/constant-overflow.js"
import { checkBitNumber } from "../checks/types/bit-number.js"
import { checkIndexing } from "../checks/types/indexing.js"
import { checkComparison } from "../checks/types/comparison.js"
import { checkArrayInit } from "../checks/types/array-init.js"
import { checkStructInit } from "../checks/types/struct-init.js"
import { checkPointerConversion } from "../checks/types/pointer-conversion.js"
import { checkStringConstant } from "../checks/types/string-constant.js"
import { checkReferenceAssign } from "../checks/types/reference-assign.js"
import { checkDataRecursion } from "../checks/types/data-recursion.js"
import { checkEnumInit } from "../checks/types/enum-init.js"
import { checkCaseLabels } from "../checks/flow/case-labels.js"
import { checkStatementRules } from "../checks/flow/statement-rules.js"
import { checkNewInExpression } from "../checks/flow/new-in-expression.js"
import { checkJumpLabels } from "../checks/flow/jump-labels.js"
import { checkNoOpStatement } from "../checks/flow/no-op-statement.js"
import { checkEmptyBlock } from "../checks/flow/empty-block.js"
import { checkLoopExit } from "../checks/flow/loop-exit.js"
import { checkThisSuperContext } from "../checks/flow/this-super-context.js"
import { checkFbInstantiation } from "../checks/calls/fb-instantiation.js"
import { checkConstantContext } from "../checks/declarations/const-context.js"
import { checkDeclaredType } from "../checks/declarations/declared-type.js"
import { checkConstantInitializer } from "../checks/declarations/constant-initializer.js"
import { checkExternalInitializer } from "../checks/declarations/external-initializer.js"
import { checkExternalGlobal } from "../checks/declarations/external-global.js"
import { checkInputDefault } from "../checks/declarations/input-default.js"
import { checkBitUsage } from "../checks/declarations/bit-usage.js"
import { checkOutputRules } from "../checks/declarations/output-rules.js"
import { checkNonInstantiable } from "../checks/declarations/non-instantiable.js"
import { checkObsoleteUsage } from "../checks/declarations/obsolete-usage.js"
import { checkAtAddress } from "../checks/declarations/at-address.js"
import { checkGenericInstantiation } from "../checks/oop/generic-instantiation.js"
import { checkInheritance } from "../checks/oop/inheritance.js"
import { checkPropertyAccess } from "../checks/oop/property-access.js"
import { checkMethodReference } from "../checks/oop/method-reference.js"
import { checkInheritedVariable } from "../checks/oop/inherited-variable.js"
import { checkIntrinsicOperands } from "../checks/calls/intrinsic-operands.js"
import { checkCallArguments } from "../checks/calls/call-arguments.js"
import { checkCallResultAccess } from "../checks/calls/call-result-access.js"
import { checkRecursiveCall } from "../checks/calls/recursive-call.js"
import { checkNonCallableCall } from "../checks/calls/non-callable-call.js"
import { checkExternalNonInputWrite } from "../checks/oop/external-write.js"
import { checkInoutExternalAccess, checkInoutOwnAccess } from "../checks/oop/inout-access.js"
import { checkConditionalCall } from "../checks/names/conditional-call.js"
import { checkUnknownType } from "../checks/declarations/unknown-type.js"
import { checkRefusedInitializer } from "../checks/declarations/refused-initializer.js"
import { checkDynamicCreation } from "../checks/declarations/dynamic-creation.js"
import { checkFbInitInout } from "../checks/oop/fb-init-inout.js"
import { checkFbInitInstantiation } from "../checks/oop/fb-init-instantiation.js"
import { checkAbstractAssign } from "../checks/oop/abstract-assign.js"
import { checkLifecycleSignatures } from "../checks/oop/lifecycle.js"
import { checkAbstractInstantiation } from "../checks/oop/abstract-instantiation.js"
import { checkInterfaceImplementations } from "../checks/oop/interface-implementation.js"
import { checkMethodSignatures } from "../checks/oop/method-signature.js"
import { checkAbstractOutputDefault } from "../checks/oop/abstract-output-default.js"
import { checkDuplicateDeclarations } from "../checks/names/duplicate-declaration.js"
import { checkUnresolvedIdentifiers } from "../checks/names/unresolved-identifier.js"
import { checkAmbiguousGlobal } from "../checks/names/ambiguous-global.js"
import { checkTypeAsValue } from "../checks/names/type-as-value.js"
import { checkReservedKeyword } from "../checks/names/reserved-keyword.js"
import { checkUnknownSource } from "../checks/types/unknown-source.js"
import { checkSignatureName } from "../checks/declarations/signature-name.js"
import { checkUnaryOperand } from "../checks/types/unary-operand.js"
import { checkTypedLiteral } from "../checks/types/typed-literal.js"
import { checkVarSectionPlacement } from "../checks/declarations/var-section-placement.js"
import { checkHeaderRules } from "../checks/declarations/header-rules.js"
import { checkAttributePlacement } from "../checks/declarations/attribute-placement.js"
import { checkPragmas } from "../checks/pragmas/pragmas.js"
import { checkParseErrors } from "../checks/syntax/parse-errors.js"
import { checkInoutInitializer } from "../checks/declarations/inout-initializer.js"

/** The folders under `checks/` — a check's group. (`network` joins with the network-text check, design.md §3, parked.) */
export type CheckGroup = "types" | "declarations" | "names" | "oop" | "calls" | "flow" | "pragmas" | "syntax"

interface RegistryEntry {
  check: Check
  group: CheckGroup
  /** `both`, or the one vendor the check runs for — with the measurement behind it in `note`. */
  vendors: "both" | Vendor
  /** The codes of earlier findings this check reads from `out`. */
  reads?: ReadonlySet<string>
  /** What was measured: required for a vendor-scoped entry, and for a check gated by a rule inside it. */
  note?: string
}

const both = (check: Check, group: CheckGroup, note?: string): RegistryEntry => ({ check, group, vendors: "both", note })
const codesys = (check: Check, group: CheckGroup, note: string): RegistryEntry => ({ check, group, vendors: "codesys", note })

/** The registry in RUN ORDER. The order is a contract (`registry.test.ts` lists it), not an accident of the file. */
export const REGISTRY: readonly RegistryEntry[] = [
  both(checkAssignmentTypes, "types"),
  both(checkNarrowingConversion, "types"),
  both(checkBinaryOperators, "types"),
  both(checkConversionCalls, "types"),
  both(checkDeref, "types"),
  both(checkSubrange, "types"),
  both(checkArrayBounds, "types"),
  both(checkConstantOverflow, "types"),
  both(checkBitNumber, "types"),
  both(checkIndexing, "types"),
  both(checkComparison, "types"),
  both(checkArrayInit, "types"),
  both(checkStructInit, "types"),
  both(checkPointerConversion, "types"),
  both(checkStringConstant, "types"),
  both(checkReferenceAssign, "types"),
  both(checkDataRecursion, "types"),
  both(checkEnumInit, "types"),
  both(checkUnaryOperand, "types"),
  both(
    checkTypedLiteral,
    "types",
    "rule gate: fires on CODESYS only — TwinCAT's lexer refuses every `<word>#` it does not read as a literal " +
      "(`TWINCAT_LITERAL_PREFIXES`), so no such word reaches the check there",
  ),
  both(checkCaseLabels, "flow"),
  both(checkStatementRules, "flow"),
  codesys(
    checkNewInExpression,
    "flow",
    "live /build (2026-09-20): TwinCAT compiles `IF (p := __NEW(T)) = 0` CLEAN (`cc5_new_in_expression`). On CODESYS the " +
      "rule is still UNMEASURED — that project's device configures no dynamic memory, so every __NEW reports THAT instead " +
      "and the nesting rule is never reached (it is in `KNOWN_DIVERGENCES.codesys` for it)",
  ),
  both(checkJumpLabels, "flow"),
  both(checkNoOpStatement, "flow"),
  both(checkEmptyBlock, "flow"),
  both(checkLoopExit, "flow"),
  both(checkThisSuperContext, "flow"),
  both(checkConstantContext, "declarations"),
  both(checkDeclaredType, "declarations"),
  both(checkConstantInitializer, "declarations"),
  codesys(
    checkConstantCycle,
    "declarations",
    "TwinCAT has no answer to measure: its XAE exits building a recursive constant (`ce_cycle`, `ce_cycle_self`, 2026-10-03)",
  ),
  both(checkExternalInitializer, "declarations"),
  both(checkExternalGlobal, "declarations"),
  codesys(checkInputDefault, "declarations", "live /build: TwinCAT silently accepts an array default on a FUNCTION input"),
  both(checkBitUsage, "declarations"),
  both(checkOutputRules, "declarations"),
  both(checkNonInstantiable, "declarations"),
  both(checkObsoleteUsage, "declarations"),
  both(checkAtAddress, "declarations"),
  both(checkHeaderRules, "declarations"),
  codesys(checkAttributePlacement, "declarations", "live /build: TwinCAT silently accepts pack_mode on a FUNCTION/METHOD"),
  both(checkInheritance, "oop"),
  both(checkPropertyAccess, "oop"),
  both(checkMethodReference, "oop"),
  both(checkInheritedVariable, "oop"),
  both(checkCallArguments, "calls"),
  both(checkCallResultAccess, "calls"),
  both(checkRecursiveCall, "calls"),
  both(checkNonCallableCall, "calls"),
  both(checkIntrinsicOperands, "calls"),
  both(checkFbInstantiation, "calls"),
  both(checkDuplicateDeclarations, "names"),
  both(checkUnresolvedIdentifiers, "names"),
  both(checkAmbiguousGlobal, "names"),
  both(checkTypeAsValue, "names"),
  codesys(
    checkReservedKeyword,
    "names",
    "a CODESYS forward-compat warning; TwinCAT accepts CHAR/WCHAR as names (verified live)",
  ),
  both(checkVarSectionPlacement, "declarations"),
  both(checkInoutInitializer, "declarations"),
  both(checkExternalNonInputWrite, "oop"),
  both(checkInoutExternalAccess, "oop"),
  both(checkInoutOwnAccess, "oop"),
  both(checkConditionalCall, "names"),
  both(checkUnknownType, "declarations"),
  both(checkRefusedInitializer, "declarations"),
  both(checkDynamicCreation, "declarations"),
  both(checkFbInitInout, "oop"),
  both(checkFbInitInstantiation, "oop"),
  both(
    checkGenericInstantiation,
    "oop",
    "rule gate: fires on CODESYS only — TwinCAT has no VAR_GENERIC (`lex/vocabulary` `CODESYS_ONLY_KEYWORDS`), so no FB " +
      "there has a generic constant to count",
  ),
  codesys(checkAbstractAssign, "oop", "live /build (2026-07-11): TwinCAT accepts this — no such rule"),
  both(checkLifecycleSignatures, "oop"),
  both(checkAbstractInstantiation, "oop"),
  both(checkInterfaceImplementations, "oop"),
  both(checkMethodSignatures, "oop"),
  codesys(checkAbstractOutputDefault, "oop", "live /build: TwinCAT silently accepts a VAR_OUTPUT default here"),
  both(checkPragmas, "pragmas"),
  both(checkSignatureName, "declarations"),
  // surfaces every parser-recorded syntax error (declaration structure + statement bodies), held to the corpus +
  // conformance zero-FP gate (a parse error on clean code is a grammar gap to fix, never a shipped FP). See change
  // `resilient-st-parse-errors`.
  both(checkParseErrors, "syntax"),
  {
    // LAST: it reports only where an earlier check already explained the hole (see its header). Of the codes it reads,
    // the network-text ones (`network-undeclared-identifier`, `network-unknown-member`) are the network pass's, which
    // runs after the registry into an `out` of its own (design.md §3, parked), so it never sees them.
    check: checkUnknownSource,
    group: "types",
    vendors: "both",
    reads: HOLE_EVIDENCE_CODES,
  },
]
