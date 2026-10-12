/**
 * DIAGNOSTIC WORDING — the `checks/declarations/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface DeclarationMessages {
  /** A non-constant array dimension bound (C0161). verified both vendors. */
  arrayBoundNonConst(bound: string): string
  /** A non-constant STRING length (`STRING(n)`, n a variable). `decl_string_length_variable`, both vendors 2026-10-01. */
  stringLengthNonConst(length: string): string
  /** A declared subrange or array dimension whose lower bound is above its upper (`INT(10..0)`, `ARRAY[5..1]`).
   *  `decl_subrange_reversed`, `decl_array_reversed_bounds`, 2026-10-01 — TwinCAT ends the sentence with a period. */
  borderOrder(): string
  /** A REFERENCE as the base type of an array, a pointer or a reference (`decl_reference_to_reference`,
   *  `decl_pointer_to_reference`, `decl_array_of_reference`, 2026-10-01) — TwinCAT has no comma before "or". */
  referenceAsBaseType(): string
  /** A `__VECTOR` of anything but REAL/LREAL (`decl_vector_of_int`, `_of_bool`, CODESYS 2026-10-01; TwinCAT has no __VECTOR). */
  vectorBaseType(): string
  /** An `ARRAY[*]` where the vendor takes none (`decl_array_star_in_var`, `_two_stars`, `_in_fb_input`,
   *  `_in_function_input`, 2026-10-01) — each vendor's sentence states its own rule. */
  variableLengthPlacement(): string
  /** An `ARRAY[*]` inside another type (`ARRAY OF ARRAY[*]`, `POINTER TO ARRAY[*]`), in any section
   *  (`decl_array_star_nested_in_var`, `_in_inout`, `decl_pointer_to_array_star_in_var`, both vendors 2026-10-01). */
  variableLengthNested(): string
  /** A `VAR CONSTANT` variable initialized with a non-constant value (C0227). verified both vendors. */
  constInitNonConst(name: string): string
  /** A `VAR_INPUT` default value that is not a constant (C0526). verified both vendors. */
  defaultNotConstant(): string
  /** A BIT variable in a POU other than a struct/FB (C0203). verified both vendors. */
  bitInWrongContainer(): string
  /** A BIT variable in a disallowed VAR block (C0204). verified both vendors. */
  bitInWrongBlock(): string
  /** `POINTER TO BIT` (C0205). verified both vendors. */
  pointerToBit(): string
  /** `ARRAY OF BIT` (C0206). verified both vendors. */
  bitArrayBase(): string
  /** `RETAIN`/`PERSISTENT` on a VAR block in a POU that doesn't allow it (C0175). verified both vendors. */
  retainNotAllowedHere(): string
  /** A `VAR_OUTPUT` declared as `REFERENCE TO` (C0222). verified both vendors. */
  outputCantBeReference(): string
  /** A variable declared with the type of a FUNCTION POU, which can't be instantiated (C0177). verified both vendors. */
  notInstantiable(typeName: string): string
  /** Use of a POU marked `{attribute 'obsolete' := 'msg'}` (C0357). verified live CODESYS; TC pending. */
  pouObsolete(name: string, message: string): string
  /** An `AT` address of the wrong shape, echoed with `?` for a missing size letter — `lit_address_*`, both vendors 2026-10-01. */
  directAddressMalformed(echo: string): string
  /** A VAR section declared directly in an INTERFACE (C0149). CODESYS SP21. */
  varInInterface(): string
  /** A POU whose signature names something other than its object (CODESYS SP21, measured 2026-09-17). */
  signatureNameMismatch(): string
  /** A PROPERTY declaring neither accessor (CODESYS SP21, a warning). */
  propertyWithoutAccessor(): string
  /** An FB EXTENDS-list naming more than one base FB — single inheritance only (C0096). verified both vendors. */
  multipleInheritance(): string
  /** A return type declared on a POU that is not a FUNCTION/METHOD, e.g. a PROGRAM (C0182). verified both vendors. */
  returnTypeNotAllowed(): string
  /** An interface using IMPLEMENTS where interface inheritance needs EXTENDS (C0421). verified both vendors. */
  interfaceImplementsMisused(): string
  /** `EXTENDS` on an alias, or on an enum extending an enum — inheritance is only legal on FB/interface/struct (C0144).
   *  Measured both vendors (`unit_type_extends_on_alias`, `unit_enum_extends_enum`, 2026-10-01). */
  inheritanceNotAllowed(): string
  /** `EXTENDS` on an alias (or a TYPE whose body was refused): CODESYS names the BASE, TwinCAT the type itself
   *  (`unit_type_extends_on_alias`, `unit_struct_extends_list`, 2026-10-01) — so the caller passes both. */
  extendsNotApplicable(base: string, type: string): string
  /** PRIVATE or PROTECTED on a FUNCTION_BLOCK or an interface member (`unit_fb_private`, `unit_interface_method_private`,
   *  both vendors 2026-10-01; an interface PROPERTY's is CODESYS's alone). */
  accessOnlyOnMethods(): string
  /** ABSTRACT and FINAL on one FUNCTION_BLOCK or METHOD (`unit_fb_abstract_final`, `unit_method_abstract_final`, both
   *  vendors 2026-10-01). */
  abstractAndFinal(): string
  /** A variable an interface METHOD or property ACCESSOR declares in a VAR section (CODESYS, record:exec 2026-10-01:
   *  `unit_interface_property_accessor_var`). */
  onlyParametersInInterfaceMethods(): string
  /** A VAR_INPUT variable an interface property ACCESSOR declares, echoed as `name : TYPE` (CODESYS, record:exec
   *  2026-10-01: `unit_interface_property_accessor_var_input`). */
  inputInPropertyAccessor(decl: string): string
  /** `EXTENDS` on a UNION DUT — unions cannot inherit (C0542). verified both vendors. */
  unionInheritance(name: string): string
  /** `IMPLEMENTS` on a FUNCTION — only FBs implement interfaces (C0145). Bridge-blocked: the push is rejected before the IDE compiles it (live-confirmed). */
  functionImplements(): string
  /** A `{attribute 'pack_mode'}` pragma on a FUNCTION/METHOD (only valid on data structures) (C0550). verified both vendors. */
  packModeNotAllowed(kind: string): string
  /** A `CONSTANT` variable declared without an initial value (C0228). verified both vendors. */
  constantNoInitialValue(name: string): string
  /** A CONSTANT whose initializer reaches itself (rule CE5, `ce_cycle`, `ce_cycle_self`, CODESYS SP21 2026-10-03). TwinCAT has
   *  no recorded wording: its XAE exits building one, so the check is CODESYS-only (`constant-cycle`). */
  recursiveConstant(): string
  /** A `VAR_EXTERNAL` declaration supplying an initial value (it must come from the GVL) (C0238). verified both vendors. */
  noInitForExternal(name: string): string
  /** A `VAR_EXTERNAL` with no matching `VAR_GLOBAL` anywhere (C0237). CODESYS-verified. */
  externalNoGlobal(name: string): string
  /** A VAR_IN_OUT variable referenced in another declaration's initializer (C0441). verified both vendors. */
  inoutInInitializer(): string
  /** A composite-typed input parameter (e.g. an array) declared with a default value (C0525). verified both vendors. */
  noDefaultForType(typeName: string): string
  /** `__NEW` of an FB/struct that lacks `{attribute 'enable_dynamic_creation'}` (CODESYS-measured). */
  dynamicCreationPragma(): string
}

export function declarationMessages({ tc }: VendorWording): DeclarationMessages {
  return {
    // CODESYS SP21, measured with the pragma as the only variable (`newdel_without_pragma` / `newdel_with_pragma`).
    // Both vendors have the rule and word it differently: TwinCAT writes "Functionblock or Structure" and calls
    // it an ATTRIBUTE where CODESYS calls it a pragma (`newdel_without_pragma`, both recordings 2026-09-20).
    dynamicCreationPragma: () =>
      tc
        ? "A Functionblock or Structure needs the attribute '{attribute 'enable_dynamic_creation'}' to be created with __NEW"
        : "A function block or structure needs the pragma '{attribute 'enable_dynamic_creation'}' to be created with __NEW",
    arrayBoundNonConst: (bound) => `Border '${bound}' of array is no constant value`,
    stringLengthNonConst: (length) => `String length '${length}' is no constant value`,
    borderOrder: () => `Lower border must be lower than upper border${tc ? "." : ""}`,
    referenceAsBaseType: () => `A reference type is not allowed as base type of an array, pointer${tc ? "" : ","} or reference`,
    vectorBaseType: () => `The base type of a vector must be either REAL or LREAL.`,
    variableLengthPlacement: () =>
      tc
        ? `Variable-length Arrays are only possible as VAR_IN_OUT of Methods, Functions and Functionblocks`
        : `Variable length arrays are only possible as VAR_IN_OUT of function blocks or as VAR_IN_OUT and VAR_INPUT of methods and functions`,
    variableLengthNested: () =>
      tc
        ? `A Variable-length Array type has to be on top level position of a type declaration.`
        : `A variable length array type has to be on top level position of a type declaration`,
    constInitNonConst: (name) => `Initialisation of constant variable '${name}' not constant`,
    defaultNotConstant: () => `Default value is not constant`,
    bitInWrongContainer: () => (tc ? `Only Structures and Function Blocks can contain variables of type BIT.` : `Only structures and function blocks can contain variables of type BIT`),
    bitInWrongBlock: () => (tc ? `Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT or VAR-block` : `Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section`),
    pointerToBit: () => `POINTER TO BIT is not allowed`,
    bitArrayBase: () => `BIT is not allowed as base type of an array`,
    retainNotAllowedHere: () => (tc ? `'RETAIN' or 'PERSISTENT' not allowed in this place` : `RETAIN or PERSISTENT not allowed in this place`),
    outputCantBeReference: () => (tc ? `Outputs can't be of type 'REFERENCE TO'` : `Outputs can't be of type REFERENCE TO`),
    notInstantiable: (typeName) => `'${typeName}' is of type FUNCTION and cannot be instantiated`,
    pouObsolete: (name, message) => `POU '${name}' has been marked as obsolete: ${message}`,
    directAddressMalformed: (echo) => `Direct ${tc ? "Address" : "address"} '${echo}' malformed`,
    varInInterface: () => `Variable declarations are not allowed in interfaces`,
    signatureNameMismatch: () => `The name used in the signature is not identical to the object name`,
    propertyWithoutAccessor: () => `The property defines neither a get nor a set accessor.`,
    multipleInheritance: () =>
      tc ? `Only one base function block may be defined in EXTENDS-list` : `Only one base function block may be defined in EXTENDS list`,
    returnTypeNotAllowed: () =>
      tc ? `Return type is only possible for POUs of Type FUNCTION and METHOD` : `Return type is only possible for POUs of type FUNCTION and METHOD`,
    interfaceImplementsMisused: () =>
      tc
        ? `Use Keyword EXTENDS for inheritance of Interfaces instead of IMPLEMENTS.`
        : `Use keyword EXTENDS for inheritance of interfaces instead of IMPLEMENTS`,
    inheritanceNotAllowed: () =>
      `Inheritance only allowed in ${tc ? "Functionblocks, Interfaces and Structures" : "function blocks, interfaces and structures"}`,
    extendsNotApplicable: (base, type) => `Keyword EXTENDS not applicable to type ${tc ? type : base}`,
    accessOnlyOnMethods: () => `PRIVATE and PROTECTED may only be applied on methods of ${tc ? "functionblocks" : "function blocks"}`,
    abstractAndFinal: () => `A method or functionblock cannot be ABSTRACT and FINAL`,
    // TwinCAT capitalizes and drops the serial comma (`unit_interface_method_var_stat`, 2026-10-01)
    onlyParametersInInterfaceMethods: () =>
      tc ? `Only Inputs, Outputs and Inouts allowed in Interface Methods` : `Only inputs, outputs, and inouts allowed in interface methods`,
    inputInPropertyAccessor: (decl) => `It is not allowed to define input variables in property accessors: ${decl}`,
    unionInheritance: (name) => `Inheritance is not intended for data type "UNION": ${name}`,
    // TwinCAT writes one word differently (`hdr_function_implements_no_return`; the catalog's C0145 twincatActual).
    functionImplements: () => `Interfaces can only be implemented by ${tc ? "Functionblocks" : "function blocks"}`,
    packModeNotAllowed: (kind) => `Attribute 'pack_mode' not allowed for '${kind}'`,
    constantNoInitialValue: (name) => `No initial value for constant variable '${name}'`,
    recursiveConstant: () => "Recursive definition of constant value",
    noInitForExternal: (name) => `No initial value allowed for VAR_EXTERNAL ${name}`,
    // CODESYS-verified (2026-07-11 live): no quotes around the name.
    externalNoGlobal: (name) => `No global definition found for VAR_EXTERNAL ${name}`,
    inoutInInitializer: () => `Access to uninitialized VAR_IN_OUT variable`,
    noDefaultForType: (typeName) => `The type ${typeName} cannot have a default value in this context`,
  }
}
