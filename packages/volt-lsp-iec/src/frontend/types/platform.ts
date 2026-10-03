/**
 * THE TARGET — the one place a type fact depends on the device the code runs on: the platform-portable integers
 * (`__XINT`, `__UXINT`, `__XWORD`) take the pointer width. Everything else about a type is the same on every target.
 */
import type { Target } from "../syntax/index.js"
import { aliasElem, ELEMENTARY_TYPES, elementaryType, type ElementaryType } from "./elementary.js"

export type { Target }

/**
 * THE PLATFORM-PORTABLE INTEGERS, which are a different kind of alias: the COMPILER resolves them by target width,
 * and by the time it prints a message the alias is gone. They are in the vendor's Elementary group and were missing
 * from this table entirely, so `elementaryType("__XINT")` was undefined and every check gating on `checkable()` said
 * nothing about them.
 *
 * Measured on the exec oracle (`types/platform-integers.ts`, 2026-09-19) — every message names the resolved type and
 * `SIZEOF` is 8 for all three:
 *
 *   __XINT   -> LINT     `a : __XINT` into a DINT is "Cannot convert type 'LINT' to type 'DINT'"
 *   __UXINT  -> ULINT
 *   __XWORD  -> LWORD    and `__XWORD + DINT` is LINT, exactly as the measured meet lattice says
 *
 * THAT IS A 64-BIT TARGET, AND THE TABLE BELOW IS ITS ANSWER — the 32-bit one is `PLATFORM_ALIASES_32`, and the TARGET
 * picks (`canonicalElem`). This said "Volt has no such device to
 * record against, so a 32-bit project is an unrecorded case rather than a wrong one". **That premise is false as
 * of 2026-09-20**: the TwinCAT fixture project is a 32-bit target, and re-recording the whole suite against it
 * measured exactly the predicted other half —
 *
 *   __XINT -> DINT, __UXINT -> UDINT, __XWORD -> DWORD
 *
 * across all 18 `plat_*` cells, consistently. So the width is a property of the TARGET, it is now measured on
 * both sides, and this table is right for one of them and wrong for the other.
 *
 * IT IS NOT A VENDOR PROPERTY, and must not become a vendor branch. TwinCAT ships x64 runtimes and CODESYS ships
 * 32-bit PLCs; keying it on the vendor would be right for these two fixture projects and wrong in principle. What
 * decides it is the DEVICE: the exec oracle's is `CODESYS Control Win V3 x64` and says so in its name, while the
 * TwinCAT project carries no marker at all and takes the platform its solution has active: TwinCAT Project13 is on
 * `TwinCAT RT (x64)`, Project14 on `TwinCAT CE7 (ARMV7)` (both measured 2026-10-03, `ty_xint_twincat_width`).
 *
 * THE TARGET DECIDES, and an unknown one says NOTHING — one rule, no vendor branch (frontend-conformance 4.1.1). The
 * target is the project scope's (`symbols/scope` `targetOf`, `CompileEnvironment.target`): the conformance harness
 * states the recording projects' (64-bit, measured), lowering the exec oracle's (`transpile/lower/conditions`), and the
 * server a workspace's where a device descriptor names a device whose width is measured (`workspace-refs`
 * `MEASURED_DEVICE_TARGETS`). Elsewhere a platform integer is a type NAME (`isElementaryTypeName` — never "Unknown
 * type") with no facts: it resolves to UNKNOWN and every check is silent about it. The exposure of that silence, measured
 * (2026-10-03, `test/frontend` type-dump "a platform integer on a target nobody measured (TY6)"): all 1833 uses written in
 * the corpus (`__XWORD` 1570, `__UXINT` 193, `__XINT` 70) are inside `Library Manager/`, but own code REACHES them
 * through the libraries' aliases — `CAA.HANDLE`, a tick count — and 54 expressions of own files in the projects whose
 * device width nobody measured go untyped (`RobotSerialNumberFB`, `CalculateParkingPosDelayFB`, `IMM_Default` in pro2193).
 *
 * Kept out of `ELEM_ALIASES` on purpose: that map's inverse drives `elementaryDisplayName`, and these must never
 * print as themselves.
 */
export const PLATFORM_ALIASES: ReadonlyMap<string, string> = new Map([
  ["__XINT", "LINT"],
  ["__UXINT", "ULINT"],
  ["__XWORD", "LWORD"],
])



/** The platform integers on a 32-bit target — measured on the TwinCAT fixture project while its active platform was
 *  `TwinCAT CE7 (ARMV7)` (2026-09-20, every `plat_*` cell; see `PLATFORM_ALIASES`). */
const PLATFORM_ALIASES_32: ReadonlyMap<string, string> = new Map([
  ["__XINT", "DINT"],
  ["__UXINT", "UDINT"],
  ["__XWORD", "DWORD"],
])

/** Is `name` (any case) one of the platform integers — a TYPE NAME whatever the target, its width the target's. */
export function isPlatformInteger(name: string): boolean {
  return PLATFORM_ALIASES.has(name.toUpperCase())
}

/**
 * Canonical short-form name for an elementary type WRITTEN IN SOURCE (resolves the IEC abbreviations and, on a known
 * `target`, the platform integers), upper-cased. The target is REQUIRED (frontend-conformance 4.1.1): on an unknown one
 * (`undefined` — the LSP over a workspace whose device width nobody measured) a platform integer stays itself, which is
 * no elementary type, so it resolves to nothing and every check is silent about it rather than guessing a width.
 */
export function canonicalElem(name: string, target: Target | undefined): string {
  const u = aliasElem(name)
  if (target === undefined || !isPlatformInteger(u)) return u
  return (target.pointerBits === 64 ? PLATFORM_ALIASES : PLATFORM_ALIASES_32).get(u)!
}

/** Facts for an elementary type name written in source, on `target` — `elementaryType` plus the platform integers. */
export function elementaryTypeOn(name: string, target: Target | undefined): ElementaryType | undefined {
  return ELEMENTARY_TYPES.get(canonicalElem(name, target))
}

/**
 * A TYPE NAME the compiler provides, whatever the target: an elementary type or a platform integer. The name exists on
 * every target — `x : __XINT` is never "Unknown type" — even where its width, and so its facts, are not known.
 */
export function isElementaryTypeName(name: string): boolean {
  return elementaryType(name) !== undefined || isPlatformInteger(name)
}
