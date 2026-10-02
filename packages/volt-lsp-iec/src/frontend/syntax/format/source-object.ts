/**
 * WHAT A WORKSPACE FILE'S EXTENSION SAYS ITS OBJECT IS — and so how its text is read.
 *
 * The push takes an item's kind from its wire name's extension and never from its header
 * (`openspec/changes/push-without-header-check`), and the file name IS the wire name. A DUT's and a GVL's text is
 * written to the IDE exactly as sent — nothing in it is read, checked or refused — so the IDE is the only reader, and
 * the LSP reads it the way the IDE does (measured on CODESYS SP21, 2026-09-30, conformance `objects/written-as-sent.ts`):
 *
 *   - its declaration is read only when the text OPENS with the object's keyword — TYPE for a DUT; VAR_GLOBAL or
 *     VAR_CONFIG for a GVL — comments and pragmas aside. A text that opens with anything else (prose, nothing at all,
 *     a comment that never closes) declares NOTHING and the build reports NOTHING about it: only a use of what it
 *     was meant to declare fails, "Unknown type: 'X'" / "Identifier 'g' not defined";
 *   - Volt's file format claims nothing in it. The `IMPLEMENTATION` line, the retired `(* @volt-… *)` comment and the
 *     reserved word are rules about splitting a POU's declaration from its body; a DUT or a GVL has no body, the push
 *     reads nothing of it, and CODESYS builds a member named IMPLEMENTATION and a GVL holding such a comment clean.
 *
 * A POU (`.fb`/`.prg`/`.fun`) and an interface (`.itf`) are split by the push, so the file format's rules hold there.
 * Text that is no workspace file — a conformance fixture packing several units, the library repo — has no object and
 * is read as before.
 *
 * The extensions mirror `source-extensions.ts` (the literal set the wiring check reads); `source-object.test.ts`
 * holds the two to each other, since this layer may not import that one.
 */
export type SourceObject = "pou" | "interface" | "dut" | "gvl"

const BY_EXTENSION: Readonly<Record<string, SourceObject>> = {
  ".fb": "pou",
  ".prg": "pou",
  ".fun": "pou",
  ".itf": "interface",
  ".gvl": "gvl",
  ".struct": "dut",
  ".enum": "dut",
  ".union": "dut",
  ".alias": "dut",
  // A DUT whose vendor states no subtype (openspec push-without-header-check 5.B). Read like every DUT: a text that
  // does not open with TYPE declares nothing, and reports nothing.
  ".dut": "dut",
}

/**
 * The object a workspace file holds, by its extension — `undefined` for text that is no workspace source file. EXACT,
 * never case-folded, as the crawl (`workspace-refs.ts`) and the CLI classify it: `E_Mode.Enum` is a foreign file
 * `volt push` refuses, not the `E_Mode.enum` the IDE publishes.
 */
export function sourceObjectOf(uri: string): SourceObject | undefined {
  const path = pathOf(uri)
  const dot = path.lastIndexOf(".")
  if (dot < 0 || /[\\/]/.test(path.slice(dot))) return undefined
  return BY_EXTENSION[path.slice(dot)]
}

/**
 * The PATH a document is named by. A URI's object is its path's, never the last `.` of the whole string: the client's
 * selector is language-only, so an SCM diff's HEAD side arrives as `git:/…/DUT_A.struct?{"path":…,"ref":"HEAD"}`,
 * whose query ends inside encoded JSON. A scheme is two or more characters, so a drive letter (`C:\w\X.fb`) and a
 * bare path stay the path they are.
 */
function pathOf(uri: string): string {
  return /^[a-z][a-z0-9+.-]+:/i.test(uri) ? new URL(uri).pathname : uri
}

/** The objects whose text the push writes as sent — read only by the IDE, and here as the IDE reads them. */
export function isWrittenAsSent(object: SourceObject | undefined): object is "dut" | "gvl" {
  return object === "dut" || object === "gvl"
}

/**
 * The keywords a written-as-sent object's text must OPEN with for the IDE to read a declaration from it at all. A GVL
 * object opening with VAR_ACCESS builds on both vendors (`decl_var_access*`), though CODESYS's message for a GVL with
 * no list names only "VAR_GLOBAL or VAR_CONFIG" (`pwh_gvl_then_prose`).
 */
export const OPENING_KEYWORDS: Readonly<Record<"dut" | "gvl", readonly string[]>> = {
  dut: ["TYPE"],
  gvl: ["VAR_GLOBAL", "VAR_CONFIG", "VAR_ACCESS"],
}
