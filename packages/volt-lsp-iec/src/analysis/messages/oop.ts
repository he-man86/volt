/**
 * DIAGNOSTIC WORDING — the `checks/oop/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

/** The lifecycle methods whose signature the vendors check (`checks/oop/lifecycle`). */
export type LifecycleMethod = "FB_Init" | "FB_Exit" | "FB_ReInit"

export interface OopMessages {
  /** A lifecycle method (`FB_Init`/`FB_Exit`/`FB_ReInit`) with the wrong signature — wording differs per vendor. */
  lifecycle(method: LifecycleMethod): string
  /** Instantiating an ABSTRACT FB: "Function block" (CODESYS) vs "Functionblock" (TwinCAT, one word). */
  abstractInstantiation(fb: string): string
  /** Value-assigning to an abstract-FB target (C0511). The message names the FB TYPE. CODESYS-verified. */
  abstractAssignTarget(fb: string): string
  /** An interface member with no implementation — identical both vendors; member + interface UPPERCASED; a PROPERTY named by
   *  its accessor METHOD, `__GET<name>` / `__SET<name>` (`rk_interface_property_not_implemented`). */
  missingInterfaceImpl(member: string, iface: string): string
  /** A property read in a context where it has no get accessor (C0143). verified both vendors. */
  propertyLacksGetter(name: string): string
  genericCount(fb: string, count: number): string
  /** A function block that EXTENDS itself (C0091). verified both vendors. */
  circularInheritance(chain: string): string
  /** An `IMPLEMENTS` interface that resolves to no definition (C0086). verified both vendors. */
  interfaceNotFound(name: string): string
  /** A derived FB redeclares a variable already declared in a base FB (C0097). verified both vendors. */
  duplicateInheritedVariable(name: string, fb: string, base: string): string
  /** An FB_ReInit method with any input or a non-BOOL return — it must have neither (C0566). verified both vendors. */
  fbReInitShape(): string
  /** An FB method whose signature differs from the interface method it implements (C0089). verified both vendors. */
  overrideMismatchInterface(method: string, iface: string): string
  /** An overriding method whose signature differs from the base FB's method (C0094/C0568), both names upper-cased by
   *  the caller. verified both vendors (`inh_override_*`, 2026-10-02). */
  overrideMismatchBase(method: string, base: string): string
  /** CODESYS's second sentence for an implementing method with another parameter COUNT than its interface method.
   *  verified CODESYS (`inh_interface_method_param_count_mismatch`); TwinCAT says only the first. */
  interfaceParamCountMismatch(method: string, iface: string): string
  /** CODESYS's second sentence for an implementing method whose parameter differs from its interface method's.
   *  verified CODESYS (`inh_interface_method_signature_mismatch`); TwinCAT says only the first. */
  interfaceVariableMismatch(variable: string, method: string, iface: string): string
  /** A VAR_OUTPUT with an initializer in an abstract/interface method — the default is never used (C0533). verified both vendors. */
  defaultOutputUnused(): string
  /** External access to an FB instance's VAR_IN_OUT member — forbidden, it's a call-bound reference (C0178). verified both vendors. */
  inoutNoExternalAccess(param: string, fb: string): string
  /** A method/action touching its own FB's VAR_IN_OUT — a WARNING (modern CODESYS allows it) (C0371). */
  inoutOwnAccess(param: string, fb: string, context: string): string
  /** An FB whose FB_Init takes extra inputs, instantiated without them. CODESYS-measured; TwinCAT unasked. */
  fbInitInstantiation(fb: string, inputs: number, syntax: string): string
  /** An ARRAY of an FB whose FB_Init takes extra inputs, given fewer initializers than elements. Both vendors measured. */
  fbInitArrayCount(initializers: number, elements: number): string
}

export function oopMessages({ tc }: VendorWording): OopMessages {
  return {
    // PROVISIONAL (no live recording yet). Object name is the FB TYPE name, matching the doc example.
    // Byte-identical both vendors (2026-07-11), incl. the trailing stray quote (`…of 'FB'."`). TC quotes
    // 'VAR_IN_OUT', CS does not — a genuine per-vendor divergence like the double-space in unknownAttribute.
    inoutNoExternalAccess: (param, fb) =>
      tc ? `No external access to 'VAR_IN_OUT' parameter '${param}' of '${fb}'."` : `No external access to VAR_IN_OUT parameter '${param}' of '${fb}'."`,
    // C0371 WARNING. Verified live: CODESYS omits the trailing period, TwinCAT adds one.
    inoutOwnAccess: (param, fb, context) =>
      `Access to VAR_IN_OUT '${param}' declared in '${fb}' from external context '${context}'${tc ? "." : ""}`,
    // CODESYS SP21, measured (`fb_init_argument_left_out`). "1 inputs" is the vendor's own wording, unpluralized.
    // TwinCAT names the method `FB_init` unquoted and STOPS: no input count, no suggested syntax
    // (`fb_init_argument_left_out`, both recordings 2026-09-20).
    fbInitInstantiation: (fb, inputs, syntax) =>
      tc
        ? `No matching FB_init method found for instantiation of ${fb}`
        : `No matching 'FB_Init' method found for instantiation of ${fb}. Specified 'FB_Init' method requires exactly ${inputs} inputs. Check syntax '${syntax}'`,
    // both vendors, measured (`oopa_fb_init_array_left_out`, analysis-conformance 3.6, 2026-10-06), each in its own words
    fbInitArrayCount: (initializers, elements) =>
      tc
        ? `The number of FB_Init-Initializers (${initializers}) does not match the number of Array-Elements (${elements})`
        : `The number of 'FB_Init' initializers (${initializers}) does not match the number of array elements (${elements})`,
    lifecycle: (method) => {
      if (method === "FB_Init") {
        return tc
          ? "An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL."
          : "The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL"
      }
      if (method === "FB_Exit") {
        return tc
          ? "An 'FB_Exit'-Method of a functionblock or struct needs an input 'bInCopyCode' of type BOOL."
          : "The FB_Exit method of a function block or struct must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL."
      }
      return tc ? `An '${method}'-Method has an invalid signature.` : `The ${method} method has an invalid signature.`
    },
    fbReInitShape: () =>
      `The FB_ReInit method of a function block or struct must have no inputs and a return value of type BOOL. The FB_ReInit will not be called automatically!`,
    overrideMismatchInterface: (method, iface) =>
      `Interface of overridden method '${method}' of interface '${iface}' doesn't match declaration`,
    overrideMismatchBase: (method, base) =>
      `Interface of overridden method '${method}' of base '${base}' doesn't match declaration`,
    interfaceParamCountMismatch: (method, iface) =>
      `The number of inputs/outputs of the method '${method}' does not correspond to the interface '${iface}'.`,
    interfaceVariableMismatch: (variable, method, iface) =>
      `The variable '${variable}' of the method '${method}' does not correspond to the interface '${iface}'.`,
    defaultOutputUnused: () => `The default value for a VAR_OUTPUT is not used in abstract or interface methods`,
    abstractInstantiation: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be instantiated`,
    // CODESYS-verified (2026-07-11 live): names the FB TYPE, no "The"/quotes/period. TwinCAT PROVISIONAL
    // (mirrors abstractInstantiation's one-word "Functionblock").
    abstractAssignTarget: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be used as a target for an assignment`,
    missingInterfaceImpl: (member, iface) =>
      `There is no implementation for method '${member.toUpperCase()}' defined in interface '${iface.toUpperCase()}'`,
    propertyLacksGetter: (name) => `The property '${name}' cannot be used in this context because it lacks the get accessor`,
    // CODESYS SP21 (`decl_var_generic_no_argument`); TwinCAT has no VAR_GENERIC
    genericCount: (fb, count) => `Generic Functionblock '${fb}' expects exactly '${count}' number of Generic Constant Definitions`,
    // TwinCAT UPPER-CASES the names in the chain, CODESYS echoes them as declared — the only difference between
    // the two recordings of `cc2_circular_inheritance` (2026-09-20).
    circularInheritance: (chain) => `Recursion in base function block list: ${tc ? chain.toUpperCase() : chain}`,
    interfaceNotFound: (name) => `No definition found for interface '${name}'`,
    duplicateInheritedVariable: (name, fb, base) =>
      `Duplicate definition of variable '${name}' in function block '${fb}' and in base '${base}'`,
  }
}
