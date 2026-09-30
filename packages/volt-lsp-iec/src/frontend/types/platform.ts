/**
 * THE TARGET — the one place a type fact depends on the device the code runs on: the platform-portable integers
 * (`__XINT`, `__UXINT`, `__XWORD`) take the pointer width. Everything else about a type is the same on every target.
 */
import { ELEM_ALIASES } from "./elementary.js"

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
 * THAT IS A 64-BIT TARGET, AND THE TABLE BELOW ASSERTS IT UNCONDITIONALLY. This said "Volt has no such device to
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
 * TwinCAT project carries no marker at all and takes TwinCAT's 32-bit default.
 *
 * LEFT AS IS, DELIBERATELY, because the alternative is a guess of a different shape. Declining to resolve them
 * would silence a message that is CORRECT on every 64-bit project, and the LSP analyses files without a device in
 * reach — the conformance replay has no workspace at all. Exposure today is nil and measured: all 1833 uses in
 * the corpus (`__XWORD` 1570, `__UXINT` 193, `__XINT` 70) are inside `Library Manager/`, which the server skips,
 * so no corpus file is analysed against this assumption. The 9 `plat_*` false positives against TwinCAT are the
 * whole of the damage, and they are on the triage list with this note rather than papered over.
 *
 * The fix, when it comes, is to take the width from the project's target and to say NOTHING when that is not
 * knowable — one rule, no vendor branch. `openspec/changes/twincat-conformance-parity` carries the decision.
 *
 * Kept out of `ELEM_ALIASES` on purpose: that map's inverse drives `elementaryDisplayName`, and these must never
 * print as themselves.
 */
export const PLATFORM_ALIASES: ReadonlyMap<string, string> = new Map([
  ["__XINT", "LINT"],
  ["__UXINT", "ULINT"],
  ["__XWORD", "LWORD"],
])


/**
 * A compilation target — only what the type facts depend on: the width of a pointer, which is the width the platform
 * integers take. REQUIRED from conformance 4.1.1, where it becomes the project's; until then every caller gets
 * `SIXTY_FOUR_BIT`, the one target the table used to assume.
 */
export interface Target {
  pointerBits: 32 | 64
}

/** The 64-bit target — `CODESYS Control Win V3 x64`, the exec oracle's device. */
const SIXTY_FOUR_BIT: Target = { pointerBits: 64 }

/** The platform integers on a 32-bit target — measured on the TwinCAT fixture project (see `PLATFORM_ALIASES`). */
const PLATFORM_ALIASES_32: ReadonlyMap<string, string> = new Map([
  ["__XINT", "DINT"],
  ["__UXINT", "UDINT"],
  ["__XWORD", "DWORD"],
])

/** Canonical short-form name for an elementary type (resolves the IEC abbreviations and the platform integers) on
 *  `target`. Upper-cases. */
export function canonicalElem(name: string, target: Target = SIXTY_FOUR_BIT): string {
  const u = name.toUpperCase()
  return ELEM_ALIASES.get(u) ?? (target.pointerBits === 64 ? PLATFORM_ALIASES : PLATFORM_ALIASES_32).get(u) ?? u
}
