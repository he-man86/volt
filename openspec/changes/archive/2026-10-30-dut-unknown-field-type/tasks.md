> DRAFT, written from Sim-Assist. Sections 1, 2 and the class sweep (4) done 2026-10-30; 3.1 is Sim-Assist's.

## 1. Check

- [x] 1.1 Resolve STRUCT and UNION field types in `computeDiagnostics`; unknown type → error on the type span
  (`unknown-type` walks `declaredTypes` — `frontend/syntax/ast/declarations.ts`, the one census of the positions a type
  stands in — and asks `unknownNamedTypes` — `analysis/shared/resolution.ts`, `unknownTypeName` of the type and of what
  an ARRAY, a POINTER or a REFERENCE wraps; the report sits on the unknown name, in the declaring file)

## 2. Test

- [x] 2.1 The repro of proposal.md reports one error in `ST_Data.dut` at 4:10 and none in `Main.pou`
  (`unknown-type.test.ts`, "a STRUCT field of an unknown type is reported on its type, in the DUT")
- [x] 2.2 A field of a known DUT, of an FB type and of `ARRAY[..] OF <unknown>` (error on the element type)
  (`unknown-type.test.ts`: the known DUT / FB / elementary fields silent, the ARRAY's element reported)

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`) — handed to Sim-Assist 2026-10-30 (its task, not Volt's)

## 4. Class sweep — a type reference in a declaration position

Every position IEC/CODESYS lets a type name stand, one conformance fixture each (`test/conformance/fixtures/declarations/
type-references.ts`, `tref_*`, recorded live on CODESYS SP21 in English, 2026-10-30), asked with a name nothing declares
(`NoSuchType`). "Before" is the LSP on `dev` 660329de3d.

- [x] 4.1 Census and fixes:

| Position | Fixture | CODESYS says | Before | After |
|---|---|---|---|---|
| VAR (FB) | `qf_c0077_before` (existing) | Unknown type | reported | reported |
| VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR_TEMP / VAR_STAT | `tref_var_*` | Unknown type (IN_OUT: + "must be assigned") | reported | reported |
| VAR_INST (method) | `tref_var_inst` | Unknown type | reported | reported |
| VAR_GLOBAL (GVL) | `tref_var_global` | Unknown type | reported | reported |
| VAR_CONFIG | `tref_var_config` | Unknown type | reported | reported |
| VAR_EXTERNAL | `tref_var_external` | Unknown type + no global definition | reported | reported |
| `a, b : X` | `tref_var_two_names` | Unknown type ×2 | reported ×2 | reported ×2 |
| STRUCT field | `tref_struct_field` | Unknown type | **missed** | fixed |
| STRUCT field, DUT used by nothing | `tref_struct_field_unused` | nothing (not compiled) | — | reported: known divergence, the DUT-reachability rule of `sn_dut_mismatch` |
| UNION field | `tref_union_field` | Unknown type | **missed** | fixed |
| STRUCT field of ARRAY OF / POINTER TO X | `tref_struct_field_array`, `_pointer` | Unknown type | **missed** | fixed |
| alias `TYPE A : X;` | `tref_alias` | Unknown type | **missed** | fixed |
| ARRAY OF X (1-dim, 2-dim, nested) | `tref_array_element`, `_two_dims`, `_nested` | Unknown type ×1 | **missed** | fixed |
| POINTER TO X / REFERENCE TO X / POINTER TO ARRAY OF X | `tref_pointer_to`, `tref_reference_to`, `tref_pointer_to_array` | Unknown type | **missed** | fixed |
| subrange base `X(0..5)` | `tref_subrange_base` | syntax error + Unknown type | reported | reported |
| enum base `(a, b) X` (DUT) | `tref_enum_base`, `tref_enum_base_alias` | SYNTAX error "':= or ;' expected instead of 'X'" — for a declared alias too | silent | fixed in the PARSER: a base is an elementary type's name |
| implicit enum base `v : (a, b) X` | `tref_implicit_enum_base` | syntax error "';, :=, REF=, ( or [' expected …" | silent | fixed (same parser rule) |
| FUNCTION result | `tref_function_return` | Unknown type | **missed** (dialect half only) | fixed |
| METHOD result | `tref_method_return` | Unknown type | **missed** | fixed |
| PROPERTY type (SET) | `tref_property_type_set` | Unknown type ×2 | **missed** | fixed (the property and each accessor) |
| PROPERTY type (GET; GET+SET) | `tref_property_type`, `_get_set` | Unknown type ×3 / ×4 + "Cannot convert type 'X' to type 'X'" | **missed** | ×2 / ×3; the GET body's extra pair a known divergence (an unresolved type kept as its written name, which the type model has no form for) |
| PROPERTY GET local | `tref_property_get_local` | Unknown type | reported | reported |
| INTERFACE METHOD result / input | `tref_interface_method_return`, `_input` | Unknown type | **missed** | fixed |
| INTERFACE PROPERTY with GET / with no accessor | `tref_interface_property_get`, `_type` | Unknown type ×2 / only the no-accessor warning | **missed** / agrees | fixed / agrees |
| FB EXTENDS / INTERFACE EXTENDS / IMPLEMENTS | `inh_unresolved_base`, `inh_interface_extends_unknown`, `cc2_base_and_interface_not_found` (existing) | as recorded | reported | reported |
| STRUCT EXTENDS | `tref_struct_extends` | Unknown type + "No definition found for base class" | **missed** | fixed (`oop/inheritance`, the FB's pair) |
| STRING length a name nothing declares | `tref_string_length_name` | "Identifier … not defined" + "String length … is no constant value" | **missed** | fixed (`const-context`, `unresolved-identifier`) |
| ARRAY bound / subrange bound a name nothing declares | `tref_array_bound_name`, `tref_subrange_bound_name` | "Border … of array is no constant value" | **missed** | fixed (`const-context`) |
| subrange bound a variable | `tref_subrange_bound_variable` | "Border 'hi' of array is no constant value" | **missed** | fixed (`const-context`) |
| `SIZEOF(X)` | `tref_sizeof` | Unknown type + not defined + conversion | Unknown type **missed** | fixed |
| `__NEW(X)` | `tref_new` | Unknown type + conversion of 'POINTER TO X' + the device's "No memory …" | **false positive** "Identifier not defined" + an 'Unknown type: __NEW(…)' conversion | Unknown type; the rest a known divergence beside `op_sys_new_delete` |
| `TO_X(1)` | `tref_to_conversion` | not defined + no call target + conversion | agrees | agrees |

  TwinCAT (4024, recorded the same day) says "Unknown type" in the same positions, with its own counts (`a, b : X` once,
  a METHOD's VAR_INST twice, a VAR_TEMP nothing) and STRUCT EXTENDS as "No definition found for base class" alone — which
  the LSP gives. Its "Unknown type" stays unjudged on TwinCAT until the `References/` library rule (lsp-quick-fixes 2.4),
  as for `qf_c0077_before`: GAPs, no false positive (`test/baseline/baseline-e.ts` names each fixture's).

- [x] 4.2 Colocated src tests: `frontend/syntax/ast/declarations.test.ts`, `parse/type-expr.test.ts` (enum base),
  `checks/declarations/unknown-type.test.ts`, `checks/oop/inheritance.test.ts` (STRUCT EXTENDS),
  `checks/declarations/const-context.test.ts`, `checks/names/unresolved-identifier.test.ts` (`__NEW`, `SIZEOF`, STRING length)
