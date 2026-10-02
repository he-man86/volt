/**
 * The URI a test should give a source: named after the POU it declares, because that is what a workspace does —
 * one item, one file, and the file carries the OBJECT's name.
 *
 * It matters now that `signature-name` exists. CODESYS errors when an object's name and its signature disagree
 * ("The name used in the signature is not identical to the object name", measured on SP21), so a harness that
 * invents a file name accuses its own fixture of a real defect. Seventeen tests across five files did.
 */
import type { ParseResult } from "../frontend/syntax/index.js"

const EXT: Record<string, string> = {
  // Every POU is `.pou` whatever its text says (openspec push-without-header-check 5.Q).
  function_block: "pou",
  program: "pou",
  function: "pou",
  interface: "itf",
  global_var_list: "gvl",
}

/** `FB_Name.pou` for the first named top-level unit, or `unit.st` when the source declares nothing named. */
export function uriFor(parseResult: ParseResult, fallback = "unit"): string {
  const unit = parseResult.units.find((u) => "name" in u && EXT[u.kind] !== undefined)
  if (unit === undefined) return `${fallback}.st`
  return `${(unit as { name: { text: string } }).name.text}.${EXT[unit.kind]}`
}
