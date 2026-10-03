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
export { isDuration, isIntegerType, isKnownPrimitive, isNumericType, isTemporal } from "./predicates.js"
export { conversionSides, isConversionName, parseConversionName } from "./conversion-name.js"
export { DEFAULT_STRING_LENGTH } from "./defaults.js"
export { integerOfWidth } from "./width.js"
export {
  integerLiteralType,
  isIntLiteral,
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
  type ArrayTypeInfo,
  type ElementaryTypeRef,
  type FunctionBlockType,
  type Type,
} from "./type.js"
export { isDialectType, resolveNamedType, resolveTypeExpr } from "./resolve.js"
export { enumDeclaration, enumDefault, inlineEnumDefault, strictEnum } from "./enums.js"
export { renderType } from "./render.js"

// inference
export { inferExprType } from "./infer/expr.js"
export { isEnumValueRef, memberScopeOf, resolveMemberChain } from "./infer/member.js"
export { resolveCallee, type CalleeInfo } from "./infer/callee.js"

// compatibility, constants, arithmetic, operators, built-ins
export { classifyConversion, GENERIC_PARAMETER_TYPES, genericParameterAccepts, isAssignable, isSameType, pointerFits, type ConversionKind } from "./compat.js"
export { constantSlotType, constEval, type ConstValue } from "./const/fold.js"
export { constancyOf } from "./const/constancy.js"
export { commonType, promoteForRuntime } from "./arith/runtime.js"
export { checkedMeetType, checkedNegationType, literalOperandType } from "./arith/checked.js"
export { durationScaleConversion, narrowDateWideDuration, temporalArithmeticType, temporalResultType } from "./arith/temporal.js"
export {
  ARITHMETIC_OPERATORS,
  BIT_OPERATOR_FUNCTIONS,
  COMPARISON_FUNCTIONS,
  comparisonConverts,
  isBitOperatorWireType,
  negativeLiteralComparisonTarget,
  notResultType,
  operandConversion,
  operandFamilyRule,
  operatorFunctionResult,
  pointerArithmeticType,
  SHORT_CIRCUIT_OPERATORS,
  shortCircuitType,
  unaryOperandConversion,
} from "./arith/operators.js"
export { BUILTIN_OPERATOR_NAMES, BUILTIN_RESULT, builtinName, exptResultType, selectionValueArguments, type BuiltinName } from "./builtins.js"
export { resolveBareName, resolveGlobalName, type BareName } from "./names.js"
