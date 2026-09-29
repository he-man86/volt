Execution: `.claude/workflows/execute-change.js` with `{ change: "frontend-conformance" }` (or "run the
frontend-conformance workflow"). Resumable: it skips ticked tasks. Every step: test-first; the FULL suite green
(packages/volt-lsp-iec `bun test`, plus `bun run check` at the repo root); the map regenerated; the step's numbers
written under its task. Oracle: CODESYS recordings, written only by the recorders.

## 0. Measure (mechanical, no judgement)

- [ ] 0.1 Parse every corpus file, fixture source and library body. Table: files CODESYS builds (build recordings)
      vs LSP parse errors; every LSP parse error without a recorded CODESYS error is a finding.
- [ ] 0.2 Printer/formatter fixed point on everything parsed in 0.1; every non-fixed-point file is a finding.
- [ ] 0.3 Resolution dump: every identifier occurrence → its declaration (or none). LSP "not defined" / "ambiguous" /
      "no member" messages vs the recorded ones, both directions.
- [ ] 0.4 Type dump: every expression's inferred type. Cross-check against recordings that decide a type (run values
      that show width/sign/overflow; CODESYS type-mismatch and conversion messages).
- [ ] 0.5 Rule inventory: list every grammar production (parser.ts, expression.ts, statements.ts, type-expr.ts,
      var-section.ts, units/), every scope/resolution rule (binder.ts, scope-nav.ts, precedence.ts,
      library-namespace.ts) and every typing rule (elementary, arith, compat, infer, const-eval) with the fixtures
      that cover it; an uncovered rule is a gap.
- [ ] 0.6 Baseline numbers into this file (parse findings, fixed-point failures, resolution and type disagreements,
      uncovered rules).

## 1. Front-end restructure (design first, then output-neutral moves)

- [ ] 1.1 design.md "Structure" (written by the frontend-design run): every current file of syntax/, symbols/, types/ —
      its responsibility, dependencies, and every place each concern is implemented (lexing, literal decoding, bodies,
      implementation line, unit parsing, attributes, scopes, precedence, inference, compatibility, constant evaluation);
      the TARGET folder and file structure with one home per concern; the front-end layer and its public index; import
      rules; the old -> new map for every file and major function; the test layout.
- [ ] 1.2 An import-rule test (a repo gate): the front-end imports nothing from analysis/services/server/network/
      transpile; back-ends import it only through its index — red first.
- [ ] 1.3 The moves and splits of design.md, one task per move in an order where every step compiles and the suite is
      green; OUTPUT-NEUTRAL: every suite, the corpus diagnostics and the transpiler's corpus-output snapshot unchanged.
      (The detailed move list is written into this section by the frontend-design run.)
- [ ] 1.4 The import-rule test green; no concern left implemented in two places.

## 2. Parser (syntax/) conformance

Per area: review against CODESYS's grammar (docs/codesys-reference, docs/language-reference.md) and the recordings;
one fixture per rule, recorded with `record:language` (accept, or CODESYS's exact messages); root causes fixed
test-first.

- [ ] 2.1 Lexer: identifiers (incl. reserved words — LIMIT/MIN/MAX/SEL/MUX are reserved in CODESYS), comments
      (nested, line), pragmas, whitespace/line endings, every token class.
- [ ] 2.2 Literals: integer (typed `INT#`, based `16#`, `_` separators, signs), REAL/LREAL (exponents, limits),
      BOOL, TIME/LTIME, DATE/LDATE, TOD/LTOD, DT/LDT (every unit and range), STRING/WSTRING (every `$` escape,
      `$00`, quotes), typed and enum literals.
- [ ] 2.3 Declarations: every VAR section kind and qualifier (CONSTANT, RETAIN, PERSISTENT, AT), initializers
      (structured, arrays, repeat counts), types (ARRAY incl. multi-dim and `*`, POINTER TO, REFERENCE TO, STRING(n),
      subranges, anonymous enums).
- [ ] 2.4 Units: PROGRAM, FUNCTION, FUNCTION_BLOCK (EXTENDS, IMPLEMENTS, ABSTRACT, FINAL, access modifiers), METHOD,
      PROPERTY (GET/SET), ACTION, INTERFACE (EXTENDS), TYPE (STRUCT incl. EXTENDS, UNION, enum with base, alias), GVL,
      NAMESPACE / library qualification, the IMPLEMENTATION line.
- [ ] 2.5 Expressions: precedence and associativity of every operator (incl. `**`/EXPT, unary minus, NOT, MOD, AND_THEN
      / OR_ELSE), calls (formal, informal, `=>` outputs, EN/ENO), member/index/deref chains, THIS/SUPER, `REF=`, ADR.
- [ ] 2.6 Statements: assignment forms (`:=`, `S=`, `R=`, `REF=`), IF/CASE (label lists, ranges, enum labels), FOR/
      WHILE/REPEAT, EXIT/CONTINUE/RETURN/JMP, empty statements, calls as statements.
- [ ] 2.7 Pragmas and conditional compilation (`{IF defined(...)}`, attributes on every position).
- [ ] 2.8 Error recovery: every recorded CODESYS parse error reproduced at the same location with the same meaning.
- [ ] 2.9 Printer/formatter: fixed point everywhere (0.2 findings closed).

## 3. Symbols (symbols/) conformance

- [ ] 3.1 Scopes: POU, method, action, property accessor, GVL, namespace, library; lookup order and shadowing
      (VAR_IN_OUT vs FB field vs VAR_STAT — cf. transpile-review 19).
- [ ] 3.2 Inheritance: EXTENDS chains (FB, STRUCT, INTERFACE), SUPER, overriding, abstract members, ambiguity.
- [ ] 3.3 Enums: qualified and unqualified members, enums with base type, collisions with other names.
- [ ] 3.4 Libraries: namespace-qualified and bare references, the manifest resolution, same short name in two
      libraries (cf. transpile-review 21).
- [ ] 3.5 Members: struct/FB/union member access, properties, interface members, through pointers/references.
- [ ] 3.6 0.3 findings closed; every resolution rule has a recorded fixture.

## 4. Types (types/) conformance

One fixture per typing rule, recorded with `record:exec` (values that expose width/sign/overflow) and
`record:language` (CODESYS's type messages).

- [ ] 4.1 Elementary types and their ranges, incl. platform aliases (__XWORD, __UXINT …).
- [ ] 4.2 Literal typing: untyped integer and REAL literals in every context (assignment, arithmetic, comparison,
      call argument, initializer, CASE label, array bound), typed literals, negative literals.
- [ ] 4.3 Arithmetic: common type (meet) of every operand pair (signed/unsigned × widths, REAL/LREAL, TIME), integer
      promotion, overflow/wrap, DIV/MOD signs, shifts and rotates, EXPT.
- [ ] 4.4 Comparisons and BOOL/bit operations on every pair.
- [ ] 4.5 Conversions: implicit (allowed/refused per CODESYS), explicit `X_TO_Y` for every pair, TRUNC/ROUND, BCD,
      strings ↔ numbers/time/date, lengths.
- [ ] 4.6 Constant evaluation: CONSTANTs, folding widths (INT/REAL), VAR_INPUT CONSTANT, array bounds and STRING(n)
      from constants, subranges.
- [ ] 4.7 Derived types: aliases (incl. alias with initializer), enums with base, subranges, arrays, structs, unions,
      POINTER TO / REFERENCE TO and their compatibility.
- [ ] 4.8 0.4 findings closed; every typing rule has a recorded fixture.

## 5. Consequences downstream

- [ ] 5.1 Re-run analysis, corpus, build-conformance and the transpiler suites; every change is either a recording-
      decided improvement (note it) or a regression (fix it). Regenerate the map.
- [ ] 5.2 Record in `transpile-restructure` which of its root causes this change already closed.

## 6. Close

- [ ] 6.1 docs/architecture.md and data-model.md describe the front-end layer and its rules.
- [ ] 6.2 Final review (spec + layering); fix; archive; delete the recreated openspec/specs/.
