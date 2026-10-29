# ST Language Server — data model

The concrete exported type surface, derived from the working implementation and organized by the target layer
structure. Definitions are lightly cleaned (doc-comments trimmed, shape preserved). This is the type contract
the build works to; the **Rebuild refinements** at the end list where the clean design intentionally changes
these shapes.

The first three sections are the front-end, `src/frontend/` (`architecture.md` "The front-end"): `frontend/syntax`,
`frontend/symbols`, `frontend/types`, with `frontend/library` (the Volt library format: path layout, manifest,
materialization) a leaf beside them. A consumer reaches each through its sub-layer's `index.ts` only (rule F2), so the
shapes below are the ones those indexes export.

## frontend/syntax (tokens + AST)

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
  malformed?: true    // a literal the vendor refuses whole (`3#…`, `INT#` with no body, `5.`): lexed as far as the vendor lexes
}
```

### AST — top-level units

```ts
type TopLevel =
  | FunctionBlock | Program | Function | Method | Action
  | Property | Interface | TypeDecl | GlobalVarList | Namespace

interface Namespace { kind: "namespace"; name: Identifier; units: TopLevel[]; span: Span }

// `modifiers`: every modifier as written, in order (`INTERNAL FINAL`) — an access modifier stands only first
// (conformance 2.4, both vendors); a base or interface is ONE (possibly dotted) identifier (`Standard.TON`).
interface FunctionBlock {
  kind: "function_block"; name: Identifier; modifiers: Keyword[]
  headerRefused?: true                      // an access modifier after another: both vendors declare no FB
  extends?: Identifier; extendsExtra?: Identifier[]; implements?: Identifier[]
  varSections: VarSection[]; body: BodySpan; span: Span
}
interface Program  { kind: "program";  name: Identifier; returnType?: TypeExpr; varSections: VarSection[]; body: BodySpan; span: Span }
interface Function {
  kind: "function"; name: Identifier; returnType?: TypeExpr
  implementsMisused?: Identifier[]; extendsMisused?: Identifier   // a clause after the name; after the return type it is no header
  varSections: VarSection[]; body: BodySpan; span: Span
}
interface Method {
  kind: "method"; name: Identifier; modifiers: Keyword[]   // OVERRIDE is no modifier: CODESYS reads it as the name
  returnType?: TypeExpr; varSections: VarSection[]; body: BodySpan; span: Span
}
interface Action { kind: "action"; name: Identifier; body: BodySpan; span: Span }
interface Property {
  kind: "property"; name: Identifier; modifiers: Keyword[]; dataType: TypeExpr
  getter?: PropertyAccessor; setter?: PropertyAccessor; span: Span
}
interface PropertyAccessor { kind: "get" | "set"; modifiers: Keyword[]; varSections: VarSection[]; body: BodySpan; span: Span }
interface Interface {
  kind: "interface"; name: Identifier; extends?: Identifier[]; implementsMisused?: Identifier[]
  methods: InterfaceMethod[]; properties: InterfaceProperty[]; span: Span
}
interface InterfaceMethod { kind: "interface_method"; name: Identifier; modifiers: Keyword[]; returnType?: TypeExpr; varSections: VarSection[]; span: Span }
interface InterfaceProperty {
  kind: "interface_property"; name: Identifier; modifiers: Keyword[]; dataType: TypeExpr
  hasGetter: boolean; hasSetter: boolean
  getterVarSections: VarSection[]; setterVarSections: VarSection[]   // the vendor's stored declaration (no body)
  span: Span
}
// A body the parser refused (no `:`, an EXTENDS list, nothing after the colon) is `{ kind: "refused" }`: the type is
// kept, bodiless, as both vendors keep it — never an alias of an invented type.
interface TypeDecl { kind: "type_decl"; name: Identifier; body: DutBody; extendsMisused?: Identifier; span: Span }
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
type DutBody = StructBody | EnumBody | UnionBody | AliasBody | RefusedBody

interface StructBody { kind: "struct"; fields: VarDecl[]; extends?: Identifier; span: Span }
interface EnumBody { kind: "enum"; baseType?: TypeExpr; init?: BodySpan; values: EnumValue[]; span: Span }
interface EnumValue { kind: "enum_value"; name: Identifier; value?: BodySpan; span: Span }  // `:= 42`
interface UnionBody { kind: "union"; fields: VarDecl[]; span: Span }
interface AliasBody { kind: "alias"; target: TypeExpr; init?: BodySpan; span: Span }
interface RefusedBody { kind: "refused"; span: Span }   // a TYPE whose body was refused, kept bodiless
```

### AST — leaves & body span

```ts
interface Identifier { kind: "identifier"; text: string; span: Span }

// An unparsed token range (initializers, addresses, bounds); carries slice + tokens
// so later passes walk without re-lexing.
interface BodySpan { kind: "body"; tokens: Token[]; span: Span; dialect: Dialect; implementation?: ImplementationLine }  // dialect: the vocabulary its statements are parsed with (refused words, frontend-conformance 2.8.3)
```

### AST — expression tree (POU bodies, parsed on demand)

```ts
type Expr =
  | IdentExpr | Literal | BinaryExpr | UnaryExpr | MemberExpr
  | IndexExpr | DerefExpr | CallExpr | ParenExpr | AssignExpr | GlobalExpr

interface IdentExpr { kind: "ident_expr"; name: string; span: Span }

type LiteralKind = "int" | "real" | "string" | "wstring" | "time" | "date" | "tod" | "datetime" | "typed" | "bool" | "address"
interface DurationValue { kind: "duration"; ns: bigint }
type LiteralValue = bigint | number | string | boolean | DurationValue | undefined   // undefined: malformed text
interface Literal {
  kind: "literal"; literalKind: LiteralKind; text: string
  value: LiteralValue   // parsed by frontend/syntax/literal (ints, reals, bool, string body, duration in ns)
  prefix?: string       // typed/address literals: the type/prefix as written (`INT`, `%IX`)
  span: Span
}
// No `type` field, on purpose: an untyped literal takes its type from context. frontend/types/literal answers it
// (`literalType`, `literalOwnType`, `literalCapacityType`, `literalCheckType`, `literalErrorType`).

interface BinaryExpr { kind: "binary"; op: string; left: Expr; right: Expr; span: Span }  // op canonical upper/punct
interface UnaryExpr  { kind: "unary"; op: string; operand: Expr; span: Span }
interface MemberExpr { kind: "member"; base: Expr; member: IdentExpr; span: Span }
interface IndexExpr  { kind: "index"; base: Expr; indices: Expr[]; span: Span }
interface DerefExpr  { kind: "deref"; base: Expr; span: Span }
interface CallExpr   { kind: "call"; callee: Expr; args: CallArg[]; span: Span }
interface CallArg    { kind: "call_arg"; param?: IdentExpr; output: boolean; value?: Expr; span: Span }  // p:=v | p=>t
interface ParenExpr  { kind: "paren"; inner: Expr; span: Span }
interface AssignExpr { kind: "assign_expr"; target: Expr; value: Expr; span: Span }  // CODESYS `(x := v)`; bare as a
                                                                                       // condition, selector, FOR bound, index
interface GlobalExpr { kind: "global_expr"; name: IdentExpr; span: Span }  // `.g`: the global namespace only; `name` is no child
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
  chained?: Expr[]            // intermediate l-values of `a := b := c` / `a S= b R= c`
  chainOps?: ("S=" | "R=" | "REF=" | undefined)[]  // the operator after each chained[i]; links may mix
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
interface ParseResult {
  units: TopLevel[]; errors: ParseError[]
  failedDeclarations: string[]   // lower-cased names a broken declaration tried to declare (silences their later uses)
  tokens: readonly Token[]       // the stream the parse lexed — consumers never re-lex
  dialect: Dialect
}
```

## frontend/symbols

```ts
type SymbolKind =
  | "function_block" | "program" | "function" | "method" | "action"
  | "property" | "interface" | "interface_method" | "interface_property"
  | "type" | "var" | "method_param" | "struct_field" | "enum_value"
  | "gvl_var" | "gvl_block" | "namespace" | "device"

interface Symbol {
  kind: SymbolKind; name: string
  span: Span              // defining identifier (go-to-def target)
  declarationSpan: Span   // full declaration range
  owner: Scope; uri: string
  typeExpr?: TypeExpr; varSection?: VarSectionKind
  qualifiedOnly?: boolean // gvl_var behind {attribute 'qualified_only'}
  ast: TopLevel | VarDecl | EnumValue | InterfaceMethod | InterfaceProperty | Method | Action | Property | DeviceInstance
}
// a device-tree instance, from its `.device` descriptor: a name and nothing else (no IEC type)
interface DeviceInstance { kind: "device"; name: string; uri: string }

type ScopeKind = "project" | "pou" | "method" | "accessor" | "interface" | "struct" | "enum" | "gvl" | "namespace"
interface Scope {
  kind: ScopeKind; name: string; parent?: Scope
  symbols: Map<string, Symbol[]>   // lowercased name → symbols
  children: Scope[]; span?: Span
  extendsName?: string; baseScope?: Scope   // EXTENDS link (post-pass): an FB's, a STRUCT's one base
  interfaceExtends?: readonly string[]; interfaceBases?: Scope[]   // an INTERFACE's EXTENDS list, linked (rule H4);
                          // read through symbols/extends `basesOf` / `ancestry` / `extendsCycle`, never by name
  qualifiedOnly?: boolean
  undeclared?: true       // a refused FB header: holds its members, is no base and no type (linkExtends skips it)
}
interface LookupResult { symbol: Symbol; foundIn: Scope }
```

## frontend/types

```ts
// what a bare identifier names — the search order's answer (`types/names` `resolveBareName`, rule Y23)
type BareName =
  | { kind: "declared"; symbol: Symbol; foundIn: Scope } | { kind: "device"; symbol: Symbol }
  | { kind: "library-namespace"; symbol: Symbol } | { kind: "enum-member"; symbol: Symbol }
  | { kind: "builtin"; builtin: "system-operator" | "conversion" | "implicit" | "operator" | "type" } | { kind: "none" }

// the ONE type model (frontend/types/type) — resolve (TypeExpr → Type) and infer (Expr → Type) both answer it
type Type =
  | ElementaryTypeRef | EnumType | StructType | FunctionBlockType | InterfaceType
  | ArrayTypeInfo | PointerTypeInfo | ReferenceTypeInfo | StaticType | UnknownType
interface ElementaryTypeRef {
  kind: "elementary"; name: string; elem: ElementaryType     // the facts, embedded
  length?: number; unfoldedLength?: true; lengthText?: string // STRING(n) / WSTRING(n)
  subrange?: { lower: bigint; upper: bigint }                 // INT(lo..hi)
}
interface EnumType          { kind: "enum"; name: string; scope?: Scope; base?: ElementaryTypeRef }
interface StructType        { kind: "struct"; name: string; scope?: Scope; union?: true }
interface FunctionBlockType { kind: "function_block"; name: string; scope?: Scope; byName?: true }
interface InterfaceType     { kind: "interface"; name: string; scope?: Scope }
interface ArrayTypeInfo     { kind: "array"; element: Type; dims: readonly ArrayDim[]; bounds?: readonly { lower: bigint; upper: bigint }[] }
interface PointerTypeInfo   { kind: "pointer"; target: Type }
interface ReferenceTypeInfo { kind: "reference"; target: Type }
interface StaticType        { kind: "static"; denotes: "gvl" | "namespace" | "struct" | "interface" | "function" | "method"; name: string; scope?: Scope }
interface UnknownType       { kind: "unknown" }   // UNKNOWN — the total, conservative answer: a check skips it

type TypeFamily = "bool" | "int" | "bitstring" | "real" | "time" | "date" | "string"
interface ElementaryType {        // the checkable-facts table (frontend/types/elementary)
  name: string; family: TypeFamily; bits: number; signed: boolean
  range?: { min: bigint; max: bigint }   // int/bit-string
  rank?: number                          // numeric widening rank
  tickNs?: bigint                        // time/date: nanoseconds per tick (TIME/TOD ms, DATE/DT s, the L types ns)
  mantissaBits?: number                  // real: the integer bits held exactly (REAL 24, LREAL 53)
}
```

`length` (a STRING's stated capacity — a sizeless `STRING` has none; the default is the transpiler's vendor fact) and
`bounds` (an array's folded dimensions, read by the transpiler, which stores the array) are facts the resolver writes; a
consumer that needs one and finds it absent skips (an UNKNOWN), it never assumes the default. Only the transpiler gives
a sizeless STRING its capacity, `DEFAULT_STRING_LENGTH` (a vendor fact), at three sites in `lower/`: `Lowering.sized`
(`lower/core/lowering.ts`, for every declared type `Lowering.resolve` resolves; an `unfoldedLength` capacity is refused
`string-capacity` there), `defaultCapacity` (`lower/builtins/conversions.ts`, the STRING type a conversion's name states) and the
`__POUNAME` constant (`lower/builtins/system.ts`).

## transpile IR

The transpiler's one contract (`transpile/ir/`, `architecture.md` "Backend"): what `lower/` builds and `interp/` and
`emit/rust/` consume. Every node carries a resolved front-end `Type` and its ST `Span`; a name is a slot index, never an
identifier; a backend that has to decide something means the lowering is incomplete.

```ts
type IrValue = bigint | number | boolean | string  // a STRING: its whole buffer one unit per char, trailing zeros trimmed
                                                   // (`semantics/string.ts` `held`); TIME in ms, LTIME in ns
type IrInit = IrValue | { elements: IrInit[]; rest: IrInit } | { fields: Record<string, IrInit> }   // rest: every element not stated

// the program — one POU lowered, with everything it reaches
interface IrPou {
  name: string; slots: IrSlot[]; body: IrStmt[]
  layouts: IrLayout[]          // each STRUCT and FB: its fields, an FB's body, in-outs, VAR_STAT, lent instances
  routines: IrRoutine[]        // each METHOD, ACTION and FUNCTION reached, lowered once per frame (and ANY variant)
  globals: IrSlot[]            // the application's storage: GVL variables, each called PROGRAM's instance
  locals?: IrSlot[]            // the scan's per-run storage, the POU's VAR_TEMP: each at its `init` every scan (7.6.4)
  init?: IrStmt[]              // the ordered init step, run once before the first scan (model 4, `lower/init/step.ts`)
  image?: IrImage              // the byte image, when a program stores an address (model 3)
  span: Span
}
interface IrSlot { name: string; type: Type; section: VarSectionKind | "temp" | "program"; init: IrInit; scoped?: true; constant?: boolean; readOnly?: boolean; ofInstance?: boolean; image?: number; list?: string; readAs?: Type; declared?: Type; rawBool?: true }
// scoped: a temp written at one site before every read — a slot to the interpreter, a `let` of its fn in Rust (7.6.1)
// image: the slot's byte offset when the image holds it
// list: a GVL variable whose name another list also declares — two globals (6.A.17), each Rust field named `<list>_<name>`
// readAs: a slot wider than the type its reads have — every read converted to it by lowering (`places/access-guards`
// `loadValue`); no backend reads it. A CONSTANT held past its type to keep its unwrapped fold (6.A.29), or a STRING
// VAR_IN_OUT bound wider than it declares, a routine lowered for the caller's capacity (`calls/string-inouts`, 8.2 step 8e:
// the slot the caller's buffer, a read its copy at the declared capacity — a comparison's excepted, read in place).
// declared: with readAs, the declared type SIZEOF measures (`builtins/sizeof`: SIZEOF(B) of a BYTE held as 256 is 1, 6Af;
// SIZEOF(io) of a STRING(10) in-out bound to a STRING(12) is 11)
// rawBool: a BOOL held as its byte — its address reaches a pointer of another type, or a byte-keeping flow fills it from
// one; its type is BYTE and every operator on it lowered on the byte (`lower/pointers/raw-bool.ts`, 8.2); no backend reads it
interface IrLayout { name: string; kind: "struct" | "function_block"; fields: IrSlot[]; body?: IrStmt[]; locals?: IrSlot[]; bodyUri?: string; inouts?: IrSlot[]; statics?: { name: string; global: number }[]; lent?: { tag: number; type: Type }[]; size?: number }
// locals: an FB body's per-run storage, its VAR_TEMP — not fields, the instance does not carry them between runs (7.6.4)
// size: an image struct's measured bytes
// the program's byte image, laid out as CODESYS lays it out from IMAGE_BASE (`semantics/memory.ts`); a backend allocates nothing
interface IrImage { size: number; bytes: [offset: number, bytes: number[]][]; regions: [start: number, end: number][] }
interface IrRoutine { name: string; key: string; kind: "method" | "action" | "function"; fb?: string; uri?: string; locals: IrSlot[]; inputs: number[]; inouts: IrSlot[]; result?: number; body: IrStmt[]; lent?: { tag: number; type: Type }[] }

// a place — a root slot and a path; only an `image` root is an address: `at`, its byte address, with every field step
// folded into it and each index step carrying its element's `size` (model 3)
interface Place { slot: number; path: Access[]; type: Type; span: Span; root?: "inout" | "local" | "global" | "this" | "lent" | "image"; at?: IrExpr; guard?: Place }
type Access = { kind: "field"; name: string } | { kind: "index"; index: IrExpr; lower: bigint; length?: number; size?: number } | { kind: "bit"; index: number; of: Type }

type IrExpr =
  | { kind: "const"; value: IrValue }                         | { kind: "fresh"; init: IrInit }
  | { kind: "load"; place: Place }                            | { kind: "convert"; value: IrExpr }   // every widening explicit
  | { kind: "binary"; op: IrBinOp; left: IrExpr; right: IrExpr; nonzeroDivisor?: true; noWrap?: true }   // both decided by lowering
  | { kind: "unary"; op: "neg" | "not"; operand: IrExpr }
  | { kind: "builtin"; name: IrBuiltinName; args: IrExpr[]; bits?: number }
  | { kind: "invoke"; routine: string; instance?: Place; inputs: IrExpr[]; order?: (number | IrFreeze)[]; inouts: IrBinding[]; lent?: Place[] }
  | { kind: "dispatch"; tag: IrExpr; arms: { tag: bigint; call: IrInvoke }[]; fault: "no-instance" | "unbound-inout" }   // a call through an interface, or a METHOD reaching its FB's in-out by the last binding (6.A.28)
  | { kind: "select"; tag: IrExpr; arms: { tag: bigint; place: Place }[] }       // a read through a multi-target pointer
  | { kind: "address"; place: Place }                         // ADR of an image place: its byte address (model 3)
  | { kind: "count"; array: Place; dim: number }              // an ARRAY[*] in-out's element count of one dimension (7.7.8)
  | { kind: "reinterpret"; value: IrExpr; over?: IrExpr }     // value's little-endian bytes over `over`'s, read at `type`: a UNION member's copy (7.8.4)
  // …each with `type: Type; span: Span`
type IrFreeze = { kind: "freeze"; temp: Place; value: IrExpr }  // an in-out's runtime index stored into `temp` where its argument is written
type IrBinding = Place | { kind: "copy"; value: IrExpr; type: Type; back?: Place; discarded?: true; span: Span }  // discarded: an unconnected VAR_OUTPUT's copy, lent `&mut`, read by nothing after the call (6.A.12)

type IrStmt =
  | { kind: "assign"; target: Place; value: IrExpr }
  | { kind: "if"; cond: IrExpr; then: IrStmt[]; else: IrStmt[] }                 // ELSIF is a nested IF
  | { kind: "switch"; selector: IrExpr; arms: { labels: { lo: IrValue; hi: IrValue }[]; body: IrStmt[] }[]; else: IrStmt[] }
  | { kind: "loop"; init: IrStmt[]; test?: { cond: IrExpr; atEnd: boolean }; body: IrStmt[]; step: IrStmt[] }  // FOR, WHILE, REPEAT
  | { kind: "break" } | { kind: "continue" } | { kind: "return" }
  | { kind: "call"; instance: Place; fb: string; inouts: IrBinding[]; lent?: Place[]; bind?: { place: Place; tag: bigint } }  // an FB body
  | { kind: "eval"; value: IrInvoke | IrDispatch | IrSelect }
  // …each with `span: Span`

// lowering's answer: the program, or why not — never a throw (`transpile/lower/diagnostics/`)
interface LoweredPou { pou?: IrPou; diagnostics: LowerDiagnostic[] }
interface LowerDiagnostic { code: string; kind: LowerCodeKind; message: string; span: Span }   // `code` from the registry (`codes.ts`)
type FaultKind = "null-dereference" | "no-instance" | "unbound-inout" | "division-by-zero" | "division-overflow" | "logarithm-of-zero"
  | "zero-to-negative-power" | "address-outside-image" | "address-across-frames"
```

The walk over all of it is `ir/walk.ts` `childrenOf` — total over every node kind (`walk.test.ts` holds one case per
kind of the unions above), and every other IR walk is built on it. A fault's text is `ir/faults.ts`'s, printed alike by both
backends.

## analysis (diagnostics)

```ts
interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span; source: string; code: string; message: string
}

type Vendor = "codesys" | "twincat"
type VendorSetting = Vendor | "auto"

// Configuration (`analysis/config`) — CODESYS's project settings, nothing more: compiler ERRORS always run; each code of
// CODESYS's "Compiler warnings" dialog that Volt implements (`CONFIGURABLE_CHECKS`, slug ↔ Cnnnn) is a 3-state control.
type DiagnosticState = "off" | "warning" | "error"
type ConfigurableCode = (typeof CONFIGURABLE_CHECKS)[number]["code"] // "jump-label-unreferenced" (C0118), "enum-duplicate-value" (C0125), …
interface AnalysisInitOptions { vendor?: VendorSetting; diagnostics?: Partial<Record<ConfigurableCode, DiagnosticState>>; diagnoseDeadCode?: boolean }
interface ResolvedConfig { vendor: Vendor; diagnostics: Record<ConfigurableCode, DiagnosticState> /* all "warning" by default */; diagnoseDeadCode: boolean }

// What a check is handed (`analysis/pipeline/context`) — a check reads only what it uses.
interface CheckContext {
  parseResult: ParseResult; source: string; project: Scope
  uri: string /* the asker: required */; config: ResolvedConfig; messages: Messages
  tokens: () => readonly Token[] // the parse's own token stream, for the pragma checks
}
type Check = (ctx: CheckContext, out: DiagnosticItem[]) => void

// One registry entry (`analysis/pipeline/registry`) — the registry is the checks in RUN ORDER, a contract
// (`registry.test.ts` lists it).
type CheckGroup = "types" | "declarations" | "names" | "oop" | "calls" | "flow" | "pragmas" | "syntax"
interface RegistryEntry {
  check: Check; group: CheckGroup
  vendors: "both" | Vendor // a one-vendor entry says what was measured in `note`
  reads?: ReadonlySet<string> // the codes of EARLIER findings this check reads from `out`
  note?: string
}

// The one pipeline (`analysis/pipeline/diagnostics`): every check of the registry in order, then the policy
// (configurable severity / off, TwinCAT's per-line dedupe). Network-text bodies are not in it yet (design §3, parked).
interface DiagnosticsArgs { parseResult: ParseResult; source: string; project: Scope; config?: ResolvedConfig | AnalysisInitOptions; uri: string; groups?: readonly CheckGroup[] }
declare function computeDiagnostics(args: DiagnosticsArgs): DiagnosticItem[]
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

A body stated `%LANGUAGE LD|FBD` is ST with `%` lines (`packages/volt-cli/docs/network-text.html`). The ST parser reads
it: `src/frontend/syntax/network/plain-st.ts` makes each `%` line trivia and reads the networks off them, and reads the
Execute box `EXECUTE(EN := c, CODE := '<ST>')` as the call `EXECUTE(EN := c)`, its ST — the one string that spans lines
(`network/execute-code.ts`: the lexer ends every string at its line, and a network body's `CODE :=` string of an open
`EXECUTE(` call is rejoined there, bound by the body) — decoded, lexed and placed after its statement, each token where it stands in the string; every operand, call and statement is an ST node, so the one type engine, resolution,
navigation, hover and rename run unchanged.

```ts
interface PlainStNetwork {
  index: number; span: Span
  header: PlainStLine                       // %NETWORK "title"
  lines: readonly PlainStLine[]             // the network's % lines, %NETWORK first
  disabled: boolean                         // %DISABLED
  wires: readonly PlainStWire[]             // VAR_TEMP w1 : ANY; END_VAR — declared in the body's scope (symbols/network-scope.ts)
  unsupported: boolean                      // %UNSUPPORTED "<shape>" #<hash>
  executes: readonly PlainStExecute[]       // EXECUTE(…, CODE := '<ST>'): its call, its ST's span, the ST decoded
}
interface PlainStLine { key: string; span: Span; args: readonly Token[] }
interface PlainStExecute { call: Span; code: Span; st: string | undefined }

// The bridge gate's codes (the cases both sides read from packages/volt-cli/test/fixtures/network-text-st). The LSP's
// network check reports network-plain-st for what a network may not hold, and network-unnamed-target for `??? := v`.
type NetworkDiagnosticCode = "NETWORK_PARSE" | "NETWORK_UNSUPPORTED"
```

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

- **`InferredType` → a rich discriminated `Type`.** *(As built: `frontend/types/type` `Type`, above.)* It was name-based (`kind` + a canonical `name`
  string) and returns unknown on any unresolved sub-part. Replace with a union that *carries facts*: elementary
  → `ElementaryType` inline (family/bits/signed/range/rank); enum/struct/FB → member scope; array → element
  `Type` + bounds; pointer/reference → target `Type`. Kills the re-derive-from-name pattern at every check.
- **AST type-expressions gain structured bounds.** `NamedType.subrange`, `ArrayDim.lower/upper`,
  `StringType.length`, and the `init?`/`at?` fields are opaque `BodySpan`s re-parsed ad hoc. Parse them into
  structured nodes: subrange `{ lo: Expr; hi: Expr }`, array dims as evaluated numeric bounds (or const-expr
  nodes), a structured string length; add a vector/multi-dim distinction.
- **`Literal` gains its value — and NOT its type.** *(As built: `Literal.value`, above.)* It was `{ literalKind, text }`
  with the value never parsed; the parsed `value` (bigint/number/string/bool/duration) means const-eval and
  range/overflow checks stop re-lexing `text`. The earlier plan to attach an inferred literal `Type` too was wrong: an
  untyped IEC literal is polymorphic (`n / 2` divides in `n`'s type; `x := 300` checks against `x`), so its type is a
  question with a context, answered by `frontend/types/literal`, never a fact on the node.
- **Unify the two `Vendor` types.** Reference uses `"shared" | "codesys" | "twincat"`; config uses
  `"codesys" | "twincat"`. Express "shared" as an applicability flag on entries; the resolved-config `Vendor`
  is the one source of truth.
- **Fold `ResolvedType` + `InferredType` into one `Type`** — *(as built)* resolve and infer answer the one `Type`.
- **Network-text operands are ST `Expr`, not a `NetworkOperand`/`NetworkGroup` tree** — Network-text operands are fully-parenthesised ST
  expressions, so they parse into the ST `Expr` tree and reuse the ONE type engine / `resolveMemberChain` /
  nav / hover. There is no network-text-specific operand tree or infer/resolve stack; operator info is the `Expr`
  binary node's. A network's splits become per-network symbols typed by their feeder
  (`NetworkTextAnalysis.networkScopes`), and `EXECUTE` boxes hold ordinary ST parsed into a `StatementList`. Supersedes
  the earlier "operator info as a fact on `NetworkGroup`" refinement (there is no `NetworkGroup`).
