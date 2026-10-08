/**
 * The EMISSION SHAPE of a fixture: its emitted Rust as constructs, each with a stable id, and its size against the ST
 * (split out of the confidence module, transpile-restructure 1.8.3).
 */
import { createHash } from "node:crypto"
// the string blob a string program starts with — a deep path, test support only (the runtime registry is not surface)
import { runtimeText } from "../../../../src/transpile/emit/rust/runtime/index.js"

// ── the emission shape ───────────────────────────────────────────────────────────────────────────────────────

/**
 * WHAT A FIXTURE'S EMITTED RUST LOOKS LIKE, with everything that is the FIXTURE'S rather than the EMITTER'S taken out
 * — the normalization the overnight review (transpile-review-2026-09-29) clustered 2,333 emissions with, moved here
 * verbatim so its ids are reproducible and the review's notes stay keyed to something that exists.
 *
 * One emitted line is one CONSTRUCT: identifiers become `x` (a variable), `f` (a field), `m(` (a call) or `T` (a
 * type); literals become `L` KEEPING their type suffix (an `i16` store and a `u8` store are different emissions);
 * string literals `S`/`B`; generated temporaries and loop labels `_N`; a run of identical list items `…`. Rust's own
 * words, the prelude's API and the emitter's fixed names are kept — they are the shape.
 */
const KEEP = new Set(
  (
    "as break const continue else enum false fn for if impl in let loop match mod move mut pub ref return self Self static struct " +
    "super trait true type unsafe use where while dyn " +
    "i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool usize isize char str String Vec Option Some None Ok Err Box " +
    "IecStr IecString IecWString Globals Programs Default default new scan call init fb_init __init after_global_init " +
    "std mem ops cmp array fmt from_fn replace swap take min max clamp abs from_bits to_bits " +
    "len is_ascii_digit push_str wrapping_add wrapping_sub wrapping_mul wrapping_div wrapping_rem wrapping_neg wrapping_abs " +
    "wrapping_shl wrapping_shr units unwrap is_empty div_euclid rem_euclid to unwrap_or parse collect is_nan is_infinite " +
    "contains map trim_end_matches to_string split_once push partial_cmp iter into filter copy_from_slice chars round " +
    "char_at with_char as_bytes trunc rotate_left rotate_right narrow widen powf ln sin cos tan asin acos atan sqrt exp log10 " +
    "clone lit iec_max iec_min iec_lreal_text iec_time_text iec_ltime_text iec_date_text iec_dt_text iec_tod_text " +
    "iec_parse_real iec_parse_int iec_civil panic INFINITY NEG_INFINITY NAN MIN MAX signum copied fold sum count " +
    "checked_add checked_sub checked_mul checked_div saturating_add saturating_sub pow trailing_zeros leading_zeros " +
    "allow derive Debug Clone PartialEq Copy non_camel_case_types dead_code g prg p v"
  ).split(/\s+/),
)

/** One emitted line as its construct. */
export function normalizeRustLine(line: string): string {
  let s = line.trim()
  s = s.replace(/\/\/.*$/, "")
  s = s.replace(/b"(?:[^"\\]|\\.)*"/g, "B").replace(/"(?:[^"\\]|\\.)*"/g, "S").replace(/b'(?:[^'\\]|\\.)'/g, "C")
  // numeric literals, keeping the type suffix
  s = s.replace(
    /\b(0x[0-9a-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(_?(?:i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize|f32|f64))?\b/g,
    (_m, _n, suffix: string | undefined) => `L${suffix ? suffix.replace("_", "") : ""}`,
  )
  // labels and generated temporaries
  s = s.replace(/'(loop|body)_\d+/g, "'$1_N").replace(/\b(__[a-z_]+?)_?\d+\b/g, "$1_N").replace(/\b(_[a-z_]+?)_\d+\b/g, "$1_N")
  // identifiers
  s = s.replace(/(\.)?\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g, (m, dot: string | undefined, id: string, call: string | undefined) => {
    if (id === "L" || id === "S" || id === "B" || id === "C" || /^L(i|u|f)\d+$/.test(id)) return m
    if (/^__?[a-z_]+_N$/.test(id) || /^(loop|body)_N$/.test(id) || id === "_") return m
    if (KEEP.has(id)) return m
    if (/_(get|set)$/.test(id) && call) return `${dot ?? ""}m_${id.endsWith("_get") ? "get" : "set"}${call}`
    const repl = call ? "m" : /^[A-Z]/.test(id) && !dot ? "T" : dot ? "f" : "x"
    return `${dot ?? ""}${repl}${call ?? ""}`
  })
  // collapse runs of an identical list item: `L, L, L` → `L, …`
  s = s.replace(/([^,[\]{}()]+)(?:,\s*\1)+/g, "$1, …")
  return s.replace(/\s+/g, " ").trim()
}

/** A normalized line that is punctuation of the construct around it — a brace, an attribute, a derive — not one. */
const BOILERPLATE = /^(\}|\{|\);?|\},?|\]|Self \{|#\[.*\]|impl .* \{|fn default\(\) -> Self \{|Self::new\(\)|pub fn new\(\) -> Self \{|\/\/.*|)$/

/** A construct's id: ten hex digits of its SHA-1, as the review printed them. */
export function shapeId(normalized: string): string {
  return createHash("sha1").update(normalized).digest("hex").slice(0, 10)
}

/** The lines of `code` that are the prelude every string-using POU carries whole — the emitter's, not the fixture's. */
export function preludeLines(code: string): number {
  return code.startsWith(runtimeText("string")) ? runtimeText("string").split("\n").length - 1 : 0
}

/**
 * A fixture's emission as its constructs, IN ORDER, and one id for the whole sequence.
 *
 * `shape` is what the map's row carries: two fixtures share it exactly when they emit the same constructs in the
 * same order, whatever their names and literals. `constructs` is what `NOTES` is keyed by — the unit the review
 * judged — and what a row's `notes` are joined through; `lines` is each construct as `normalizeRustLine` printed
 * it, parallel to `constructs`, which the map prints above each note. None of it depends on anything but the code:
 * no run order, no counter, no position in the corpus.
 */
export function emissionShape(code: string): { shape: string; constructs: readonly string[]; lines: readonly string[] } {
  const skip = preludeLines(code)
  const lines: string[] = []
  code.split("\n").forEach((raw, i) => {
    if (i < skip || raw.trim() === "") return
    const n = normalizeRustLine(raw)
    if (!BOILERPLATE.test(n)) lines.push(n)
  })
  const constructs = lines.map(shapeId)
  return { shape: shapeId(constructs.join("\n")), constructs, lines }
}

/**
 * Emitted Rust lines per ST line, to one decimal — non-blank lines on both sides, the prelude not counted (it is the
 * same 140 lines on every string POU and would make the column say "uses a STRING"), ST comment lines not counted.
 * The ST is the ASSEMBLED fixture — its POUs, the PLC_PRG that calls them and its GVLs — and NOT a library body it
 * pulls in, so a library call inflates the ratio; the review measured that too, and said so.
 */
export function sizeRatio(code: string, source: string, gvls: readonly { source: string }[]): number {
  const skip = preludeLines(code)
  const rust = code.split("\n").filter((l, i) => i >= skip && l.trim() !== "").length
  const stLines = (s: string): number => s.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^\s*\/\//.test(l)).length
  const st = stLines(source) + gvls.reduce((n, g) => n + stLines(g.source), 0)
  return Math.round((rust / st) * 10) / 10
}
