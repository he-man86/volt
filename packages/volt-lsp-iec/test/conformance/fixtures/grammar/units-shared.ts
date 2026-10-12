/**
 * the helpers `units.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

export const doc = "frontend-conformance design.md §4 2.4 (units)"

/** A fixture whose unit under test is the FB `FB_LANG_<name>`, instanced in PLC_PRG as `inst_<name>`; `source` holds it
 *  and whatever it needs (types, interfaces, a base, its members). */
export function fbUnit(name: string, feature: string, source: string): LanguageTest {
  return {
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
    source,
  }
}

/** An FB `FB_LANG_<name>` headed `FUNCTION_BLOCK <head>` (`<name>` stands for the FB's name in it), with `out : INT` and
 *  `body`, then `members` (METHOD/PROPERTY/ACTION units) and `before` (units written ahead of it). */
export function fb(name: string, feature: string, head: string, body: string, members = "", before = ""): LanguageTest {
  const header = head.replaceAll("<name>", `FB_LANG_${name}`)
  return fbUnit(name, feature,
    `${before}FUNCTION_BLOCK ${header}\nVAR\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members ? `\n${members}` : ""}`)
}

/** An interface `ITF_LANG_<name><suffix>` declaring `members` (and `head` after its name). */
export function itf(name: string, members: string, head = "", suffix = ""): string {
  return `INTERFACE ITF_LANG_${name}${suffix}${head}\n${members}END_INTERFACE\n\n`
}

/** The method `Get : INT` an interface declares, and the one an FB implements it with (5). */
export const ITF_GET = "METHOD Get : INT\nEND_METHOD\n"

/** The push's refusal of an interface accessor's declaration, in its words (both vendors, 2026-10-01). */
export const ACCESSOR_DECLARATION_NOT_WRITABLE = "an interface property's GET/SET carries only the fact that it exists — its declaration and body are not writable, and writing them can crash the IDE. Remove the edit, or make the change in the IDE and pull."

/** `t`, whose push both vendors refuse with `reason` (Volt's own push, before either IDE sees the text). */
export function pushRefuses(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, vendorRefuses: { codesys: reason, twincat: reason } }
}

/** `t`, whose push only TWINCAT refuses (`reason`): CODESYS takes it, so its build is recorded. */
export function twincatPushRefuses(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, vendorRefuses: { twincat: reason } }
}

/** `t`, whose text Volt's push REWRITES before either IDE sees it (`how`): no vendor ever answers the text as written.
 *  The build recording measures the rewrite, and `record:exec` would load the parser's own split — so nothing is
 *  asked. A BRIDGE gap (reported to the owner), not a fact about the language. */
export function pushRewrites(t: LanguageTest, how: string): LanguageTest {
  return {
    ...t,
    execSkip: `NOTHING TO MEASURE until the bridge carries the text as written: ${how}, so the IDE never holds what the fixture asks, and record:exec would load the LSP parser's own split — an answer shaped by the code under test`,
  }
}

/**
 * `t`, whose push both vendors refuse and whose `record:exec` answer is shaped by the code under test: the loader names
 * each member object as the LSP PARSER splits it, and with OVERRIDE read as a name that object is called OVERRIDE (it
 * was M under the parser before 2.4a) — and CODESYS reads a property's or an interface method's declaration against
 * its object (`seen`, 2026-10-01), so the answer moves with the parser. `unit_method_override` keeps its recording:
 * an FB method's declaration is parsed whatever its object is called, and BOTH namings measured OVERRIDE as a name
 * ("The name used in the signature is not identical to the object name" under M; "Unexpected token 'INT' found" +
 * "';' expected instead of 'M'" under OVERRIDE).
 */
export function loaderNamed(t: LanguageTest, seen: string): LanguageTest {
  return {
    ...t,
    execSkip: `NOTHING TO COMPARE: the push names the member by the last word before its colon (openspec bridge-refusal-review D10), and \`record:exec\` names the member object as the parser splits it — ${seen}, an answer that moves with the parser's reading rather than one about the text`,
  }
}

/** An interface accessor declaring an output or in-out (record:exec, CODESYS 2026-10-01): CODESYS refuses the
 *  IMPLEMENTER's getter against it ("Interface of overridden method '__GETVAL' of interface 'I' doesn't match declaration"
 *  + "The number of inputs/outputs of the method '__GETVAL' does not correspond to the interface 'I'."), a comparison of
 *  accessor signatures `interface-implementation` does not make. */
export function accessorSignature(t: LanguageTest): LanguageTest {
  return {
    ...t,
    deferred: {
      lsp: "niche: accepted loss (0 occurrences in the corpora — no interface accessor declares an output or in-out); comparing an implementer's accessor with the interface's is `interface-implementation`'s, which compares methods only (2026-10-01)",
    },
  }
}

export const IMPL_GET = "METHOD Get : INT\nGet := 5;\nEND_METHOD\n"

/** A STRUCT `DUT_LANG_<name><suffix>` with `fields` and `head` between its name and the colon. */
export function struct(name: string, fields: string, head = "", suffix = "", after = ""): string {
  return `TYPE DUT_LANG_${name}${suffix}${head} :\nSTRUCT${after}\n${fields}\nEND_STRUCT\nEND_TYPE\n\n`
}

/** A FUNCTION `F_LANG_<name>` whose text is `source` (`<f>` stands for its name), called by PLC_PRG's `body`. */
export function fun(name: string, feature: string, source: string, vars: string, body: string): LanguageTest {
  const f = `F_LANG_${name}`
  return {
    name,
    pouName: f,
    kind: "function",
    feature,
    fromDoc: doc,
    source: source.replaceAll("<f>", f),
    plcPrgVar: vars.replaceAll("<f>", f),
    plcPrgBody: body.replaceAll("<f>", f),
  }
}

/** A PROGRAM `PRG_LANG_<name>` headed `PROGRAM <head>` with `out : INT` set to 3, called and read by PLC_PRG. */
export function program(name: string, feature: string, head: string): LanguageTest {
  const p = `PRG_LANG_${name}`
  return {
    name,
    pouName: p,
    kind: "program",
    feature,
    fromDoc: doc,
    source: `PROGRAM ${head.replaceAll("<name>", p)}\nVAR\n\tout : INT;\nEND_VAR\nout := 3;\nEND_PROGRAM\n`,
    plcPrgVar: `seen_${name} : INT;`,
    plcPrgBody: `${p}();\nseen_${name} := ${p}.out;`,
  }
}

/** A method `M : INT` returning 7, headed `METHOD <mods> M`, called by the FB's body. */
export function method(name: string, feature: string, mods: string): LanguageTest {
  return fb(name, feature, "<name>", "out := M();", `METHOD ${mods} M : INT\nM := 7;\nEND_METHOD\n`)
}

/** An FB extending `FB_LANG_<name>_base` (whose `M` returns 1) and overriding `M` with one headed `METHOD <mods> M`. */
/**
 * `overriding`, PUSHED AS SENT, with its base FB a fixture of its own (`<name>_base`, `overrideBase`). The LSP parser
 * reads `METHOD OVERRIDE M` as the method OVERRIDE, as both vendors do, so it cannot split the source into the units
 * the recorder marks; the push reads the member as the last word before the colon (M, openspec bridge-refusal-review
 * D10) and writes the header as sent — which is what the build answers.
 */
export function overridingAsSent(name: string, feature: string, mods: string): LanguageTest {
  return {
    ...fbUnit(name, feature,
      `FUNCTION_BLOCK FB_LANG_${name} EXTENDS FB_LANG_${name}_base\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := M();\n` +
        `END_FUNCTION_BLOCK\n\nMETHOD ${mods} M : INT\nIMPLEMENTATION ST\nM := 7;\nEND_METHOD\n`),
    asSent: "the parser reads OVERRIDE as the method's name, so it cannot mark the units; the text states its own IMPLEMENTATION lines, as a workspace file does",
  }
}

/** The base FB an `overridingAsSent` fixture extends, with the `M : INT` it overrides — a fixture of its own, so the
 *  as-sent fixture is one item. */
export function overrideBase(name: string): LanguageTest {
  return {
    ...fbUnit(`${name}_base`, `the base FB of ${name}, declaring the METHOD M it overrides`,
      `FUNCTION_BLOCK FB_LANG_${name}_base\nVAR\n\tb : INT := 2;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 1;\nEND_METHOD\n`),
  }
}

/** A property `P : INT` headed `PROPERTY <mods> P` whose getter returns `stored` (6), read by the FB's body. */
export function property(name: string, feature: string, mods: string, accessor = "GET\nP := stored;\nEND_GET\n"): LanguageTest {
  return fbUnit(name, feature,
    `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tout : INT;\n\tstored : INT := 6;\nEND_VAR\nout := P;\nEND_FUNCTION_BLOCK\n\nPROPERTY ${mods ? `${mods} ` : ""}P : INT\n${accessor}END_PROPERTY\n`)
}

/** The struct an accessor-name fixture's `SET` points at or is (`SET^.x`, `SET.x`) — a fixture of its own, so each FB
 *  fixture is one item. */
export const REC = "DUT_LANG_unit_accessor_name_rec"

export const accessorNameRec: LanguageTest = {
  name: "unit_accessor_name_rec",
  pouName: REC,
  kind: "dut",
  feature: "the struct the accessor-name fixtures declare SET with",
  fromDoc: doc,
  asSent: "a TYPE with no body the parser reads: its text is pushed as a workspace file holds it",
  source: `TYPE ${REC} :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n`,
  plcPrgVar: `v_unit_accessor_name_rec : ${REC};`,
}

/** A getter / setter whose body is `body`, under its IMPLEMENTATION line, as a workspace file holds it. */
export const getter = (body: string) => `GET\nIMPLEMENTATION ST\n${body}\nEND_GET\n`

export const setter = (body: string) => `SET\nIMPLEMENTATION ST\n${body}\nEND_SET\n`

/**
 * An FB `FB_LANG_<name>` declaring `decls` beside `out`, with `body`, and a property `P : <type>` holding `accessors` —
 * PUSHED AS SENT: every body states its own IMPLEMENTATION line, as the field file does, because the rule under test
 * starts at that line (a GET/SET after it is text), and the parser's split before the fix would carry its own reading.
 */
export function accessorName(name: string, feature: string, decls: string, body: string, accessors: string, type = "INT"): LanguageTest {
  return {
    ...fbUnit(name, feature,
      `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tout : INT;\n${decls}END_VAR\nIMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n\n` +
        `PROPERTY P : ${type}\n${accessors}END_PROPERTY\n`),
    asSent: "GET/SET used as names inside an accessor: the text states its own IMPLEMENTATION lines, as a workspace file does, and the parser's split is the code under test",
  }
}

/** An interface whose `Get` is headed `METHOD <mods> Get`, implemented by the FB with a plain `METHOD Get` (5). */
export function itfMethod(name: string, feature: string, mods: string): LanguageTest {
  return fb(name, feature, `<name> IMPLEMENTS ITF_LANG_${name}`, "out := Get();", IMPL_GET,
    itf(name, `METHOD ${mods} Get : INT\nEND_METHOD\n`))
}

/** An interface whose `Val` is headed `PROPERTY <mods> Val`, implemented by the FB with a plain getter (5). */
export function itfProperty(name: string, feature: string, mods: string, accessor = "GET\nEND_GET\n"): LanguageTest {
  return fb(name, feature, `<name> IMPLEMENTS ITF_LANG_${name}`, "out := Val;",
    "PROPERTY Val : INT\nGET\nVal := 5;\nEND_GET\nEND_PROPERTY\n",
    itf(name, `PROPERTY ${mods ? `${mods} ` : ""}Val : INT\n${accessor}END_PROPERTY\n`))
}

/** A DUT that is the whole fixture, pushed AS SENT (the parser cannot split it: it has no body the parser reads), and
 *  declared in PLC_PRG so the build reaches it. */
export function bareType(name: string, feature: string, kind: "dut", source: string): LanguageTest {
  return {
    name,
    pouName: `DUT_LANG_${name}`,
    kind,
    feature,
    fromDoc: doc,
    asSent: "a TYPE with no body the parser reads: its text is pushed as a workspace file holds it",
    source,
    plcPrgVar: `v_${name} : DUT_LANG_${name};`,
  }
}

/** An FB `FB_LANG_<name>` (`out := <body>`) whose object text wraps it as `wrap` says, pushed AS SENT: the text IS the
 *  question, and the parser's split would carry its own reading of the namespace instead. */
export function namespaced(name: string, feature: string, wrap: (fbText: string) => string, body = "out := 1;"): LanguageTest {
  const fbText = `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n`
  return {
    ...fbUnit(name, feature, wrap(fbText)),
    asSent: "a project holds no namespace object; the namespace is the object's text, pushed as a workspace file holds it",
    execSkip:
      "NOTHING TO MEASURE: no program runs the FB — the push refuses a namespace block on both vendors, and the keyword line alone leaves the FB undeclared (CODESYS: \"Unknown type\", record:language 2026-10-01); nor is there a namespace object for record:exec to load the text into",
  }
}

/** `t` declared in PLC_PRG and not called — an FB whose header leaves it undeclared is asked by "Unknown type" alone. */
export function undeclaredFb(t: LanguageTest): LanguageTest {
  return { ...t, plcPrgBody: "" }
}

/** `t` with `decl` added to its FB's VAR section, beside `out`. */
export function withVar(t: LanguageTest, decl: string): LanguageTest {
  return { ...t, source: t.source.replace("VAR\n\tout : INT;\n", `VAR\n\tout : INT;\n${decl}\n`) }
}

/** `t` with `rec : DUT_LANG_<name>` declared in its FB — the STRUCT fixtures' variable. */
export function withRec(t: LanguageTest): LanguageTest {
  return withVar(t, `\trec : DUT_LANG_${t.name};`)
}

/**
 * `t` pushed AS SENT: one item, its text as written, with `IMPLEMENTATION ST` stated above the body — for a header
 * the parser misreads, where its split would put the body's line in the wrong place (or nowhere) and the push would
 * carry the parser's reading instead of the question. One unit only: what it uses is another fixture's.
 */
export function asSent(t: LanguageTest): LanguageTest {
  const units = t.source.match(/^(FUNCTION_BLOCK|FUNCTION|PROGRAM) /gm) ?? []
  if (units.length !== 1) throw new Error(`${t.name}: an AS SENT fixture holds one unit, not ${units.length}`)
  // the body is what follows the last END_VAR (every unit here declares one)
  const at = t.source.lastIndexOf("END_VAR\n") + "END_VAR\n".length
  return {
    ...t,
    asSent: "the parser misreads this header; its text is pushed as a workspace file holds it",
    source: `${t.source.slice(0, at)}IMPLEMENTATION ST\n${t.source.slice(at)}`,
  }
}
