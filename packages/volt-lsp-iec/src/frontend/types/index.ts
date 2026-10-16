/**
 * TYPES — what a type is and what an expression's type is: the elementary facts, the `Type` model and its resolution,
 * inference, compatibility, constant folding and the operators' rules (openspec frontend-conformance design.md §2
 * "Index contents"). This file names exactly what the rest of the package imports; consumers import it, never a file
 * beside it, so a name can move between the files here without a consumer noticing.
 */

// the elementary facts
export {
  ANY_FAMILIES,
  CODESYS_ONLY_TYPES,
  ELEMENTARY_TYPES,
  elementaryType,
  inTypeGroup,
  type ElementaryType,
} from "./elementary.js"
export { canonicalElem, elementaryTypeOn, isElementaryTypeName, isPlatformInteger, PLATFORM_ALIASES, type Target } from "./platform.js"
export {
  floatBits,
  hasTextFormat,
  holdsIntegerBits,
  isBit,
  isBoolValued,
  isDuration,
  isIntegerType,
  isIntegral,
  isKnownPrimitive,
  isNumericType,
  isReal,
  isTemporal,
  stringKind,
} from "./predicates.js"
export { conversionSides, isConversionName, parseConversionName } from "./conversion-name.js"
export { DEFAULT_STRING_LENGTH, typeZero } from "./defaults.js"
export { elementOf, peelArray } from "./arrays.js"
export { integerOfWidth, storeInteger, widthOf, wrapToWidth } from "./width.js"
export {
  integerLiteralType,
  isIntLiteral,
  unparenthesised,
  literalCapacityType,
  literalCheckType,
  literalContextConversion,
  literalErrorType,
  literalOwnType,
  literalType,
  REAL_LITERAL_TYPE,
  REAL_MAX_MAGNITUDE,
  untypedNumberValue,
} from "./literal.js"

// the Type model and its resolution
export {
  elementaryRef,
  elementaryTypeRef,
  elemOf,
  UNKNOWN,
  withoutSubrange,
  type ArrayTypeInfo,
  type ElementaryTypeRef,
  type FunctionBlockType,
  type Type,
} from "./type.js"
export { isDialectType, resolveNamedType, resolveTypeExpr } from "./resolve.js"
export { enumDeclaration, enumDefault, enumDefaultValue, inlineEnumDefault, numberEnumerators, strictEnum } from "./enums.js"
export { renderType } from "./render.js"

// inference
export { inferExprType } from "./infer/expr.js"
export { alignUp, packFields, typeBytes, type Bytes, type PackedField } from "./layout.js"
export { isEnumValueRef, memberScopeOf, resolveMemberChain } from "./infer/member.js"
export { isPositionalSection, resolveCallee, takesNoPositionalArguments, type CalleeInfo } from "./infer/callee.js"
export { isSfcStepBase } from "./infer/sfc-step.js"
export { sfcStepTypeScope } from "./system.js"

// compatibility, constants, arithmetic, operators, built-ins
export { classifyConversion, GENERIC_PARAMETER_TYPES, genericParameterAccepts, isAssignable, isSameType, pointerComparison, pointerIntoElementary, type ConversionKind } from "./compat.js"
export { constantSlotType, constEval, type ConstValue } from "./const/fold.js"
export { declaredValue, isRecursiveConstant } from "./const/values.js"
export { constancyOf } from "./const/constancy.js"
export { commonType, promoteForRuntime } from "./arith/runtime.js"
export { checkedMeetType, checkedNegationType, literalOperandType } from "./arith/checked.js"
export { durationScaleConversion, narrowDateWideDuration, temporalArithmeticType, temporalResultType } from "./arith/temporal.js"
export {
  ARITHMETIC_OPERATORS,
  BIT_OPERATOR_FUNCTIONS,
  COMPARISON_FUNCTIONS,
  comparisonConverts,
  negativeLiteralComparisonTarget,
  notResultType,
  operandConversion,
  operandFamilyRule,
  pointerArithmeticType,
  SHORT_CIRCUIT_OPERATORS,
  shortCircuitType,
  unaryOperandConversion,
} from "./arith/operators.js"
export { atomicOperand, BUILTIN_OPERATOR_NAMES, BUILTIN_RESULT, builtinName, COMPILER_IMPLICITS, exptResultType, selectionValueArguments, type AtomicOperand, type BuiltinName } from "./builtins.js"
export { resolveBareName, resolveGlobalName, type BareName } from "./names.js"

// network text — the reader typed by the operators' rule, and each network's wire scope over the POU's
export { parseNetworkText } from "./network/network-parse.js"
export { analyzeNetworkText, headIsVariable, instanceFb, networkNetworkAt, type NetworkTextAnalysis } from "./network/network-analyze.js"
