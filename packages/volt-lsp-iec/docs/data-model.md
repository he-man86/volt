# ST Language Server — data model

The concrete exported type surface, derived from the working implementation and organized by the target layer
structure. Definitions are lightly cleaned (doc-comments trimmed, shape preserved). This is the type contract
the build works to; the **Rebuild refinements** at the end list where the clean design intentionally changes
these shapes.

## syntax (tokens + AST)

### Lexer

```ts
interface Span {
  start: number; end: number            // byte offsets, end exclusive
  startLine: number; startCol: number   // 1-based line, 0-based col
  endLine: number; endCol: number
}

type TokenKind =
  | "keyword" | "identifier"
  | "int_lit" | "real_lit" | "string_lit" | "wstring_lit"
  | "time_lit" | "date_lit" | "tod_lit" | "datetime_lit"
  | "typed_lit" | "address_lit"
  | "punct"
  | "line_comment" | "block_comment" | "pragma" | "whitespace"  // trivia
  | "eof" | "unknown"

// ~200 canonical ST keywords (case-insensitive lex, stored upper). Groups:
// POU shells · type decls · VAR sections · modifiers · inheritance · type exprs ·
// control flow · textual/boolean ops · arithmetic/bit/selection/comparison op-words ·
// math fns · address/meta ops · CODESYS __-system operators.
type Keyword =
  | "FUNCTION_BLOCK" | "END_FUNCTION_BLOCK" | "PROGRAM" | "FUNCTION" | "METHOD"
  | "ACTION" | "PROPERTY" | "GET" | "SET" | "INTERFACE" | "TYPE" | "STRUCT" | "UNION"
  | "VAR" | "VAR_INPUT" | "VAR_OUTPUT" | "VAR_IN_OUT" | "VAR_TEMP" | "VAR_STAT"
  | "VAR_GLOBAL" | /* …all VAR kinds… */ "END_VAR"
  | "CONSTANT" | "RETAIN" | "PERSISTENT" | "PUBLIC" | "PRIVATE" | "ABSTRACT"
  | "OVERRIDE" | "EXTENDS" | "IMPLEMENTS"
  | "ARRAY" | "OF" | "REFERENCE" | "POINTER" | "TO" | "AT" | "STRING" | "WSTRING"
  | "IF" | "THEN" | "ELSIF" | "ELSE" | "CASE" | "FOR" | "WHILE" | "REPEAT"
  | "RETURN" | "EXIT" | "CONTINUE" | "JMP"
  | "AND" | "OR" | "XOR" | "NOT" | "MOD" | "DIV" | "TRUE" | "FALSE"
  | "ADD" | "SUB" | "MUL" | "SHL" | "SEL" | "MUX" | "MIN" | "MAX" | "LIMIT"
  | "GT" | "LT" | "GE" | "LE" | "EQ" | "NE" | "ABS" | "SQRT" | "SIN" /* …math… */
  | "ADR" | "SIZEOF" | "__NEW" | "__DELETE" | "__TRY" | "__CATCH"
  | "THIS" | "SUPER" | "NAMESPACE" | /* …~200 total… */

interface Token {
  kind: TokenKind
  keyword?: Keyword   // canonical keyword when kind==="keyword"
  text: string        // source text, original casing
  span: Span
}
```

### AST — top-level units

```ts
type TopLevel =
  | FunctionBlock | Program | Function | Method | Action
  | Property | Interface | TypeDecl | GlobalVarList | Namespace

interface Namespace { kind: "namespace"; name: Identifier; units: TopLevel[]; span: Span }

interface FunctionBlock {
  kind: "function_block"; name: Identifier
  accessModifier?: Keyword; extends?: Identifier; implements?: Identifier[]
  abstract?: boolean; final?: boolean
  varSections: VarSection[]; body: BodySpan; span: Span
}
interface Program  { kind: "program";  name: Identifier; varSections: VarSection[]; body: BodySpan; span: Span }
interface Function { kind: "function"; name: Identifier; returnType?: TypeExpr; varSections: VarSection[]; body: BodySpan; span: Span }
interface Method {
  kind: "method"; name: Identifier
  accessModifier?: Keyword; final?: boolean; abstract?: boolean; override?: boolean
  returnType?: TypeExpr; varSections: VarSection[]; body: BodySpan; span: Span
}
interface Action { kind: "action"; name: Identifier; body: BodySpan; span: Span }
interface Property {
  kind: "property"; name: Identifier; accessModifier?: Keyword; dataType: TypeExpr
  getter?: PropertyAccessor; setter?: PropertyAccessor; span: Span
}
interface PropertyAccessor { kind: "get" | "set"; varSections: VarSection[]; body: BodySpan; span: Span }
interface Interface { kind: "interface"; name: Identifier; extends?: Identifier[]; methods: InterfaceMethod[]; properties: InterfaceProperty[]; span: Span }
interface InterfaceMethod { kind: "interface_method"; name: Identifier; returnType?: TypeExpr; varSections: VarSection[]; span: Span }
interface InterfaceProperty { kind: "interface_property"; name: Identifier; dataType: TypeExpr; hasGetter: boolean; hasSetter: boolean; span: Span }
interface TypeDecl { kind: "type_decl"; name: Identifier; body: DutBody; span: Span }
interface GlobalVarList { kind: "global_var_list"; varSections: VarSection[]; span: Span }
```

### AST — VAR sections & declarations

```ts
type VarSectionKind =
  | "VAR" | "VAR_INPUT" | "VAR_OUTPUT" | "VAR_IN_OUT" | "VAR_TEMP"
  | "VAR_STAT" | "VAR_INST" | "VAR_EXTERNAL" | "VAR_GLOBAL"
  | "VAR_CONFIG" | "VAR_ACCESS" | "VAR_GENERIC"

interface VarSection {
  kind: "var_section"; sectionKind: VarSectionKind
  constant?: boolean; retain?: boolean; nonRetain?: boolean; persistent?: boolean
  decls: VarDecl[]; span: Span
}
interface VarDecl {
  kind: "var_decl"; names: Identifier[]   // `a, b, c : INT;`
  type: TypeExpr; init?: BodySpan; at?: BodySpan; span: Span
}
```

### AST — type expressions

```ts
type TypeExpr = NamedType | ArrayType | ReferenceType | PointerType | StringType | ImplicitEnumType

interface NamedType {
  kind: "named_type"; name: Identifier
  qualifiers?: Identifier[]   // `Tc2_Standard.TON`
  subrange?: BodySpan         // `INT(lo..hi)` bound tokens (only when a range)
  span: Span
}
interface ArrayType { kind: "array_type"; dims: ArrayDim[]; element: TypeExpr; span: Span }
interface ArrayDim  { kind: "array_dim"; lower: BodySpan; upper: BodySpan; span: Span }  // opaque bounds
interface ReferenceType { kind: "reference_type"; target: TypeExpr; span: Span }
interface PointerType   { kind: "pointer_type";   target: TypeExpr; span: Span }
interface StringType { kind: "string_type"; wide: boolean; length?: BodySpan; span: Span }
interface ImplicitEnumType { kind: "implicit_enum_type"; values: Array<{ name: Identifier; init?: BodySpan }>; span: Span }
```

### AST — DUT bodies (`TYPE … END_TYPE`)

```ts
type DutBody = StructBody | EnumBody | UnionBody | AliasBody

interface StructBody { kind: "struct"; fields: VarDecl[]; extends?: Identifier; span: Span }
interface EnumBody { kind: "enum"; baseType?: TypeExpr; init?: BodySpan; values: EnumValue[]; span: Span }
interface EnumValue { kind: "enum_value"; name: Identifier; value?: BodySpan; span: Span }  // `:= 42`
interface UnionBody { kind: "union"; fields: VarDecl[]; span: Span }
interface AliasBody { kind: "alias"; target: TypeExpr; init?: BodySpan; span: Span }
```

### AST — leaves & body span

```ts
interface Identifier { kind: "identifier"; text: string; span: Span }

// An unparsed token range (initializers, addresses, bounds); carries slice + tokens
// so later passes walk without re-lexing.
interface BodySpan { kind: "body"; tokens: Token[]; span: Span }
```

### AST — expression tree (POU bodies, parsed on demand)

```ts
type Expr =
  | IdentExpr | Literal | BinaryExpr | UnaryExpr | MemberExpr
  | IndexExpr | DerefExpr | CallExpr | ParenExpr | AssignExpr

interface IdentExpr { kind: "ident_expr"; name: string; span: Span }

type LiteralKind = "int" | "real" | "string" | "wstring" | "time" | "date" | "tod" | "datetime" | "typed" | "bool" | "address"
interface Literal { kind: "literal"; literalKind: LiteralKind; text: string; span: Span }  // value NOT parsed

interface BinaryExpr { kind: "binary"; op: string; left: Expr; right: Expr; span: Span }  // op canonical upper/punct
interface UnaryExpr  { kind: "unary"; op: string; operand: Expr; span: Span }
interface MemberExpr { kind: "member"; base: Expr; member: IdentExpr; span: Span }
interface IndexExpr  { kind: "index"; base: Expr; indices: Expr[]; span: Span }
interface DerefExpr  { kind: "deref"; base: Expr; span: Span }
interface CallExpr   { kind: "call"; callee: Expr; args: CallArg[]; span: Span }
interface CallArg    { kind: "call_arg"; param?: IdentExpr; output: boolean; value?: Expr; span: Span }  // p:=v | p=>t
interface ParenExpr  { kind: "paren"; inner: Expr; span: Span }
interface AssignExpr { kind: "assign_expr"; target: Expr; value: Expr; span: Span }  // CODESYS `(x := v)`
```

### AST — statement tree

```ts
type Statement =
  | Assignment | CallStatement | IfStatement | CaseStatement
  | ForStatement | WhileStatement | RepeatStatement
  | ReturnStatement | ExitStatement | ContinueStatement
  | TryStatement | ExprStatement | EmptyStatement
type StatementList = Statement[]

interface Assignment {
  kind: "assign"; target: Expr; value: Expr
  op?: "S=" | "R=" | "REF="   // IEC set/reset/reference; undefined for :=
  chained?: Expr[]            // intermediate l-values of `a := b := c`
  span: Span
}
interface CallStatement { kind: "call_stmt"; call: CallExpr; span: Span }
interface ExprStatement { kind: "expr_stmt"; expr: Expr; span: Span }
interface TryStatement {   // __TRY … __CATCH(e) … __FINALLY … __ENDTRY
  kind: "try"; tryBody: StatementList; catchVar?: Expr; catchBody?: StatementList; finallyBody?: StatementList; span: Span
}
interface IfStatement { kind: "if"; branches: IfBranch[]; elseBody?: StatementList; span: Span }
interface IfBranch    { kind: "if_branch"; cond: Expr; body: StatementList; span: Span }
interface CaseStatement { kind: "case"; selector: Expr; arms: CaseArm[]; elseBody?: StatementList; span: Span }
interface CaseArm   { kind: "case_arm"; labels: CaseLabel[]; body: StatementList; span: Span }
interface CaseLabel { kind: "case_label"; value: Expr; upper?: Expr; span: Span }  // upper = `1..5`
interface ForStatement { kind: "for"; controlVar: Expr; from: Expr; to: Expr; by?: Expr; body: StatementList; span: Span }
interface WhileStatement  { kind: "while"; cond: Expr; body: StatementList; span: Span }
interface RepeatStatement { kind: "repeat"; body: StatementList; until: Expr; span: Span }
interface ReturnStatement { kind: "return"; span: Span }
interface ExitStatement   { kind: "exit"; span: Span }
interface ContinueStatement { kind: "continue"; span: Span }
interface EmptyStatement  { kind: "empty"; span: Span }  // lone `;`
```

### AST — parse result

```ts
interface ParseError { message: string; span: Span }
interface ParseResult { units: TopLevel[]; errors: ParseError[] }
```

## symbols

```ts
type SymbolKind =
  | "function_block" | "program" | "function" | "method" | "action"
  | "property" | "interface" | "interface_method" | "interface_property"
  | "type" | "var" | "method_param" | "struct_field" | "enum_value"
  | "gvl_var" | "gvl_block" | "namespace"

interface Symbol {
  kind: SymbolKind; name: string
  span: Span              // defining identifier (go-to-def target)
  declarationSpan: Span   // full declaration range
  owner: Scope; uri: string
  typeExpr?: TypeExpr; varSection?: VarSectionKind
  qualifiedOnly?: boolean // gvl_var behind {attribute 'qualified_only'}
  ast: TopLevel | VarDecl | EnumValue | InterfaceMethod | InterfaceProperty | Method | Action | Property
}

type ScopeKind = "project" | "pou" | "method" | "accessor" | "interface" | "struct" | "enum" | "gvl" | "namespace"
interface Scope {
  kind: ScopeKind; name: string; parent?: Scope
  symbols: Map<string, Symbol[]>   // lowercased name → symbols
  children: Scope[]; span?: Span
  extendsName?: string; baseScope?: Scope   // EXTENDS link (post-pass)
  qualifiedOnly?: boolean
}
interface LookupResult { symbol: Symbol; foundIn: Scope }
```

## types

```ts
type ResolvedKind = "elementary" | "enum" | "struct" | "function_block" | "alias" | "unknown"
interface ResolvedType { kind: ResolvedKind; aliasTarget?: TypeExpr; scope?: Scope }

interface InferredType {          // lean, name-based (see Rebuild refinements)
  kind: ResolvedKind; name?: string; scope?: Scope; typeExpr?: TypeExpr
}

type TypeFamily = "bool" | "int" | "bitstring" | "real" | "time" | "date" | "string"
interface ElementaryType {        // the checkable-facts table (already built)
  name: string; family: TypeFamily; bits: number; signed: boolean
  range?: { min: bigint; max: bigint }   // int/bit-string
  rank?: number                          // numeric widening rank
}
```

## analysis (diagnostics)

```ts
interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span; source: string; code: string; message: string
}

type Vendor = "codesys" | "twincat"
type VendorSetting = Vendor | "auto"

// Per-check enable flags (see the config decision in design: the clean rebuild collapses
// these ~30 flags to `vendor` + a small opt-in lint set).
interface DiagnosticConfig {
  reservedKeyword: boolean; doubleUnderscore: boolean; consecutiveUnderscores: boolean
  duplicateDeclaration: boolean; unresolvedIdentifier: boolean
  unknownPragma: boolean; wrongVendorPragma: boolean; pragmaMissingCompanion: boolean
  pragmaConflict: boolean; messagePragmas: boolean; orphanConditionalPragma: boolean; initSlotCollision: boolean
  fbLifecycleSignature: boolean; shadowingDeclaration: boolean
  missingInterfaceImplementation: boolean; missingInterfaceSignature: boolean
  abstractInstantiation: boolean; varSectionPlacement: boolean; externalNonInputWrite: boolean
  conversionSourceMismatch: boolean; assignmentTypeMismatch: boolean
  binaryOperatorTypeMismatch: boolean; callArgumentMismatch: boolean
  narrowingConversion: boolean; derefOnNonPointer: boolean
  vendorOnlyOperator: boolean
  vgStructure: boolean; vgUndeclaredIdentifier: boolean; vgUndefinedLabel: boolean
  vgUnknownPin: boolean; vgNotCanonical: boolean
}
interface PlcLspInitOptions { vendor?: VendorSetting; diagnostics?: Partial<DiagnosticConfig>; hover?: { showSource?: boolean }; completion?: { snippetSupport?: boolean } }
interface ResolvedConfig { vendor: Vendor; diagnostics: DiagnosticConfig; hover: { showSource: boolean }; completion: { snippetSupport: boolean } }
```

## reference

```ts
type ReferenceKind = "keyword" | "data-type" | "operator" | "type-conversion" | "pragma" | "lifecycle-method" | "standard-fb" | "standard-function"
type Vendor = "shared" | "codesys" | "twincat"   // NOTE: reference's Vendor has a "shared" arm (config's does not)

interface ReferenceSource { url: string; localFile: string; retrievedAt: string }
interface ReferenceEntry {
  name: string; kind: ReferenceKind; source: ReferenceSource; vendor: Vendor
  oneLiner: string; details?: string; gotchas?: string[]; examples?: string[]; aliases?: string[]
  equivalentIn?: { codesys?: { name: string; note?: string }; twincat?: { name: string; note?: string; differentSignature?: boolean } }
}
interface ConversionEntry extends ReferenceEntry { sourceType: string; destType: string }
```

## network text (FBD/LD as text)

**As-built (the reuse model).** Network-text operands ARE fully-parenthesised ST expressions, so they parse into the
ST `Expr` tree and flow through the ONE type engine / `resolveMemberChain` / nav / hover — there is no
parallel `NetworkOperand`/`NetworkGroup`/`NetworkLeaf` operand tree, no network-text-specific infer/resolve stack, and operator info
is the `Expr` binary node's, not a `NetworkGroup` fact. An `EXECUTE` box holds ordinary ST, parsed with the ST
statement parser into a `StatementList`. This is the "reuse the shared core — one type engine, one service
set" refinement (architecture F); the pre-rebuild `NetworkOperand` tree below the line is retained only as the
historical topology model.

```ts
// Diagnostic codes — the LSP EMITS only the pure-text structural subset (it mirrors these so a body is
// fixed before push). The rest are BRIDGE-OWNED (need the writer + PLCopen round-trip) and never emitted
// by the LSP; they are listed for completeness of the wire vocabulary.
type NetworkDiagnosticCode =
  | "NETWORK_PARSE" | "NETWORK_NOT_CLOSED" | "NETWORK_DUPLICATE_NETWORK" | "NETWORK_DUPLICATE_NAME"   // ← LSP-emitted
  | "NETWORK_BAD_EXPRESSION" | "NETWORK_UNKNOWN_OPERATOR" | "NETWORK_LEAF_REFERENCES_TEMP" | "NETWORK_LEAF_FANOUT" | "NETWORK_NOT_CANONICAL" // ← bridge-only
interface NetworkDiagnostic { code: NetworkDiagnosticCode; message: string; span: Span } // messages PROVISIONAL until the T.1 bridge record pass

type NetworkLanguage = "FBD" | "LD" | "CFC" | "SFC" | "UNKNOWN"
interface NetworkName { text: string; span: Span }

// Statements — operands are ST `Expr` (undefined when a slice does not parse cleanly → conservative skip).
type NetworkStatement =
  | NetworkWireDef | NetworkSink | NetworkFbCall | NetworkEnEnoIf | NetworkExecute | NetworkLabel | NetworkJump | NetworkReturn | NetworkComment | NetworkUnknownStmt
interface NetworkWireDef { kind: "wire_def"; name: NetworkName; isEnBinding: boolean; producer?: Expr; span: Span }
interface NetworkSink    { kind: "sink"; target?: Expr; value?: Expr; span: Span }
interface NetworkFbCall  { kind: "fb_call"; call?: Expr; span: Span }                        // a box call `inst(PIN := arg, …)`
interface NetworkEnEnoIf { kind: "en_eno_if"; en?: Expr; body: NetworkStatement[]; span: Span }   // IF <en> THEN … END_IF
interface NetworkExecute { kind: "execute"; statements: StatementList; ok: boolean; span: Span } // EXECUTE <inline ST> END_EXECUTE
interface NetworkLabel   { kind: "label"; name: NetworkName; span: Span }
interface NetworkJump    { kind: "jump"; target: NetworkName; condition?: Expr; span: Span }
interface NetworkReturn  { kind: "return"; condition?: Expr; span: Span }
interface NetworkComment { kind: "comment"; text: string; span: Span }
interface NetworkUnknownStmt { kind: "unknown_stmt"; tokens: Token[]; span: Span }

interface NetworkNetwork {
  index?: number; language: NetworkLanguage; label?: string; disabled: boolean
  statements: NetworkStatement[]; headerSpan: Span; span: Span
}
interface NetworkText { kind: "network_body"; networks: NetworkNetwork[]; diagnostics: NetworkDiagnostic[]; span: Span }

// Analysis (F.2b) — a per-network resolution scope layering the network's LET wires (typed by inferring
// their producer `Expr`) over the POU scope; the shared infer engine resolves wires like real variables.
interface VgAnalysis { vg: NetworkText; pou: Scope; networkScopes: Map<NetworkNetwork, Scope> }
```

<details><summary>Pre-rebuild operand tree (historical — NOT built; operands are `Expr`)</summary>

```ts
interface VgMods { negated: boolean; edge?: "rising" | "falling"; storage?: "set" | "reset"; tokens: Token[] }
type VgCore = NetworkGroup | VgCall | VgMember | NetworkLeaf
interface NetworkOperand { kind: "operand"; mods: VgMods; core: VgCore; span: Span }
interface NetworkGroup   { kind: "group"; op?: VgOperatorSymbol; opTokens: Token[]; operands: NetworkOperand[]; span: Span }
interface VgCall    { kind: "call"; callee: NetworkName; args: VgArg[]; span: Span }
interface VgMember  { kind: "member"; base: NetworkName; member: NetworkName; span: Span }
interface NetworkLeaf    { kind: "leaf"; text: string; tokens: Token[]; isLiteral: boolean; name?: NetworkName; span: Span }
interface VgArg     { pin?: NetworkName; value: NetworkOperand; span: Span }
type VgOperatorSymbol = "AND" | "OR" | "XOR" | "+" | "-" | "*" | "/" | "MOD" | ">" | "<" | ">=" | "<=" | "=" | "<>"
type VgOperatorClass = "logic" | "arithmetic" | "comparison"
```
</details>

## conformance / testing

```ts
interface LanguageTest {
  name: string; pouName: string
  kind: "function_block" | "function" | "program" | "gvl" | "dut" | "interface"
  feature: string; source: string; fromDoc: string; expectTcAccepts: boolean
  plcPrgVar?: string; plcPrgBody?: string
  recordIsolated?: boolean; recorderSkip?: boolean; note?: string
}
interface RecordedDiagnostic { severity: "error" | "warning" | "info"; message: string; line: number; object: string | null; section: "decl" | "impl" | null }
interface ExpectedRecording { recorded: { at: string; bridgeVersion?: string } | null; tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }> }
```

## Rebuild refinements

The deltas the clean design makes to the shapes above (facts-first, structured-not-textual):

- **`InferredType` → a rich discriminated `Type`.** Today it is name-based (`kind` + a canonical `name`
  string) and returns unknown on any unresolved sub-part. Replace with a union that *carries facts*: elementary
  → `ElementaryType` inline (family/bits/signed/range/rank); enum/struct/FB → member scope; array → element
  `Type` + bounds; pointer/reference → target `Type`. Kills the re-derive-from-name pattern at every check.
- **AST type-expressions gain structured bounds.** `NamedType.subrange`, `ArrayDim.lower/upper`,
  `StringType.length`, and the `init?`/`at?` fields are opaque `BodySpan`s re-parsed ad hoc. Parse them into
  structured nodes: subrange `{ lo: Expr; hi: Expr }`, array dims as evaluated numeric bounds (or const-expr
  nodes), a structured string length; add a vector/multi-dim distinction.
- **`Literal` gains value + type.** Today `{ literalKind, text }` with the value never parsed. Attach a parsed
  `value` (bigint/number/duration) + inferred literal `Type`, so const-eval and range/overflow checks stop
  re-lexing `text`.
- **Unify the two `Vendor` types.** Reference uses `"shared" | "codesys" | "twincat"`; config uses
  `"codesys" | "twincat"`. Express "shared" as an applicability flag on entries; the resolved-config `Vendor`
  is the one source of truth.
- **Fold `ResolvedType` + `InferredType` into one `Type`** — they overlap heavily; resolve and infer become one
  engine.
- **Network-text operands are ST `Expr`, not a `NetworkOperand`/`NetworkGroup` tree** — Network-text operands are fully-parenthesised ST
  expressions, so they parse into the ST `Expr` tree and reuse the ONE type engine / `resolveMemberChain` /
  nav / hover. There is no network-text-specific operand tree or infer/resolve stack; operator info is the `Expr`
  binary node's. `LET` wires become per-network pseudo-symbols typed by inferring their producer `Expr`
  (`VgAnalysis.networkScopes`), and `EXECUTE` boxes hold ordinary ST parsed into a `StatementList`. Supersedes
  the earlier "operator info as a fact on `NetworkGroup`" refinement (there is no `NetworkGroup`).
