/**
 * formatting · print (Layer E · E.3). Renders the AST back to canonical ST text — the printer half of
 * the formatter. Declarations (units · VAR sections · DUT bodies) and statement trees are re-emitted
 * with tab indentation; expressions/types reuse the layer-C renderers (`exprText`/`renderTypeExpr`),
 * the one home for that. A body that is not ST, or doesn't parse cleanly, is preserved VERBATIM from its
 * tokens — trivially round-trip-safe — under its `IMPLEMENTATION` line (and a member's `%FOLDER`), printed from the AST.
 *
 * Contract (closes A.3): `parse(format(src)) ≡ parse(src)` — formatting never changes the AST. Comments
 * inside statement bodies are not yet re-attached, so a body with inline comments is preserved verbatim.
 */
import type { Position, Range, TextEdit } from "vscode-languageserver-protocol"
import {
  type Attribute,
  type BodySpan,
  bodyReader,
  type CaseArm,
  type EnumValue,
  type PropertyAccessor,
  exprText,
  initOperatorText,
  sourceStatements,
  renderTypeExpr,
  type Statement,
  statedLine,
  type StatementList,
  stmtChildLists,
  type TopLevel,
  type TypeExpr,
  unitBodies,
  type VarDecl,
  type VarSection,
} from "../../frontend/syntax/index.js"
import { offsetFromPosition, rangeFromSpan } from "../shared/index.js"
import type { Document } from "../shared/index.js"

const TAB = "\t"

/** LSP-shaped formatting options (`editorconfig`): tabs by default, spaces on request. */
export interface FormatOptions {
  insertSpaces?: boolean
  tabSize?: number
}

/** Format the whole document. */
export function formatDocument(doc: Document, options?: FormatOptions): string {
  const units = doc.parseResult.units
  return applyIndentStyle(units.map((u, i) => printOrKeep(doc, u, units[i + 1])).join("\n\n") + "\n", options)
}

/** Range formatting: re-emit each top-level unit that intersects the range (edits are per-unit). */
export function formatRange(doc: Document, range: Range, options?: FormatOptions): TextEdit[] {
  const start = offsetFromPosition(doc.source, range.start)
  const end = offsetFromPosition(doc.source, range.end)
  const edits: TextEdit[] = []
  for (const unit of doc.parseResult.units) {
    if (unit.span.end < start || unit.span.start > end) continue
    if (refusedIn(doc, unit)) continue // kept as written: no edit (`printOrKeep`)
    edits.push({ range: rangeFromSpan(unit.span), newText: applyIndentStyle(printUnit(unit), options) })
  }
  return edits
}

/**
 * On-type formatting: after a newline, indent the fresh line to the block depth at the cursor.
 * ponytail: depth is a token-scan count of open blocks (IF/CASE/FOR/WHILE/REPEAT/__TRY vs their
 * closers) within the enclosing body — enough for auto-indent, not a full reflow.
 */
export function formatOnType(doc: Document, position: Position, ch: string, options?: FormatOptions): TextEdit[] {
  if (ch !== "\n") return []
  const offset = offsetFromPosition(doc.source, position)
  if (offset < 0) return []
  const depth = blockDepthAt(doc, offset)
  if (depth <= 0) return []
  const unit = options?.insertSpaces ? " ".repeat((options.tabSize ?? 2) * depth) : TAB.repeat(depth)
  return [{ range: { start: position, end: position }, newText: unit }]
}

/** Convert leading tabs to spaces per options (the printer always emits tabs internally). */
function applyIndentStyle(text: string, options?: FormatOptions): string {
  if (options?.insertSpaces !== true) return text
  const pad = " ".repeat(options.tabSize ?? 2)
  return text
    .split("\n")
    .map((line) => {
      const m = /^\t+/.exec(line)
      return m ? pad.repeat(m[0].length) + line.slice(m[0].length) : line
    })
    .join("\n")
}

/** Open-block depth of the ST body enclosing `offset`, by scanning the body's statements. */
function blockDepthAt(doc: Document, offset: number): number {
  for (const unit of doc.parseResult.units) {
    if (offset < unit.span.start || offset > unit.span.end) continue
    for (const body of unitBodies(unit)) {
      if (offset < body.span.start || offset > body.span.end) continue
      const parsed = sourceStatements(body) // as written: the cursor may sit in any conditional branch
      if (!parsed.ok) return 1 // inside a body but unparseable — one level of indent
      return statementDepthAt(parsed.statements, offset)
    }
  }
  return 0
}

function statementDepthAt(list: StatementList, offset: number): number {
  for (const s of list) {
    if (offset < s.span.start || offset > s.span.end) continue
    const inner = stmtChildLists(s).map((sub) => statementDepthAt(sub, offset))
    return 1 + Math.max(0, ...inner)
  }
  return 0
}

/**
 * A unit the declaration parse refused anything inside is kept AS WRITTEN: a refused declaration leaves no node, so a
 * unit reprinted from its AST deletes the user's line (`v : __VECTOR[4] OF REAL;` on TwinCAT, `v : final;` on either
 * vendor). The rule an unparseable body already follows (`printCode`), one level up. A unit's span ends with its body,
 * before its `END_…` keyword, so what is kept runs to where the next unit starts (or the end of the file).
 */
function printOrKeep(doc: Document, unit: TopLevel, next: TopLevel | undefined): string {
  if (!refusedIn(doc, unit)) return printUnit(unit)
  return verbatimText(doc.source.slice(unit.span.start, next?.span.start ?? doc.source.length)).trimEnd()
}

/** Whether the declaration parse reported an error inside `unit`. */
function refusedIn(doc: Document, unit: TopLevel): boolean {
  return doc.parseResult.errors.some((e) => e.span.start >= unit.span.start && e.span.start < unit.span.end)
}

/** The attributes a node carries, each on its own line as written, ahead of what it decorates — reprinted from the AST
 *  without them, formatting deleted every `{attribute}` of a file (frontend-conformance 2.7.2 put them in the AST). */
function attributeLines(node: { attributes?: readonly Attribute[] }, indent = ""): string {
  return (node.attributes ?? []).map((a) => `${indent}${a.text}\n`).join("")
}

function printUnit(unit: TopLevel): string {
  return attributeLines(unit) + printUnitItself(unit)
}

function printUnitItself(unit: TopLevel): string {
  switch (unit.kind) {
    case "function_block":
      return wrap(fbHeader(unit), unit.varSections, unit.body, "END_FUNCTION_BLOCK")
    case "program":
      return wrap(`PROGRAM ${unit.name.text}${returnTypeText(unit.returnType)}`, unit.varSections, unit.body, "END_PROGRAM")
    case "function":
      return wrap(
        `FUNCTION ${unit.name.text}${unit.extendsMisused ? ` EXTENDS ${unit.extendsMisused.text}` : ""}${namesClause("IMPLEMENTS", unit.implementsMisused)}${returnTypeText(unit.returnType)}`,
        unit.varSections,
        unit.body,
        "END_FUNCTION",
      )
    case "method":
      return wrap(
        `METHOD ${modifierText(unit.modifiers)}${unit.name.text}${returnTypeText(unit.returnType)}`,
        unit.varSections,
        unit.body,
        "END_METHOD",
      )
    case "action":
      return `ACTION ${unit.name.text}\n${printBody(unit.body)}END_ACTION`
    case "interface":
      return printInterface(unit)
    case "type_decl":
      return printTypeDecl(unit)
    case "global_var_list":
      return unit.varSections.map(printVarSection).join("\n")
    case "property":
      return printProperty(unit)
    case "namespace":
      return `NAMESPACE ${unit.name.text}\n${unit.units.map(printUnit).join("\n\n")}${unit.closer === undefined ? "" : "\nEND_NAMESPACE"}`
  }
}

// Every header clause as written — a clause a CHECK refuses (a PROGRAM's return type, a FUNCTION's IMPLEMENTS, an FB's
// second base) is still the file's text: reprinted without it, formatting deleted it (conformance 2.4).
function fbHeader(fb: Extract<TopLevel, { kind: "function_block" }>): string {
  const bases = fb.extends ? [fb.extends, ...(fb.extendsExtra ?? [])] : []
  return `FUNCTION_BLOCK ${modifierText(fb.modifiers)}${fb.name.text}${namesClause("EXTENDS", bases)}${namesClause("IMPLEMENTS", fb.implements)}`
}

/** ` KEYWORD a, b` for a header's name list, or nothing when it has none. */
function namesClause(keyword: string, names: readonly { text: string }[] | undefined): string {
  return names !== undefined && names.length > 0 ? ` ${keyword} ${names.map((n) => n.text).join(", ")}` : ""
}

function returnTypeText(t: TypeExpr | undefined): string {
  return t !== undefined ? ` : ${renderTypeExpr(t)}` : ""
}

function wrap(header: string, sections: readonly VarSection[], body: BodySpan, ender: string): string {
  const vars = sections.map(printVarSection).join("\n")
  return `${header}\n${vars ? vars + "\n" : ""}${printBody(body)}${ender}`
}

function printVarSection(section: VarSection): string {
  const mods = [
    section.constant ? "CONSTANT" : undefined,
    section.retain ? "RETAIN" : undefined,
    section.persistent ? "PERSISTENT" : undefined,
  ].filter(Boolean)
  const header = `${section.sectionKind}${mods.length ? " " + mods.join(" ") : ""}`
  const decls = section.decls.map((d) => attributeLines(d, TAB) + TAB + printVarDecl(d)).join("\n")
  return `${header}\n${decls ? decls + "\n" : ""}END_VAR`
}

function printVarDecl(decl: VarDecl): string {
  const names = decl.names.map((n) => n.text).join(", ")
  const at =
    decl.at !== undefined
      ? ` AT ${decl.at.tokens
          .map((t) => t.text)
          .join("")
          .trim()}`
      : ""
  // THE OPERATOR THE SOURCE USED, not `:=` for everything. A REFERENCE binds its target with `REF=`, and printing
  // `:=` there changes a bind into a store through an unbound reference — a silent rewrite of the engineer's
  // meaning, in a formatter whose whole contract is that it does not change meaning. It was invisible while the
  // AST dropped the operator; the corpus round-trip gate caught it on three files the moment it was recorded.
  const init = decl.init !== undefined ? ` ${initOperatorText(decl.initOp)}${initText(decl.init)}` : ""
  // a VAR_ACCESS declaration's path and direction (`names : path : type READ_ONLY;`)
  const path = decl.access !== undefined ? ` ${decl.access.path.map((p) => p.text).join(".")} :` : ""
  const direction = decl.access?.direction !== undefined ? ` ${decl.access.direction}` : ""
  return `${names}${at} :${path} ${renderTypeExpr(decl.type)}${direction}${init};`
}

function initText(init: VarDecl["init"]): string {
  if (init === undefined) return ""
  return init.kind === "aggregate_init" ? init.tokens.map((t) => t.text).join("") : exprText(init)
}

// ─── bodies ──────────────────────────────────────────────────────────────────

/**
 * A body: its `IMPLEMENTATION` line and a member's `%FOLDER` under it, then its code. The line and the folder are NOT in
 * `body.tokens` (`splitImplementation` takes them out — they are no code), so they are printed from where the parser
 * keeps them. Rebuilt from the tokens alone, formatting deleted both from every file: an LD body lost the line that
 * states its language and read as ST, and a member lost its folder, which the next push took for "none".
 *
 * Only a body the ST parser reads is re-printed as ST; any other (network text, a hidden body) is kept verbatim.
 */
function printBody(body: BodySpan): string {
  return implementationHead(body) + printCode(body)
}

function implementationHead(body: BodySpan): string {
  const line = body.implementation
  if (line === undefined) return ""
  const leading = line.leading === undefined ? "" : `${verbatimText(line.leading)}\n`
  return `${leading}${statedLine(line)}\n${folderLine(line.folder)}`
}

/** A member's `%FOLDER` line, in the push's one spelling (`StReader.FolderOn`), or nothing. */
function folderLine(folder: string | undefined): string {
  return folder === undefined ? "" : `%FOLDER ${folder}\n`
}

function printCode(body: BodySpan): string {
  if (bodyReader(body) !== "st") return verbatim(body)
  const parsed = sourceStatements(body)
  // preserve commented, pragma'd and unparseable bodies: the tree holds neither comments nor pragmas, so printing it
  // would drop source
  if (!parsed.ok || hasCommentOrPragma(body)) return verbatim(body)
  const text = printStatements(parsed.statements, 0)
  return text.length > 0 ? text + "\n" : ""
}

function verbatim(body: BodySpan): string {
  const raw = verbatimText(body.tokens.map((t) => t.text).join(""))
    .replace(/^\n+/, "")
    .replace(/\s+$/, "")
  return raw.length > 0 ? raw + "\n" : ""
}

/** Source text kept as written, in the printer's line ending. A body's tokens open with the newline that ends its
 *  `IMPLEMENTATION` line (or a member's `%FOLDER`); left as `\r\n` in a CRLF file, it survived the strip of leading
 *  newlines and stood under the `\n` the head prints — a blank line the push writes into the IDE body, in a file of
 *  mixed line endings. */
function verbatimText(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

function hasCommentOrPragma(body: BodySpan): boolean {
  return body.tokens.some((t) => t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma")
}

function printStatements(list: StatementList, depth: number): string {
  return list.map((s) => printStatement(s, depth)).join("\n")
}

function printStatement(s: Statement, depth: number): string {
  const ind = TAB.repeat(depth)
  switch (s.kind) {
    case "assign": {
      // Each link prints its OWN operator. This used to print `s.op` for every link on the belief that set/reset
      // ops never chain — they do (`a S= b R= c` compiles), and that belief would have reformatted it into
      // `a S= b S= c`: a different program, written back to the user's file.
      const ops = [s.op, ...(s.chainOps ?? [])].map((o) => o ?? ":=")
      const parts = [s.target, ...(s.chained ?? []), s.value].map(exprText)
      return `${ind}${parts.map((p, i) => (i === 0 ? p : `${ops[i - 1]} ${p}`)).join(" ")};`
    }
    case "call_stmt":
      return `${ind}${exprText(s.call)};`
    case "expr_stmt":
      return `${ind}${exprText(s.expr)};`
    case "return":
      return `${ind}RETURN;`
    case "exit":
      return `${ind}EXIT;`
    case "continue":
      return `${ind}CONTINUE;`
    case "empty":
      return `${ind};`
    case "if":
      return printIf(s, depth)
    case "case":
      return printCase(s, depth)
    case "for":
      return `${ind}FOR ${exprText(s.controlVar)} := ${exprText(s.from)} TO ${exprText(s.to)}${s.by ? ` BY ${exprText(s.by)}` : ""} DO\n${printStatements(s.body, depth + 1)}\n${ind}END_FOR;`
    case "while":
      return `${ind}WHILE ${exprText(s.cond)} DO\n${printStatements(s.body, depth + 1)}\n${ind}END_WHILE;`
    case "repeat":
      return `${ind}REPEAT\n${printStatements(s.body, depth + 1)}\n${ind}UNTIL ${exprText(s.until)}\n${ind}END_REPEAT;`
    case "try":
      return printTry(s, depth)
    case "jmp":
      return `${ind}JMP ${exprText(s.target)};`
    case "label":
      return `${ind}${s.name.text}:`
  }
}

function printIf(s: Extract<Statement, { kind: "if" }>, depth: number): string {
  const ind = TAB.repeat(depth)
  const parts: string[] = []
  s.branches.forEach((b, i) => {
    parts.push(`${ind}${i === 0 ? "IF" : "ELSIF"} ${exprText(b.cond)} THEN\n${printStatements(b.body, depth + 1)}`)
  })
  if (s.elseBody !== undefined) parts.push(`${ind}ELSE\n${printStatements(s.elseBody, depth + 1)}`)
  return `${parts.join("\n")}\n${ind}END_IF;`
}

function printCase(s: Extract<Statement, { kind: "case" }>, depth: number): string {
  const ind = TAB.repeat(depth)
  const arms = s.arms.map((a) => printArm(a, depth + 1)).join("\n")
  const elseBlock =
    s.elseBody !== undefined ? `\n${TAB.repeat(depth + 1)}ELSE\n${printStatements(s.elseBody, depth + 2)}` : ""
  return `${ind}CASE ${exprText(s.selector)} OF\n${arms}${elseBlock}\n${ind}END_CASE;`
}

function printArm(a: CaseArm, depth: number): string {
  const ind = TAB.repeat(depth)
  const labels = a.labels
    .map((l) => (l.upper ? `${exprText(l.value)}..${exprText(l.upper)}` : exprText(l.value)))
    .join(", ")
  return `${ind}${labels}:\n${printStatements(a.body, depth + 1)}`
}

function printTry(s: Extract<Statement, { kind: "try" }>, depth: number): string {
  const ind = TAB.repeat(depth)
  let out = `${ind}__TRY\n${printStatements(s.tryBody, depth + 1)}`
  // a catch without its operand is a catch (`stmt_try_catch_without_operand`)
  if (s.catchBody !== undefined)
    out += `\n${ind}__CATCH${s.catchVar !== undefined ? `(${exprText(s.catchVar)})` : ""}\n${printStatements(s.catchBody, depth + 1)}`
  if (s.finallyBody !== undefined) out += `\n${ind}__FINALLY\n${printStatements(s.finallyBody, depth + 1)}`
  return `${out}\n${ind}__ENDTRY;`
}

// ─── declarations ────────────────────────────────────────────────────────────

/** Modifiers as written, each followed by the space before the name. */
function modifierText(written: readonly string[]): string {
  return written.map((m) => `${m} `).join("")
}

// An interface member's `%FOLDER` closes its declaration — the last line before END_METHOD, or before a property's
// accessors — which is where the push reads it (`StReader.PeelFolderClosing`).
function printInterface(iface: Extract<TopLevel, { kind: "interface" }>): string {
  const ext = `${namesClause("EXTENDS", iface.extends)}${namesClause("IMPLEMENTS", iface.implementsMisused)}`
  const methods = iface.methods.map((m) => {
    const ret = m.returnType ? ` : ${renderTypeExpr(m.returnType)}` : ""
    const vars = m.varSections.map(printVarSection).join("\n")
    const head = `${TAB}METHOD ${modifierText(m.modifiers)}${m.name.text}${ret}\n`
    return `${head}${vars ? vars + "\n" : ""}${folderLine(m.folder)}${TAB}END_METHOD`
  })
  const properties = iface.properties.map((p) => {
    // an accessor that declares VAR sections is written as a block, so they are kept (U21); a bare one as its keyword
    const accessor = (kw: string, vars: readonly VarSection[]) =>
      vars.length === 0 ? `\n${TAB}${kw}` : `\n${TAB}${kw}\n${vars.map(printVarSection).join("\n")}\n${TAB}END_${kw}`
    const getset = `${p.hasGetter ? accessor("GET", p.getterVarSections) : ""}${p.hasSetter ? accessor("SET", p.setterVarSections) : ""}`
    const folder = p.folder === undefined ? "" : `\n%FOLDER ${p.folder}`
    const head = `${TAB}PROPERTY ${modifierText(p.modifiers)}${p.name.text} : ${renderTypeExpr(p.dataType)}`
    return `${head}${folder}${getset}\n${TAB}END_PROPERTY`
  })
  const members = [...methods, ...properties].join("\n")
  return `INTERFACE ${iface.name.text}${ext}\n${members ? members + "\n" : ""}END_INTERFACE`
}

// EXTENDS stands on the TYPE line and nowhere else: `STRUCT EXTENDS B` is refused by both vendors
// (`unit_struct_extends_after_struct`), and printing it there turned a struct the vendor builds into one it refuses. An
// EXTENDS a check refuses (`extendsMisused`) and a type's initializer are the file's text too — printed, not dropped.
function printTypeDecl(t: Extract<TopLevel, { kind: "type_decl" }>): string {
  const body = t.body
  const base = body.kind === "struct" ? body.extends : t.extendsMisused
  const head = `TYPE ${t.name.text}${base ? ` EXTENDS ${base.text}` : ""} :`
  if (body.kind === "struct" || body.kind === "union") {
    const fields = body.fields.map((f) => attributeLines(f, TAB) + TAB + printVarDecl(f)).join("\n")
    const kw = body.kind === "struct" ? "STRUCT" : "UNION"
    return `${head}\n${kw}\n${fields}\nEND_${kw}\nEND_TYPE`
  }
  if (body.kind === "enum") {
    const values = body.values.map(printEnumValue).join(", ")
    const baseType = body.baseType ? ` ${renderTypeExpr(body.baseType)}` : ""
    return `${head} (${values})${baseType}${body.init ? ` := ${initText(body.init)}` : ""};\nEND_TYPE`
  }
  // a refused body carries a parse error, and a unit with one is kept as written (`printOrKeep`), never reprinted
  if (body.kind === "refused") throw new Error(`TYPE ${t.name.text} has a refused body; it is kept as written, not printed`)
  return `${head} ${renderTypeExpr(body.target)}${body.init ? ` := ${initText(body.init)}` : ""};\nEND_TYPE`
}

function printEnumValue(v: EnumValue): string {
  return v.value !== undefined ? `${v.name.text} := ${exprText(v.value)}` : v.name.text
}

// A property's `%FOLDER` closes its declaration, before its accessors (`StWriter.AssembleProperty`). An accessor with no
// VAR section prints none — not an empty line: a leading newline in an accessor is the engineer's blank line to the push.
function printProperty(p: Extract<TopLevel, { kind: "property" }>): string {
  const acc = (label: string, a: PropertyAccessor | undefined, ender: string) => {
    if (a === undefined) return ""
    const vars = a.varSections.map(printVarSection).join("\n")
    return `${label}${a.modifiers.map((m) => ` ${m}`).join("")}\n${vars ? vars + "\n" : ""}${printBody(a.body)}${ender}`
  }
  const parts = [acc("GET", p.getter, "END_GET"), acc("SET", p.setter, "END_SET")].filter(Boolean).join("\n")
  const head = `PROPERTY ${modifierText(p.modifiers)}${p.name.text} : ${renderTypeExpr(p.dataType)}\n`
  return `${head}${folderLine(p.folder)}${parts}\nEND_PROPERTY`
}
