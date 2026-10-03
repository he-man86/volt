/**
 * THE COMPILER'S OWN STRUCTS — the named types both vendors build without any library declaring them, written out here
 * as the declarations they stand for, so a member read through one is typed and an unknown member is refused like any
 * struct's (frontend-conformance 4.1.3; `analysis/resolution` `BUILTIN_NAMED_TYPES` lists the names):
 *
 *   VERSION              rule TY15 — `docs/codesys-reference/06-data-types.md` "VERSION": four UINT components. Recorded
 *                        2026-10-03 on both vendors: the components are UINT (`ty_version_component_type`: "Cannot
 *                        convert type 'UINT' to type 'SINT'"), they hold and add (`ty_version_type` runs to 69), an
 *                        unknown one is "'uiBuild' is no component of 'VERSION'", and the struct itself is 'VERSION'
 *                        in a message (`ty_version_into_string`).
 *   __SYSTEM.AnyType     rule TY14 — what an input declared ANY or ANY_<group> IS inside its function: `diSize` the
 *                        argument's size (`type_any_function_input` runs to 2 for an INT, `ty_any_num_parameter_accepts_
 *                        real` to 4), `pValue` its address as raw bytes (`tr_17_any_pvalue_*`: read through a POINTER TO
 *                        REAL it is the bits), `TypeClass` the compiler's `__SYSTEM.TYPE_CLASS` — which is declared
 *                        nowhere here, so that component is untyped rather than given a guessed member list. An UNKNOWN
 *                        component is unrecorded (the vendor may name AnyType, not the group), so `analysis/resolution`
 *                        does not refuse one (step 4a review).
 *
 * They are bound in a project of their own, never in the asker's: they are no project's symbols (a project of its own
 * that declares `VERSION` wins, `resolve.ts`), and resolving their components needs nothing but elementary types.
 */
import { parseSource } from "../syntax/index.js"
import { build, type Scope } from "../symbols/index.js"
import { GENERIC_PARAMETER_TYPES } from "./compat.js"
import type { StructType } from "./type.js"

const SYSTEM_SOURCE = `TYPE VERSION :
STRUCT
	uiMajor : UINT;
	uiMinor : UINT;
	uiServicePack : UINT;
	uiPatch : UINT;
END_STRUCT
END_TYPE

TYPE AnyType :
STRUCT
	TypeClass : __SYSTEM.TYPE_CLASS;
	pValue : POINTER TO BYTE;
	diSize : DINT;
END_STRUCT
END_TYPE
`

let systemScopes: ReadonlyMap<string, Scope> | undefined
/** The system structs' member scopes, by upper-case name — bound once. */
function scopes(): ReadonlyMap<string, Scope> {
  if (systemScopes === undefined) {
    const project = build.buildSymbolTable([{ uri: "volt:system/types.dut", source: SYSTEM_SOURCE, parseResult: parseSource(SYSTEM_SOURCE, { networkText: false }) }])
    systemScopes = new Map(project.children.filter((c) => c.kind === "struct").map((c) => [c.name.toUpperCase(), c]))
  }
  return systemScopes
}

/**
 * The compiler-provided struct a bare type name stands for: `VERSION`, or the AnyType an `ANY` / ANY_<group> input is
 * (named as written, so a message names the parameter's declared group). Undefined for any other name.
 */
export function systemStructType(name: string): StructType | undefined {
  const upper = name.toUpperCase()
  if (upper === "VERSION") return { kind: "struct", name: "VERSION", scope: scopes().get("VERSION") }
  if (GENERIC_PARAMETER_TYPES.has(upper)) return { kind: "struct", name: upper, scope: scopes().get("ANYTYPE") }
  return undefined
}
