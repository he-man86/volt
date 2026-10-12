/**
 * THE AST'S UNITS — the top-level units of a file, and the parse result with its errors. One family of `ast/nodes/`
 * (openspec lsp-same-standard design.md §8).
 */
import type { Token } from "../../lex/tokens.js"
import type { Keyword, Dialect } from "../../lex/vocabulary.js"
import type { Span } from "../../span.js"
import type { Attribute, VarSection, DutBody, VarSectionKind, VarDecl } from "./declarations.js"
import type { Identifier, BodySpan } from "./expressions.js"
import type { TypeExpr } from "./types.js"

// ─── top-level units ─────────────────────────────────────────────────────────

export type TopLevel =
  | FunctionBlock
  | Program
  | Function
  | Method
  | Action
  | Property
  | Interface
  | TypeDecl
  | GlobalVarList
  | Namespace

export interface Namespace {
  kind: "namespace"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  units: TopLevel[]
  /** Its END_NAMESPACE as written — absent when the text runs out first (the keyword line alone is a text the push hands
   *  the IDE, rule U28) and on a library's namespace, which no text spells. The printer writes a closer only where one
   *  stood. */
  closer?: Span
  span: Span
}
export interface FunctionBlock {
  kind: "function_block"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC FINAL`): the header's text, kept so a check reads it and the formatter
   *  prints it back as written (conformance 2.4.3). An access modifier stands only first; one written later is kept here
   *  too — it is the file's text — and refused by the parser (`parse/names` `refusedAccessModifier`). */
  modifiers: Keyword[]
  /** An access modifier written after another modifier (`FUNCTION_BLOCK FINAL PUBLIC X`): both vendors then declare no
   *  FB at all and say nothing about the header — only "Unknown type" where it is used (`unit_fb_final_public_order`,
   *  `unit_fb_public_internal`, 2026-10-01). The binder declares no symbol for it. */
  headerRefused?: true
  /** A return type illegally declared on a FUNCTION_BLOCK (`FUNCTION_BLOCK X : INT`) — drives C0182, as a PROGRAM's. */
  returnType?: TypeExpr
  /** A `: <type>` the parser refused — `returnType` is then absent, and this says one was declared. */
  returnTypeRefused?: true
  extends?: Identifier
  /** The illegal 2nd+ bases when the EXTENDS list has more than one (single inheritance only) — drives C0096. */
  extendsExtra?: Identifier[]
  implements?: Identifier[]
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Program {
  kind: "program"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  /** A return type illegally declared on a PROGRAM (`PROGRAM P : BOOL`) — drives C0182. */
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Function {
  kind: "function"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
  /** An illegal `IMPLEMENTS` clause on a FUNCTION (only FBs implement interfaces) — drives C0145. */
  implementsMisused?: Identifier[]
  /** An illegal `EXTENDS` clause on a FUNCTION — its base is never found (`hdr_function_extends_no_return`). */
  extendsMisused?: Identifier
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Method {
  kind: "method"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC FINAL`): the header's text, kept so a check reads it and the formatter
   *  prints it back as written (conformance 2.4.3). An access modifier stands only first; one written later is kept here
   *  too — it is the file's text — and refused by the parser (`parse/names` `refusedAccessModifier`). */
  modifiers: Keyword[]
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Action {
  kind: "action"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  body: BodySpan
  span: Span
}
export interface Property {
  kind: "property"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  dataType: TypeExpr
  getter?: PropertyAccessor
  setter?: PropertyAccessor
  span: Span
}
export interface PropertyAccessor {
  kind: "get" | "set"
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Interface {
  kind: "interface"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  extends?: Identifier[]
  /** An IMPLEMENTS list illegally used on an interface (should be EXTENDS) — drives C0421. */
  implementsMisused?: Identifier[]
  /** VAR sections illegally placed directly in the interface body (interfaces declare signatures only) — drives
   *  C0149, which fires once an FB IMPLEMENTS the interface (an interface nobody implements is never compiled). */
  strayVarSections?: VarSection[]
  methods: InterfaceMethod[]
  properties: InterfaceProperty[]
  span: Span
}
export interface InterfaceMethod {
  kind: "interface_method"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  returnType?: TypeExpr
  varSections: VarSection[]
  span: Span
}
export interface InterfaceProperty {
  kind: "interface_property"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  dataType: TypeExpr
  hasGetter: boolean
  hasSetter: boolean
  /** The VAR sections each accessor declares — the vendor's stored content, not a body (DIALECT D21: an interface
   *  accessor has none). Kept so the formatter prints them back; read and dropped, formatting deleted them (U21). */
  getterVarSections: VarSection[]
  setterVarSections: VarSection[]
  span: Span
}
export interface TypeDecl {
  kind: "type_decl"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  name: Identifier
  body: DutBody
  /** An `EXTENDS Base` clause on a non-STRUCT DUT (enum/alias → C0144, union → C0542) — inheritance is only
   *  legal on structs (and FBs/interfaces). The parser sets this only in the illegal case. */
  extendsMisused?: Identifier
  span: Span
}
export interface GlobalVarList {
  kind: "global_var_list"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  varSections: VarSection[]
  span: Span
}

// ─── parse result ────────────────────────────────────────────────────────────

export interface ParseError {
  message: string
  span: Span
  /**
   * THE TOKEN THIS IS THE "Unexpected token" ERROR ABOUT — set only for that one shape, and only so the
   * analysis layer can word it per vendor (CODESYS "token", TwinCAT "Token"; measured 2026-09-20 on `echo_*`
   * and every reserved-name cascade). The parser stays vendor-blind: it carries the FACT and `message` keeps a
   * readable default, and `checkParseErrors` — which knows the vendor — renders the final wording. Without
   * this the only other way to reach TwinCAT's spelling is a vendor-aware parser, which is a much larger
   * change than one capital letter is worth.
   */
  unexpectedToken?: string
  /**
   * A GLOBAL missing its `;` after the type (`endAfterType` in a VAR_GLOBAL section). A vendor FACT like
   * `unexpectedToken`: TwinCAT reports it, CODESYS reports nothing for it in a GVL (conformance
   * `pwh_gvl_missing_semicolon`, measured on both 2026-09-30), and only the analysis layer knows the vendor.
   */
  globalMissingSemicolon?: true
  /**
   * A CALL OPERATOR WRITTEN WITHOUT ITS `(` — "'ABS' needs exactly '1' operands" (`CALL_OPERATOR_OPERANDS`). A fact like
   * `unexpectedToken`, for the same reason: TwinCAT capitalises "Operands", and only the analysis layer knows the vendor.
   */
  operandCount?: { operator: string; count: number; atLeast: boolean }
  /**
   * AN `AT` OPERAND THAT IS NO ADDRESS — a size letter and no position, `AT %IW*` / `AT %MW`: "Direct address expected
   * after AT instead of %IW" (`lit_address_incomplete_sized`, `lit_address_no_position`). A fact like `unexpectedToken`:
   * TwinCAT words it 'Direct Address expected after "AT" instead of %IW', and only the analysis layer knows the vendor.
   */
  directAddressExpected?: string
  /**
   * A VAR SECTION INSIDE A STRUCT, by its keyword (`parse/declarations` `refuseSectionInStruct`) — the placement error the
   * vendors word each their own way ("VAR_TEMP declaration not allowed in this place" / "'VAR_TEMP' declaration …",
   * `decl_<kw>_inside_struct`). A fact like `unexpectedToken`: only the analysis layer knows the vendor.
   */
  sectionInStruct?: VarSectionKind
  /**
   * …and that section ECHOED as the compiler reads it back — "Variable declaration expected instead of VAR\r\n\ta:INT;
   * \r\nEND_VAR\r\n" (`decl_var_inside_struct*`). The keyword as echoed (none for VAR_INST and VAR_CONFIG) and the
   * declarations; the analysis writes the text, as it prints types and values (the parser imports no printer).
   */
  sectionEcho?: { keyword: string; decls: readonly VarDecl[] }
  /**
   * A CONDITIONAL DIRECTIVE WITH NO `{IF}` OPEN for it in its statement list (`parse/statements` `applyPragmas`), by its
   * word — "Unexpected pragma: 'END_IF' found without matching 'if'". A fact like `unexpectedToken`: TwinCAT capitalises
   * "Pragma" (`conditional_orphan_else`, `prag_unbalanced_end_if`), and only the analysis layer knows the vendor.
   */
  orphanPragma?: string
  /** A conditional `{IF}` chain left open where its statement list ends — "Unexpected End-of-file found: 'ELSIF', 'ELSE'
   *  or 'END_IF' expected" (byte-identical on both vendors); a fact so the analysis gives it its own code. */
  unterminatedConditional?: true
  /** A CASE whose first arm has no label — "No CASE label found" (CODESYS) / "No case label found" (TwinCAT,
   *  `rec_refused_word_case_label_first`, 2026-10-02); a fact like `unexpectedToken`, worded by the analysis layer. */
  noCaseLabel?: true
  /** A `hasattribute` condition whose attribute is no quoted string, by the text found — "Single byte string expected for
   *  an attribute value instead of 'X'" (`cc6_attribute_value_unquoted`, both vendors); a fact so the analysis keeps the
   *  rule its own code (`attribute-value-string`). */
  attributeValueString?: string
}
export interface ParseResult {
  units: TopLevel[]
  errors: ParseError[]
  /**
   * NAMES A DECLARATION TRIED TO DECLARE AND COULD NOT, lower-cased — so the semantic pass can stay quiet about
   * every later use of one.
   *
   * A declaration that fails to parse binds nothing, and then every mention of the name downstream is undefined
   * and each is reported. CODESYS stops at the parse error. That cascade is the whole reason the sixteen reserved
   * IL operator names are not in the keyword table: adding them cost 44 LSP-only messages against 16 real misses
   * (`docs/reserved-il-operators.md`). It is not specific to them — ANY malformed declaration does it, and the only
   * reason it has been invisible is that no fixture had a malformed declaration AND a later use of the name.
   */
  failedDeclarations: string[]
  /**
   * The token stream the parse read — trivia included, lexed ONCE with the parse's dialect. A consumer that needs the
   * tokens (a check reading pragmas or literals as written) reads them here rather than lexing the source a second
   * time, possibly with another vocabulary.
   */
  tokens: readonly Token[]
  /** The vocabulary `tokens` were lexed with — so a consumer reading them can refuse a parse made for another vendor
   *  (`computeDiagnostics`) instead of answering with the wrong vocabulary. */
  dialect: Dialect
}
