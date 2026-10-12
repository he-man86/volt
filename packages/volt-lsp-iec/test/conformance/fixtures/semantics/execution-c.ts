/**
 * the fixtures of `execution.ts` — part C: consolidate-lsp-structure A12: a signed and an unsigned type of the SAME width — which one does the operation use?; consolidate-lsp-structure A3: does a typed literal's prefix decide its type? Lowering ignores it; transpiler review 2026-09-14: two suspected bugs, recorded before any fix — neither is one; transpiler review 2026-09-14: CONTINUE — the emitted Rust's `continue` skips a FOR's step and a REPEAT's UNTIL,; code CODESYS does not compile — the transpiler's input contract (`rejects`, wording as recorded 2026-09-14); CASE range edges.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { ExecCase } from "./execution-shared.js"

export const CASES_C: readonly ExecCase[] = [
  // ═══ phase 2 — DATE / TOD / DT (+ L variants). The IR has no rule for them yet; `types/elementary` says DATE and
  //     TOD are 32 bits, DT 64 — unverified. First question: what unit does each count? ═══
  {
    // One day, one second, one millisecond past each epoch — the integer that comes back is the unit.
    name: "date_representation",
    vars: [
      "d1 : DATE := D#1970-01-02; dt1 : DT := DT#1970-01-01-00:00:01; tod1 : TOD := TOD#00:00:01;",
      "dateUnits : UDINT; dtUnits : UDINT; todUnits : UDINT;",
    ].join("\n"),
    body: "dateUnits := DATE_TO_UDINT(d1); dtUnits := DT_TO_UDINT(dt1); todUnits := TOD_TO_UDINT(tod1);",
  },
  {
    name: "date_arithmetic",
    vars: [
      "leapEve : DT := DT#2024-02-28-23:59:59; oneSec : TIME := T#1S; d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01;",
      "rolled : DT; dateDiff : TIME; noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H; pastMidnight : TOD; todDiff : TIME;",
    ].join("\n"),
    body: "rolled := leapEve + oneSec; dateDiff := mar1 - d28; pastMidnight := noon + halfDay; todDiff := TOD#13:00:00 - noon;",
  },
  {
    name: "date_compare",
    vars: "early : DT := DT#2024-01-01-00:00:00; late : DT := DT#2024-01-01-00:00:01; before : BOOL; same : BOOL;",
    body: "before := early < late; same := early = DT#2024-01-01-00:00:00;",
  },
  {
    // If DT counts 32-bit seconds, its maximum is DT#2106-02-07-06:28:15 and one more second wraps to the epoch.
    name: "date_width_wrap",
    vars: "dtMax : DT := DT#2106-02-07-06:28:15; oneSec : TIME := T#1S; over : DT;",
    body: "over := dtMax + oneSec;",
  },
  {
    // TOD#12:30:15.5 + T#12H read back as TIME_OF_DAY#0:30:15.500 — is the STORED value reduced modulo a day, or only
    // shown that way? The count that comes back decides; so does TOD#23:59:59.999 + T#1MS.
    name: "tod_wrap_representation",
    vars: [
      "noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H; wrapped : TOD; wrappedUnits : UDINT;",
      "lastMs : TOD := TOD#23:59:59.999; oneMs : TIME := T#1MS; overMidnight : TOD; overUnits : UDINT;",
    ].join("\n"),
    body: "wrapped := noon + halfDay; wrappedUnits := TOD_TO_UDINT(wrapped); overMidnight := lastMs + oneMs; overUnits := TOD_TO_UDINT(overMidnight);",
  },
  {
    // DT counts seconds and TIME milliseconds: does T#1500MS added to a DT truncate to one second, or round to two?
    name: "dt_plus_fractional_time",
    vars: "epoch : DT := DT#1970-01-01-00:00:00; t1500 : TIME := T#1500MS; later : DT; laterUnits : UDINT;",
    body: "later := epoch + t1500; laterUnits := DT_TO_UDINT(later);",
  },
  {
    name: "date_negative_difference",
    vars: "d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01; backwards : TIME; backwardsUnits : UDINT;",
    body: "backwards := d28 - mar1; backwardsUnits := TIME_TO_UDINT(backwards);",
  },
  {
    name: "dt_minus_time",
    vars: "dt1 : DT := DT#2024-03-01-00:00:00; oneSec : TIME := T#1S; earlier : DT;",
    body: "earlier := dt1 - oneSec;",
  },
  {
    name: "date_plus_time",
    vars: "d28 : DATE := D#2024-02-28; oneDay : TIME := T#1D; nextDay : DATE;",
    body: "nextDay := d28 + oneDay;",
  },
  {
    name: "ldate_ltod_ldt",
    vars: [
      "ldt1 : LDT := LDT#1970-01-01-00:00:01; oneNs : LTIME := LTIME#1NS; ldtPlus : LDT; ldtUnits : ULINT;",
      "ltod1 : LTOD := LTOD#00:00:01; ltodUnits : ULINT; ld1 : LDATE := LDATE#1970-01-02; ldateUnits : ULINT;",
    ].join("\n"),
    body: "ldtPlus := ldt1 + oneNs; ldtUnits := LDT_TO_ULINT(ldtPlus); ltodUnits := LTOD_TO_ULINT(ltod1); ldateUnits := LDATE_TO_ULINT(ld1);",
  },
  // ═══ phase 2 — STRING / WSTRING. tasks.md decides the shape (a fixed-size buffer with defined truncation, not Rust
  //     `String`); these measure the definitions. One question per case. ═══
  {
    name: "string_assign_truncation",
    vars: "short5 : STRING(5); long8 : STRING := 'abcdefgh'; fits : STRING(5); three : STRING := 'xyz';",
    body: "short5 := long8; fits := three;",
  },
  {
    // STRING without a length is STRING(80): does an 85-character value keep 80?
    name: "string_default_length",
    vars: `plain : STRING; longText : STRING(100) := '${"x".repeat(85)}'; plainLen : INT;`,
    body: "plain := longText; plainLen := LEN(plain);",
  },
  {
    name: "string_compare",
    vars: "abc : STRING := 'abc'; abd : STRING := 'abd'; bee : STRING := 'b'; upperA : STRING := 'A'; lowerA : STRING := 'a'; less : BOOL; same : BOOL; longerLess : BOOL; caseLess : BOOL;",
    body: "less := abc < abd; same := abc = 'abc'; longerLess := abc < bee; caseLess := upperA < lowerA;",
  },
  {
    name: "string_len_left_right_mid",
    vars: "hello : STRING := 'hello'; length : INT; leftTwo : STRING; rightThree : STRING; midTwoAtTwo : STRING;",
    body: "length := LEN(hello); leftTwo := LEFT(hello, 2); rightThree := RIGHT(hello, 3); midTwoAtTwo := MID(hello, 2, 2);",
  },
  {
    name: "string_concat",
    vars: "ab : STRING := 'ab'; cd : STRING := 'cd'; joined : STRING; tooShort : STRING(3);",
    body: "joined := CONCAT(ab, cd); tooShort := CONCAT(ab, cd);",
  },
  {
    name: "string_insert_delete_replace_find",
    vars: "abcd : STRING := 'abcd'; abcdef : STRING := 'abcdef'; inserted : STRING; deleted : STRING; replaced : STRING; found : INT;",
    body: "inserted := INSERT(abcd, 'XY', 2); deleted := DELETE(abcdef, 2, 3); replaced := REPLACE(abcdef, 'XY', 2, 3); found := FIND('abcabc', 'ca');",
  },
  {
    name: "string_edge_positions",
    vars: "abc : STRING := 'abc'; empty : STRING; leftBeyond : STRING; midAtZero : STRING; notFound : INT; emptyLen : INT; rightBeyond : STRING;",
    body: "leftBeyond := LEFT(abc, 5); midAtZero := MID(abc, 2, 0); notFound := FIND(abc, 'z'); emptyLen := LEN(empty); rightBeyond := RIGHT(abc, 9);",
  },
  {
    // `WLEN` / `WLEFT` do not exist without Standard64 — "Identifier 'WLEN' not defined" — and Standard's LEN/LEFT
    // refuse a WSTRING: "Cannot convert type 'WSTRING' to type 'STRING(255)'" (both measured 2026-09-14). So WSTRING is
    // measured without functions: truncation on store, the sizeless default (by comparing with a WSTRING(80)), ordering.
    name: "wstring_basic",
    vars: `wide : WSTRING := "héllo"; short3 : WSTRING(3); w80 : WSTRING(80) := "${"x".repeat(80)}"; longW : WSTRING(100) := "${"x".repeat(85)}"; plainW : WSTRING; sameAs80 : BOOL; shortLess : BOOL;`,
    body: "short3 := wide; plainW := longW; sameAs80 := plainW = w80; shortLess := short3 < wide;",
  },
  {
    // `wstring_basic` stored "héllo" into a WSTRING(3) as "hé" — the é took TWO places, which a UTF-16 WSTRING would not.
    // Is that how a WSTRING holds characters, or how the literal's source text reached the compiler? The same é as a
    // four-digit escape separates the two; ASCII and a second non-ASCII letter bound it.
    name: "wstring_code_units",
    vars: 'escaped : WSTRING(3) := "h$00E9llo"; direct : WSTRING(3) := "héllo"; ascii : WSTRING(3) := "hello"; escapedIsDirect : BOOL; umlaut : WSTRING(2) := "ü!";',
    body: "escapedIsDirect := escaped = direct;",
  },
  // ── consolidate-lsp-structure A12: a signed and an unsigned type of the SAME width — which one does the operation use? ──
  {
    // `wider` lets the LEFT operand win at equal rank, and only UDINT-on-the-left was ever measured
    // (`signed_unsigned_comparison`). DINT -1 and UDINT 0 tell the two apart: in DINT the sum is -1 and -1 < 0, in UDINT
    // the sum is 4294967295 and the comparison is FALSE. Both orders, and the 64-bit pair.
    name: "same_width_mixed_sign_order",
    // (`ld` is not a usable name — CODESYS reserves the IL operator `LD`: "Unexpected token 'ld' found")
    vars: "d : DINT := -1; u : UDINT := 0; bigNeg64 : LINT := -1; bigZero64 : ULINT := 0; sumDU : LINT; sumUD : LINT; lessDU : BOOL; lessUD : BOOL; lessLong : BOOL; lessLongRev : BOOL;",
    body: "sumDU := d + u; sumUD := u + d; lessDU := d < u; lessUD := u > d; lessLong := bigNeg64 < bigZero64; lessLongRev := bigZero64 > bigNeg64;",
  },
  {
    // The int pairs above meet in the SIGNED type whichever side it is on. A bit string has the same width as its int
    // (DWORD/DINT) but is a different family — does it follow the same rule?
    name: "same_width_bitstring_sign",
    vars: "dw : DWORD := 0; di : DINT := -1; sumDwDi : LINT; sumDiDw : LINT; greaterDw : BOOL; lessDi : BOOL;",
    body: "sumDwDi := dw + di; sumDiDw := di + dw; greaterDw := dw > di; lessDi := di < dw;",
  },
  {
    // transpile-review-2026-09-29 task 1: at DIFFERENT widths, does the wider UNSIGNED operand decide the sign? The
    // checked meet says no — ULINT + SINT is named LINT, DWORD + SINT DINT (`fixtures/operators/mixed-type.ts`) — but
    // only the name was asked, never the value. A negative narrow signed operand tells them apart: in the unsigned
    // type 6 / -2 is 0, 0 > -2 is FALSE, 7 MOD -2 is 7 and MIN(7, -2) is 7. (`s` is not a usable name — CODESYS reserves the IL operator `S`.)
    name: "meet_mixed_sign_wider_unsigned",
    vars: "ul : ULINT := 6; sn : SINT := -2; w : DWORD := 10; i : INT := -2; z : DWORD := 0; ud : UDINT := 7; divUlS : LINT; divWI : LINT; gtZI : BOOL; gtUlS : BOOL; modUdI : LINT; minUdI : LINT;",
    body: "divUlS := ul / sn; divWI := w / i; gtZI := z > i; gtUlS := ul > sn; modUdI := ud MOD i; minUdI := MIN(ud, i);",
  },
  {
    // transpile-review-2026-09-29 task 2: a named CONSTANT initialised from a LITERAL its type cannot hold — does a
    // use of it see the literal, or the value its slot holds? Asked where the fold is the only answer: an initializer
    // and a CASE label (the `END_VAR VAR CONSTANT` splice declares the constants inside PLC_PRG).
    name: "named_const_literal_wrap",
    vars: "x : DINT := C; y : DINT; xn : DINT := N; sw : INT := -25536; res : INT; END_VAR VAR CONSTANT C : INT := 40000; N : SINT := 200;",
    body: "y := C; CASE sw OF C: res := 1; ELSE res := 2; END_CASE",
  },
  {
    // task 2's other half: a constant initialised from a constant EXPRESSION that overflows its type.
    name: "named_const_expression_keeps",
    // CODESYS reads D back as SINT#128 and E as USINT#258 — the constant is its unwrapped fold, not a stored SINT — and
    // `d2 := D` is 128 (transpile-review task 2.3: the constant's slot takes the width that holds it).
    vars: "d1 : INT := D; e1 : INT := E; d2 : INT; e2 : INT; END_VAR VAR CONSTANT K : SINT := 127; D : SINT := K + 1; U : USINT := 255; E : USINT := U + 3;",
    body: "d2 := D; e2 := E;",
  },
  {
    // transpile-review-2026-09-29 task 3: at what width does a constant fold over REAL? Each initializer `iX` has a
    // runtime twin `rX` assigned the identical expression: a REAL constant named alone, a REAL sum past float32's
    // integer range, a REAL quotient, a REAL# literal inside an expression, a REAL difference whose intermediate is
    // past float32's range, and an LREAL constant initialised from a REAL one.
    name: "real_constant_fold_width",
    vars: "iRef : LREAL := C01; rRef : LREAL; iAdd : LREAL := CBig + 1; rAdd : LREAL; iDiv : LREAL := C1 / C3; rDiv : LREAL; iLit : LREAL := REAL#0.1 * 1; rLit : LREAL; iBig : LREAL := (CBig + 1) - CBig; rBig : LREAL; iChain : LREAL := DChain; rChain : LREAL; END_VAR VAR CONSTANT C01 : REAL := 0.1; CBig : REAL := 16777216; C1 : REAL := 1; C3 : REAL := 3; DChain : LREAL := C01;",
    body: "rRef := C01; rAdd := CBig + 1; rDiv := C1 / C3; rLit := REAL#0.1 * 1; rBig := (CBig + 1) - CBig; rChain := DChain;",
  },
  // ── consolidate-lsp-structure A3: does a typed literal's prefix decide its type? Lowering ignores it ──
  {
    // `REAL#0.1` is float32's 0.1 if the prefix types it; lowering types a real literal by context, so into an LREAL it
    // would be float64's 0.1 — the digits differ.
    name: "typed_literal_real_prefix",
    vars: "fromReal : LREAL; fromLreal : LREAL; untyped : LREAL;",
    body: "fromReal := REAL#0.1; fromLreal := LREAL#0.1; untyped := 0.1;",
  },
  {
    // All-constant arithmetic folds at full width when untyped (`constant_arithmetic_width`). With a type prefix on both
    // operands — does it fold in that type (INT 30000 + 30000 wraps), or still at full width?
    name: "typed_literal_constant_fold",
    vars: "intSum : DINT; usintSum : INT; mixedSum : DINT;",
    body: "intSum := INT#30000 + INT#30000; usintSum := USINT#200 + USINT#100; mixedSum := INT#30000 + 30000;",
  },
  // ── transpiler review 2026-09-14: two suspected bugs, recorded before any fix — neither is one ──
  // An untyped literal out of its target's range was suspected to reach the emitter as `300u8`, which rustc rejects. It
  // cannot: CODESYS does not compile it (the transpiler's input contract), while a negative literal into USINT wraps.
  {
    name: "literal_out_of_range_init",
    vars: "b300 : BYTE := 300; bIn : INT;",
    body: "bIn := b300;",
    rejects: "Cannot convert type 'INT' to type 'BYTE'",
  },
  {
    name: "literal_out_of_range_assign",
    vars: "si : SINT; siIn : INT;",
    body: "si := 300; siIn := si;",
    rejects: "Cannot convert type 'INT' to type 'SINT'",
  },
  { name: "literal_negative_into_unsigned", vars: "us : USINT; usIn : INT;", body: "us := -1; usIn := us;" },
  {
    // A FOR counter stepping past its type's maximum was suspected to wrap only in the transpiler (the step adds in the
    // counter's own type, not promoted). CODESYS wraps it too: `runs` hits the guard (11) and the SINT counter reads -121.
    name: "for_at_type_max",
    vars: "i : SINT; runs : INT;",
    body: "FOR i := 125 TO 127 DO runs := runs + 1; IF runs > 10 THEN EXIT; END_IF END_FOR",
  },
  // ── transpiler review 2026-09-14: CONTINUE — the emitted Rust's `continue` skips a FOR's step and a REPEAT's UNTIL,
  //    where the interpreter runs both. Neither was ever recorded. Each loop has a guard, so a CONTINUE that skips the
  //    step cannot hang the simulator: `guard` counts iterations and EXITs past 20. ──
  {
    name: "continue_in_for",
    vars: "i : INT; counted : INT; guard : INT;",
    body: "FOR i := 1 TO 5 DO guard := guard + 1; IF guard > 20 THEN EXIT; END_IF IF i = 3 THEN CONTINUE; END_IF counted := counted + 1; END_FOR",
  },
  {
    name: "continue_in_while",
    vars: "k : INT; counted : INT; guard : INT;",
    body: "WHILE k < 5 DO guard := guard + 1; IF guard > 20 THEN EXIT; END_IF k := k + 1; IF k = 3 THEN CONTINUE; END_IF counted := counted + 1; END_WHILE",
  },
  {
    name: "continue_in_repeat",
    vars: "j : INT; counted : INT; guard : INT;",
    body: "REPEAT guard := guard + 1; IF guard > 20 THEN EXIT; END_IF j := j + 1; IF j < 3 THEN CONTINUE; END_IF counted := counted + 1; UNTIL j >= 5 END_REPEAT",
  },
  // ── code CODESYS does not compile — the transpiler's input contract (`rejects`, wording as recorded 2026-09-14) ──
  { name: "power_operator_rejected", vars: "base : INT := 2; result : INT;", body: "result := base ** 2;", rejects: "Unexpected token '**' found" },
  { name: "ampersand_operator_rejected", vars: "a : BOOL; b : BOOL; both : BOOL;", body: "both := a & b;", rejects: "Unexpected token '&' found" },
  {
    name: "standard_len_wstring_rejected",
    vars: "wide : WSTRING; n : INT;",
    body: "n := LEN(wide);",
    rejects: "Cannot convert type 'WSTRING' to type 'STRING(255)'",
  },
  {
    name: "string_arithmetic_rejected",
    vars: "left : STRING := 'x'; right : STRING := 'y'; joined : STRING;",
    body: "joined := left + right;",
    rejects: "Cannot convert type 'STRING' to type 'ANY_NUM'",
  },
  {
    name: "bit_index_out_of_range_rejected",
    vars: "word16 : INT; flag : BOOL;",
    body: "flag := word16.16;",
    rejects: "'16' is no valid bit number for 'word16'",
  },
  {
    // A STRING never meets a WSTRING implicitly — not stored into one, not compared with one — so lowering has no
    // STRING/WSTRING rule at all (it had a `string-width` refusal until this was recorded).
    name: "string_wstring_mixing",
    rejects: "Cannot compare type 'STRING' with type 'WSTRING'",
    vars: "narrow : STRING := 'abc'; wide : WSTRING := \"abc\"; intoWide : WSTRING; intoNarrow : STRING; same : BOOL;",
    body: "intoWide := narrow; intoNarrow := wide; same := narrow = wide;",
  },
  // transpile-restructure 6.13 (RC 38's appendix line): a store THROUGH A REFERENCE is the implicit store into its target
  // — a STRING into an INT, an INT into a STRING, a STRING into a WSTRING, each refused (CODESYS record:exec 2026-10-09:
  // "Cannot convert type 'STRING' to type 'REFERENCE TO INT'") — and the explicit conversion beside them (12).
  {
    name: "tr_38_ref_store_string_into_int",
    vars: "v : INT; str : STRING := '12'; ri : REFERENCE TO INT;",
    body: "ri REF= v; ri := str;",
    rejects: "Cannot convert type 'STRING' to type 'REFERENCE TO INT'",
  },
  {
    name: "tr_38_ref_store_int_into_string",
    vars: "i : INT := 5; s1 : STRING; rs : REFERENCE TO STRING;",
    body: "rs REF= s1; rs := i;",
    rejects: "Cannot convert type 'INT' to type 'REFERENCE TO STRING'",
  },
  {
    name: "tr_38_ref_store_string_into_wstring",
    vars: "str : STRING := 'ab'; w : WSTRING; rw : REFERENCE TO WSTRING;",
    body: "rw REF= w; rw := str;",
    rejects: "Cannot convert type 'STRING' to type 'REFERENCE TO WSTRING'",
  },
  {
    name: "tr_38_ref_store_explicit_conversion",
    vars: "v : INT; str : STRING := '12'; ri : REFERENCE TO INT; readBack : INT;",
    body: "ri REF= v; ri := STRING_TO_INT(str); readBack := v;",
  },
  {
    // The AST keeps a literal's `$` escapes raw ('a$Tb' is four characters of text); CODESYS counts one per escape?
    name: "string_escapes",
    vars: "tabbed : STRING := 'a$Tb'; dollar : STRING := 'x$$y'; tabbedLen : INT; dollarLen : INT;",
    body: "tabbedLen := LEN(tabbed); dollarLen := LEN(dollar);",
  },
  {
    // The other escapes, each identified by comparing it with its hex spelling — `$N` might be CR LF, and a lower-case
    // escape might not be the same one.
    name: "string_escapes_named",
    vars: "nl : STRING := '$N'; lf : STRING := '$L'; cr : STRING := '$R'; pg : STRING := '$P'; quote : STRING := '$''; dq : STRING := '$\"'; hexA : STRING := '$41'; lowerT : STRING := '$t'; nlLen : INT; nlIsLf : BOOL; lfIs0A : BOOL; crIs0D : BOOL; pgIs0C : BOOL; quoteIs27 : BOOL; dqIs22 : BOOL; hexIsA : BOOL; lowerIsTab : BOOL;",
    body: "nlLen := LEN(nl); nlIsLf := nl = lf; lfIs0A := lf = '$0A'; crIs0D := cr = '$0D'; pgIs0C := pg = '$0C'; quoteIs27 := quote = '$27'; dqIs22 := dq = '$22'; hexIsA := hexA = 'A'; lowerIsTab := lowerT = '$T';",
  },
  {
    // positions at or below zero
    name: "string_positions_low",
    vars: "abc : STRING := 'abc'; leftNeg : STRING; leftZero : STRING; midPosZero : STRING; insertZero : STRING; deleteLenZero : STRING; replacePosZero : STRING; findEmpty : INT;",
    body: "leftNeg := LEFT(abc, -1); leftZero := LEFT(abc, 0); midPosZero := MID(abc, 1, 0); insertZero := INSERT(abc, 'XY', 0); deleteLenZero := DELETE(abc, 0, 1); replacePosZero := REPLACE(abc, 'XY', 1, 0); findEmpty := FIND(abc, '');",
  },
  {
    // positions past the end
    name: "string_positions_high",
    vars: "abc : STRING := 'abc'; midBeyond : STRING; midPastEnd : STRING; insertBeyond : STRING; insertAtEnd : STRING; deleteBeyond : STRING; deletePastEnd : STRING; replaceBeyond : STRING; replacePastEnd : STRING; findAtEnd : INT;",
    body: "midBeyond := MID(abc, 2, 5); midPastEnd := MID(abc, 4, 2); insertBeyond := INSERT(abc, 'XY', 5); insertAtEnd := INSERT(abc, 'XY', 3); deleteBeyond := DELETE(abc, 2, 5); deletePastEnd := DELETE(abc, 5, 2); replaceBeyond := REPLACE(abc, 'XY', 2, 5); replacePastEnd := REPLACE(abc, 'XY', 5, 2); findAtEnd := FIND(abc, 'c');",
  },
  {
    // Standard's parameters are STRING(255): is a longer argument cut to 255 on the way in?
    name: "string_input_truncation",
    vars: `long300 : STRING(300) := '${"y".repeat(300)}'; len300 : INT; leftAll : STRING(300); concatLen : INT;`,
    body: "len300 := LEN(long300); leftAll := LEFT(long300, 300); concatLen := LEN(CONCAT(long300, 'x'));",
  },
  {
    // the formats and parses string_conversions did not pin down
    name: "string_conversions_more",
    vars: "flag : BOOL := TRUE; dur : TIME := T#1S500MS; bigNeg : LINT := -9223372036854775807; byteV : BYTE := 255; spaced : STRING := ' 12'; plus : STRING := '+5'; emptyS : STRING; huge : STRING := '99999'; realS : STRING := '2.5'; tBool : STRING; tTime : STRING; tLint : STRING; tByte : STRING; pSpaced : INT; pPlus : INT; pEmpty : INT; pHuge : INT; pReal : REAL;",
    body: "tBool := BOOL_TO_STRING(flag); tTime := TIME_TO_STRING(dur); tLint := LINT_TO_STRING(bigNeg); tByte := BYTE_TO_STRING(byteV); pSpaced := STRING_TO_INT(spaced); pPlus := STRING_TO_INT(plus); pEmpty := STRING_TO_INT(emptyS); pHuge := STRING_TO_INT(huge); pReal := STRING_TO_REAL(realS);",
  },
  {
    name: "string_conversions",
    vars: "minus42 : INT := -42; digits : STRING := '123'; mixed : STRING := '12abc'; asText : STRING; parsed : INT; parsedMixed : INT;",
    body: "asText := INT_TO_STRING(minus42); parsed := STRING_TO_INT(digits); parsedMixed := STRING_TO_INT(mixed);",
  },
  {
    // where REAL_TO_STRING switches to an exponent (1E10 did, 3.0 did not), float64 digits, the other texts, the parse
    // edges, and INSERT at a negative position (REPLACE's measurements imply it prepends)
    name: "string_conversions_formats",
    vars: "flagOff : BOOL; zeroT : TIME; dayT : TIME := T#1D2H; tOff : STRING; tZeroT : STRING; tDayT : STRING; sReal : STRING := ' 1.5abc'; sExp : STRING := '1E3'; sMinusSpace : STRING := '- 5'; sTab : STRING := '$T7'; abc : STRING := 'abc'; pRealMixed : REAL; pExp : REAL; pMinusSpace : INT; pTab : INT; insertNeg : STRING;",
    body: "tOff := BOOL_TO_STRING(flagOff); tZeroT := TIME_TO_STRING(zeroT); tDayT := TIME_TO_STRING(dayT); pRealMixed := STRING_TO_REAL(sReal); pExp := STRING_TO_REAL(sExp); pMinusSpace := STRING_TO_INT(sMinusSpace); pTab := STRING_TO_INT(sTab); insertNeg := INSERT(abc, 'XY', -1);",
  },
  {
    // Every REAL/LREAL → STRING sample in one case, so the conversions that ARE one rule stay green without it. It looked
    // like 7 significant digits, fixed from 1E-4 up to below 1E8, else '1E08' / '1E-05' — and 123456792 printed EIGHT
    // ('1.2345679E08'). Not one rule; refused (design §18).
    name: "real_to_string_digits",
    deferred: "REAL_TO_STRING stays refused — no single digit rule fits (user decision 2026-09-14)",
    vars: "onePointFive : REAL := 1.5; three : REAL := 3.0; tenth : REAL := 0.1; big : REAL := 1.0E10; negHalf : REAL := -2.5; rE6 : REAL := 1.0E6; rE7 : REAL := 1.0E7; rE8 : REAL := 1.0E8; rMixed : REAL := 123456.7; rMilli : REAL := 0.001; rE4neg : REAL := 0.0001; rE5neg : REAL := 1.0E-5; r2p24 : REAL := 16777216.0; lTenth : LREAL := 0.1; realText : STRING; t3 : STRING; t01 : STRING; t1e10 : STRING; tNeg : STRING; tE6 : STRING; tE7 : STRING; tE8 : STRING; tMixed : STRING; tMilli : STRING; tE4neg : STRING; tE5neg : STRING; t2p24 : STRING; tLTenth : STRING; sciFraction : REAL := 1.5E8; nineDigits : REAL := 123456789.0; roundsUp : REAL := 99999990.0; tieToEven : REAL := 1234566.5; tieToOdd : REAL := 1234567.5; zero : REAL; hundred : REAL := 100.0; fiveDigits : REAL := 0.00012345; tiny : REAL := 2.5E-10; largest : REAL := 3.4028235E38; negSci : REAL := -1.0E8; tSciFraction : STRING; tNineDigits : STRING; tRoundsUp : STRING; tTieToEven : STRING; tTieToOdd : STRING; tZero : STRING; tHundred : STRING; tFiveDigits : STRING; tTiny : STRING; tLargest : STRING; tNegSci : STRING;",
    body: "realText := REAL_TO_STRING(onePointFive); t3 := REAL_TO_STRING(three); t01 := REAL_TO_STRING(tenth); t1e10 := REAL_TO_STRING(big); tNeg := REAL_TO_STRING(negHalf); tE6 := REAL_TO_STRING(rE6); tE7 := REAL_TO_STRING(rE7); tE8 := REAL_TO_STRING(rE8); tMixed := REAL_TO_STRING(rMixed); tMilli := REAL_TO_STRING(rMilli); tE4neg := REAL_TO_STRING(rE4neg); tE5neg := REAL_TO_STRING(rE5neg); t2p24 := REAL_TO_STRING(r2p24); tLTenth := LREAL_TO_STRING(lTenth); tSciFraction := REAL_TO_STRING(sciFraction); tNineDigits := REAL_TO_STRING(nineDigits); tRoundsUp := REAL_TO_STRING(roundsUp); tTieToEven := REAL_TO_STRING(tieToEven); tTieToOdd := REAL_TO_STRING(tieToOdd); tZero := REAL_TO_STRING(zero); tHundred := REAL_TO_STRING(hundred); tFiveDigits := REAL_TO_STRING(fiveDigits); tTiny := REAL_TO_STRING(tiny); tLargest := REAL_TO_STRING(largest); tNegSci := REAL_TO_STRING(negSci);",
  },
  {
    // STRING_TO_REAL reads a prefix (' 1.5abc' is 1.5, '1E3' is 1000); its edges
    name: "string_to_real_parse",
    vars: "sDotFirst : STRING := '.5'; sDotLast : STRING := '5.'; sBareExp : STRING := '1.5E'; sLowerExp : STRING := '2e2'; sNeg : STRING := ' -2.5'; sWord : STRING := 'abc'; sTabbed : STRING := '$T3.25'; sComma : STRING := '1,5'; sLong : STRING := '1.23456789'; pDotFirst : REAL; pDotLast : REAL; pBareExp : REAL; pLowerExp : REAL; pNeg : REAL; pWord : REAL; pTabbed : REAL; pComma : REAL; pLong : REAL; lLong : LREAL;",
    body: "pDotFirst := STRING_TO_REAL(sDotFirst); pDotLast := STRING_TO_REAL(sDotLast); pBareExp := STRING_TO_REAL(sBareExp); pLowerExp := STRING_TO_REAL(sLowerExp); pNeg := STRING_TO_REAL(sNeg); pWord := STRING_TO_REAL(sWord); pTabbed := STRING_TO_REAL(sTabbed); pComma := STRING_TO_REAL(sComma); pLong := STRING_TO_REAL(sLong); lLong := STRING_TO_LREAL(sLong);",
  },
  // ── CASE range edges ──
  {
    name: "case_range_edges",
    vars: "s0 : INT := 0; s1 : INT := 1; s5 : INT := 5; s6 : INT := 6; r0 : INT; r1 : INT; r5 : INT; r6 : INT;",
    body: [
      "CASE s0 OF 1..5: r0 := 1; ELSE r0 := 2; END_CASE",
      "CASE s1 OF 1..5: r1 := 1; ELSE r1 := 2; END_CASE",
      "CASE s5 OF 1..5: r5 := 1; ELSE r5 := 2; END_CASE",
      "CASE s6 OF 1..5: r6 := 1; ELSE r6 := 2; END_CASE",
    ].join("\n"),
  },
]
