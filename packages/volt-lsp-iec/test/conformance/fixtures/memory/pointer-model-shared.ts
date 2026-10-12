/**
 * the helpers `pointer-model.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
export const doc = "openspec transpile-restructure design.md §3.3 (task 4.1)"

export const doc413 = "openspec transpile-restructure design.md §3.3 Decision (step 4f), task 4.13"

// ─── transpile-restructure 8.2 (design.md §7.2 Decision step 8c): the NaN bits and the BOOL byte, recorded first ───
// RECORDED (CODESYS 3.5.21.40, record:exec 2026-10-11) and modelled: a NaN is its bits (`semantics/nan.ts`, the cells in
// `semantics/nan.cases.ts`) — an operation answers its first NaN operand quieted, NEG keeps the sign and ABS clears it, a
// NaN made from no NaN is 16#FFC00000, REAL <-> LREAL moves the payload, a copy or a select carries it as it is; a BOOL whose
// byte another type reaches is held as its BYTE (`lower/pointers/raw-bool.ts`) — AND / OR / XOR the bytes, NOT bit 0
// inverted, = and <> the bytes, IF non-zero, BOOL_TO_INT / BYTE bit 0, a copy and a FUNCTION input the byte.
export const doc82 = "openspec transpile-restructure design.md §7.2 Decision (step 8c), task 8.2"

/**
 * An FB's rows whose every result is a REAL (LREAL) stored into the scratch `res` (`lr`) and read back as its BITS through
 * a pointer, so a NaN's sign and payload are recorded and not only its being a NaN. A row is `[name, expression, type]`;
 * its bits land in the DWORD (LWORD) `w<name>`. Every operand is a variable loaded through a pointer, so no compile-time
 * fold stands in for the run-time operation.
 */
export function bitsRows(rows: readonly (readonly [string, string, "REAL" | "LREAL"])[]): { vars: string; body: string } {
  const vars = rows.map(([name, , t]) => `\tw${name} : ${t === "REAL" ? "DWORD" : "LWORD"};\n`).join("")
  const body = rows
    .map(([name, expr, t]) =>
      t === "REAL" ? `res := ${expr};\npd := ADR(res);\nw${name} := pd^;\n` : `lr := ${expr};\npq := ADR(lr);\nw${name} := pq^;\n`,
    )
    .join("")
  return { vars, body }
}

// REAL: an operand NaN — signalling (sig, 16#7FA00000), quiet with a payload (pay, 16#7FC12345), negative (neg,
// 16#FFC00000), negative signalling with a payload (negSig, 16#FF812345) — through + - * / in both operand orders, two NaN operands in both
// orders, negation, ABS, a plain copy, SQRT / LN / LOG / EXP / EXPT of a NaN; the NaNs an operation makes from non-NaN
// operands (LN(-1), ASIN(2), inf - inf, inf * 0); and a NaN compared and converted to an integer.
export const NAN_REAL_ROWS = [
  ["AddSOne", "sig + one"], ["AddOneS", "one + sig"], ["SubSOne", "sig - one"], ["SubOneS", "one - sig"],
  ["MulSOne", "sig * one"], ["MulOneS", "one * sig"], ["DivSOne", "sig / one"], ["DivOneS", "one / sig"],
  ["AddPOne", "pay + one"], ["AddOneP", "one + pay"], ["AddNOne", "neg + one"], ["AddOneNS", "one + negSig"],
  ["AddSP", "sig + pay"], ["AddPS", "pay + sig"], ["AddPN", "pay + neg"], ["AddNP", "neg + pay"],
  ["MulNSP", "negSig * pay"], ["MulPNS", "pay * negSig"], ["SubPS", "pay - sig"], ["SubSP", "sig - pay"],
  ["NegS", "-sig"], ["NegP", "-pay"], ["NegN", "-neg"], ["AbsN", "ABS(neg)"], ["AbsNS", "ABS(negSig)"],
  ["CopyS", "sig"], ["CopyNS", "negSig"],
  ["SqrtS", "SQRT(sig)"], ["SqrtP", "SQRT(pay)"], ["SqrtN", "SQRT(neg)"], ["LnP", "LN(pay)"], ["LogP", "LOG(pay)"], ["ExpP", "EXP(pay)"],
  ["ExptPTwo", "EXPT(pay, two)"], ["ExptTwoP", "EXPT(two, pay)"],
  ["LnMinusOne", "LN(zero - one)"], ["AsinTwo", "ASIN(two)"], ["InfMinusInf", "pinf - pinf"], ["InfTimesZero", "pinf * zero"],
].map(([n, e]) => [n!, e!, "REAL"] as const)

export const nanReal = bitsRows(NAN_REAL_ROWS)

// LREAL: the same operand classes in 64 bits (sig 16#7FF4000000000000, pay 16#7FF8000000012345, neg 16#FFF8000000000000),
// and the two conversions: REAL → LREAL of a REAL NaN (fs, fp, fn, fns as above), LREAL → REAL of an LREAL NaN whose payload
// sits in the low bits (pay), the high bits (high 16#7FF8123400000000, highSig 16#7FF1234500000000 signalling) or nowhere
// (neg); and a REAL NaN beside an LREAL in one expression (the REAL converted first).
export const NAN_LREAL_ROWS = [
  ...[
    ["AddSOne", "sig + one"], ["AddOneS", "one + sig"], ["SubOneS", "one - sig"], ["MulOneP", "one * pay"],
    ["AddSP", "sig + pay"], ["AddPS", "pay + sig"], ["AddPN", "pay + neg"], ["AddNP", "neg + pay"],
    ["NegP", "-pay"], ["AbsN", "ABS(neg)"], ["CopyS", "sig"],
    ["SqrtS", "SQRT(sig)"], ["SqrtP", "SQRT(pay)"], ["LnP", "LN(pay)"], ["ExpP", "EXP(pay)"],
    ["LnMinusOne", "LN(zero - one)"], ["AsinTwo", "ASIN(two)"], ["InfMinusInf", "pinf - pinf"],
    ["FromFS", "REAL_TO_LREAL(fs)"], ["FromFP", "REAL_TO_LREAL(fp)"], ["FromFN", "REAL_TO_LREAL(fn)"], ["FromFNS", "REAL_TO_LREAL(fns)"],
    ["MixPOne", "fp + one"], ["MixOneP", "one + fp"], ["MixFSP", "fs + pay"], ["MixPFS", "pay + fs"],
  ].map(([n, e]) => [n!, e!, "LREAL"] as const),
  ...[
    ["ToS", "LREAL_TO_REAL(sig)"], ["ToP", "LREAL_TO_REAL(pay)"], ["ToHi", "LREAL_TO_REAL(high)"], ["ToHiS", "LREAL_TO_REAL(highSig)"],
    ["ToN", "LREAL_TO_REAL(neg)"],
  ].map(([n, e]) => [n!, e!, "REAL"] as const),
]

export const nanLreal = bitsRows(NAN_LREAL_ROWS)

// The second round, asked by the first's answers (an operand NaN comes out quieted, ABS clears its sign, a copy keeps it):
// the trigonometric functions of a NaN (x87, design.md §7.2), ABS of a positive signalling NaN, EXPT with a NaN base and a
// zero exponent, and whether the selects — MAX, MIN, LIMIT, SEL, MUX — carry a signalling NaN unquieted, as a copy does.
export const NAN_SELECT_ROWS = [
  ...[
    ["SinP", "SIN(pay)"], ["CosP", "COS(pay)"], ["TanP", "TAN(pay)"], ["AsinP", "ASIN(pay)"], ["AcosP", "ACOS(pay)"],
    ["AtanP", "ATAN(pay)"], ["SinS", "SIN(sig)"], ["AbsS", "ABS(sig)"], ["ExptSTwo", "EXPT(sig, two)"],
    ["ExptPZero", "EXPT(pay, zero)"], ["MaxOneS", "MAX(one, sig)"], ["MaxSOne", "MAX(sig, one)"], ["MinOneS", "MIN(one, sig)"],
    ["LimitZeroOneS", "LIMIT(zero, one, sig)"], ["SelS", "SEL(TRUE, one, sig)"], ["MuxS", "MUX(1, one, sig)"],
  ].map(([n, e]) => [n!, e!, "REAL"] as const),
  ...[
    ["LSinP", "SIN(lpay)"], ["LAtanP", "ATAN(lpay)"], ["LAbsS", "ABS(lsig)"], ["LMaxOneS", "MAX(lone, lsig)"],
    ["LSelS", "SEL(TRUE, lone, lsig)"],
  ].map(([n, e]) => [n!, e!, "LREAL"] as const),
]

export const nanSelect = bitsRows(NAN_SELECT_ROWS)

/** The BOOL-byte rows: a result BOOL stored into the scratch `res` and read back as its BYTE (`y<name>`). */
export function byteRows(rows: readonly (readonly [string, string])[]): { vars: string; body: string } {
  return {
    vars: rows.map(([name]) => `\ty${name} : BYTE;\n`).join(""),
    body: rows.map(([name, expr]) => `res := ${expr};\npb := ADR(res);\ny${name} := pb^;\n`).join(""),
  }
}

// For each of the bytes 2, 3 and 255 written into a BOOL through a POINTER TO BYTE: AND / OR / XOR with a TRUE or FALSE
// variable and with another such BOOL, NOT, the BOOL copied — every result's byte; then `<> TRUE`, `= FALSE`, `<> FALSE`,
// `=` of two such BOOLs, BOOL_TO_INT / BOOL_TO_BYTE, IF, a copy into a plain BOOL (no address taken) compared with TRUE and
// negated, and the BOOL given to a FUNCTION's input (BOOL_TO_BYTE of it there, and `= TRUE` there).
export const BOOL_BYTES = [2, 3, 255] as const

export const BOOL_BYTE_ROWS = BOOL_BYTES.flatMap((k) => [
  [`And${k}T`, `b${k} AND t`], [`And${k}F`, `b${k} AND f`], [`Or${k}F`, `b${k} OR f`], [`Or${k}T`, `b${k} OR t`],
  [`Xor${k}T`, `b${k} XOR t`], [`Xor${k}F`, `b${k} XOR f`], [`Not${k}`, `NOT b${k}`], [`Copy${k}`, `b${k}`],
] as const)

export const boolBytes = byteRows([
  ...BOOL_BYTE_ROWS,
  ["And2b3", "b2 AND b3"], ["Or2b3", "b2 OR b3"], ["Xor2b3", "b2 XOR b3"], ["And3b255", "b3 AND b255"], ["Xor3b255", "b3 XOR b255"],
])

export const boolPlain = BOOL_BYTES.map(
  (k) =>
    `ne${k}T := b${k} <> TRUE;\neq${k}F := b${k} = FALSE;\nne${k}F := b${k} <> FALSE;\nint${k} := BOOL_TO_INT(b${k});\nbyte${k} := BOOL_TO_BYTE(b${k});\n` +
    `if${k} := FALSE;\nIF b${k} THEN\n\tif${k} := TRUE;\nEND_IF\nc${k} := b${k};\ncEqT${k} := c${k} = TRUE;\ncNot${k} := NOT c${k};\n` +
    `fIn${k} := F_MEM_bool_in_byte(x := b${k});\nfEqT${k} := F_MEM_bool_in_eq(x := b${k});\n`,
).join("")

export const boolPlainVars = BOOL_BYTES.map(
  (k) =>
    `\tne${k}T : BOOL;\n\teq${k}F : BOOL;\n\tne${k}F : BOOL;\n\tint${k} : INT;\n\tbyte${k} : BYTE;\n\tif${k} : BOOL;\n\tc${k} : BOOL;\n` +
    `\tcEqT${k} : BOOL;\n\tcNot${k} : BOOL;\n\tfIn${k} : BYTE;\n\tfEqT${k} : BOOL;\n`,
).join("")

// Gate 8c's flows: an FB whose VAR_INPUT BOOL `x` is compared with TRUE, negated and converted — no address of it taken, so
// only the flow into the input can make it hold a byte; and the caller's result variables, for the bytes 2 and 255.
export const boolFlowQ = (name: string): string =>
  `FUNCTION_BLOCK ${name}\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tisT : BOOL;\n\tnx : BOOL;\n\txInt : INT;\nEND_VAR\nisT := x = TRUE;\nnx := NOT x;\nxInt := BOOL_TO_INT(x);\nEND_FUNCTION_BLOCK\n\n`

export const boolFlowOutVars = [2, 255].map((k) => `\tisT${k} : BOOL;\n\tnx${k} : BOOL;\n\txInt${k} : INT;\n`).join("")

export const boolFlowOutBody = [2, 255].map((k) => `isT${k} := q${k}.isT;\nnx${k} := q${k}.nx;\nxInt${k} := q${k}.xInt;\n`).join("")

/** Gate 8c's views: what a POINTER TO BOOL is given the address of, by row name. */
export const BOOL_VIEW_OF: Readonly<Record<string, string>> = { Y2: "y2", Y255: "y255", W: "w", Arr: "arr" }

export const BOOL_VIEWS = Object.keys(BOOL_VIEW_OF)
